/* Document projects, conversion, recovery and text comparison for the PDF host. */
(function (scope) {
  'use strict';
  const make = (tag, cls, text) => { const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node; };
  const clone = value => JSON.parse(JSON.stringify(value));
  const finite = (value,fallback=0) => Number.isFinite(Number(value))?Number(value):fallback;
  const uid = () => crypto.randomUUID();
  const PROJECT_NOTE = 'Проект хранит исходные PDF, включая закрытые и удалённые области. Для передачи документа с удалённым содержимым сохраните PDF.';
  const button = (label,action,cls='') => {const node=make('button','pds-button '+cls,label);node.type='button';node.onclick=event=>{const report=error=>{const body=node.closest('dialog')?.querySelector('.pds-dialog-body');if(body){let warning=body.querySelector('.pds-form-error');if(!warning){warning=make('p','pds-form-error');warning.setAttribute('role','alert');body.append(warning);}warning.textContent=error?.message||String(error);}};try{Promise.resolve(action(event)).catch(report);}catch(error){report(error);}};return node;};
  const field = (label,input,note) => {const wrap=make('label','pds-field');wrap.append(make('span','pds-label',label),input);if(note)wrap.append(make('small','pds-note',note));return wrap;};
  const input = (type,value) => {const node=make('input','pds-input');node.type=type;node.value=value;return node;};
  const select = (entries,value) => {const node=make('select','pds-input');entries.forEach(([key,label])=>{const option=make('option','',label);option.value=key;node.append(option);});node.value=value;return node;};
  const check = (label,checked) => {const wrap=make('label','pds-check'),control=input('checkbox','');control.checked=checked;wrap.append(control,make('span','',label));return {wrap,control};};
  const from64 = value => Uint8Array.from(atob(value),character=>character.charCodeAt(0));
  const to64 = value => {if(typeof value==='string')return value.replace(/^data:application\/pdf;base64,/,'');const bytes=value instanceof Uint8Array?value:new Uint8Array(value);let binary='';for(let index=0;index<bytes.length;index+=32768)binary+=String.fromCharCode(...bytes.subarray(index,index+32768));return btoa(binary);};
  function rangeOf(text,total) {
    const selected=new Set();
    for(const part of String(text||'').replace(/\s+/g,'').split(/[,;]+/)){
      if(!part)continue;
      const found=part.match(/^(\d+)(?:[-–—](\d+))?$/);if(!found)throw Error('Укажите страницы, например 1, 3–5.');
      const first=Number(found[1]),last=Number(found[2]||found[1]);
      if(first<1||last<first||last>total)throw Error('Диапазон должен быть от 1 до '+total+'.');
      for(let number=first;number<=last;number++)selected.add(number-1);
    }
    if(!selected.size)throw Error('Выберите хотя бы одну страницу.');
    return [...selected].sort((a,b)=>a-b);
  }
  const allRange = total => total>1?'1–'+total:'1';
  function boxOf(value) {const box=value?.bbox||value||{};return {x:finite(box.x),y:finite(box.y),w:Math.max(0,finite(box.w)),h:Math.max(0,finite(box.h))};}
  function boundsOf(value) {const box=boxOf(value),r=finite(value?.angle)*Math.PI/180,c=Math.cos(r),s=Math.sin(r),corners=[[0,0],[box.w,0],[box.w,box.h],[0,box.h]].map(([x,y])=>({x:box.x+x*c-y*s,y:box.y+x*s+y*c})),x=Math.min(...corners.map(p=>p.x)),y=Math.min(...corners.map(p=>p.y));return {x,y,w:Math.max(...corners.map(p=>p.x))-x,h:Math.max(...corners.map(p=>p.y))-y};}
  function crosses(left,right) {const a=boundsOf(left),b=boundsOf(right);return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
  function mostlyInside(item,area) {const a=boxOf(item),b=boxOf(area),cross=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));return cross/Math.max(1,a.w*a.h)>.6;}
  function textLines(items) {
    const ordered=items.filter(item=>String(item.text||'').trim()).sort((a,b)=>finite(a.y)-finite(b.y)||finite(a.x)-finite(b.x));
    const rows=[];
    for(const item of ordered){
      const y=finite(item.y),height=Math.max(1,finite(item.h,finite(item.fontSize,11)));
      let row=rows.at(-1);
      if(!row||Math.abs(row.y-y)>Math.max(height,row.h)*.5){row={y,h:height,items:[]};rows.push(row);}
      row.items.push(item);
    }
    return rows.map(row=>row.items.sort((a,b)=>finite(a.x)-finite(b.x)).map(item=>String(item.text||'').trim()).join(' ').replace(/[ \t]+/g,' ').trim()).filter(Boolean);
  }
  function textDiff(left,right) {
    const originalLeft=left.length,originalRight=right.length;
    let prefix=0,suffix=0;
    while(prefix<left.length&&prefix<right.length&&left[prefix]===right[prefix])prefix++;
    while(suffix<left.length-prefix&&suffix<right.length-prefix&&left[left.length-suffix-1]===right[right.length-suffix-1])suffix++;
    let a=left.slice(prefix,left.length-suffix),b=right.slice(prefix,right.length-suffix),limited=false;
    if(a.length*b.length>2000000){
      const cap=Math.max(1,Math.floor(Math.sqrt(2000000)));a=a.slice(0,cap);b=b.slice(0,cap);limited=true;
    }
    const stride=b.length+1,matrix=new Uint16Array((a.length+1)*stride);
    for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)matrix[i*stride+j]=a[i]===b[j]?matrix[(i+1)*stride+j+1]+1:Math.max(matrix[(i+1)*stride+j],matrix[i*stride+j+1]);
    const rows=[];let i=0,j=0,removed=0,added=0;
    const contextStart=Math.max(0,prefix-2);
    for(let k=contextStart;k<prefix;k++)rows.push({kind:'same',left:k+1,right:k+1,text:left[k]});
    while(i<a.length||j<b.length){
      if(i<a.length&&j<b.length&&a[i]===b[j]){rows.push({kind:'same',left:prefix+i+1,right:prefix+j+1,text:a[i]});i++;j++;}
      else if(j<b.length&&(i===a.length||matrix[i*stride+j+1]>=matrix[(i+1)*stride+j])){rows.push({kind:'add',left:null,right:prefix+j+1,text:b[j++]});added++;}
      else {rows.push({kind:'remove',left:prefix+i+1,right:null,text:a[i++]});removed++;}
    }
    if(!limited)for(let k=0;k<Math.min(suffix,2);k++)rows.push({kind:'same',left:originalLeft-suffix+k+1,right:originalRight-suffix+k+1,text:left[originalLeft-suffix+k]});
    return {rows,added,removed,limited,prefix,suffix,originalLeft,originalRight};
  }
  function modal(title,subtitle,wide=false) {
    const dialog=make('dialog','pds-dialog'+(wide?' pds-dialog-wide':'')),heading=make('div','pds-dialog-heading'),titleId='pds-title-'+uid();
    const caption=make('div'),h2=make('h2','',title);h2.id=titleId;caption.append(h2);if(subtitle)caption.append(make('p','',subtitle));
    const close=button('×',()=>dialog.close(),'pds-close');close.setAttribute('aria-label','Закрыть');heading.append(caption,close);
    const body=make('div','pds-dialog-body'),actions=make('div','pds-dialog-actions');dialog.setAttribute('aria-labelledby',titleId);dialog.append(heading,body,actions);document.body.append(dialog);
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
    dialog.addEventListener('keydown',event=>event.stopPropagation());
    return {dialog,body,actions,close:()=>dialog.close()};
  }
  class Studio {
    constructor(host) {this.host=host;this.api=host.api;this.locked=false;this.revision=0;this.documentKey='';this.needsSave=false;this.firstPending=0;this.lastSaved=0;this.lastModel='';this.recoveryId=null;this.autosaveTimer=null;this.autosavePromise=null;this.disposed=false;this.recoveryCount=0;}
    title() {return this.host.title?.()||'Документ';}
    pages() {return this.host.pages()||[];}
    current() {const value=this.host.current?.();return typeof value==='string'?this.pages().find(page=>page.id===value):value;}
    identity(detail) {return detail?.documentId||this.host.sources?.()?.[0]?.id||this.pages()[0]?.sourceId||this.title();}
    say(text,bad=false) {this.state.textContent=text;this.state.classList.toggle('is-error',bad);this.state.title=text;this.host.status?.(text);}
    async run(label,fn) {
      if(this.locked||this.host.isBusy?.())return false;
      this.locked=true;this.sync();
      try{return await (this.host.busy?this.host.busy(label,fn):fn());}
      catch(error){this.say(error?.message||String(error),true);return false;}
      finally{this.locked=false;this.sync();}
    }
    sync() {this.bar.querySelectorAll('button').forEach(control=>{control.disabled=this.locked||!!this.host.isBusy?.();});this.recoveryButton.textContent='Восстановление'+(this.recoveryCount?' · '+this.recoveryCount:'');}
    install() {
      this.bar=make('nav','pds-bar');this.bar.setAttribute('aria-label','Рабочий цикл документов');
      const brand=make('span','pds-bar-label','Документы');
      const projects=make('div','pds-bar-group');projects.append(button('Открыть проект',()=>void this.openProject()),button('Сохранить проект',()=>this.saveProjectDialog()));
      const exportGroup=make('div','pds-bar-group');exportGroup.append(button('Экспорт в Word / Excel',()=>this.exportDialog()),button('Выбранные страницы',()=>this.pagesDialog()));
      const tools=make('div','pds-bar-group');tools.append(button('Сравнить PDF',()=>void this.compare()),button('Номера и водяной знак',()=>this.marksDialog()));
      this.recoveryButton=button('Восстановление',()=>void this.recoveryDialog());this.recoveryButton.title='Локальные автоматические копии редактируемых проектов';
      this.state=make('span','pds-autosave','Автокопия при изменениях');this.state.setAttribute('role','status');this.state.title='Автокопии хранятся локально; исходные PDF и рабочая база не изменяются.';
      this.bar.append(brand,projects,exportGroup,tools,this.recoveryButton,this.state);
      const anchor=document.querySelector('.pe-findbar')||document.querySelector('.pe-pagebar')||document.querySelector('.pe-ribbon')||document.querySelector('header');
      if(anchor)anchor.after(this.bar);else document.body.prepend(this.bar);
      this.documentKey=this.identity();this.onChange=event=>this.changed(event.detail||{});scope.addEventListener('pdf-studio-change',this.onChange);
      this.onVisibility=()=>{if(document.visibilityState==='hidden'&&this.needsSave)void this.flushAutosave();};document.addEventListener('visibilitychange',this.onVisibility);
      this.startupTimer=setTimeout(()=>void this.loadRecovery(),500);
      return {flushAutosave:()=>this.flushAutosave(true),hasPendingAutosave:()=>this.needsSave||!!this.autosavePromise,dispose:()=>this.dispose()};
    }
    changed(detail) {
      const key=this.identity(detail),revision=typeof detail.revision==='number'?detail.revision:this.revision+1,changed=revision!==this.revision;
      this.revision=revision;
      if(key!==this.documentKey){clearTimeout(this.autosaveTimer);this.documentKey=key;this.needsSave=false;this.firstPending=0;this.lastModel='';this.recoveryId=null;this.lastSaved=0;this.say('Автокопия при изменениях');}
      if(changed&&(detail.dirty||this.recoveryId||this.needsSave)){this.needsSave=true;if(!this.firstPending)this.firstPending=Date.now();this.scheduleAutosave();}
    }
    scheduleAutosave() {
      clearTimeout(this.autosaveTimer);if(this.disposed||!this.needsSave)return;
      const now=Date.now(),delay=Math.max(0,Math.min(10000,this.firstPending+30000-now),this.lastSaved+30000-now);
      this.autosaveTimer=setTimeout(()=>void this.flushAutosave(),delay);
    }
    async flushAutosave(force=false) {
      if(this.disposed||!this.needsSave)return true;
      if(this.autosavePromise){await this.autosavePromise;if(this.needsSave&&force)return this.flushAutosave(true);return !this.needsSave;}
      if(this.host.isBusy?.()&&!this.locked&&!force){this.autosaveTimer=setTimeout(()=>void this.flushAutosave(),3000);return false;}
      clearTimeout(this.autosaveTimer);
      this.autosavePromise=(async()=>{
        const key=this.documentKey;
        try {
          const project=await this.host.serializeProject(),revision=this.revision,model=JSON.stringify(project.pages||project.model||project);
          if(model===this.lastModel){if(key===this.documentKey&&revision===this.revision){this.needsSave=false;this.firstPending=0;}return true;}
          this.state.textContent='Сохраняем автокопию…';
          const result=await this.api.autosave({project,recoveryId:this.recoveryId||undefined});
          if(!result?.ok)throw Error(result?.error||'Автокопия не сохранена');
          if(key===this.documentKey){this.recoveryId=result.id;this.lastSaved=Date.now();this.lastModel=model;this.needsSave=revision!==this.revision;this.firstPending=this.needsSave?Date.now():0;this.state.textContent='Автокопия · '+new Date(result.savedAt||Date.now()).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});this.state.classList.remove('is-error');}
          return true;
        } catch(error){this.say('Не удалось сохранить автокопию: '+(error?.message||error),true);return false;}
        finally{this.autosavePromise=null;if(this.needsSave&&!this.disposed){this.firstPending=Date.now();this.autosaveTimer=setTimeout(()=>void this.flushAutosave(),30000);}}
      })();
      return this.autosavePromise;
    }
    saveProjectDialog() {
      if(this.locked||this.host.isBusy?.())return;
      const view=modal('Сохранить редактируемый проект','PDF-источники, страницы, распознанный текст, таблицы и правки в одном файле .tvspdf.');
      view.body.append(make('p','pds-project-note',PROJECT_NOTE),make('p','pds-note','Проект можно открыть позже и продолжить работу. Для Word, Excel или готового PDF используйте экспорт.'));
      view.actions.append(button('Отмена',view.close),button('Сохранить проект',()=>{view.close();void this.run('Сохранение проекта…',async()=>{const project=await this.host.serializeProject(),result=await this.api.saveProject({project});if(result?.canceled)return;if(!result?.ok)throw Error(result?.error||'Проект не сохранён');this.host.markProjectSaved?.();this.say('Проект сохранён: '+result.path);});},'pds-primary'));
    }
    async openProject() {
      if(this.locked||this.host.isBusy?.())return;
      await this.flushAutosave(true);if(this.host.guard&&!await this.host.guard())return;
      await this.run('Открытие проекта…',async()=>{const result=await this.api.openProject();if(result?.canceled)return;if(!result?.ok)throw Error(result?.error||'Не удалось открыть проект');await this.host.restoreProject(result.project);this.documentKey=this.identity();this.recoveryId=null;this.lastModel='';this.needsSave=false;this.say('Проект открыт. Исходные PDF сохранены внутри проекта.');});
    }
    rangeField(total) {const range=input('text',allRange(total));range.autocomplete='off';return {range,wrap:field('Страницы',range,'Например: 1, 3–5. Текущая страница — '+(this.pages().indexOf(this.current())+1)+'.')};}
    exportDialog() {
      if(this.locked||this.host.isBusy?.()||!this.pages().length)return;
      const view=modal('Экспорт документа','Текст и проверенные таблицы станут редактируемыми.');
      const format=select([['docx','Word · DOCX'],['xlsx','Excel · XLSX'],['txt','Текст · TXT'],['csv','Таблицы · CSV']],'docx'),{range,wrap}=this.rangeField(this.pages().length),tablesOnly=check('Экспортировать только таблицы',false),note=make('p','pds-note');
      const update=()=>{tablesOnly.wrap.hidden=!['xlsx','csv'].includes(format.value);note.textContent=format.value==='docx'?'Word сохраняет текст, таблицы и вставленные изображения. Расположение восстанавливается приблизительно; исходные сканы не заменяют редактируемый текст.':format.value==='xlsx'?'Таблицы берутся из сеток OCR. Каждая страница получит лист, полный текст — отдельный лист. Номера и ИНН сохраняются строками.':format.value==='csv'?'CSV с разделителем «;», UTF-8. Таблицы берутся из сеток OCR; проверьте столбцы перед передачей.':'TXT сохраняет доступный текст по порядку чтения, страницы разделяются переводом страницы.';};format.onchange=update;update();
      const warning=make('p','pds-form-error');warning.setAttribute('role','alert');view.body.append(field('Формат',format),wrap,tablesOnly.wrap,note,warning);
      view.actions.append(button('Отмена',view.close),button('Экспортировать',()=>{let indices;try{indices=rangeOf(range.value,this.pages().length);}catch(error){warning.textContent=error.message;range.focus();return;}const chosen=this.pages().filter((_,index)=>indices.includes(index)),kind=format.value,only=tablesOnly.control.checked&&['xlsx','csv'].includes(kind);view.close();void this.run('Подготовка экспорта…',()=>this.exportOffice(chosen,kind,only));},'pds-primary'));
    }
    async exportOffice(pages,format,tablesOnly) {
      const revision=this.revision,all=this.pages(),models=[];let excludedTables=0;
      for(const page of pages){
        const removals=(page.elements||[]).filter(item=>item.type==='redaction');
        const tables=(page.ocrTables||[]).filter(table=>{if(!Array.isArray(table.rows)||!table.rows.length)return false;if(removals.some(area=>crosses(table.bbox,area))){excludedTables++;return false;}return true;}),text=await this.host.text(page.id)||[];
        const blocks=tablesOnly?[]:text.filter(item=>!tables.some(table=>mostlyInside(item,table.bbox))).map(item=>({...item,kind:'text'}));
        tables.forEach(table=>{const b=boxOf(table.bbox);blocks.push({kind:'table',...b,text:'',rows:table.rows.map(row=>row.map(value=>String(value??'')))});});
        if(format==='docx')for(const item of page.elements||[])if(item.type==='image'&&item.dataUrl&&!item.original&&!removals.some(area=>crosses(item,area)))blocks.push({kind:'image',dataUrl:item.dataUrl,x:item.x,y:item.y,w:item.w,h:item.h,alt:'Вставленное изображение'});
        models.push({number:all.indexOf(page)+1,width:page.width,height:page.height,blocks});
      }
      if(tablesOnly&&!models.some(page=>page.blocks.length))throw Error('В выбранных страницах нет таблиц OCR. Создайте или распознайте сетку таблицы в рабочем пространстве OCR.');
      if(!models.some(page=>page.blocks.length))throw Error('В выбранных страницах нет доступного текста. Сначала распознайте сканы.');
      if(this.revision!==revision)throw Error('Документ изменился при подготовке. Повторите экспорт.');
      const result=await this.api.exportDocument({format,title:this.title(),pages:models});if(result?.canceled)return;if(!result?.ok)throw Error(result?.error||'Экспорт не выполнен');this.say('Экспорт '+format.toUpperCase()+' сохранён: '+result.path+(excludedTables?' · таблиц с удалённой областью исключено: '+excludedTables:''));
    }
    pagesDialog() {
      if(this.locked||this.host.isBusy?.()||!this.pages().length)return;
      const view=modal('Сохранить выбранные страницы','Отдельный PDF с текущими правками и порядком страниц.'),{range,wrap}=this.rangeField(this.pages().length),warning=make('p','pds-form-error');warning.setAttribute('role','alert');view.body.append(wrap,warning);
      view.actions.append(button('Отмена',view.close),button('Сохранить PDF',()=>{let chosen;try{const indices=rangeOf(range.value,this.pages().length);chosen=this.pages().filter((_,index)=>indices.includes(index));}catch(error){warning.textContent=error.message;return;}view.close();void this.run('Подготовка выбранных страниц…',async()=>{const bytes=await this.host.exportPdf(chosen),result=await this.api.exportPages({bytesBase64:to64(bytes),title:this.title().replace(/\.pdf$/i,'')+' — страницы'});if(result?.canceled)return;if(!result?.ok)throw Error(result?.error||'PDF не сохранён');this.say('Выбранные страницы сохранены: '+result.path);});},'pds-primary'));
    }
    async loadRecovery() {try{const result=await this.api.recoveryList();if(result?.ok){this.recoveryCount=result.entries.length;this.sync();if(this.recoveryCount){this.bar.classList.add('has-recovery');this.recoveryButton.title='Доступно копий восстановления: '+this.recoveryCount;}}return result;}catch(error){return {ok:false,error:error.message};}}
    async recoveryDialog() {
      if(this.locked||this.host.isBusy?.())return;
      const result=await this.loadRecovery();if(!result?.ok){this.say(result?.error||'Не удалось прочитать копии восстановления',true);return;}
      const view=modal('Восстановление документов','Локальные автоматические копии. Рабочая база и исходные файлы не изменяются.');view.body.append(make('p','pds-project-note',PROJECT_NOTE));
      const list=make('div','pds-recovery-list'),empty=()=>{list.replaceChildren(make('p','pds-empty','Сохранённых копий пока нет. Автокопия появится после изменений в документе.'));};
      if(!result.entries.length)empty();
      for(const entry of result.entries){
        const item=make('div','pds-recovery-item'),info=make('div'),date=new Date(entry.savedAt),stamp=Number.isNaN(date.getTime())?String(entry.savedAt||'Дата неизвестна'):date.toLocaleString('ru-RU');info.append(make('strong','',entry.title),make('small','',stamp+' · '+Math.max(.1,entry.bytes/1048576).toLocaleString('ru-RU',{maximumFractionDigits:1})+' МБ'));
        const restore=button('Открыть',async()=>{await this.flushAutosave(true);if(this.host.guard&&!await this.host.guard())return;view.close();void this.run('Восстановление проекта…',async()=>{const opened=await this.api.recoveryOpen(entry.id);if(!opened?.ok)throw Error(opened?.error||'Не удалось восстановить документ');await this.host.restoreProject(opened.project);this.documentKey=this.identity();this.recoveryId=entry.id;this.lastModel='';this.needsSave=false;this.say('Восстановлена копия от '+stamp+'. Сохраните проект или PDF.');});},'pds-primary');restore.disabled=!!entry.damaged;
        const remove=button('Удалить',()=>{const confirm=modal('Удалить эту копию?',entry.title+' · '+stamp);confirm.body.append(make('p','pds-note','Удалится только автоматическая копия восстановления. Сохранённые PDF и проекты останутся на месте.'));confirm.actions.append(button('Отмена',confirm.close),button('Удалить копию',async()=>{const deleted=await this.api.recoveryDelete(entry.id);if(!deleted?.ok){this.say(deleted?.error||'Копия не удалена',true);return;}if(this.recoveryId===entry.id)this.recoveryId=null;confirm.close();item.remove();this.recoveryCount=Math.max(0,this.recoveryCount-1);this.sync();if(!list.childElementCount)empty();},'pds-danger'));});
        const controls=make('div','pds-recovery-actions');controls.append(restore,remove);item.append(info,controls);list.append(item);
      }
      view.body.append(list);view.actions.append(button('Закрыть',view.close));
    }
    marksDialog() {
      if(this.locked||this.host.isBusy?.()||!this.pages().length)return;
      const view=modal('Номера страниц и водяной знак','Элементы можно затем выбрать на странице, передвинуть или удалить.');
      const kind=select([['number','Номера страниц'],['watermark','Водяной знак']],'number'),text=input('text','{n} / {total}'),position=select([['footer','По центру снизу'],['header','По центру сверху'],['center','В центре страницы']],'footer'),size=input('number','11'),color=input('color','#64748b'),opacity=input('number','0.8'),replace=check('Заменить ранее добавленные этой командой элементы',true),{range,wrap}=this.rangeField(this.pages().length),warning=make('p','pds-form-error');
      Object.assign(size,{min:'5',max:'150',step:'1'});Object.assign(opacity,{min:'0.1',max:'1',step:'0.05'});
      kind.onchange=()=>{const watermark=kind.value==='watermark';text.value=watermark?'КОПИЯ':'{n} / {total}';position.value=watermark?'center':'footer';size.value=watermark?'40':'11';opacity.value=watermark?'0.2':'0.8';};
      const row=make('div','pds-form-row');row.append(field('Размер, пт',size),field('Цвет',color),field('Непрозрачность',opacity));
      view.body.append(field('Элемент',kind),field('Текст',text,'{n} — номер страницы документа, {total} — всего страниц.'),wrap,field('Положение',position),row,replace.wrap,warning);
      view.actions.append(button('Отмена',view.close),button('Применить',()=>{
        try{
          const indices=rangeOf(range.value,this.pages().length),fontSize=Number(size.value),alpha=Number(opacity.value);if(!text.value.trim())throw Error('Введите текст элемента.');if(!(fontSize>=5&&fontSize<=150&&alpha>=.1&&alpha<=1))throw Error('Проверьте размер и непрозрачность.');
          const type=kind.value,total=this.pages().length,template=text.value.slice(0,500),where=position.value;
          this.host.mutate(type==='number'?'Добавить номера страниц':'Добавить водяной знак',()=>{indices.forEach(index=>{const page=this.pages()[index];if(replace.control.checked)page.elements=page.elements.filter(item=>item.studioMark!==type);const value=template.replaceAll('{n}',String(index+1)).replaceAll('{total}',String(total)),rotation=((finite(page.nativeRotation)+finite(page.rotation))%360+360)%360,displayW=rotation%180?page.height:page.width,displayH=rotation%180?page.width:page.height,w=Math.min(displayW-24,Math.max(fontSize,value.length*fontSize*.56)),h=fontSize*1.5,vx=(displayW-w)/2,vy=where==='center'?(displayH-h)/2:where==='header'?24:displayH-h-24,origin=rotation===90?{x:vy,y:page.height-vx}:rotation===180?{x:page.width-vx,y:page.height-vy}:rotation===270?{x:page.width-vy,y:vx}:{x:vx,y:vy};page.elements.push({id:uid(),type:'text',studioMark:type,text:value,...origin,w,h,angle:-rotation,fontSize,color:color.value,opacity:alpha,bold:false,italic:false,wrap:false});});});
          void this.host.refresh?.();view.close();this.say('Добавлено на страницах: '+indices.length+'. Действие можно отменить.');
        }catch(error){warning.textContent=error.message;}
      },'pds-primary'));
    }
    async compare() {
      if(this.locked||this.host.isBusy?.())return;
      let comparison;
      await this.run('Подготовка сравнения…',async()=>{
        const chosen=await this.api.compareFile();if(chosen?.canceled)return;if(!chosen?.ok)throw Error(chosen?.error||'Не удалось открыть второй PDF');
        const models=this.pages(),bytes=await this.host.exportPdf(models),options={useSystemFonts:true,standardFontDataUrl:new URL('./node_modules/pdfjs-dist/standard_fonts/',location.href).href};
        let left,right;
        try{left=await pdfjsLib.getDocument({...options,data:typeof bytes==='string'?from64(bytes):new Uint8Array(bytes).slice()}).promise;right=await pdfjsLib.getDocument({...options,data:from64(chosen.bytesBase64)}).promise;comparison={left,right,name:chosen.name};}
        catch(error){void left?.destroy();void right?.destroy();throw Error(error?.name==='PasswordException'?'Второй PDF защищён паролем. Откройте копию без пароля.':error.message);}
      });
      if(comparison)await this.compareDialog(comparison);
    }
    async compareDialog({left,right,name}) {
      const view=modal('Сравнение документов','Текстовое сравнение по строкам. Изображения, подписи, цвет и геометрия автоматически не сравниваются.',true),controls=make('div','pds-compare-controls'),pageNumber=input('number','1'),total=Math.max(left.numPages,right.numPages),previous=button('←',()=>navigate(-1)),next=button('→',()=>navigate(1)),tab=select([['pages','Страницы рядом'],['text','Изменения текста']],'pages'),status=make('span','pds-note','Подготавливаем текст…');
      pageNumber.min='1';pageNumber.max=String(total);previous.setAttribute('aria-label','Предыдущая пара страниц');next.setAttribute('aria-label','Следующая пара страниц');
      controls.append(previous,field('Страница',pageNumber),make('span','pds-note','/ '+total),next,tab,status);
      const pagePanel=make('div','pds-compare-pages'),leftPane=make('section','pds-compare-page'),rightPane=make('section','pds-compare-page'),leftCanvas=make('canvas'),rightCanvas=make('canvas'),leftEmpty=make('p','pds-empty'),rightEmpty=make('p','pds-empty');
      leftPane.append(make('h3','',this.title()+' · текущие правки'),leftCanvas,leftEmpty);rightPane.append(make('h3','',name),rightCanvas,rightEmpty);pagePanel.append(leftPane,rightPane);
      const diffPanel=make('div','pds-diff-panel');diffPanel.hidden=true;view.body.append(controls,pagePanel,diffPanel);view.actions.append(make('span','pds-note','Слева — сохранённый вид текущих правок. Справа — выбранный PDF.'),button('Закрыть',view.close));
      let closed=false,token=0,tasks=[],textStop=false;
      view.dialog.addEventListener('close',()=>{closed=true;textStop=true;token++;tasks.forEach(task=>task.cancel());void left.destroy();void right.destroy();leftCanvas.width=leftCanvas.height=rightCanvas.width=rightCanvas.height=1;},{once:true});
      const render=async()=>{
        const turn=++token;tasks.forEach(task=>task.cancel());tasks=[];
        const number=Math.max(1,Math.min(total,Math.floor(Number(pageNumber.value)||1)));pageNumber.value=String(number);previous.disabled=number<=1;next.disabled=number>=total;
        for(const [doc,canvas,empty] of [[left,leftCanvas,leftEmpty],[right,rightCanvas,rightEmpty]]){
          empty.textContent='';canvas.hidden=number>doc.numPages;if(number>doc.numPages){empty.textContent='В этом документе такой страницы нет.';continue;}
          try{const page=await doc.getPage(number);if(closed||turn!==token)return;const original=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(1.6,850/original.width,1200/original.height)});canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const task=page.render({canvasContext:canvas.getContext('2d'),viewport,background:'#fff'});tasks.push(task);await task.promise;}
          catch(error){if(!closed&&error.name!=='RenderingCancelledException')empty.textContent='Не удалось показать страницу: '+error.message;}
        }
      };
      function navigate(delta){pageNumber.value=String(Math.max(1,Math.min(total,Number(pageNumber.value)+delta)));void render();}
      pageNumber.onchange=()=>void render();tab.onchange=()=>{pagePanel.hidden=tab.value!=='pages';diffPanel.hidden=tab.value!=='text';};void render();
      const readLines=async doc=>{const lines=[];let cut=false;for(let number=1;number<=doc.numPages;number++){if(textStop)break;const page=await doc.getPage(number),viewport=page.getViewport({scale:1,rotation:0}),content=await page.getTextContent(),items=content.items.filter(item=>item.str?.trim()).map(item=>{const transform=pdfjsLib.Util.transform(viewport.transform,item.transform);return {text:item.str,x:transform[4],y:transform[5],w:item.width,h:Math.hypot(transform[2],transform[3])||item.height||11};});lines.push(...textLines(items));if(lines.length>10000||lines.reduce((sum,line)=>sum+line.length,0)>1000000){cut=true;break;}await new Promise(resolve=>setTimeout(resolve,0));}return {lines,cut};};
      try{
        const [a,b]=await Promise.all([readLines(left),readLines(right)]);if(closed)return;
        if(!a.lines.length||!b.lines.length){status.textContent='Для текста нужен слой текста или OCR';diffPanel.append(make('p','pds-empty','В одном из документов нет доступного текста. Распознайте его и сохраните PDF с поисковым текстом. Страницы можно сравнить визуально.'));return;}
        const diff=textDiff(a.lines,b.lines),limited=a.cut||b.cut||diff.limited;status.textContent=diff.added||diff.removed?'Добавлено строк: '+diff.added+' · удалено: '+diff.removed+(limited?' · часть текста':''):limited?'В сравниваемой части текст совпадает':'Текст совпадает';
        diffPanel.append(make('p','pds-diff-summary',limited?'Документ большой: сравнение ограничено доступной частью текста. Неизменённое начало и конец сокращены.':'Красным — строки только слева, зелёным — только справа. Сопоставление учитывает порядок строк.'));
        if(!diff.added&&!diff.removed)diffPanel.append(make('p','pds-empty','Различий в сравниваемом тексте нет. Изображения и оформление проверьте на вкладке «Страницы рядом».'));
        let rendered=0;const list=make('div','pds-diff-list'),more=button('Показать ещё строки',()=>appendRows());
        const appendRows=()=>{for(const row of diff.rows.slice(rendered,rendered+400)){const line=make('div','pds-diff-row is-'+row.kind),numbers=make('span','pds-diff-number',(row.left??'—')+' / '+(row.right??'—')),text=make('pre','',row.text);line.append(numbers,text);list.append(line);}rendered+=400;more.hidden=rendered>=diff.rows.length;};appendRows();diffPanel.append(list,more);
      }catch(error){if(!closed){status.textContent='Сравнение текста не завершено';diffPanel.append(make('p','pds-form-error',error.message));}}
    }
    dispose() {this.disposed=true;clearTimeout(this.autosaveTimer);clearTimeout(this.startupTimer);scope.removeEventListener('pdf-studio-change',this.onChange);document.removeEventListener('visibilitychange',this.onVisibility);this.bar.remove();}
  }
  scope.PdfDocumentStudio=Object.freeze({install:host=>new Studio(host).install()});
})(window);
