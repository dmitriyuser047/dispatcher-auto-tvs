'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const PDFLib = require('pdf-lib');
const { createCanvas } = require('@napi-rs/canvas');
const { copyPage } = require('../assets/js/40-pdf-page-model.js');
const { applyContentChanges } = require('../electron/pdf-content-engine.cjs');
const { loadPdfJs, pdfDocumentOptions } = require('../electron/pdfjs-runtime.cjs');

const { build } = require('../assets/js/39-pdf-export.js');
const exportPdf = options => build({ ...options, PDFLib });

function pageModel(index, extra = {}) {
  return { id: 'page-'+index, sourceId: 'original', sourcePage: index, width: 200, height: 200, baseTransform: [1,0,0,-1,0,200], rotation: 0, elements: [], ...extra };
}

async function sourceWithSharedSecret() {
  const doc = await PDFLib.PDFDocument.create();
  const retained = doc.addPage([200,200]), excluded = doc.addPage([200,200]);
  const image = color => { const canvas=createCanvas(20,20);const context=canvas.getContext('2d');context.fillStyle=color;context.fillRect(0,0,20,20);return canvas.toBuffer('image/png'); };
  const visible=await doc.embedPng(image('#1028e0')), secret=await doc.embedPng(image('#ed19e7'));
  retained.drawImage(visible,{x:20,y:20,width:160,height:160});
  excluded.drawImage(secret,{x:20,y:20,width:160,height:160});
  retained.drawText('RETAINED PAGE',{x:10,y:185,size:10});
  excluded.drawText('EXCLUDED-SECRET-2026',{x:10,y:185,size:10});
  // A real cross-page /Dest must not bring the excluded page back through the
  // annotation object graph, even after removal from the visible page tree.
  const link=doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Link',Rect:[0,0,10,10],Dest:[excluded.ref,'Fit']}));
  retained.node.set(PDFLib.PDFName.of('Annots'),doc.context.obj([link]));
  doc.setSubject('PRIVATE SOURCE METADATA');
  await doc.attach(Buffer.from('ATTACHMENT SECRET'),'secret.txt');
  // Finish image embedding before assigning an identifiable private resource.
  await doc.save();
  doc.context.lookup(secret.ref).dict.set(PDFLib.PDFName.of('PrivateResourceMarker'),PDFLib.PDFString.of('UNUSED-SHARED-SECRET-IMAGE'));
  const shared=doc.context.obj({});
  for(const page of [retained,excluded])for(const [name,value] of page.node.Resources().lookup(PDFLib.PDFName.of('XObject'),PDFLib.PDFDict).entries())shared.set(name,value);
  for(const page of [retained,excluded])page.node.Resources().set(PDFLib.PDFName.of('XObject'),shared);
  return new Uint8Array(await doc.save());
}

function allObjectText(doc) {
  return doc.context.enumerateIndirectObjects().map(([,object])=> {
    if(object instanceof PDFLib.PDFRawStream){
      let decoded='';try{decoded=Buffer.from(PDFLib.decodePDFRawStream(object).decode()).toString('latin1');}catch{}
      return object.dict.toString()+'\n'+decoded;
    }
    return object.toString();
  }).join('\n');
}

test('saving a retained page removes excluded streams, shared secret image, links and attachments', {timeout:120000}, async () => {
  const bytes=await sourceWithSharedSecret();
  const source=await PDFLib.PDFDocument.load(bytes);
  assert.match(allObjectText(source),/UNUSED-SHARED-SECRET-IMAGE/,'fixture really has a hidden shared resource');
  const warnings=[];
  const output=await exportPdf({
    sources:[{id:'original',name:'synthetic.pdf',bytes}],pages:[pageModel(0)],
    api:{processContent:async payload=> {
      assert.equal(payload.rasterizePages.length,1,'subset export must discard unused shared resources');
      const result=await applyContentChanges(Buffer.from(payload.bytesBase64,'base64'),payload.changes,{rasterizePages:payload.rasterizePages});
      return {ok:true,bytesBase64:result.bytes.toString('base64'),warnings:result.warnings,pages:result.pages};
    }},
    onWarnings:messages=>warnings.push(...messages),
  });
  const result=await PDFLib.PDFDocument.load(output);
  assert.equal(result.getPageCount(),1);
  assert.doesNotMatch(allObjectText(result),/EXCLUDED-SECRET|UNUSED-SHARED-SECRET|PRIVATE SOURCE METADATA|ATTACHMENT SECRET/);
  assert.equal(result.catalog.has(PDFLib.PDFName.of('Names')),false);
  assert.equal(result.getPage(0).node.Annots(),undefined);
  assert.ok(warnings.some(text=>text.includes('ресурсы')),'raster/privacy tradeoff is explained before saving');
  // Render the resulting page to ensure privacy did not blank the retained
  // visible image. No source font, hidden object or attachment is needed.
  const pdfjs=await loadPdfJs(),task=pdfjs.getDocument({...pdfDocumentOptions(),data:output.slice()});
  try{
    const document=await task.promise,page=await document.getPage(1),canvas=createCanvas(200,200);
    await page.render({canvasContext:canvas.getContext('2d'),viewport:page.getViewport({scale:1}),background:'#fff'}).promise;
    const pixel=canvas.getContext('2d').getImageData(100,100,1,1).data;
    assert.ok(pixel[2]>180&&pixel[0]<60,'retained blue image stays visible');
  }finally{await task.destroy();}
});

test('unchanged page sets retain vector text, independent duplicate pages and ordering', async () => {
  const doc=await PDFLib.PDFDocument.create();
  doc.addPage([200,200]).drawText('FIRST VECTOR PAGE',{x:20,y:100,size:12});
  doc.addPage([200,200]).drawText('SECOND VECTOR PAGE',{x:20,y:100,size:12});
  const bytes=new Uint8Array(await doc.save());
  const output=await exportPdf({sources:[{id:'original',bytes}],pages:[pageModel(1),pageModel(0),pageModel(0)],api:{processContent(){throw Error('all source pages retained; no raster needed');}}});
  const pdfjs=await loadPdfJs(),task=pdfjs.getDocument({...pdfDocumentOptions(),data:output});
  try{
    const pdf=await task.promise;assert.equal(pdf.numPages,3);
    const contents=[];for(let n=1;n<=pdf.numPages;n++)contents.push((await (await pdf.getPage(n)).getTextContent()).items.map(item=>item.str).join(''));
    assert.deepEqual(contents,['SECOND VECTOR PAGE','FIRST VECTOR PAGE','FIRST VECTOR PAGE']);
  }finally{await task.destroy();}
});

test('duplicated and restored OCR page data uses independent IDs with intact correction and table references', () => {
  const original=pageModel(0,{
    ocrAreas:[{id:'area',type:'table',x:10,y:10,w:100,h:60}],
    ocrLines:[{id:'ocr:line',origKey:'ocr:line',areaId:'area',text:'Original',x:10,y:10,w:50,h:10}],
    elements:[{id:'corrected',type:'text',origKey:'ocr:line',text:'Corrected'},{id:'native',type:'text',origKey:'source:0'}],
    ocrTables:[{id:'table',areaId:'area',bbox:{x:10,y:10,w:100,h:60},rows:[['preserved']]}],
    ocrEngines:[{areaId:'area'},{areaId:'full:page-0'}],
  });
  const duplicate=copyPage(original),restored=copyPage(original,{pageId:original.id});
  assert.notEqual(duplicate.id,original.id);
  assert.equal(restored.id,original.id,'restoring keeps page navigation stable');
  for(const copy of [duplicate,restored]){
    assert.notEqual(copy.ocrTables[0].id,original.ocrTables[0].id);
    assert.notEqual(copy.ocrAreas[0].id,original.ocrAreas[0].id);
    assert.notEqual(copy.ocrLines[0].id,original.ocrLines[0].id);
    assert.equal(copy.ocrTables[0].areaId,copy.ocrAreas[0].id);
    assert.equal(copy.ocrLines[0].areaId,copy.ocrAreas[0].id);
    assert.equal(copy.elements[0].origKey,copy.ocrLines[0].origKey);
    assert.equal(copy.elements[1].origKey,'source:0');
    assert.equal(copy.ocrEngines[1].areaId,'full:'+copy.id);
  }
  duplicate.ocrTables[0].rows[0][0]='Changed in duplicate';
  assert.equal(original.ocrTables[0].rows[0][0],'preserved');
});
