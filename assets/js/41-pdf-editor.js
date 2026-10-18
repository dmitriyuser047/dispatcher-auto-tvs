/* PDF workspace. Model coordinates are the unrotated PDF.js viewport at scale 1. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const make = (tag, cls, text) => { const el=document.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el; };
  const id = () => crypto.randomUUID();
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const turn = value => ((value % 360) + 360) % 360;
  const from64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const to64 = bytes => { let out='';for(let i=0;i<bytes.length;i+=32768)out+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(out); };
  const PE = {sources:[],pages:[],docs:new Map(),text:new Map(),current:null,selected:null,tool:'select',zoom:1,busy:false,rendering:false,renderToken:0,renderTask:null,thumbObserver:null,undo:[],redo:[],saved:'',projectSaved:'',dirty:false,allowClose:false,gesture:null,propertyBefore:null,clipboard:null,find:[],findIndex:-1};
  let studio;
  let modelRevision=0;
  const defaults={fontSize:14,color:'#17243b',bold:false,italic:false,opacity:1,strokeWidth:2};
  const sourceText=new Map(), imageCache=new Map();
  const page = () => PE.pages.find(p=>p.id===PE.current);
  const source = model => PE.sources.find(s=>s.id===model.sourceId);
  const snapshot = () => JSON.stringify(PE.pages);
  const setStatus = text => { $('peStatus').textContent=text; };
  const error = err => { setStatus('Не удалось выполнить действие: '+(err?.message||String(err)));console.error(err); };
  const angle = model => turn(model.nativeRotation+model.rotation);
  const typing = target => target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)||target.isContentEditable);
  function syncState() {
    const state=snapshot();PE.dirty=!!PE.pages.length&&state!==PE.saved&&state!==PE.projectSaved;
    $('peDirty').hidden=false;
    $('peDirty').textContent=PE.dirty?'Есть изменения':state===PE.projectSaved&&state!==PE.saved?'Сохранено в проект':'Сохранено';
    $('peDirty').classList.toggle('is-dirty',PE.dirty);
    $('peUndo').disabled=PE.busy||!PE.undo.length;
    $('peRedo').disabled=PE.busy||!PE.redo.length;
    document.body.classList.toggle('is-busy',PE.busy);
    const current=PE.pages.indexOf(page());
    $('pePageNumber').value=current+1;$('pePageNumber').max=PE.pages.length;
    $('pePageCount').textContent='/ '+PE.pages.length;
    $('pePrev').disabled=PE.busy||current<=0;$('peNext').disabled=PE.busy||current>=PE.pages.length-1;
    $('peMoveLeft').disabled=PE.busy||current<=0;$('peMoveRight').disabled=PE.busy||current>=PE.pages.length-1;
    $('peDeletePage').disabled=PE.busy||PE.pages.length<2;
    for(const button of document.querySelectorAll('[data-tool]')){button.classList.toggle('is-active',button.dataset.tool===PE.tool);button.setAttribute('aria-pressed',String(button.dataset.tool===PE.tool));}
    $('peZoomLabel').textContent=Math.round(PE.zoom*100)+'%';
    document.title=(PE.dirty?'● ':'')+($('peFileName').textContent||'Документ')+' — PDF-редактор';
    window.dispatchEvent(new CustomEvent('pdf-studio-change',{detail:{dirty:PE.dirty,revision:modelRevision,documentId:PE.sources[0]?.id||null}}));
  }
  function checkpoint(before,label) {
    const after=snapshot();if(before===after){syncState();return;}modelRevision++;
    PE.find=[];PE.findIndex=-1;$('peFindCount').textContent='';
    PE.undo.push({before,after,current:PE.current,label});PE.redo=[];
    while(PE.undo.length>40||PE.undo.length>1&&PE.undo.reduce((sum,item)=>sum+item.before.length+item.after.length,0)>32000000)PE.undo.shift();
    syncState();
  }
  function change(label,fn) { finishProperty();const before=snapshot();fn();checkpoint(before,label);renderLayer();renderInspector(); }
  function finishProperty() { if(PE.propertyBefore!=null){const before=PE.propertyBefore;PE.propertyBefore=null;checkpoint(before,'Свойства элемента');} }
  async function busy(label,fn) {
    if(PE.busy)return;finishProperty();PE.busy=true;syncState();setStatus(label);
    for(const control of document.querySelectorAll('button,input,textarea,select')){if(!control.disabled){control.dataset.peBusy='1';control.disabled=true;}}
    try{return await fn();}catch(err){error(err);if(!PE.pages.length){$('peEmpty').hidden=false;$('peEmpty').textContent=err.message;$('peStage').hidden=true;}return false;}
    finally{PE.busy=false;for(const control of document.querySelectorAll('[data-pe-busy]')){delete control.dataset.peBusy;control.disabled=false;}syncState();renderInspector();}
  }
  function choose(title,text,choices) {
    return new Promise(resolve=>{
      const dialog=make('dialog','pe-dialog'),head=make('h2','',title),message=make('p','',text),actions=make('div','pe-dialog-actions');
      for(const [value,label,primary] of choices){const button=make('button',primary?'btn btn-primary':'btn btn-ghost',label);button.type='button';button.onclick=()=>{dialog.close();resolve(value);};actions.append(button);}
      dialog.append(head,message,actions);document.body.append(dialog);dialog.addEventListener('cancel',()=>resolve('cancel'),{once:true});dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();actions.querySelector('button')?.focus();
    });
  }
  async function discardGuard() {
    finishProperty();if(!PE.dirty)return true;
    const choice=await choose('Сохранить изменения?','В документе есть несохранённые правки.',[['save','Сохранить',true],['discard','Не сохранять'],['cancel','Вернуться']]);
    if(choice==='save')return !!await save(false);return choice==='discard';
  }
  async function addSource(bytes,name) {
    const item={id:id(),bytes:bytes.slice(),name};
    const doc=await pdfjsLib.getDocument({data:bytes.slice(),useSystemFonts:true,standardFontDataUrl:new URL('./node_modules/pdfjs-dist/standard_fonts/',location.href).href}).promise;
    const models=[];
    for(let n=1;n<=doc.numPages;n++){const pdfPage=await doc.getPage(n),vp=pdfPage.getViewport({scale:1,rotation:0});models.push({id:id(),sourceId:item.id,sourcePage:n-1,nativeRotation:turn(pdfPage.rotate||0),rotation:0,width:vp.width,height:vp.height,baseTransform:Array.from(vp.transform),elements:[]});}
    PE.sources.push(item);PE.docs.set(item.id,doc);return models;
  }
  async function loadDocument(data) {
    if(!data?.pdfBase64)throw Error(data?.error||'Не получен PDF-документ');
    PE.renderToken++;PE.renderTask?.cancel();
    let models;try{models=await addSource(from64(data.pdfBase64),data.fileName);}catch(err){if(page())void renderPage();throw err;}
    const newId=models[0].sourceId,newSource=PE.sources.find(s=>s.id===newId),newDoc=PE.docs.get(newId);
    for(const [key,doc] of PE.docs)if(key!==newId)void doc.destroy();
    PE.sources=[newSource];PE.docs=new Map([[newId,newDoc]]);PE.text.clear();sourceText.clear();imageCache.clear();PE.undo=[];PE.redo=[];PE.selected=null;PE.find=[];PE.findIndex=-1;
    PE.pages=models;PE.current=PE.pages[0].id;PE.saved=snapshot();PE.projectSaved='';modelRevision++;
    $('peFileName').textContent=data.fileName||'Документ.pdf';$('peEmpty').hidden=true;$('peStage').hidden=false;
    fitZoom('page');await renderPage();renderThumbs();syncState();renderInspector();setStatus('Выберите текст двойным щелчком или добавьте свой элемент.');
  }
  function sourceItems(model) {return [...(PE.text.get(model.sourceId+':'+model.sourcePage)||[]),...(model.ocrLines||[])];}
  async function readText(model,pdfPage) {
    const key=model.sourceId+':'+model.sourcePage;if(PE.text.has(key))return;
    const content=await pdfPage.getTextContent(),items=[];
    for(const [index,item] of content.items.entries()){
      if(!item.str?.trim())continue;
      const tx=pdfjsLib.Util.transform(model.baseTransform,item.transform),fontSize=Math.hypot(tx[2],tx[3])||item.height||12;
      const ownAngle=Math.atan2(tx[1],tx[0])*180/Math.PI;
      const x=tx[4]+Math.sin(ownAngle*Math.PI/180)*fontSize*.82,y=tx[5]-Math.cos(ownAngle*Math.PI/180)*fontSize*.82;
      items.push({id:'source:'+index,origKey:String(index),type:'text',text:item.str,x,y,w:Math.max(item.width,4),h:fontSize*1.2,fontSize,color:'#000000',bold:false,italic:false,angle:ownAngle,wrap:false});
    }
    PE.text.set(key,items);
  }
  async function renderPage() {
    const model=page();if(!model)return;
    const token=++PE.renderToken;PE.renderTask?.cancel();PE.rendering=true;$('peStage').classList.add('is-rendering');
    try{
      const pdfPage=await PE.docs.get(model.sourceId).getPage(model.sourcePage+1);
      const ratio=Math.min(window.devicePixelRatio||1,2),viewport=pdfPage.getViewport({scale:PE.zoom*ratio,rotation:0});
      const output=document.createElement('canvas');output.width=Math.ceil(viewport.width);output.height=Math.ceil(viewport.height);
      const ctx=output.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,output.width,output.height);
      if(token!==PE.renderToken)return;
      const task=pdfPage.render({canvasContext:ctx,viewport,background:'#fff'});PE.renderTask=task;await task.promise;
      await readText(model,pdfPage);if(token!==PE.renderToken)return;
      const canvas=$('peCanvas');canvas.width=output.width;canvas.height=output.height;canvas.getContext('2d').drawImage(output,0,0);
      canvas.style.width=model.width*PE.zoom+'px';canvas.style.height=model.height*PE.zoom+'px';
      sizeStage();renderLayer();renderInspector();syncState();
      setStatus('Страница '+(PE.pages.indexOf(model)+1)+' из '+PE.pages.length+' · двойной щелчок по тексту — правка');
    }catch(err){if(err.name!=='RenderingCancelledException'&&token===PE.renderToken)error(err);}
    finally{if(token===PE.renderToken){PE.rendering=false;PE.renderTask=null;$('peStage').classList.remove('is-rendering');}}
  }
  function sizeStage() {
    const model=page(),r=angle(model),w=model.width*PE.zoom,h=model.height*PE.zoom,sw=r%180?h:w,sh=r%180?w:h;
    $('peStage').style.width=sw+'px';$('peStage').style.height=sh+'px';$('peScene').style.width=w+'px';$('peScene').style.height=h+'px';
    $('peScene').style.transform=r===90?`translate(${h}px,0) rotate(90deg)`:r===180?`translate(${w}px,${h}px) rotate(180deg)`:r===270?`translate(0,${w}px) rotate(270deg)`:'none';
  }
  function fitZoom(kind) {const model=page();if(!model)return;const r=angle(model),w=r%180?model.height:model.width,h=r%180?model.width:model.height;const area=$('peCanvasArea');PE.zoom=clamp(kind==='width'?(area.clientWidth-64)/w:Math.min((area.clientWidth-64)/w,(area.clientHeight-56)/h),.2,4);}
  function changeZoom(delta) {if(PE.busy)return;finishProperty();PE.zoom=clamp(PE.zoom+delta,.2,4);void renderPage();}
  function point(event) {
    const model=page(),rect=$('peStage').getBoundingClientRect(),x=(event.clientX-rect.left)/PE.zoom,y=(event.clientY-rect.top)/PE.zoom,r=angle(model);
    const p=r===90?{x:y,y:model.height-x}:r===180?{x:model.width-x,y:model.height-y}:r===270?{x:model.width-y,y:x}:{x,y};
    return {x:clamp(p.x,0,model.width),y:clamp(p.y,0,model.height)};
  }
  const sourceId = value => /^(source:|ocr:)/.test(value||'');
  function selected() {if(!PE.selected||!page())return null;return sourceId(PE.selected)?sourceItems(page()).find(e=>e.id===PE.selected):page().elements.find(e=>e.id===PE.selected);}
  function editableSelected() {
    let item=selected();if(!item)return null;
    if(sourceId(PE.selected)){item=clone(item);item.id=id();item.original={x:item.x,y:item.y,w:item.w,h:item.h,angle:item.angle};page().elements.push(item);PE.selected=item.id;}
    return item;
  }
  function setSelection(value,focusText=false) {finishProperty();PE.selected=value;renderLayer();renderInspector();if(focusText){$('peText').focus();$('peText').select();}}
  function styleBox(div,item) {div.style.left=item.x*PE.zoom+'px';div.style.top=item.y*PE.zoom+'px';div.style.width=Math.max(item.w||1,1)*PE.zoom+'px';div.style.height=Math.max(item.h||1,1)*PE.zoom+'px';div.style.transform=`rotate(${item.angle||0}deg)`;div.style.transformOrigin='0 0';}
  function mask(item) {const div=make('div','pe-mask');styleBox(div,item);div.style.background=item.color||'#ffffff';return div;}
  function textStyle(div,item) {div.style.fontFamily='Arial, sans-serif';div.style.fontSize=item.fontSize*PE.zoom+'px';div.style.fontWeight=item.bold?'700':'400';div.style.fontStyle=item.italic?'italic':'normal';div.style.lineHeight='1.2';div.style.color=item.color||'#000';div.style.whiteSpace=item.wrap===false?'pre':'pre-wrap';div.style.overflowWrap=item.wrap===false?'normal':'anywhere';div.style.background=item.bg||'transparent';}
  function textPreview(div,item) {
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=`${item.italic?'italic ':''}${item.bold?'700':'400'} ${item.fontSize}px Arial`;
    const lines=[];for(const paragraph of String(item.text||'').replace(/\r\n?/g,'\n').replace(/\t/g,'    ').split('\n')){
      if(item.wrap===false||ctx.measureText(paragraph).width<=item.w){lines.push(paragraph);continue;}
      let line='';for(const word of paragraph.match(/\s+|\S+/gu)||[]){if(line&&ctx.measureText(line+word).width>item.w){lines.push(line.trimEnd());line='';if(/^\s+$/u.test(word))continue;}if(ctx.measureText(word).width<=item.w){line+=word;continue;}for(const char of word){if(line&&ctx.measureText(line+char).width>item.w){lines.push(line);line='';}line+=char;}}lines.push(line);
    }
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),text=document.createElementNS('http://www.w3.org/2000/svg','text');svg.classList.add('pe-path');svg.setAttribute('viewBox',`0 0 ${item.w} ${item.h}`);svg.setAttribute('preserveAspectRatio','none');text.setAttribute('fill',item.color||'#000');text.setAttribute('font-family','Arial');text.setAttribute('font-size',item.fontSize);text.setAttribute('font-weight',item.bold?'700':'400');text.setAttribute('font-style',item.italic?'italic':'normal');
    lines.forEach((line,index)=>{const span=document.createElementNS('http://www.w3.org/2000/svg','tspan');span.setAttribute('x','0');span.setAttribute('y',String(item.fontSize*.82+index*item.fontSize*1.2));span.textContent=line;text.append(span);});svg.append(text);div.append(svg);
  }
  function renderLayer() {
    const model=page();if(!model)return;const layer=$('peLayer');layer.replaceChildren();layer.dataset.tool=PE.tool;
    const replaced=new Set(model.elements.map(e=>e.origKey).filter(v=>v!=null));
    for(const item of model.elements){if(item.type==='mask')layer.append(mask(item));else if(item.original)layer.append(mask(item.original));}
    if(PE.tool==='select')for(const item of sourceItems(model)){
      if(replaced.has(item.origKey))continue;const box=make('div','pe-source'+(PE.selected===item.id?' pe-selected':''));box.dataset.sourceId=item.id;styleBox(box,item);box.title='Двойной щелчок — изменить текст';box.setAttribute('aria-label',item.text);layer.append(box);
    }
    for(const item of model.elements){
      if(item.type==='mask')continue;const div=make('div','pe-element pe-'+item.type+(PE.selected===item.id?' pe-selected':''));div.dataset.elementId=item.id;styleBox(div,item);div.style.opacity=item.opacity??1;
      if(item.type==='text'){textStyle(div,item);textPreview(div,item);}
      else if(item.type==='image'){const img=make('img');img.src=item.dataUrl;img.draggable=false;div.append(img);}
      else if(item.type==='highlight'){div.style.background=item.color;div.style.opacity=item.opacity??.35;}
      else if(item.type==='rectangle'||item.type==='redaction'){if(item.fill===false){div.style.border=`${(item.width||2)*PE.zoom}px solid ${item.color}`;div.style.background='transparent';}else div.style.background=item.color;if(item.type==='redaction')div.title='Содержимое этой области будет удалено при сохранении PDF';}
      else if(item.type==='draw'){
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),line=document.createElementNS('http://www.w3.org/2000/svg','polyline');svg.classList.add('pe-path');svg.setAttribute('viewBox',`0 0 ${item.w} ${item.h}`);svg.setAttribute('preserveAspectRatio','none');line.setAttribute('points',item.points.map(p=>(p.x-item.x)+','+(p.y-item.y)).join(' '));line.setAttribute('stroke',item.color);line.setAttribute('stroke-width',item.width||2);line.setAttribute('fill','none');line.setAttribute('stroke-linecap','round');line.setAttribute('stroke-linejoin','round');svg.append(line);div.append(svg);
      }
      if(PE.selected===item.id&&['text','image','rectangle','highlight','redaction'].includes(item.type)){const handle=make('span','pe-handle');handle.dataset.resize='1';handle.title='Изменить размер. Shift — свободные пропорции изображения';div.append(handle);}
      layer.append(div);
    }
    $('peSelectionInfo').textContent=selected()?({'text':'Текст','image':'Изображение','draw':'Перо','highlight':'Маркер','rectangle':'Фигура'}[selected().type]||'Элемент'):'';
  }
  function renderInspector() {
    const item=selected();$('peSelectionEmpty').hidden=!!item||PE.tool!=='select';$('peProps').hidden=!item&&PE.tool==='select';
    $('peInspectorTitle').textContent=item?item.type==='text'?'Параметры текста':'Параметры элемента':'Инструменты';
    $('peTextGroup').hidden=item?.type!=='text'&&PE.tool!=='text';
    $('peText').disabled=!item;$('peDeleteSelection').hidden=!item;
    const geometry=$('peX').closest('.pe-property-section');if(geometry)geometry.hidden=!item;
    if(item){
      if(document.activeElement!==$('peText'))$('peText').value=item.text||'';
      for(const [field,key] of [['peX','x'],['peY','y'],['peWidth','w'],['peHeight','h']])if(document.activeElement!==$(field))$(field).value=Math.round((item[key]||0)*10)/10;
    }
    const style=item||defaults;
    if(document.activeElement!==$('peFontSize'))$('peFontSize').value=style.fontSize||defaults.fontSize;
    $('peBold').classList.toggle('is-active',!!style.bold);$('peBold').setAttribute('aria-pressed',String(!!style.bold));
    $('peItalic').classList.toggle('is-active',!!style.italic);$('peItalic').setAttribute('aria-pressed',String(!!style.italic));
    if(document.activeElement!==$('peColor'))$('peColor').value=style.color||defaults.color;
    if(document.activeElement!==$('peOpacity'))$('peOpacity').value=style.opacity??defaults.opacity;
    $('peOpacity').disabled=PE.busy||item?.type==='redaction';
    if(document.activeElement!==$('peStrokeWidth'))$('peStrokeWidth').value=style.type==='draw'||style.type==='rectangle'?style.width||2:defaults.strokeWidth;
    const hints={select:'Двойной щелчок по тексту открывает правку. При сохранении исходный текст удаляется движком PDF. Перетаскивайте элементы; тяните угол для размера.',text:'Щёлкните на странице. Текст вводится справа и сразу отображается в документе.',draw:'Рисуйте мышью. Толщина и цвет задаются в настройках инструмента.',highlight:'Выделите прямоугольную область. Цвет и прозрачность можно изменить.',rectangle:'Протяните рамку на странице. Настройте цвет и толщину.',cover:'Выделите область, чтобы закрасить её белым. Это визуальное перекрытие содержимого.',redaction:'Отметьте область для удаления содержимого. При сохранении эта страница станет изображением до 300 dpi; старые объекты страницы будут исключены. Отмена доступна до сохранения.',capture:'Выделите область исходной страницы. Её копия станет перемещаемым изображением.',clean:'Выделите область цветной печати. Удаляются цветные пиксели, тёмные штрихи сохраняются. Ctrl+Z — отмена.'};
    $('peHints').textContent=hints[PE.tool];
  }
  function setTool(tool) {if(PE.busy)return;finishProperty();PE.tool=tool;PE.selected=null;renderLayer();renderInspector();syncState();}
  function deleteSelected() {
    if(!selected()||PE.busy)return;change('Удалить элемент',()=>{const item=editableSelected();const list=page().elements,index=list.indexOf(item);if(item.original)list[index]={id:id(),type:'mask',origKey:item.origKey,...item.original,color:'#ffffff'};else list.splice(index,1);PE.selected=null;});
  }
  function undo(redo=false) {
    if(PE.busy)return;finishProperty();const list=redo?PE.redo:PE.undo,item=list.pop();if(!item)return;
    modelRevision++;(redo?PE.undo:PE.redo).push(item);PE.pages=JSON.parse(redo?item.after:item.before);PE.find=[];PE.findIndex=-1;$('peFindCount').textContent='';if(!PE.pages.some(p=>p.id===PE.current))PE.current=PE.pages[0].id;PE.selected=null;renderThumbs();void renderPage();syncState();setStatus((redo?'Повторено: ':'Отменено: ')+item.label);
  }
  function goTo(index) {if(PE.busy)return;if(!Number.isInteger(index)||index<0||index>=PE.pages.length){syncState();return;}finishProperty();PE.current=PE.pages[index].id;PE.selected=null;for(const b of $('pePages').querySelectorAll('[data-page-id]'))b.classList.toggle('is-active',b.dataset.pageId===PE.current);void renderPage();}
  function renderThumbs() {
    PE.thumbObserver?.disconnect();const host=$('pePages');host.replaceChildren();
    PE.thumbObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){PE.thumbObserver.unobserve(entry.target);void renderThumbnail(entry.target,entry.target.dataset.pageId);}},{root:host,rootMargin:'200px'});
    PE.pages.forEach((model,index)=>{const button=make('button','pe-page-thumb'+(model.id===PE.current?' is-active':''));button.type='button';button.dataset.pageId=model.id;button.setAttribute('aria-label','Страница '+(index+1));const canvas=make('canvas');canvas.width=100;canvas.height=130;button.append(canvas,make('span','',String(index+1)));button.onclick=()=>goTo(PE.pages.findIndex(p=>p.id===model.id));host.append(button);PE.thumbObserver.observe(button);});
  }
  async function renderThumbnail(button,pageId) {
    try{const model=PE.pages.find(p=>p.id===pageId);if(!model)return;const pdfPage=await PE.docs.get(model.sourceId).getPage(model.sourcePage+1),probe=pdfPage.getViewport({scale:1,rotation:angle(model)}),vp=pdfPage.getViewport({scale:Math.min(100/probe.width,138/probe.height),rotation:angle(model)});const canvas=button.querySelector('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);await pdfPage.render({canvasContext:canvas.getContext('2d'),viewport:vp,background:'#fff'}).promise;}catch(err){button.title='Миниатюра недоступна';}
  }
  function pageAction(kind) {
    if(PE.busy)return;const model=page(),index=PE.pages.indexOf(model);if(!model)return;
    change(kind==='duplicate'?'Дублировать страницу':kind==='left'||kind==='right'?'Переместить страницу':'Повернуть страницу',()=>{
      if(kind==='rotateLeft'||kind==='rotateRight')model.rotation=turn(model.rotation+(kind==='rotateLeft'?-90:90));
      if(kind==='left'&&index>0)[PE.pages[index-1],PE.pages[index]]=[PE.pages[index],PE.pages[index-1]];
      if(kind==='right'&&index<PE.pages.length-1)[PE.pages[index],PE.pages[index+1]]=[PE.pages[index+1],PE.pages[index]];
      if(kind==='duplicate'){const copy=clone(model);copy.id=id();copy.elements.forEach(e=>e.id=id());PE.pages.splice(index+1,0,copy);PE.current=copy.id;}
      PE.selected=null;
    });renderThumbs();void renderPage();
  }
  async function deletePage() {
    if(PE.busy||PE.pages.length<=1)return;const current=PE.current;
    if(await choose('Удалить страницу?','Действие можно отменить кнопкой «Отменить».',[['delete','Удалить',true],['cancel','Вернуться']])!=='delete'||current!==PE.current)return;
    change('Удалить страницу',()=>{const index=PE.pages.indexOf(page());PE.pages.splice(index,1);PE.current=PE.pages[Math.min(index,PE.pages.length-1)].id;PE.selected=null;});renderThumbs();void renderPage();
  }
  async function insertPages(blank=false) {
    await busy(blank?'Добавляю страницу…':'Загрузка страниц…',async()=>{
      const before=snapshot(),added=[];
      if(blank){const doc=await PDFLib.PDFDocument.create();doc.addPage([595.28,841.89]);added.push(...await addSource(await doc.save(),'Пустая страница'));}
      else{const result=await window.pdfEditor.mergePdf();if(!result?.ok){if(result?.error)throw Error(result.error);return;}for(const file of result.files)added.push(...await addSource(from64(file.base64),file.name));}
      const index=PE.pages.indexOf(page());PE.pages.splice(index+1,0,...added);PE.current=added[0].id;PE.selected=null;checkpoint(before,'Добавить страницы');renderThumbs();await renderPage();
    });
  }
  function image(url) {if(!imageCache.has(url))imageCache.set(url,new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Изображение не читается'));img.src=url;}));return imageCache.get(url);}
  async function insertImage() {
    await busy('Загрузка изображения…',async()=>{const result=await window.pdfEditor.insertImage();if(!result?.ok){if(result?.error)throw Error(result.error);return;}const img=await image(result.dataUrl),canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;if(canvas.width*canvas.height>30000000)throw Error('Выберите изображение размером до 30 мегапикселей');canvas.getContext('2d').drawImage(img,0,0);const model=page(),r=angle(model),displayW=r%180?model.height:model.width,displayH=r%180?model.width:model.height,w=Math.min(240,displayW*.65,displayH*.65*canvas.width/canvas.height),h=w*canvas.height/canvas.width,vx=(displayW-w)/2,vy=(displayH-h)/2,origin=r===90?{x:vy,y:model.height-vx}:r===180?{x:model.width-vx,y:model.height-vy}:r===270?{x:model.width-vy,y:vx}:{x:vx,y:vy};change('Вставить изображение',()=>{const item={id:id(),type:'image',...origin,w,h,angle:-r,dataUrl:canvas.toDataURL('image/png')};model.elements.push(item);PE.selected=item.id;});setStatus('Изображение вставлено. Перетащите его и измените размер за угол.');});
  }
  function rubber(rect) {let box=$('peRubber');if(!box){box=make('div','pe-rubber');box.id='peRubber';$('peLayer').append(box);}styleBox(box,rect);}
  function rectangleBetween(a,b) {return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)};}
  $('peStage').addEventListener('pointerdown',event=>{
    if(PE.busy||PE.rendering||event.button!==0)return;finishProperty();const pos=point(event),model=page(),target=event.target.closest('[data-element-id],[data-source-id]');
    if(PE.tool==='select'){
      if(!target){setSelection(null);return;}
      event.preventDefault();const picked=target.dataset.elementId||target.dataset.sourceId;if(PE.selected!==picked)setSelection(picked);
      const item=selected();PE.gesture={kind:event.target.closest('[data-resize]')?'resize':'move',start:pos,before:snapshot(),item:clone(item),target:picked,moved:false};
    }else if(PE.tool==='text'){
      event.preventDefault();change('Добавить текст',()=>{const item={id:id(),type:'text',...defaults,x:pos.x,y:pos.y,w:Math.min(240,model.width-20),h:defaults.fontSize*2.4,angle:-angle(model),text:'Введите текст',wrap:true};model.elements.push(item);PE.selected=item.id;});PE.tool='select';syncState();renderLayer();renderInspector();$('peText').focus();$('peText').select();return;
    }else{event.preventDefault();PE.gesture={kind:PE.tool,start:pos,end:pos,before:snapshot(),points:[pos]};rubber({x:pos.x,y:pos.y,w:1,h:1});}
    $('peStage').setPointerCapture(event.pointerId);
  });
  $('peStage').addEventListener('dblclick',event=>{const target=event.target.closest('[data-element-id],[data-source-id]');if(PE.tool==='select'&&target){setSelection(target.dataset.elementId||target.dataset.sourceId,true);}});
  $('peStage').addEventListener('pointermove',event=>{
    const gesture=PE.gesture;if(!gesture)return;const pos=point(event);gesture.end=pos;
    if(gesture.kind==='move'||gesture.kind==='resize'){
      const dx=pos.x-gesture.start.x,dy=pos.y-gesture.start.y;if(!gesture.moved&&Math.hypot(dx,dy)<1)return;
      const item=editableSelected();if(!item)return;gesture.moved=true;
      if(gesture.kind==='move'){const x=clamp(gesture.item.x+dx,-page().width*.2,page().width),y=clamp(gesture.item.y+dy,-page().height*.2,page().height);if(item.type==='draw'){const shiftX=x-item.x,shiftY=y-item.y;item.points.forEach(p=>{p.x+=shiftX;p.y+=shiftY;});}item.x=x;item.y=y;}
      else{const a=(gesture.item.angle||0)*Math.PI/180,localX=dx*Math.cos(a)+dy*Math.sin(a),localY=-dx*Math.sin(a)+dy*Math.cos(a);item.w=Math.max(8,gesture.item.w+localX);item.h=item.type==='image'&&!event.shiftKey?item.w*gesture.item.h/gesture.item.w:Math.max(8,gesture.item.h+localY);}
      renderLayer();renderInspector();syncState();
    }else if(gesture.kind==='draw'){
      gesture.points.push(pos);const rect=rectangleBetween(gesture.start,pos);rubber({...rect,w:Math.max(rect.w,1),h:Math.max(rect.h,1)});
      let svg=$('peLivePath');if(!svg){svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='peLivePath';svg.classList.add('pe-live-path');svg.setAttribute('viewBox',`0 0 ${page().width} ${page().height}`);svg.style.width=page().width*PE.zoom+'px';svg.style.height=page().height*PE.zoom+'px';svg.innerHTML='<polyline fill="none" stroke-linecap="round" stroke-linejoin="round"/>';$('peLayer').append(svg);}const line=svg.firstChild;line.setAttribute('points',gesture.points.map(p=>p.x+','+p.y).join(' '));line.setAttribute('stroke',defaults.color);line.setAttribute('stroke-width',defaults.strokeWidth);
    }else rubber(rectangleBetween(gesture.start,pos));
  });
  async function finishGesture(event,cancel=false) {
    const gesture=PE.gesture;if(!gesture)return;PE.gesture=null;$('peRubber')?.remove();$('peLivePath')?.remove();
    if(cancel){PE.pages=JSON.parse(gesture.before);renderLayer();renderInspector();syncState();return;}
    if(gesture.kind==='move'||gesture.kind==='resize'){if(gesture.moved)checkpoint(gesture.before,gesture.kind==='move'?'Переместить элемент':'Изменить размер');return;}
    const rect=rectangleBetween(gesture.start,point(event));if(gesture.kind!=='draw'&&rect.w<2&&rect.h<2)return;
    if(gesture.kind==='draw'){
      const xs=gesture.points.map(p=>p.x),ys=gesture.points.map(p=>p.y),minX=Math.min(...xs),minY=Math.min(...ys),w=Math.max(...xs)-minX,h=Math.max(...ys)-minY;
      if(w<1&&h<1)return;
      const item={id:id(),type:'draw',x:minX,y:minY,w:Math.max(1,w),h:Math.max(1,h),points:gesture.points,color:defaults.color,width:defaults.strokeWidth};page().elements.push(item);PE.selected=item.id;
    }else if(gesture.kind==='capture'||gesture.kind==='clean'){
      await busy('Обрабатываю область…',async()=>{
        const canvas=$('peCanvas'),model=page(),scale=canvas.width/model.width,sx=Math.round(rect.x*scale),sy=Math.round(rect.y*scale),sw=Math.max(1,Math.min(canvas.width-sx,Math.round(rect.w*scale))),sh=Math.max(1,Math.min(canvas.height-sy,Math.round(rect.h*scale))),crop=document.createElement('canvas');crop.width=sw;crop.height=sh;const ctx=crop.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,sx,sy,sw,sh,0,0,sw,sh);
        if(gesture.kind==='clean'){const data=ctx.getImageData(0,0,sw,sh);for(let i=0;i<data.data.length;i+=4){const r=data.data[i],g=data.data[i+1],b=data.data[i+2],hi=Math.max(r,g,b),lo=Math.min(r,g,b);if(hi-lo>30&&hi>lo*1.18&&lo>25){data.data[i]=data.data[i+1]=data.data[i+2]=255;}}ctx.putImageData(data,0,0);}
        const item={id:id(),type:'image',...rect,angle:0,dataUrl:crop.toDataURL('image/png')};if(gesture.kind==='clean')item.original={...rect,angle:0};model.elements.push(item);PE.selected=item.id;checkpoint(gesture.before,gesture.kind==='clean'?'Очистить цвет':'Копировать область');renderLayer();renderInspector();setStatus(gesture.kind==='clean'?'Цвет очищен в выбранной области. Проверьте результат; Ctrl+Z — отмена.':'Область скопирована. Её можно переместить и изменить размер.');
      });return;
    }else{
      const item={id:id(),type:gesture.kind==='cover'?'rectangle':gesture.kind,...rect,color:gesture.kind==='cover'?'#ffffff':gesture.kind==='redaction'?'#000000':gesture.kind==='highlight'?'#ffe052':defaults.color,opacity:gesture.kind==='highlight'?.35:1,width:defaults.strokeWidth,fill:gesture.kind!=='rectangle'};page().elements.push(item);PE.selected=item.id;
    }
    checkpoint(gesture.before,'Добавить элемент');renderLayer();renderInspector();
  }
  $('peStage').addEventListener('pointerup',event=>void finishGesture(event));$('peStage').addEventListener('pointercancel',event=>void finishGesture(event,true));
  function propertyChange(field,value) {
    if(PE.busy)return;if(PE.propertyBefore==null)PE.propertyBefore=snapshot();
    const item=editableSelected();if(item){
      if(field==='x'||field==='y'){const delta=value-item[field];if(item.type==='draw')item.points.forEach(p=>p[field]+=delta);}
      if(item.type==='draw'&&(field==='w'||field==='h')){const axis=field==='w'?'x':'y',factor=value/Math.max(item[field],.01);item.points.forEach(p=>p[axis]=item[axis]+(p[axis]-item[axis])*factor);}
      item[field]=item.type==='redaction'&&field==='opacity'?1:value;
      if(field==='text'&&item.wrap===false)item.w=Math.max(item.w,item.text.length*item.fontSize*.55);
    }else defaults[field==='width'?'strokeWidth':field]=value;
    modelRevision++;renderLayer();syncState();
  }
  function bindProperties() {
    for(const [name,key,min,max] of [['peFontSize','fontSize',4,160],['peOpacity','opacity',.1,1],['peStrokeWidth','width',.2,40],['peX','x',-10000,10000],['peY','y',-10000,10000],['peWidth','w',2,10000],['peHeight','h',2,10000]]){
      $(name).addEventListener('focus',()=>{PE.propertyBefore=snapshot();});$(name).addEventListener('input',()=>{if($(name).value==='')return;const value=Number($(name).value);if(Number.isFinite(value))propertyChange(key,clamp(value,min,max));});$(name).addEventListener('change',finishProperty);$(name).addEventListener('blur',finishProperty);
    }
    $('peText').addEventListener('focus',()=>{PE.propertyBefore=snapshot();});$('peText').addEventListener('input',()=>propertyChange('text',$('peText').value));$('peText').addEventListener('blur',finishProperty);
    $('peColor').addEventListener('input',()=>propertyChange('color',$('peColor').value));$('peColor').addEventListener('change',finishProperty);
    for(const [button,key] of [['peBold','bold'],['peItalic','italic']])$(button).onclick=()=>{change('Начертание текста',()=>{const item=editableSelected()||defaults;item[key]=!item[key];});};
  }
  async function save(asCopy) {
    return busy('Сохранение PDF…',async()=>{
      const captured=snapshot();const bytes=await exportPdf(PE.pages);const result=await (asCopy?window.pdfEditor.saveAs(to64(bytes)):window.pdfEditor.save(to64(bytes)));
      if(!result?.saved){if(result?.error)throw Error(result.error);setStatus('Сохранение отменено. Правки остаются в редакторе.');return false;}
      PE.saved=captured;$('peFileName').textContent=result.fileName||result.path.split(/[\\/]/).pop();syncState();setStatus('Сохранено: '+result.path);return true;
    });
  }
  async function runOcr() {
    await busy('Распознавание страницы…',async()=>{
      const model=page(),pdfPage=await PE.docs.get(model.sourceId).getPage(model.sourcePage+1);let scale=300/72;
      if(Math.max(model.width,model.height)*scale>5000)scale=5000/Math.max(model.width,model.height);
      const vp=pdfPage.getViewport({scale,rotation:0}),canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);await pdfPage.render({canvasContext:canvas.getContext('2d'),viewport:vp,background:'#ffffff'}).promise;
      const result=await window.pdfEditor.ocr(canvas.toDataURL('image/png').split(',')[1]);if(!result?.ok)throw Error(result?.error||'Распознавание не завершено');
      const before=snapshot();model.ocrText=String(result.text||'');
      const native=PE.text.get(model.sourceId+':'+model.sourcePage)||[],normalize=text=>text.toLocaleLowerCase('ru').replace(/\s/g,'');
      model.ocrLines=(result.lines||[]).map((line,index)=>({id:'ocr:'+index,origKey:'ocr:'+index,type:'text',text:line.text,x:line.bbox.x/scale,y:line.bbox.y/scale,w:line.bbox.w/scale,h:line.bbox.h/scale,fontSize:clamp(line.bbox.h/scale*.85,5,80),color:'#000000',angle:0,wrap:false})).filter(line=>!native.some(item=>normalize(item.text)===normalize(line.text)&&Math.abs(item.x-line.x)<12&&Math.abs(item.y-line.y)<12));
      checkpoint(before,'Распознать страницу');renderLayer();setStatus(model.ocrLines.length?'Распознано строк: '+model.ocrLines.length+'. Двойной щелчок по строке — правка.':'Текст не найден. Можно добавить текст вручную.');
    });
  }
  async function findText(direction=1,rebuild=true) {
    if(PE.busy)return;const query=$('peFind').value.trim().toLocaleLowerCase('ru');if(!query){PE.find=[];PE.findIndex=-1;$('peFindCount').textContent='';return;}
    if(rebuild||!PE.find.length){PE.find=[];PE.findIndex=-1;for(const model of PE.pages){const pdfPage=await PE.docs.get(model.sourceId).getPage(model.sourcePage+1);await readText(model,pdfPage);const replaced=new Set(model.elements.map(e=>e.origKey).filter(v=>v!=null));for(const item of [...sourceItems(model).filter(e=>!replaced.has(e.origKey)),...model.elements.filter(e=>e.type==='text')])if(item.text.toLocaleLowerCase('ru').includes(query))PE.find.push({pageId:model.id,elementId:item.id});}}
    if(!PE.find.length){$('peFindCount').textContent='Не найдено';return;}
    PE.findIndex=PE.findIndex<0?(direction<0?PE.find.length-1:0):(PE.findIndex+direction+PE.find.length)%PE.find.length;const found=PE.find[PE.findIndex];finishProperty();if(!PE.pages.some(p=>p.id===found.pageId))return;PE.current=found.pageId;PE.selected=found.elementId;PE.tool='select';await renderPage();$('peFindCount').textContent=(PE.findIndex+1)+' / '+PE.find.length;for(const button of $('pePages').querySelectorAll('[data-page-id]'))button.classList.toggle('is-active',button.dataset.pageId===PE.current);
  }
  function copySelected() {const item=selected();if(!item)return;PE.clipboard=clone(item);setStatus('Элемент скопирован. Ctrl+V — вставить копию.');}
  function pasteSelected() {if(!PE.clipboard)return;change('Вставить копию',()=>{const item=clone(PE.clipboard);item.id=id();delete item.original;delete item.origKey;item.x+=16;item.y+=16;if(item.points)item.points.forEach(p=>{p.x+=16;p.y+=16;});page().elements.push(item);PE.selected=item.id;});}
  async function exportPdf(models) {
    return PdfEditorExport.build({sources:PE.sources,pages:models,api:window.pdfEditor,onWarnings:async(warnings,details)=>{
      const raster=details.filter(p=>p.method==='raster-content').map(p=>p.pageIndex+1);
      const text=[...new Set(warnings)].join('\n')+(raster.length?'\nСтраницы с растровой обработкой: '+raster.join(', ')+'. Исходный текст этих страниц перестанет быть редактируемым; новый OCR-слой будет добавлен, если он распознан.':'');
      const choice=await choose('Особенности сохранения PDF',text,[['continue','Продолжить сохранение',true],['cancel','Вернуться к правкам']]);
      if(choice!=='continue')throw Error('Сохранение отменено. Все правки остаются в редакторе.');
    }});
  }
  function areaOverlap(a,b) {
    const bounds=item=>{const r=(item.angle||0)*Math.PI/180,c=Math.cos(r),s=Math.sin(r),pts=[[0,0],[item.w,0],[0,item.h],[item.w,item.h]].map(([x,y])=>[item.x+c*x-s*y,item.y+s*x+c*y]);return [Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))];};
    const x=bounds(a),y=bounds(b);return x[0]<y[2]&&x[2]>y[0]&&x[1]<y[3]&&x[3]>y[1];
  }
  async function effectiveText(pageId) {
    const model=PE.pages.find(p=>p.id===pageId);if(!model)throw Error('Страница не найдена');
    await readText(model,await PE.docs.get(model.sourceId).getPage(model.sourcePage+1));
    const replaced=new Set(model.elements.map(e=>e.origKey).filter(v=>v!=null)),redactions=model.elements.filter(e=>e.type==='redaction');
    return [...sourceItems(model).filter(e=>!replaced.has(e.origKey)),...model.elements.filter(e=>e.type==='text')].filter(e=>!redactions.some(r=>areaOverlap(r,e))).map(clone);
  }
  function serializeProject() {
    finishProperty();const used=new Set(PE.pages.map(p=>p.sourceId));
    const sources=PE.sources.filter(s=>used.has(s.id));
    if(PE.pages.length>2000||sources.length>100||sources.reduce((sum,s)=>sum+s.bytes.length,0)>200*1024*1024||sources.some(s=>s.bytes.length>128*1024*1024))throw Error('Разделите проект: до 2000 страниц, 100 источников, 128 МБ на PDF и 200 МБ суммарно.');
    return {schemaVersion:1,title:$('peFileName').textContent||'Документ.pdf',sources:sources.map(s=>({id:s.id,name:s.name,bytesBase64:to64(s.bytes)})),pages:clone(PE.pages),current:PE.current};
  }
  async function restoreProject(project) {
    if(!project||project.schemaVersion!==1||!Array.isArray(project.sources)||!project.sources.length||project.sources.length>100||!Array.isArray(project.pages)||!project.pages.length||project.pages.length>2000)throw Error('Неподдерживаемый или повреждённый проект PDF');
    const nextSources=[],nextDocs=new Map(),nextPages=clone(project.pages),numbers=['x','y','w','h','angle','fontSize','width','opacity'];
    let total=0,adopted=false;
    try{
      for(const entry of project.sources){
        if(!entry||typeof entry.id!=='string'||nextDocs.has(entry.id)||typeof entry.bytesBase64!=='string')throw Error('Повреждён список PDF-источников проекта');
        const bytes=from64(entry.bytesBase64);total+=bytes.length;if(total>200*1024*1024)throw Error('Проект превышает 200 МБ исходных PDF');
        const doc=await pdfjsLib.getDocument({data:bytes.slice(),useSystemFonts:true,standardFontDataUrl:new URL('./node_modules/pdfjs-dist/standard_fonts/',location.href).href}).promise;
        nextDocs.set(entry.id,doc);nextSources.push({id:entry.id,name:String(entry.name||'Документ.pdf').slice(0,240),bytes});
      }
      const pageIds=new Set();
      for(const model of nextPages){
        if(!model||typeof model.id!=='string'||pageIds.has(model.id)||!nextDocs.has(model.sourceId)||!Number.isInteger(model.sourcePage)||model.sourcePage<0||model.sourcePage>=nextDocs.get(model.sourceId).numPages||!Array.isArray(model.elements)||model.elements.length>20000)throw Error('Повреждена страница проекта');
        pageIds.add(model.id);const pdfPage=await nextDocs.get(model.sourceId).getPage(model.sourcePage+1),vp=pdfPage.getViewport({scale:1,rotation:0});
        model.width=vp.width;model.height=vp.height;model.baseTransform=Array.from(vp.transform);model.nativeRotation=turn(pdfPage.rotate||0);
        if(!Number.isFinite(model.rotation)||model.rotation%90)throw Error('Неверный поворот страницы проекта');model.rotation=turn(model.rotation);
        if(model.ocrLines&&!Array.isArray(model.ocrLines))throw Error('Неверные OCR-строки проекта');
        const elements=[...model.elements,...(model.ocrLines||[])];
        if(elements.length>50000)throw Error('Слишком много элементов на странице проекта');
        for(const element of elements){
          if(!element||!['text','image','draw','rectangle','highlight','mask','redaction'].includes(element.type)||typeof element.id!=='string')throw Error('Неизвестный элемент проекта');
          for(const field of numbers)if(element[field]!=null&&(!Number.isFinite(element[field])||Math.abs(element[field])>1000000))throw Error('Неверные координаты элемента проекта');
          if(!(element.w>0)||!(element.h>0))throw Error('Неверный размер элемента проекта');
          for(const key of ['color','bg'])if(element[key]!=null&&!/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(element[key]))throw Error('Неверный цвет элемента проекта');
          if(element.type==='text'&&(typeof element.text!=='string'||element.text.length>1000000||!(element.fontSize>0)))throw Error('Неверный текст проекта');
          if(element.type==='image'&&(!/^data:image\/(png|jpe?g);base64,[a-z0-9+/=\r\n]+$/i.test(element.dataUrl||'')||element.dataUrl.length>24000000))throw Error('В проекте есть неподдерживаемое изображение');
          if(element.type==='draw'&&(!Array.isArray(element.points)||element.points.length>100000||element.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))))throw Error('Повреждены линии проекта');
          if(element.original&&(['x','y','w','h'].some(key=>!Number.isFinite(element.original[key])||Math.abs(element.original[key])>1000000)||!(element.original.w>0)||!(element.original.h>0)||element.original.angle!=null&&!Number.isFinite(element.original.angle)))throw Error('Неверная область замены проекта');
          if(element.type==='redaction')element.opacity=1;
        }
        if(model.ocrAreas&&(!Array.isArray(model.ocrAreas)||model.ocrAreas.length>1000))throw Error('Неверные OCR-области проекта');
        if(model.ocrTables&&(!Array.isArray(model.ocrTables)||model.ocrTables.length>500))throw Error('Неверные таблицы проекта');
        const validBox=b=>b&&['x','y','w','h'].every(key=>Number.isFinite(b[key])&&Math.abs(b[key])<=1000000)&&b.w>0&&b.h>0;
        for(const area of model.ocrAreas||[])if(!area||typeof area.id!=='string'||!['text','table','exclude'].includes(area.type)||!validBox(area))throw Error('Повреждена OCR-область проекта');
        for(const table of model.ocrTables||[])if(!table||typeof table.id!=='string'||!validBox(table.bbox)||!Array.isArray(table.rows)||table.rows.length>2000||table.rows.some(row=>!Array.isArray(row)||row.length>200||row.some(cell=>typeof cell!=='string'||cell.length>100000)))throw Error('Повреждена сетка таблицы проекта');
      }
      const result=await window.pdfEditor.adoptProject({title:String(project.title||'Документ.pdf'),pdfBase64:to64(nextSources[0].bytes)});
      if(!result?.ok)throw Error(result?.error||'Не удалось принять PDF-проект');adopted=true;
      PE.renderToken++;PE.renderTask?.cancel();for(const doc of PE.docs.values())void doc.destroy();
      modelRevision++;PE.sources=nextSources;PE.docs=nextDocs;PE.pages=nextPages;PE.current=pageIds.has(project.current)?project.current:nextPages[0].id;
      PE.text.clear();sourceText.clear();imageCache.clear();PE.undo=[];PE.redo=[];PE.find=[];PE.findIndex=-1;PE.selected=null;PE.tool='select';PE.propertyBefore=null;PE.saved='';PE.projectSaved=snapshot();
      $('peFileName').textContent=String(project.title||'Документ.pdf');$('peEmpty').hidden=true;$('peStage').hidden=false;
      fitZoom('page');renderThumbs();await renderPage();syncState();setStatus('Проект восстановлен. Сохранение PDF предложит выбрать новый файл.');
    }catch(err){if(!adopted)for(const doc of nextDocs.values())void doc.destroy();throw err;}
  }
  window.PdfStudioHost=Object.freeze({
    pages:()=>PE.pages,current:page,sources:()=>PE.sources,text:effectiveText,
    pdfPage:async pageId=>{const model=PE.pages.find(p=>p.id===pageId);if(!model)throw Error('Страница не найдена');return PE.docs.get(model.sourceId).getPage(model.sourcePage+1);},
    mutate:change,refresh:async()=>{PE.find=[];PE.findIndex=-1;$('peFindCount').textContent='';renderThumbs();await renderPage();syncState();},
    busy,isBusy:()=>PE.busy,status:setStatus,api:window.pdfEditor,serializeProject,restoreProject,exportPdf,choose,guard:discardGuard,
    markProjectSaved:()=>{finishProperty();PE.projectSaved=snapshot();syncState();},title:()=>$('peFileName').textContent||'Документ.pdf'
  });
  const actions={peUndo:()=>undo(),peRedo:()=>undo(true),peSave:()=>save(false),peSaveAs:()=>save(true),peOpen:async()=>{if(await discardGuard())await busy('Открытие PDF…',async()=>{await studio?.flushAutosave();const result=await window.pdfEditor.openFile();if(result?.ok){try{await loadDocument(result);const accepted=await window.pdfEditor.commitOpen(result.pendingToken);if(!accepted?.ok)throw Error(accepted?.error||'Не удалось принять новый документ');}catch(err){await window.pdfEditor.cancelOpen(result.pendingToken);throw err;}}else if(result?.error)throw Error(result.error);});},peMerge:()=>insertPages(),peBlank:()=>insertPages(true),peOcr:()=>window.PdfOcrWorkbench?PdfOcrWorkbench.open(window.PdfStudioHost):runOcr(),peImage:insertImage,pePrev:()=>goTo(PE.pages.indexOf(page())-1),peNext:()=>goTo(PE.pages.indexOf(page())+1),peRotateLeft:()=>pageAction('rotateLeft'),peRotateRight:()=>pageAction('rotateRight'),peMoveLeft:()=>pageAction('left'),peMoveRight:()=>pageAction('right'),peDuplicatePage:()=>pageAction('duplicate'),peDeletePage:deletePage,peZoomOut:()=>changeZoom(-.15),peZoomIn:()=>changeZoom(.15),peFitWidth:()=>{fitZoom('width');void renderPage();},peFitPage:()=>{fitZoom('page');void renderPage();},peDeleteSelection:deleteSelected,peFindNext:()=>findText(1,false),peFindPrev:()=>findText(-1,false)};
  for(const [name,action] of Object.entries(actions))$(name).addEventListener('click',()=>{try{Promise.resolve(action()).catch(error);}catch(err){error(err);}});
  for(const button of document.querySelectorAll('[data-tool]'))button.onclick=()=>setTool(button.dataset.tool);
  $('pePageNumber').addEventListener('change',()=>goTo(Number($('pePageNumber').value)-1));
  $('peFind').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void findText(event.shiftKey?-1:1,false).catch(error);}});
  $('peFind').addEventListener('input',()=>{PE.find=[];PE.findIndex=-1;$('peFindCount').textContent='';});
  $('peCanvasArea').addEventListener('wheel',event=>{if(event.ctrlKey){event.preventDefault();changeZoom(event.deltaY<0?.1:-.1);}},{passive:false});
  document.addEventListener('keydown',event=>{
    if(document.querySelector('dialog[open]'))return;
    if(PE.busy)return;const modifier=event.ctrlKey||event.metaKey;
    if(modifier&&event.key.toLowerCase()==='s'){event.preventDefault();void save(event.shiftKey);return;}
    if(modifier&&event.key.toLowerCase()==='f'){event.preventDefault();$('peFind').focus();$('peFind').select();return;}
    if(typing(event.target))return;
    if(modifier&&event.key.toLowerCase()==='z'){event.preventDefault();undo(event.shiftKey);}
    else if(modifier&&event.key.toLowerCase()==='y'){event.preventDefault();undo(true);}
    else if(modifier&&event.key.toLowerCase()==='c'){event.preventDefault();copySelected();}
    else if(modifier&&event.key.toLowerCase()==='v'){event.preventDefault();pasteSelected();}
    else if(modifier&&event.key.toLowerCase()==='d'){event.preventDefault();copySelected();pasteSelected();}
    else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();deleteSelected();}
    else if(event.key==='Escape'){if(PE.gesture){PE.pages=JSON.parse(PE.gesture.before);PE.gesture=null;}setTool('select');}
    else if(event.key==='PageDown'){event.preventDefault();goTo(PE.pages.indexOf(page())+1);}
    else if(event.key==='PageUp'){event.preventDefault();goTo(PE.pages.indexOf(page())-1);}
    else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)&&selected()){event.preventDefault();const step=event.shiftKey?10:1;change('Переместить элемент',()=>{const item=editableSelected(),vx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,vy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0,a=-angle(page())*Math.PI/180,dx=vx*Math.cos(a)-vy*Math.sin(a),dy=vx*Math.sin(a)+vy*Math.cos(a);item.x+=dx;item.y+=dy;if(item.points)item.points.forEach(p=>{p.x+=dx;p.y+=dy;});});}
  });
  window.addEventListener('beforeunload',event=>{if(window.PdfOcrWorkbench?.hasPending?.()){event.preventDefault();event.returnValue=false;PdfOcrWorkbench.requestClose();return;}if(PE.allowClose)return;if(PE.busy){event.preventDefault();event.returnValue=false;setStatus('Дождитесь окончания текущего действия перед закрытием.');return;}if(!PE.dirty&&!studio?.hasPendingAutosave?.())return;event.preventDefault();event.returnValue=false;void discardGuard().then(async ok=>{if(ok){await studio?.flushAutosave();PE.allowClose=true;window.close();}}).catch(error);});
  bindProperties();
  const theme=localStorage.getItem('theme');if(theme==='dark')document.documentElement.dataset.theme='dark';
  async function init() {
    try{
      if(!window.pdfEditor||!window.pdfjsLib||!window.PDFLib)throw Error('Модули редактора не загружены. Переустановите программу.');
      pdfjsLib.GlobalWorkerOptions.workerSrc=new URL('./node_modules/pdfjs-dist/build/pdf.worker.min.js',location.href).href;
      window.pdfEditor.onOcrProgress?.(progress=>{if(PE.busy&&progress.status==='recognizing text')setStatus('Распознавание страницы: '+Math.round((progress.progress||0)*100)+'%');});
      await busy('Открытие PDF…',async()=>loadDocument(await window.pdfEditor.getData()));
      if(PE.pages.length&&window.PdfDocumentStudio)studio=PdfDocumentStudio.install(window.PdfStudioHost);
    }catch(err){error(err);$('peEmpty').hidden=false;$('peEmpty').textContent=err.message;}
  }
  void init();
})();
