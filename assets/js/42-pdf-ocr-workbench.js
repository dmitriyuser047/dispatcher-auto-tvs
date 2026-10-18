/* OCR verification workspace. Coordinates use PDF.js viewport({ scale: 1, rotation: 0 }). */
(function () {
  'use strict';
  const el = (tag, cls, text) => { const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node; };
  const uid = () => crypto.randomUUID();
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
  const finite = (value,fallback=0) => Number.isFinite(Number(value))?Number(value):fallback;
  const confidence = value => value!=null&&Number.isFinite(Number(value))?clamp(Number(value),0,100):null;
  const bounds = value => ({x:finite(value?.x??value?.x0),y:finite(value?.y??value?.y0),w:Math.max(0,finite(value?.w??(value?.x1-value?.x0))),h:Math.max(0,finite(value?.h??(value?.y1-value?.y0)))});
  const visualBounds = value => {const b=bounds(value),r=finite(value?.angle)*Math.PI/180,c=Math.cos(r),s=Math.sin(r),points=[[0,0],[b.w,0],[0,b.h],[b.w,b.h]].map(([x,y])=>({x:b.x+c*x-s*y,y:b.y+s*x+c*y})),x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));return {x,y,w:Math.max(...points.map(p=>p.x))-x,h:Math.max(...points.map(p=>p.y))-y};};
  const intersection = (a,b) => Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
  const redactions = model => (model.elements||[]).filter(item=>item.type==='redaction');
  const redacted = (model,box) => redactions(model).some(area=>intersection(visualBounds(area),box)>0);
  const clippedArea = (area,model) => {if(!area||!['text','table','exclude'].includes(area.type)||['x','y','w','h'].some(key=>!Number.isFinite(area[key])))throw Error('Повреждена область OCR. Удалите её и выделите заново.');const x=clamp(area.x,0,model.width),y=clamp(area.y,0,model.height),right=clamp(area.x+area.w,0,model.width),bottom=clamp(area.y+area.h,0,model.height);return {...area,x,y,w:Math.max(0,right-x),h:Math.max(0,bottom-y)};};
  const overlaps = (a,b) => intersection(a,b)>Math.min(a.w*a.h,b.w*b.h)*.12;
  const norm = text => String(text||'').toLocaleLowerCase('ru').replace(/\s+/g,'');
  const median = values => {const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);return sorted.length?sorted[Math.floor(sorted.length/2)]:1;};
  const button = (text, action, cls='') => {const node=el('button','pow-button '+cls,text);node.type='button';node.onclick=action;return node;};
  const option = (value,text) => {const node=el('option','',text);node.value=value;return node;};
  const field = (label,control,note) => {const wrap=el('label','pow-field');wrap.append(el('span','pow-label',label),control);if(note)wrap.append(el('small','pow-field-note',note));return wrap;};
  const checkbox = (text,checked) => {const wrap=el('label','pow-check'),input=el('input');input.type='checkbox';input.checked=checked;wrap.append(input,el('span','',text));return {wrap,input};};
  function pageRange(text,total) {
    const found=new Set();
    for(const part of String(text).replace(/\s+/g,'').split(/[,;]+/)){
      if(!part)continue;
      const match=part.match(/^(\d+)(?:[-–—](\d+))?$/);if(!match)throw Error('Укажите номера и диапазоны: например 1, 3–5.');
      const start=Number(match[1]),end=Number(match[2]||match[1]);
      if(start<1||end<start||end>total)throw Error('Диапазон должен быть от 1 до '+total+'.');
      for(let number=start;number<=end;number++)found.add(number-1);
    }
    if(!found.size)throw Error('Укажите хотя бы одну страницу.');
    return [...found].sort((a,b)=>a-b);
  }
  function canonicalBox(box,region,scale,rotation,canvas) {
    const b=bounds(box),r=-rotation*Math.PI/180,c=Math.cos(r),s=Math.sin(r),cx=canvas.width/2,cy=canvas.height/2;
    const points=[[b.x,b.y],[b.x+b.w,b.y],[b.x,b.y+b.h],[b.x+b.w,b.y+b.h]].map(([x,y])=>({x:((x-cx)*c-(y-cy)*s+cx)/scale+region.x,y:((x-cx)*s+(y-cy)*c+cy)/scale+region.y}));
    const minX=Math.max(region.x,Math.min(...points.map(p=>p.x))),minY=Math.max(region.y,Math.min(...points.map(p=>p.y))),maxX=Math.min(region.x+region.w,Math.max(...points.map(p=>p.x))),maxY=Math.min(region.y+region.h,Math.max(...points.map(p=>p.y)));
    return {x:minX,y:minY,w:Math.max(0,maxX-minX),h:Math.max(0,maxY-minY)};
  }
  function preprocess(canvas,settings) {
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(settings.grayscale||settings.contrast!==1){
      const image=ctx.getImageData(0,0,canvas.width,canvas.height),pixels=image.data;
      for(let i=0;i<pixels.length;i+=4){
        if(settings.grayscale){const grey=pixels[i]*.299+pixels[i+1]*.587+pixels[i+2]*.114;pixels[i]=pixels[i+1]=pixels[i+2]=grey;}
        if(settings.contrast!==1)for(let channel=0;channel<3;channel++)pixels[i+channel]=clamp((pixels[i+channel]-128)*settings.contrast+128,0,255);
        pixels[i+3]=255;
      }
      ctx.putImageData(image,0,0);
    }
    if(settings.rotation){
      const copy=el('canvas');copy.width=canvas.width;copy.height=canvas.height;copy.getContext('2d').drawImage(canvas,0,0);
      ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.save();ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(settings.rotation*Math.PI/180);ctx.drawImage(copy,-canvas.width/2,-canvas.height/2);ctx.restore();
      copy.width=copy.height=1;
    }
    return canvas;
  }
  function groupWords(words) {
    const sorted=words.filter(w=>w.text?.trim()&&w.bbox?.w>0&&w.bbox?.h>0).sort((a,b)=>a.bbox.y-b.bbox.y||a.bbox.x-b.bbox.x),rows=[];
    for(const word of sorted){
      const center=word.bbox.y+word.bbox.h/2;
      let row=rows.find(r=>Math.abs(r.center-center)<Math.max(r.height,word.bbox.h)*.65);
      if(!row){row={center,height:word.bbox.h,words:[]};rows.push(row);}
      row.words.push(word);row.center=row.words.reduce((sum,w)=>sum+w.bbox.y+w.bbox.h/2,0)/row.words.length;row.height=Math.max(row.height,word.bbox.h);
    }
    return rows.sort((a,b)=>a.center-b.center).map(row=>row.words.sort((a,b)=>a.bbox.x-b.bbox.x));
  }
  function tableFromWords(words,area) {
    const groups=groupWords(words),height=median(words.map(w=>w.bbox.h)),candidates=[];
    for(const [rowIndex,row] of groups.entries())for(let i=1;i<row.length;i++){
      const left=row[i-1].bbox.x+row[i-1].bbox.w,right=row[i].bbox.x;
      if(right-left>height*1.1)candidates.push({x:(left+right)/2,rowIndex});
    }
    const clusters=[];
    for(const candidate of candidates.sort((a,b)=>a.x-b.x)){
      let cluster=clusters.find(c=>Math.abs(c.x-candidate.x)<height*1.25);
      if(!cluster){cluster={x:candidate.x,values:[],rows:new Set()};clusters.push(cluster);}
      cluster.values.push(candidate.x);cluster.rows.add(candidate.rowIndex);cluster.x=cluster.values.reduce((sum,x)=>sum+x,0)/cluster.values.length;
    }
    const cuts=clusters.filter(c=>c.rows.size>=Math.min(groups.length,Math.max(2,Math.ceil(groups.length*.35)))).sort((a,b)=>b.rows.size-a.rows.size).slice(0,11).map(c=>c.x).sort((a,b)=>a-b);
    const rows=groups.map(wordsInRow=>{
      const cells=Array.from({length:cuts.length+1},()=>[]);
      for(const word of wordsInRow){const center=word.bbox.x+word.bbox.w/2;let col=cuts.findIndex(x=>center<x);if(col<0)col=cuts.length;cells[col].push(word.text);}
      return cells.map(parts=>parts.join(' '));
    });
    return {id:uid(),areaId:area.id,bbox:bounds(area),rows:rows.length?rows:[['']],columnBounds:[area.x,...cuts,area.x+area.w],source:words.length?'ocr-words':'manual',reviewed:false};
  }
  function mergeLines(model,incoming,regions,nativeItems) {
    const old=Array.isArray(model.ocrLines)?model.ocrLines:[],used=new Set(),protectedKeys=new Set((model.elements||[]).map(item=>item.origKey).filter(Boolean));
    const kept=old.filter(line=>!regions.some(region=>overlaps(bounds(line),region))),result=[...kept],protectedIds=new Set();
    for(const fresh of incoming){
      if(nativeItems.some(item=>norm(item.text)===norm(fresh.text)&&Math.abs(item.x-fresh.x)<10&&Math.abs(item.y-fresh.y)<10))continue;
      const protectedLine=old.find(prior=>(prior.userCorrected||protectedKeys.has(prior.origKey))&&intersection(bounds(prior),bounds(fresh))/Math.max(1,Math.min(prior.w*prior.h,fresh.w*fresh.h))>.35);
      if(protectedLine){used.add(protectedLine.id);protectedIds.add(protectedLine.id);if(!result.some(line=>line.id===protectedLine.id))result.push(protectedLine);continue;}
      let match=null,best=0;
      for(const prior of old){if(used.has(prior.id))continue;const a=bounds(prior),b=bounds(fresh),cross=intersection(a,b),score=cross/Math.max(1,Math.min(a.w*a.h,b.w*b.h));if(score>.35&&score>best){match=prior;best=score;}}
      if(match){
        used.add(match.id);
        if(match.userCorrected||protectedKeys.has(match.origKey)){if(!result.some(line=>line.id===match.id))result.push(match);protectedIds.add(match.id);continue;}
        fresh.id=match.id;fresh.origKey=match.origKey||match.id;
      }
      if(!result.some(line=>norm(line.text)===norm(fresh.text)&&overlaps(bounds(line),bounds(fresh))))result.push(fresh);
    }
    for(const prior of old)if(!used.has(prior.id)&&(prior.userCorrected||protectedKeys.has(prior.origKey))&&!result.some(line=>line.id===prior.id)){result.push(prior);protectedIds.add(prior.id);}
    return {lines:result.sort((a,b)=>a.y-b.y||a.x-b.x),protectedCount:protectedIds.size};
  }
  function spreadsheetText(cell) {const value=String(cell??'');return /^\s*[=+@-]/.test(value)&&!/^\s*[+-]?\d+(?:[.,]\d+)?\s*$/.test(value)?"'"+value:value;}
  function tsv(rows) {return rows.map(row=>row.map(cell=>spreadsheetText(cell).replace(/[\t\r\n]+/g,' ')).join('\t')).join('\n');}
  function csv(rows) {return '\uFEFF'+rows.map(row=>row.map(cell=>'"'+spreadsheetText(cell).replace(/"/g,'""')+'"').join(';')).join('\r\n');}

  class Workbench {
    constructor(host) {
      this.host=host;this.pageId=host.current()?.id||host.pages()[0]?.id;this.tab='recognize';this.mode='view';this.running=false;this.stop=false;this.closed=false;this.previewToken=0;this.cropToken=0;this.cache=new Map();this.drafts=new Map();this.tableDrafts=new Map();this.selectedLine=null;this.selectedArea=null;this.selectedTable=null;this.unsubscribe=null;this.lineFilter='all';this.log=[];
    }
    page() {return this.host.pages().find(model=>model.id===this.pageId);}
    say(message,isError=false) {this.status.textContent=message;this.status.classList.toggle('is-error',isError);this.host.status?.(message);}
    controlSelect(entries,value) {const select=el('select','pow-input');for(const [key,label] of entries)select.append(option(key,label));select.value=value;return select;}
    number(min,max,value,step=1) {const input=el('input','pow-input');input.type='number';Object.assign(input,{min:String(min),max:String(max),step:String(step),value:String(value)});return input;}
    async open() {
      if(!this.page()){this.host.status?.('Сначала откройте документ.');return;}
      this.dialog=el('dialog','pow-dialog');this.dialog.setAttribute('aria-labelledby','pow-title');
      const heading=el('header','pow-header'),title=el('div','pow-title');title.append(el('span','pow-eyebrow','ДОКУМЕНТ → ТЕКСТ → ПРОВЕРКА'),el('h2','','Распознавание и сверка'));title.lastChild.id='pow-title';
      this.closeButton=button('Закрыть',()=>this.requestClose(),'pow-quiet');heading.append(title,this.closeButton);
      const tabs=el('nav','pow-tabs');tabs.setAttribute('aria-label','Этапы распознавания');tabs.setAttribute('role','tablist');this.tabs=new Map();
      for(const [key,label] of [['recognize','1. Распознать'],['review','2. Проверить текст'],['tables','3. Таблицы']]){const tab=button(label,()=>this.setTab(key));tab.setAttribute('role','tab');this.tabs.set(key,tab);tabs.append(tab);}
      this.body=el('div','pow-body');this.recognizePanel=this.buildRecognize();this.reviewPanel=this.buildReview();this.tablesPanel=this.buildTables();this.body.append(this.recognizePanel,this.reviewPanel,this.tablesPanel);
      const footer=el('footer','pow-footer');this.status=el('p','pow-status','Обведите области или распознайте страницы целиком.');this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');
      this.discardButton=button('Отбросить несохранённые правки и закрыть',()=>this.close(),'pow-danger');this.discardButton.hidden=true;
      this.applyButton=button('Применить правки',()=>this.applyDrafts(),'pow-primary');this.applyButton.disabled=true;footer.append(this.status,this.discardButton,this.applyButton);
      this.dialog.append(heading,tabs,this.body,footer);document.body.append(this.dialog);
      this.dialog.addEventListener('cancel',event=>{event.preventDefault();if(this.running)this.requestStop();else this.requestClose();});
      this.dialog.addEventListener('keydown',event=>{event.stopPropagation();if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();if(!this.running)this.applyDrafts();}});
      this.unsubscribe=this.host.api?.onOcrProgress?.(progress=>{if(!this.running)return;if(progress.status==='recognizing text'){this.progress.value=(this.batchDone+(finite(progress.progress)))/Math.max(1,this.batchTotal);this.progressText.textContent=this.batchLabel+' · '+Math.round(finite(progress.progress)*100)+'%';}});
      this.dialog.showModal();this.refreshPageSelect();this.refreshAreas();this.setTab('recognize');await this.renderPreview();
    }
    buildRecognize() {
      const panel=el('section','pow-recognize'),settings=el('aside','pow-settings');settings.append(el('h3','','Параметры'));
      this.scope=this.controlSelect([['current','Текущая страница'],['all','Все страницы'],['range','Диапазон страниц']],'current');this.range=el('input','pow-input');this.range.placeholder='Например: 1, 3–5';this.rangeWrap=field('Номера страниц',this.range);this.rangeWrap.hidden=true;this.scope.onchange=()=>{this.rangeWrap.hidden=this.scope.value!=='range';};settings.append(field('Объём',this.scope),this.rangeWrap);
      this.language=this.controlSelect([['rus+eng','Русский + английский'],['rus','Русский'],['eng','Английский']],'rus+eng');settings.append(field('Язык',this.language,'Распознавание выполняется локально.'));
      this.modelProfile=this.controlSelect([['accurate','Точный'],['default','Стандартный']],'accurate');settings.append(field('Модели распознавания',this.modelProfile,'Точный режим использует другой набор моделей и может занимать больше времени.'));
      this.decode=this.controlSelect([['document','Печатный текст'],['line','Одна строка текста'],['codes','Номер или код — одна строка'],['amount','Сумма — одна строка']],'document');settings.append(field('Тип содержимого',this.decode,'Номер и сумма распознаются только в выделенных текстовых областях. Для них словарные подсказки исключены из моделей.'));
      this.thresholdMethod=this.controlSelect([['otsu','Стандартная'],['adaptive-otsu','Для неравномерного фона'],['sauvola','Sauvola — для сложного фона']],'otsu');settings.append(field('Обработка фона движком',this.thresholdMethod,'Штатные алгоритмы Tesseract. Выбор зависит от качества скана.'));
      this.layout=this.controlSelect([['auto','Автоматический макет'],['block','Единый текстовый блок'],['sparse','Разрозненные подписи']],'auto');settings.append(field('Расположение текста',this.layout));
      const gray=checkbox('Убрать цвет для OCR',true);this.grayscale=gray.input;settings.append(gray.wrap);
      this.contrast=this.controlSelect([['1','Исходный контраст'],['1.25','Усилить на 25%'],['1.5','Усилить на 50%'],['2','Усилить вдвое']],'1');settings.append(field('Контраст',this.contrast));
      this.rotation=this.number(-5,5,0,.1);settings.append(field('Коррекция наклона, °',this.rotation,'От −5 до +5°. Вращается изображение только для OCR.'));
      const skip=checkbox('Пропускать страницы с исходным текстом',true);this.skipNative=skip.input;settings.append(skip.wrap,el('p','pow-note','Обработка не меняет изображение в PDF. Выделенные области и исключения относятся к своей странице.'));
      this.runButton=button('Распознать',()=>void this.run(),'pow-primary pow-run');this.stopButton=button('Остановить после страницы',()=>this.requestStop(),'pow-stop');this.stopButton.hidden=true;this.progress=el('progress','pow-progress');this.progress.max=1;this.progress.value=0;this.progress.hidden=true;this.progressText=el('span','pow-progress-text');settings.append(this.runButton,this.stopButton,this.progress,this.progressText);
      this.runLog=el('div','pow-run-log');this.runLog.setAttribute('aria-live','polite');settings.append(this.runLog);
      const workspace=el('div','pow-preview-workspace'),toolbar=el('div','pow-preview-toolbar');this.pageSelect=this.controlSelect([],this.pageId);this.pageSelect.setAttribute('aria-label','Страница для просмотра');this.pageSelect.onchange=()=>void this.setPage(this.pageSelect.value);
      const modes=el('div','pow-area-modes');this.modeButtons=new Map();for(const [key,label] of [['view','Просмотр'],['text','Текст'],['table','Таблица'],['exclude','Исключить']]){const node=button(label,()=>this.setMode(key));this.modeButtons.set(key,node);modes.append(node);}toolbar.append(this.pageSelect,modes);
      this.previewScroll=el('div','pow-preview-scroll');this.preview=el('div','pow-preview');this.previewCanvas=el('canvas','pow-preview-canvas');this.areaLayer=el('div','pow-area-layer');this.areaLayer.setAttribute('aria-label','Области распознавания');this.preview.append(this.previewCanvas,this.areaLayer);this.previewScroll.append(this.preview);
      this.areaLayer.addEventListener('pointerdown',event=>this.startArea(event));this.areaLayer.addEventListener('pointermove',event=>this.moveArea(event));this.areaLayer.addEventListener('pointerup',event=>this.finishArea(event));this.areaLayer.addEventListener('pointercancel',()=>{this.gesture=null;this.renderAreaLayer();});
      this.areaList=el('div','pow-area-list');this.areaHint=el('p','pow-note','Выберите «Текст», «Таблица» или «Исключить» и обведите прямоугольник на странице. Без областей распознаётся вся страница.');workspace.append(toolbar,this.areaHint,this.previewScroll,this.areaList);panel.append(settings,workspace);return panel;
    }
    buildReview() {
      const panel=el('section','pow-review'),bar=el('div','pow-review-toolbar');
      this.reviewScope=this.controlSelect([['page','Показанная страница'],['all','Весь документ']],'page');this.reviewScope.onchange=()=>this.refreshReview();
      this.reviewFilter=this.controlSelect([['all','Все строки'],['uncertain','Требуют сверки'],['changed','С исправлениями']],'all');this.reviewFilter.onchange=()=>this.refreshReview();
      this.threshold=this.number(0,100,80);this.threshold.setAttribute('aria-label','Порог уверенности OCR в процентах');this.threshold.onchange=()=>this.refreshReview();
      this.reviewSearch=el('input','pow-input');this.reviewSearch.type='search';this.reviewSearch.placeholder='Найти в распознанном тексте';this.reviewSearch.oninput=()=>this.refreshReview();
      bar.append(this.reviewScope,this.reviewFilter,field('Порог OCR, %',this.threshold),this.reviewSearch);this.reviewSummary=el('p','pow-review-summary');
      const columns=el('div','pow-review-columns');this.lineList=el('div','pow-line-list');this.lineList.setAttribute('aria-label','Распознанные строки');this.lineEditor=el('div','pow-line-editor');columns.append(this.lineList,this.lineEditor);panel.append(bar,this.reviewSummary,el('p','pow-note','Процент — уверенность движка в распознанных символах, а не проверка реквизитов. Правки здесь изменяют OCR-текст; видимую надпись в PDF можно заменить инструментом текста.'),columns);return panel;
    }
    buildTables() {
      const panel=el('section','pow-tables'),bar=el('div','pow-table-toolbar');this.tableSelect=this.controlSelect([],'');this.tableSelect.setAttribute('aria-label','Таблица');this.tableSelect.onchange=()=>{this.selectedTable=this.tableSelect.value;this.renderGrid();};
      this.manualTableButton=button('Создать сетку',()=>this.createManualTable());this.tableCopyButton=button('Скопировать TSV',()=>void this.copyTable());this.tableCsvButton=button('Сохранить CSV',()=>void this.downloadTable());this.tableSourceButton=button('Показать оригинал',()=>{this.tableSource.hidden=!this.tableSource.hidden;this.tableSourceButton.textContent=this.tableSource.hidden?'Показать оригинал':'Скрыть оригинал';if(!this.tableSource.hidden)void this.renderTableSource();});bar.append(this.tableSelect,this.manualTableButton,this.tableCopyButton,this.tableCsvButton,this.tableSourceButton);
      this.tableMessage=el('p','pow-note','Обведите таблицу на первом этапе и запустите OCR. Сетка строится по координатам распознанных слов. Заголовки, объединённые ячейки и структуру нужно проверить.');this.tableSource=el('div','pow-table-source');this.tableSource.hidden=true;this.grid=el('div','pow-table-grid');this.gridTools=el('div','pow-grid-tools');panel.append(bar,this.tableMessage,this.tableSource,this.gridTools,this.grid);return panel;
    }
    setTab(tab) {
      if(this.running)return;
      this.tab=tab;for(const [key,node] of this.tabs){node.classList.toggle('is-active',key===tab);node.setAttribute('aria-selected',String(key===tab));}
      this.recognizePanel.hidden=tab!=='recognize';this.reviewPanel.hidden=tab!=='review';this.tablesPanel.hidden=tab!=='tables';
      if(tab==='review')this.refreshReview();if(tab==='tables')this.refreshTables();
    }
    refreshPageSelect() {this.pageSelect.replaceChildren();this.host.pages().forEach((model,index)=>this.pageSelect.append(option(model.id,'Страница '+(index+1))));this.pageSelect.value=this.pageId;}
    async setPage(pageId) {
      if(this.running)return;this.pageId=pageId;this.selectedArea=null;this.selectedLine=null;this.selectedTable=null;this.pageSelect.value=pageId;this.refreshAreas();await this.renderPreview();if(this.tab==='review')this.refreshReview();if(this.tab==='tables')this.refreshTables();
    }
    setMode(mode) {if(this.running)return;this.mode=mode;for(const [key,node] of this.modeButtons){node.classList.toggle('is-active',key===mode);node.setAttribute('aria-pressed',String(key===mode));}this.areaLayer.dataset.mode=mode;}
    async sourceCanvas(model,scale=1.2) {
      const key=model.id+':'+scale;
      if(this.cache.has(key))return this.cache.get(key);
      const promise=(async()=>{if(!(model.width>0)||!(model.height>0))throw Error('Неверный размер страницы');const actualScale=Math.min(scale,4800/Math.max(model.width,model.height),Math.sqrt(16000000/(model.width*model.height))),pdfPage=await this.host.pdfPage(model.id),viewport=pdfPage.getViewport({scale:actualScale,rotation:0}),canvas=el('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);await pdfPage.render({canvasContext:ctx,viewport,background:'#ffffff'}).promise;for(const area of redactions(model)){ctx.save();ctx.translate(area.x*actualScale,area.y*actualScale);ctx.rotate(finite(area.angle)*Math.PI/180);ctx.fillStyle=area.color||'#000000';ctx.fillRect(0,0,area.w*actualScale,area.h*actualScale);ctx.restore();}return canvas;})();
      this.cache.set(key,promise);try{const canvas=await promise;if(this.cache.size>4){const oldest=this.cache.keys().next().value;if(oldest!==key)this.cache.delete(oldest);}return canvas;}catch(err){this.cache.delete(key);throw err;}
    }
    async renderPreview() {
      const token=++this.previewToken,model=this.page();if(!model)return;
      this.preview.classList.add('is-loading');
      try{const source=await this.sourceCanvas(model,1.2);if(this.closed||token!==this.previewToken)return;this.previewCanvas.width=source.width;this.previewCanvas.height=source.height;this.previewCanvas.getContext('2d').drawImage(source,0,0);this.preview.style.aspectRatio=model.width+' / '+model.height;this.renderAreaLayer();this.setMode(this.mode);}catch(err){this.say('Не удалось показать страницу: '+err.message,true);}finally{if(token===this.previewToken)this.preview.classList.remove('is-loading');}
    }
    areaPoint(event) {const model=this.page(),rect=this.areaLayer.getBoundingClientRect();return {x:clamp((event.clientX-rect.left)/rect.width*model.width,0,model.width),y:clamp((event.clientY-rect.top)/rect.height*model.height,0,model.height)};}
    startArea(event) {
      if(this.running||event.button!==0)return;const target=event.target.closest('[data-area-id]');
      if(this.mode==='view'){if(target){this.selectedArea=target.dataset.areaId;this.refreshAreas();}return;}
      event.preventDefault();this.gesture={start:this.areaPoint(event),end:this.areaPoint(event),pointerId:event.pointerId};this.areaLayer.setPointerCapture(event.pointerId);this.renderAreaLayer();
    }
    moveArea(event) {if(!this.gesture||event.pointerId!==this.gesture.pointerId)return;this.gesture.end=this.areaPoint(event);this.renderAreaLayer();}
    finishArea(event) {
      if(!this.gesture||event.pointerId!==this.gesture.pointerId)return;const gesture=this.gesture;gesture.end=this.areaPoint(event);this.gesture=null;const area={id:uid(),type:this.mode,x:Math.min(gesture.start.x,gesture.end.x),y:Math.min(gesture.start.y,gesture.end.y),w:Math.abs(gesture.end.x-gesture.start.x),h:Math.abs(gesture.end.y-gesture.start.y)};
      if(area.w<8||area.h<8){this.renderAreaLayer();this.say('Область слишком мала. Обведите участок шире.');return;}
      this.host.mutate('Добавить область распознавания',()=>{const model=this.page();if(!Array.isArray(model.ocrAreas))model.ocrAreas=[];model.ocrAreas.push(area);});this.selectedArea=area.id;this.refreshAreas();this.say('Область добавлена. Запустите распознавание для обновления текста.');
    }
    renderAreaLayer() {
      const model=this.page();if(!model)return;this.areaLayer.replaceChildren();
      const draw=(area,draft=false)=>{const box=el('div','pow-area pow-area-'+area.type+(this.selectedArea===area.id?' is-selected':'')+(draft?' is-draft':''));box.style.left=area.x/model.width*100+'%';box.style.top=area.y/model.height*100+'%';box.style.width=area.w/model.width*100+'%';box.style.height=area.h/model.height*100+'%';if(!draft)box.dataset.areaId=area.id;const labels={text:'Текст',table:'Таблица',exclude:'Исключено'};box.append(el('span','',labels[area.type]||'Область'));this.areaLayer.append(box);};
      for(const area of model.ocrAreas||[])draw(area);
      if(this.gesture){const a=this.gesture.start,b=this.gesture.end;draw({type:this.mode,x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)},true);}
    }
    refreshAreas() {
      this.areaList.replaceChildren();const model=this.page();if(!model)return;
      const labels={text:'Текст',table:'Таблица',exclude:'Исключить'};
      for(const [index,area] of (model.ocrAreas||[]).entries()){
        const item=el('div','pow-area-chip'+(this.selectedArea===area.id?' is-selected':'')),select=button(labels[area.type]+' '+(index+1),()=>{this.selectedArea=area.id;this.refreshAreas();});select.title='Выбрать область';const remove=button('×',()=>{this.host.mutate('Удалить область распознавания',()=>{this.page().ocrAreas=this.page().ocrAreas.filter(item=>item.id!==area.id);});if(this.selectedArea===area.id)this.selectedArea=null;this.refreshAreas();});remove.setAttribute('aria-label','Удалить область '+(index+1));item.append(select,remove);this.areaList.append(item);
      }
      if(!(model.ocrAreas||[]).length)this.areaList.append(el('span','pow-note','Областей нет — вся страница.'));this.renderAreaLayer();
    }
    settings() {const rotation=finite(this.rotation.value);if(rotation < -5||rotation>5)throw Error('Угол коррекции должен быть от −5 до +5°.');return {language:this.language.value,profile:this.modelProfile.value,decode:this.decode.value,threshold:this.thresholdMethod.value,grayscale:this.grayscale.checked,contrast:finite(this.contrast.value,1),rotation,psm:this.decode.value==='document'?(this.layout.value==='block'?6:this.layout.value==='sparse'?11:3):7,skipNative:this.skipNative.checked};}
    setRunning(value) {
      this.running=value;for(const node of this.dialog.querySelectorAll('button,input,select,textarea'))node.disabled=value;
      this.stopButton.hidden=!value;this.runButton.hidden=value;this.progress.hidden=!value;this.closeButton.hidden=value;if(value)this.stopButton.disabled=false;
      if(!value){this.updateDraftState();this.tableCopyButton.disabled=!this.table();this.tableCsvButton.disabled=!this.table();}
    }
    requestStop() {this.stop=true;this.stopButton.disabled=true;this.say('Остановка запрошена. Текущая страница завершится; готовые результаты сохранятся.');}
    async run() {
      if(this.running)return;
      let settings,pages;try{settings=this.settings();const all=this.host.pages();pages=this.scope.value==='all'?[...all]:this.scope.value==='range'?pageRange(this.range.value,all.length).map(index=>all[index]):[this.page()];if(!this.host.api?.ocr)throw Error('Движок OCR недоступен.');if(['codes','amount'].includes(settings.decode)&&pages.some(model=>{const positive=(model.ocrAreas||[]).filter(area=>area.type!=='exclude');return !positive.length||positive.some(area=>area.type!=='text');}))throw Error('Для номера или суммы обведите одну строку инструментом «Текст». На каждой выбранной странице нужны только текстовые области, без табличных.');}catch(err){this.say(err.message,true);return;}
      if(this.drafts.size||this.tableDrafts.size)this.applyDrafts();
      this.stop=false;this.batchDone=0;this.batchTotal=pages.length;this.progress.value=0;this.runLog.replaceChildren();this.log=[];
      let done=0,failed=0,skipped=0,lines=0,protectedCount=0;
      const execute=async()=>{
        this.setRunning(true);
        try{
          for(const model of pages){
            if(this.stop)break;
            const number=this.host.pages().findIndex(p=>p.id===model.id)+1;this.batchLabel='Страница '+number+' · '+(this.batchDone+1)+' из '+pages.length;this.progressText.textContent=this.batchLabel;this.say('Распознавание: '+this.batchLabel.toLocaleLowerCase('ru'));
            try{
              const textItems=await this.host.text(model.id)||[],nativeItems=textItems.filter(item=>String(item.id||'').startsWith('source:')),positive=(model.ocrAreas||[]).filter(area=>area.type!=='exclude');
              if(settings.skipNative&&!positive.length&&nativeItems.map(item=>item.text||'').join('').trim().length>30){skipped++;this.addLog('Страница '+number+': пропущена — есть исходный текст.','skip');}
              else{
                const output=await this.recognizePage(model,settings,nativeItems);done++;lines+=output.count;protectedCount+=output.protectedCount;this.addLog('Страница '+number+': '+output.count+' строк'+(output.tables?' · таблиц '+output.tables:'')+(output.protectedCount?' · прежние правки сохранены':'')+(output.warning?' · '+output.warning:''),'done');
              }
            }catch(err){failed++;this.addLog('Страница '+number+': '+(err?.message||String(err)),'error');}
            this.batchDone++;this.progress.value=this.batchDone/this.batchTotal;
            await new Promise(resolve=>setTimeout(resolve,0));
          }
        }finally{this.setRunning(false);}
      };
      try{if(typeof this.host.busy==='function')await this.host.busy('Распознавание документа…',execute);else await execute();}catch(err){this.say('Ошибка распознавания: '+err.message,true);}
      await Promise.resolve(this.host.refresh?.());this.setRunning(false);this.refreshReview();this.refreshTables();
      const summary=(this.stop?'Остановлено. ':'Готово. ')+'Страниц распознано: '+done+', пропущено: '+skipped+', ошибок: '+failed+'. Строк: '+lines+'.'+(protectedCount?' Ранее исправленные строки сохранены.':'');this.progressText.textContent=summary;this.say(summary,failed>0);
      if(done>0){this.setTab('review');this.reviewScope.value=pages.length>1?'all':'page';this.refreshReview();}
    }
    addLog(message,type) {this.log.push({message,type});const line=el('div','pow-log-line is-'+type,message);this.runLog.append(line);this.runLog.scrollTop=this.runLog.scrollHeight;}
    async recognizePage(model,settings,nativeItems) {
      let scale=Math.min(300/72,4800/Math.max(model.width,model.height));if(model.width*model.height*scale*scale>16000000)scale=Math.sqrt(16000000/(model.width*model.height));
      const source=await this.sourceCanvas(model,scale),allAreas=(model.ocrAreas||[]).map(area=>clippedArea(area,model)).filter(area=>area.w>0&&area.h>0),regions=allAreas.filter(area=>area.type==='text'||area.type==='table'),exclusions=[...allAreas.filter(area=>area.type==='exclude'),...redactions(model).map(visualBounds),...(model.elements||[]).filter(item=>item.original).map(item=>visualBounds(item.original))];
      if(!regions.length)regions.push({id:'full:'+model.id,type:'text',x:0,y:0,w:model.width,h:model.height});
      const incoming=[],newTables=[],scores=[],texts=[],engines=[];let coordinatesMissing=false;
      for(const region of regions){
        const crop=el('canvas');crop.width=Math.max(1,Math.round(region.w*scale));crop.height=Math.max(1,Math.round(region.h*scale));const ctx=crop.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,crop.width,crop.height);ctx.drawImage(source,region.x*scale,region.y*scale,region.w*scale,region.h*scale,0,0,crop.width,crop.height);
        for(const exclusion of exclusions){ctx.fillStyle='#fff';ctx.fillRect((exclusion.x-region.x)*scale,(exclusion.y-region.y)*scale,exclusion.w*scale,exclusion.h*scale);}
        preprocess(crop,settings);
        const result=await this.host.api.ocr(crop.toDataURL('image/png').split(',')[1],{language:settings.language,profile:settings.profile,decode:settings.decode,threshold:settings.threshold,isRegion:!region.id.startsWith('full:'),psm:region.type==='table'?6:settings.psm});
        if(!result?.ok){crop.width=crop.height=1;throw Error(result?.error||'Движок не вернул результат.');}
        if(result.meta)engines.push({areaId:region.id,coreVersion:result.meta.coreVersion,nativeCore:result.meta.nativeCore?{...result.meta.nativeCore}:null,profile:result.meta.effectiveModelProfile,decode:result.meta.decode,threshold:result.meta.threshold,bindingPatchVersion:result.meta.bindingPatchVersion||null,modelFiles:(result.meta.modelFiles||[]).map(file=>({language:file.language,sha256:file.sha256})),rotateRadians:result.meta.rotateRadians||0});
        const score=confidence(result.confidence);if(score!=null)scores.push(score);if(result.text?.trim())texts.push(result.text.trim());
        const pageWords=[];
        for(const line of result.lines||[]){
          if(!line.text?.trim()||!line.bbox)continue;const bbox=canonicalBox(line.bbox,region,scale,settings.rotation,crop);if(bbox.w<.1||bbox.h<.1||exclusions.some(exclusion=>intersection(bbox,exclusion)>bbox.w*bbox.h*.5))continue;
          const lineId='ocr:'+uid(),words=(line.words||[]).filter(word=>word.text?.trim()&&word.bbox).map(word=>({text:String(word.text),confidence:confidence(word.confidence),bbox:canonicalBox(word.bbox,region,scale,settings.rotation,crop)})).filter(word=>word.bbox.w>0&&word.bbox.h>0&&!exclusions.some(exclusion=>intersection(word.bbox,exclusion)>word.bbox.w*word.bbox.h*.5));pageWords.push(...words);
          incoming.push({id:lineId,origKey:lineId,type:'text',text:String(line.text).trim(),...bbox,bbox,fontSize:clamp(bbox.h*.82,5,100),color:'#000000',angle:0,wrap:false,confidence:confidence(line.confidence),words,areaId:region.id,reviewed:false,userCorrected:false});
        }
        if(!(result.lines||[]).length&&result.text?.trim())coordinatesMissing=true;
        if(region.type==='table'){
          const rootWords=(result.words||[]).filter(word=>word.text?.trim()&&word.bbox).map(word=>({text:String(word.text),confidence:confidence(word.confidence),bbox:canonicalBox(word.bbox,region,scale,settings.rotation,crop)}));
          const words=pageWords.length?pageWords:rootWords.filter(word=>!exclusions.some(exclusion=>intersection(word.bbox,exclusion)>word.bbox.w*word.bbox.h*.5));
          const table=tableFromWords(words,region);if(!words.length){table.rows=texts.at(-1)?.split(/\r?\n/).filter(Boolean).map(text=>[text])||[['']];table.source='manual';table.note='Координаты слов не получены. Сетка требует ручной разметки.';}newTables.push(table);
        }
        crop.width=crop.height=1;
      }
      const merged=mergeLines(model,incoming,regions,nativeItems),previousTables=model.ocrTables||[],retainedTables=previousTables.filter(table=>!regions.some(region=>region.id===table.areaId));let tablePreserved=0;
      for(const table of newTables){const previous=previousTables.find(item=>item.areaId===table.areaId&&(item.userCorrected||item.reviewed));if(previous){retainedTables.push(previous);tablePreserved++;}else retainedTables.push(table);}
      this.host.mutate('Распознать страницу',()=>{model.ocrLines=merged.lines;model.ocrText=merged.lines.map(line=>line.text).join('\n')||texts.join('\n');model.ocrConfidence=scores.length?scores.reduce((sum,score)=>sum+score,0)/scores.length:null;model.ocrTables=retainedTables;model.ocrPreprocess={...settings};model.ocrEngines=engines;model.ocrWarnings=[...(coordinatesMissing?['Текст получен без координат строк. Проверьте его вручную.']:[]),...(merged.protectedCount?['Прежние исправления текста сохранены при повторном распознавании.']:[]),...(tablePreserved?['Исправленные таблицы сохранены при повторном распознавании.']:[])];});
      return {count:incoming.length,tables:newTables.length,protectedCount:merged.protectedCount,warning:coordinatesMissing?'движок не вернул координаты':''};
    }
    lineEntries() {const models=this.reviewScope.value==='all'?this.host.pages():[this.page()];return models.flatMap(model=>{const replaced=new Set((model?.elements||[]).map(item=>item.origKey).filter(Boolean));return (model?.ocrLines||[]).filter(line=>!replaced.has(line.origKey)&&!redacted(model,visualBounds(line))).map(line=>({model,line}));});}
    draftText(model,line) {return this.drafts.get(model.id+':'+line.id)?.text??line.text;}
    refreshReview() {
      if(!this.lineList)return;const entries=this.lineEntries(),threshold=clamp(finite(this.threshold.value,80),0,100),query=this.reviewSearch.value.trim().toLocaleLowerCase('ru');
      const needs=line=>!line.reviewed&&(confidence(line.confidence)==null||line.confidence<threshold),uncertain=entries.filter(({line})=>needs(line)).length;
      const filtered=entries.filter(({model,line})=>{if(query&&!this.draftText(model,line).toLocaleLowerCase('ru').includes(query))return false;return this.reviewFilter.value==='uncertain'?needs(line):this.reviewFilter.value==='changed'?line.userCorrected||this.drafts.has(model.id+':'+line.id):true;});
      this.reviewSummary.textContent='Строк: '+entries.length+' · требуют сверки: '+uncertain+' · показано: '+filtered.length;this.lineList.replaceChildren();
      for(const {model,line} of filtered){
        const key=model.id+':'+line.id,node=button('',()=>{this.selectedLine={pageId:model.id,lineId:line.id};this.refreshReview();},'pow-line-item'+(this.selectedLine?.pageId===model.id&&this.selectedLine?.lineId===line.id?' is-selected':''));const top=el('span','pow-line-meta'),score=confidence(line.confidence),badge=el('span','pow-confidence'+(needs(line)?' is-low':''),score==null?'OCR: нет оценки':'OCR '+Math.round(score)+'%');top.append(el('span','','Стр. '+(this.host.pages().indexOf(model)+1)),badge);if(line.reviewed)top.append(el('span','pow-reviewed','Проверена'));if(this.drafts.has(key)||line.userCorrected)top.append(el('span','pow-edited','Исправлена'));node.append(top,el('span','pow-line-text',this.draftText(model,line)));this.lineList.append(node);
      }
      if(!filtered.length)this.lineList.append(el('div','pow-empty',entries.length?'По выбранному фильтру строк нет.':'Здесь появятся OCR-строки. Сначала запустите распознавание.'));
      if(!this.selectedLine||!filtered.some(({model,line})=>model.id===this.selectedLine.pageId&&line.id===this.selectedLine.lineId))this.selectedLine=filtered[0]?{pageId:filtered[0].model.id,lineId:filtered[0].line.id}:null;
      this.renderLineEditor();
    }
    async renderLineEditor() {
      const token=++this.cropToken;this.lineEditor.replaceChildren();if(!this.selectedLine){this.lineEditor.append(el('div','pow-empty','Выберите строку слева.'));return;}
      const model=this.host.pages().find(item=>item.id===this.selectedLine.pageId),line=model?.ocrLines?.find(item=>item.id===this.selectedLine.lineId);if(!model||!line)return;
      const key=model.id+':'+line.id,head=el('div','pow-editor-heading');head.append(el('h3','','Сверка строки'),el('span','pow-note','Страница '+(this.host.pages().indexOf(model)+1)));
      const source=el('div','pow-line-source'),canvas=el('canvas');source.append(canvas);const text=el('textarea','pow-line-input');text.value=this.draftText(model,line);text.rows=5;text.setAttribute('aria-label','Исправленный текст строки');text.spellcheck=false;text.oninput=()=>{this.drafts.set(key,{pageId:model.id,lineId:line.id,text:text.value,reviewed:true});this.updateDraftState();};
      const pending=this.drafts.get(key),isReviewed=pending?.reviewed??line.reviewed;
      const tools=el('div','pow-line-tools'),approve=button(isReviewed?'Отметить непроверенной':'Строка проверена',()=>{const draft=this.drafts.get(key);if(draft){draft.reviewed=!draft.reviewed;this.updateDraftState();}else this.host.mutate('Отметить OCR-строку',()=>{line.reviewed=!line.reviewed;});this.refreshReview();}),reset=button('Сбросить правку строки',()=>{this.drafts.delete(key);this.updateDraftState();this.renderLineEditor();});tools.append(approve,reset);
      const words=Array.isArray(line.words)?line.words:[],lowWords=words.filter(word=>confidence(word.confidence)!=null&&word.confidence<finite(this.threshold.value,80));
      this.lineEditor.append(head,el('span','pow-label','Фрагмент исходного документа'),source,field('Распознанный текст',text),tools);
      if(lowWords.length)this.lineEditor.append(el('p','pow-warning','Слова для сверки: '+lowWords.map(word=>word.text+' ('+Math.round(word.confidence)+'%)').join(', ')));
      if(line.originalText&&line.originalText!==line.text)this.lineEditor.append(el('p','pow-note','До ручной правки: '+line.originalText));
      try{const image=await this.sourceCanvas(model,1.8);if(token!==this.cropToken||this.closed)return;const scale=image.width/model.width,b=bounds(line),padX=12,padY=Math.max(6,b.h*.6),x=clamp(b.x-padX,0,model.width),y=clamp(b.y-padY,0,model.height),w=Math.min(model.width-x,b.w+padX*2),h=Math.min(model.height-y,b.h+padY*2);canvas.width=Math.max(1,Math.ceil(w*scale));canvas.height=Math.max(1,Math.ceil(h*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,x*scale,y*scale,w*scale,h*scale,0,0,canvas.width,canvas.height);ctx.strokeStyle='#2e5bff';ctx.lineWidth=1;ctx.strokeRect((b.x-x)*scale,(b.y-y)*scale,b.w*scale,b.h*scale);}catch(err){if(token===this.cropToken)source.replaceChildren(el('p','pow-warning','Фрагмент недоступен: '+err.message));}
    }
    updateDraftState() {const count=this.drafts.size+this.tableDrafts.size;this.applyButton.disabled=this.running||!count;this.applyButton.textContent=count?'Применить правки ('+count+')':'Применить правки';if(!count)this.discardButton.hidden=true;}
    applyDrafts() {
      if(this.running||!this.drafts.size&&!this.tableDrafts.size)return;let count=0;
      this.host.mutate('Исправить результаты OCR',()=>{
        for(const draft of this.drafts.values()){
          const model=this.host.pages().find(item=>item.id===draft.pageId),line=model?.ocrLines?.find(item=>item.id===draft.lineId);if(!line)continue;if(line.text!==draft.text){if(!line.originalText)line.originalText=line.text;line.text=draft.text;line.userCorrected=true;}line.reviewed=draft.reviewed;model.ocrText=model.ocrLines.map(item=>item.text).join('\n');count++;
        }
        for(const [key,draft] of this.tableDrafts){const [pageId]=key.split('|'),model=this.host.pages().find(item=>item.id===pageId),index=model?.ocrTables?.findIndex(item=>item.id===draft.id);if(index>=0){model.ocrTables[index]={...clone(draft),userCorrected:true};count++;}}
      });
      this.drafts.clear();this.tableDrafts.clear();this.updateDraftState();this.refreshReview();this.refreshTables();void Promise.resolve(this.host.refresh?.());this.say('Применено изменений: '+count+'. Сохраните PDF, чтобы записать OCR-текст в файл.');
    }
    allTables() {return this.host.pages().flatMap(model=>(model.ocrTables||[]).filter(table=>!redacted(model,bounds(table.bbox))).map(table=>({model,table})));}
    table() {const entry=this.allTables().find(({table})=>table.id===this.selectedTable);if(!entry)return null;return {model:entry.model,table:this.tableDrafts.get(entry.model.id+'|'+entry.table.id)||entry.table};}
    refreshTables() {
      if(!this.tableSelect)return;const tables=this.allTables();if(!tables.some(({table})=>table.id===this.selectedTable))this.selectedTable=tables.find(({model})=>model.id===this.pageId)?.table.id||tables[0]?.table.id||null;
      this.tableSelect.replaceChildren();for(const {model,table} of tables)this.tableSelect.append(option(table.id,'Стр. '+(this.host.pages().indexOf(model)+1)+' · таблица '+((model.ocrTables||[]).indexOf(table)+1)));this.tableSelect.value=this.selectedTable||'';this.tableCopyButton.disabled=this.tableCsvButton.disabled=!tables.length;this.renderGrid();
    }
    createManualTable() {
      const model=this.page();if(!model)return;const selected=(model.ocrAreas||[]).find(area=>area.id===this.selectedArea&&area.type!=='exclude'),area=selected||{id:null,x:0,y:0,w:model.width,h:model.height};if(redacted(model,bounds(area))){this.say('Выделите область таблицы вне участков удаления содержимого.',true);return;}const table={id:uid(),areaId:area.id,bbox:bounds(area),rows:[['','',''],['','',''],['','','']],columnBounds:[],source:'manual',reviewed:false};
      this.host.mutate('Добавить таблицу',()=>{if(!Array.isArray(model.ocrTables))model.ocrTables=[];model.ocrTables.push(table);});this.selectedTable=table.id;this.refreshTables();this.say('Создана ручная сетка 3 × 3. Добавляйте строки и столбцы по документу.');
    }
    draftTable() {const entry=this.table();if(!entry)return null;const key=entry.model.id+'|'+entry.table.id;if(!this.tableDrafts.has(key))this.tableDrafts.set(key,clone(entry.table));this.updateDraftState();return this.tableDrafts.get(key);}
    gridEdit(fn) {const table=this.draftTable();if(!table)return;fn(table);table.reviewed=false;this.renderGrid();}
    renderGrid() {
      this.grid.replaceChildren();this.gridTools.replaceChildren();const entry=this.table();this.tableSourceButton.disabled=!entry;if(!entry){this.tableSource.replaceChildren();this.grid.append(el('div','pow-empty','Таблиц пока нет. Выделите область таблицы и распознайте её или создайте ручную сетку.'));return;}
      const table=entry.table,cols=Math.max(1,...table.rows.map(row=>row.length));this.tableMessage.textContent=(table.source==='ocr-words'?'Черновик по координатам OCR-слов. ':'Ручная сетка. ')+(table.note||'Проверьте столбцы, заголовки и объединённые ячейки.')+' '+table.rows.length+' × '+cols+'.'+(table.reviewed?' Таблица проверена.':'');
      const addRow=button('+ Строка',()=>this.gridEdit(draft=>draft.rows.push(Array.from({length:cols},()=>'')))),addCol=button('+ Столбец',()=>this.gridEdit(draft=>{draft.rows.forEach(row=>{while(row.length<cols)row.push('');row.push('');});draft.columnBounds=[];}));
      const reviewed=button(table.reviewed?'Снять отметку проверки':'Таблица проверена',()=>{const draft=this.draftTable();draft.reviewed=!draft.reviewed;this.renderGrid();});
      const remove=button('Удалить таблицу',()=>{const entry=this.table();if(!entry)return;this.tableDrafts.delete(entry.model.id+'|'+entry.table.id);this.host.mutate('Удалить OCR-таблицу',()=>{entry.model.ocrTables=entry.model.ocrTables.filter(item=>item.id!==entry.table.id);});this.selectedTable=null;this.updateDraftState();this.refreshTables();},'pow-danger');this.gridTools.append(addRow,addCol,reviewed,remove);
      const wrap=el('div','pow-grid-scroll'),grid=el('table','pow-grid-table'),head=el('thead'),header=el('tr');header.append(el('th','','№'));
      for(let col=0;col<cols;col++){const cell=el('th'),label=el('span','','Столбец '+(col+1)),del=button('×',()=>this.gridEdit(draft=>{draft.rows.forEach(row=>row.splice(col,1));draft.columnBounds=[];}));del.disabled=cols<=1;del.setAttribute('aria-label','Удалить столбец '+(col+1));cell.append(label,del);header.append(cell);}head.append(header);grid.append(head);const body=el('tbody');
      table.rows.forEach((row,rowIndex)=>{const tr=el('tr'),rowHead=el('th'),del=button('×',()=>this.gridEdit(draft=>draft.rows.splice(rowIndex,1)));del.disabled=table.rows.length<=1;del.setAttribute('aria-label','Удалить строку '+(rowIndex+1));rowHead.append(el('span','',String(rowIndex+1)),del);tr.append(rowHead);for(let col=0;col<cols;col++){const cell=el('td'),input=el('textarea','pow-cell');input.rows=2;input.value=row[col]||'';input.setAttribute('aria-label','Строка '+(rowIndex+1)+', столбец '+(col+1));input.oninput=()=>{const draft=this.draftTable();while(draft.rows[rowIndex].length<cols)draft.rows[rowIndex].push('');draft.rows[rowIndex][col]=input.value;draft.reviewed=false;this.tableMessage.textContent='Есть несохранённые изменения таблицы. Проверьте сетку и нажмите «Применить правки».';};cell.append(input);tr.append(cell);}body.append(tr);});grid.append(body);wrap.append(grid);this.grid.append(wrap);if(!this.tableSource.hidden)void this.renderTableSource();
    }
    async renderTableSource() {const entry=this.table();if(!entry||this.tableSource.hidden)return;const token=uid();this.tableSourceToken=token;this.tableSource.replaceChildren(el('p','pow-note','Подготовка фрагмента…'));try{const image=await this.sourceCanvas(entry.model,1.5);if(this.closed||this.tableSourceToken!==token)return;const scale=image.width/entry.model.width,b=bounds(entry.table.bbox),canvas=el('canvas');canvas.width=Math.max(1,Math.ceil(b.w*scale));canvas.height=Math.max(1,Math.ceil(b.h*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,b.x*scale,b.y*scale,b.w*scale,b.h*scale,0,0,canvas.width,canvas.height);this.tableSource.replaceChildren(canvas);}catch(err){if(this.tableSourceToken===token)this.tableSource.replaceChildren(el('p','pow-warning','Не удалось показать фрагмент: '+err.message));}}
    async copyTable() {const entry=this.table();if(!entry)return;try{await navigator.clipboard.writeText(tsv(entry.table.rows));this.say('Таблица скопирована. Вставьте в Excel; столбцы разделены табуляцией.');}catch(err){this.say('Не удалось скопировать таблицу. Используйте «Сохранить CSV».',true);}}
    async downloadTable() {const entry=this.table();if(!entry)return;if(typeof this.host.api?.exportDocument!=='function'){this.say('Экспорт CSV недоступен. Скопируйте таблицу кнопкой TSV.',true);return;}const payload={format:'csv',title:'Таблица-страница-'+(this.host.pages().indexOf(entry.model)+1),pages:[{number:this.host.pages().indexOf(entry.model)+1,width:entry.model.width,height:entry.model.height,tables:[{title:'Таблица',rows:clone(entry.table.rows)}],blocks:[]}]};const job=async()=>{try{const result=await this.host.api.exportDocument(payload);if(result?.ok)this.say('Таблица сохранена: '+result.path);else if(result?.canceled)this.say('Экспорт отменён. Таблица остаётся в редакторе.');else this.say(result?.error||'Не удалось сохранить CSV.',true);}catch(err){this.say('Не удалось сохранить CSV: '+err.message,true);}};if(typeof this.host.busy==='function')await this.host.busy('Экспорт таблицы…',job);else await job();this.updateDraftState();this.refreshTables();}
    requestClose() {if(this.running){this.requestStop();return;}if(this.drafts.size||this.tableDrafts.size){this.discardButton.hidden=false;this.say('Есть несохранённые правки OCR. Примените их или выберите «Отбросить … и закрыть».');return;}this.close();}
    close() {this.closed=true;this.previewToken++;this.cropToken++;if(typeof this.unsubscribe==='function')this.unsubscribe();this.dialog.close();this.dialog.remove();this.cache.clear();if(active===this)active=null;void Promise.resolve(this.host.refresh?.());}
  }
  let active=null;
  window.PdfOcrWorkbench={
    open:async host=>{if(active){active.dialog?.focus();return;}if(!host?.pages||!host?.pdfPage||!host?.mutate)throw Error('Не подключён интерфейс PDF-редактора.');const workbench=new Workbench(host);active=workbench;try{await workbench.open();if(!workbench.dialog&&active===workbench)active=null;}catch(err){workbench.dialog?.remove();if(typeof workbench.unsubscribe==='function')workbench.unsubscribe();if(active===workbench)active=null;host.status?.('Не удалось открыть OCR: '+err.message);throw err;}},
    hasPending:()=>!!active&&(active.drafts.size>0||active.tableDrafts.size>0),
    requestClose:()=>active?.requestClose(),
    tableTsv:tsv,
    tableCsv:csv
  };
})();
