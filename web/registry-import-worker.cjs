'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parentPort,workerData}=require('node:worker_threads');
const core=require('../assets/core/registry-import.js');
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const clean=value=>Object.prototype.toString.call(value)==='[object Date]'?value.toISOString().slice(0,10):value==null?'':String(value);
function unique(values,tolerance=.5){const result=[];for(const value of values.sort((a,b)=>a-b))if(!result.length||value-result.at(-1)>tolerance)result.push(value);return result;}
async function pdf(bytes){
  const runtime=require('../electron/pdfjs-runtime.cjs'),pdfjs=await runtime.loadPdfJs();
  const task=pdfjs.getDocument({...runtime.pdfDocumentOptions(),data:new Uint8Array(bytes),disableFontFace:true});
  try{
    const document=await task.promise;if(document.numPages>100)fail('REGISTRY_LIMIT','В одном PDF допускается до 100 страниц.');
    const grid=[],rowPages=[],preamble=[];let current=null,currentPage=0,textBytes=0;
    for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
      const page=await document.getPage(pageNumber),content=await page.getTextContent(),operators=await page.getOperatorList();
      const items=content.items.filter(item=>typeof item.str==='string'&&item.str.trim()).map(item=>({str:item.str,x:item.transform[4],y:item.transform[5],w:item.width,h:item.height}));
      textBytes+=items.reduce((sum,item)=>sum+Buffer.byteLength(item.str),0);if(textBytes>16*1024*1024||items.length>100000)fail('REGISTRY_LIMIT','Слишком много текста в PDF.');
      const header=items.find(item=>/^сумма(?:[,\s]|$)/i.test(item.str.trim()));if(!header)continue;
      const xs=[];for(let i=0;i<operators.fnArray.length;i++)if(operators.fnArray[i]===pdfjs.OPS.constructPath){const box=operators.argsArray[i]?.[2];if(box?.length===4&&box[2]-box[0]<.8&&box[3]-box[1]>10)xs.push((box[0]+box[2])/2);}
      const bounds=unique(xs);if(bounds.length<4||bounds.length>100)fail('REGISTRY_PDF_TABLE','Не найдены границы столбцов PDF. Для этого макета загрузите реестр из Excel.');
      const column=item=>{for(let i=0;i<bounds.length-1;i++)if(item.x>=bounds[i]-.8&&item.x<bounds[i+1]-.4)return i;return -1;};
      const cellsOf=line=>{const cells=Array(bounds.length-1).fill('');for(const item of line.sort((a,b)=>b.y-a.y||a.x-b.x)){const col=column(item);if(col>=0)cells[col]+=(cells[col]?' ':'')+item.str;}return cells;};
      const headers=cellsOf(items.filter(item=>Math.abs(item.y-header.y)<9));
      if(!grid.length){grid.push(headers);rowPages.push(pageNumber);}const sumColumn=headers.findIndex(value=>/^сумма/i.test(value.trim()));if(sumColumn<0)fail('REGISTRY_COLUMNS','В PDF не найден столбец суммы.');
      preamble.push(...items.filter(item=>item.y>header.y+10).sort((a,b)=>b.y-a.y).map(item=>item.str));
      const lines=[];for(const item of items.filter(item=>item.y<header.y-9).sort((a,b)=>b.y-a.y||a.x-b.x)){let line=lines.at(-1);if(!line||Math.abs(line.y-item.y)>1.5){line={y:item.y,items:[]};lines.push(line);}line.items.push(item);}
      for(const line of lines){const cells=cellsOf(line.items),number=cells[0].trim();let isMoney=false;try{isMoney=core.cents(cells[sumColumn])!==null;}catch{}
        if(isMoney&&cells.some(value=>/^(?:всего|итого)(?:\s|$)/i.test(value.trim()))){if(current){grid.push(current);rowPages.push(currentPage);current=null;}grid.push(cells);rowPages.push(pageNumber);}
        else if((/^(?:№|n\b|п\/?п|номер)/i.test(headers[0])?/^\d+[.)]?$/.test(number):cells[sumColumn].trim())&&cells.some((value,index)=>index!==sumColumn&&value.trim())){if(current){grid.push(current);rowPages.push(currentPage);}current=cells;currentPage=pageNumber;}
        else if(current){for(let col=0;col<cells.length;col++)if(cells[col])current[col]+=(current[col]?'\n':'')+cells[col];}
        if(grid.length>core.MAX_ROWS+50)fail('REGISTRY_LIMIT','Слишком много строк PDF.');
      }
      page.cleanup();
    }
    if(current){grid.push(current);rowPages.push(currentPage);}
    if(grid.length<2)fail('REGISTRY_PDF_TABLE','В PDF не найдена текстовая таблица реестра. Для скана используйте распознанную копию PDF или Excel.');
    return [{name:'Таблица PDF',grid,rowPages,preamble}];
  }finally{await task.destroy().catch(()=>{});}
}
async function decode(input){
  const bytes=Buffer.from(input.base64,'base64'),extension=path.extname(input.name).toLowerCase();let tables;
  if(extension==='.pdf')tables=await pdf(bytes);
  else if(['.xlsx','.xls'].includes(extension)){
    const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../vendor/xlsx.bundle.js'),'utf8'),context,{timeout:10000});
    const book=context.XLSX.read(bytes,{type:'buffer',cellDates:true,cellFormula:false,bookVBA:false});if(book.SheetNames.length>100)fail('REGISTRY_LIMIT','В книге больше 100 листов.');
    let count=0;tables=book.SheetNames.map(name=>{const sheet=book.Sheets[name],range=sheet['!ref']?context.XLSX.utils.decode_range(sheet['!ref']):null;if(range&&(range.e.r>core.MAX_ROWS+100||range.e.c>200))fail('REGISTRY_LIMIT','Лист превышает 10 000 строк или 200 столбцов.');const grid=context.XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true}).map(row=>Array.from(row,clean));count+=grid.length;if(count>core.MAX_ROWS+100)fail('REGISTRY_LIMIT','В книге слишком много строк.');return {name,grid};});
  }else fail('REGISTRY_FORMAT','Выберите Excel XLSX/XLS или PDF.');
  if(Buffer.byteLength(JSON.stringify(tables))>24*1024*1024)fail('REGISTRY_LIMIT','Таблица превышает допустимый размер.');
  return {tables};
}
if(parentPort)decode(workerData).then(result=>parentPort.postMessage({ok:true,...result})).catch(error=>parentPort.postMessage({ok:false,code:error.code||'REGISTRY_DECODE',error:error.message}));
module.exports={decode};
