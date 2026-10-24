// Two separate exports share the same saved maintenance-plan snapshot.
let generatorMaintenancePrintSession=null;
const gmPrintDocuments=Object.freeze({schedule:{label:'График ТО',button:'Сохранить график ТО в PDF',prefix:'График_ТО_ДЭС_'},spares:{label:'Приложение ЗИП',button:'Сохранить приложение ЗИП в PDF',prefix:'Приложение_ЗИП_ДЭС_'}});
function gmPrintActive(session){return !!session&&generatorMaintenancePrintSession===session&&session.form.isConnected&&!!session.form.closest('#wfModal.open');}
function gmPrintAssert(session){
 if(!gmPrintActive(session)||data!==session.database||wfCommandContextStamp()!==session.stamp||JSON.stringify(data.generatorMaintenancePlans||[])!==session.planText)throw Error('График, база или права изменились. Откройте печать заново');
 const fresh=GeneratorMaintenancePrint.prepare(data,session.id,platformSessionContext());
 if(JSON.stringify(fresh)!==JSON.stringify(session.model))throw Error('Источники графика изменились. Откройте печать заново');
}
function gmPrintButtons(session){
 for(const button of session.form.querySelectorAll('[data-gmp-document]')){const selected=button.dataset.gmpDocument===session.document;button.disabled=session.pending;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;button.classList.toggle('btn-primary',selected);button.classList.toggle('btn-ghost',!selected);}
 for(const button of session.form.querySelectorAll('[data-gmp-pdf]')){const selected=button.dataset.gmpPdf===session.document;button.hidden=!selected;button.style.display=selected?'':'none';button.disabled=session.pending;}
 session.form.querySelector('[data-gmp-close]').disabled=session.pending;
 session.form.closest('#wfModal')?.querySelector('.modal-header button')?.toggleAttribute('disabled',session.pending);
}
function gmPrintSelect(session,document){
 gmPrintAssert(session);if(session.pending)return;if(!Object.hasOwn(gmPrintDocuments,document))throw Error('Неизвестный документ печати');
 const html=GeneratorMaintenancePrint.render(session.model,{document}),frame=session.form.querySelector('[data-gmp-frame]');
 session.document=document;session.html=html;frame.title=gmPrintDocuments[document].label;frame.srcdoc=html;
 const panel=session.form.querySelector('[data-gmp-panel]');panel.setAttribute('aria-labelledby','generatorMaintenancePrintTab-'+document);
 session.form.querySelector('[data-gmp-heading]').textContent=gmPrintDocuments[document].label;
 session.form.querySelector('[data-gmp-error]').textContent='';session.form.querySelector('[data-gmp-status]').textContent='';gmPrintButtons(session);
}
function generatorMaintenancePrintHasPendingEdits(){return !!generatorMaintenancePrintSession?.pending;}
async function generatorMaintenancePrintFlush(){const session=generatorMaintenancePrintSession;while(session?.pending)await new Promise(resolve=>setTimeout(resolve,15));return !generatorMaintenancePrintHasPendingEdits();}
const gmPrintOriginalClose=closeModal;
closeModal=function(id,...args){const session=generatorMaintenancePrintSession;if(id==='wfModal'&&gmPrintActive(session)&&session.pending){showToast('Дождитесь завершения сохранения PDF');return;}const result=gmPrintOriginalClose.call(this,id,...args);if(session&&id==='wfModal'&&!session.form.closest('#wfModal.open')&&generatorMaintenancePrintSession===session)generatorMaintenancePrintSession=null;return result;};
function printGeneratorMaintenancePlan(id){
 try{
  if(generatorMaintenancePrintSession?.pending)throw Error('Дождитесь завершения сохранения PDF');
  if(typeof GeneratorMaintenancePrint==='undefined')throw Error('Шаблоны графика ТО и приложения ЗИП не загружены');
  const context=platformSessionContext(),model=GeneratorMaintenancePrint.prepare(data,id,context),database=data,stamp=wfCommandContextStamp(),planText=JSON.stringify(data.generatorMaintenancePlans||[]);
  if(model.status==='approved'&&typeof platformSaveBaseline==='function'&&JSON.stringify(platformSaveBaseline().generatorMaintenancePlans||[])!==planText)throw Error('В графиках есть несохранённые изменения. Сначала загрузите подтверждённую редакцию');
  wfShowDialog('Печать графика ТО и потребности в ЗИП','<form id="generatorMaintenancePrintForm" class="wf-form"><p class="wf-wide wf-note">'+(model.status==='approved'?'Утверждённая редакция. Оба документа используют сохранённый снимок и реквизиты комиссии.':'Проект. График ТО и приложение ЗИП помечены «Не утверждён».')+' Документы сохраняются отдельными PDF.</p><div class="wf-wide wf-actions" role="tablist" aria-label="Документ для печати">'+Object.entries(gmPrintDocuments).map(([key,value])=>'<button type="button" class="btn btn-ghost" role="tab" id="generatorMaintenancePrintTab-'+key+'" aria-controls="generatorMaintenancePrintPanel" aria-selected="false" data-gmp-document="'+key+'">'+value.label+'</button>').join('')+'</div><div class="wf-wide" id="generatorMaintenancePrintPanel" role="tabpanel" data-gmp-panel><p data-gmp-heading></p><iframe data-gmp-frame sandbox="" title="График ТО" style="width:100%;height:480px;background:#fff;border:1px solid var(--border)"></iframe></div><p class="wf-wide" role="alert" data-gmp-error></p><p class="wf-wide" role="status" data-gmp-status></p><div class="wf-wide wf-actions"><button type="button" class="btn btn-ghost" data-gmp-close>Закрыть</button>'+Object.entries(gmPrintDocuments).map(([key,value])=>'<button type="submit" class="btn btn-primary" data-gmp-pdf="'+key+'"'+(key==='schedule'?'':' hidden style="display:none"')+'>'+value.button+'</button>').join('')+'</div></form>');
  const form=document.getElementById('generatorMaintenancePrintForm'),session=generatorMaintenancePrintSession={id,form,pending:false,database,stamp,planText,model,document:'schedule',html:''};
  gmPrintSelect(session,'schedule');
  const close=()=>closeModal('wfModal');form.querySelector('[data-gmp-close]').onclick=close;form.closest('#wfModal').querySelector('.modal-header button').onclick=close;
  for(const button of form.querySelectorAll('[data-gmp-document]'))button.onclick=()=>{try{gmPrintSelect(session,button.dataset.gmpDocument);}catch(error){form.querySelector('[data-gmp-error]').textContent=error.message;}};
  form.querySelector('[role=tablist]').onkeydown=event=>{if(session.pending||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const keys=Object.keys(gmPrintDocuments),index=keys.indexOf(session.document),document=event.key==='Home'?keys[0]:event.key==='End'?keys.at(-1):keys[(index+(event.key==='ArrowLeft'?-1:1)+keys.length)%keys.length];try{gmPrintSelect(session,document);form.querySelector('[data-gmp-document="'+document+'"]').focus();}catch(error){form.querySelector('[data-gmp-error]').textContent=error.message;}};
  form.onsubmit=async event=>{
   event.preventDefault();if(session.pending)return;const errorBox=form.querySelector('[data-gmp-error]'),status=form.querySelector('[data-gmp-status]');let completed=false,canceled=false;
   try{
    gmPrintAssert(session);if(event.submitter?.dataset.gmpPdf&&event.submitter.dataset.gmpPdf!==session.document)throw Error('Сначала откройте выбранный документ');
    if(typeof window.electronAPI?.exportPdf!=='function')throw Error('Сохранение PDF доступно в установленной программе');
    const document=session.document,html=GeneratorMaintenancePrint.render(session.model,{document}),org=String(model.snapshot.org||'Организация').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,80),filename=gmPrintDocuments[document].prefix+org+'_'+String(model.snapshot.year??'проект')+'_ред_'+String(model.revision??1)+'.pdf';
    session.pending=true;gmPrintButtons(session);errorBox.textContent='';status.textContent='Подготовка PDF: '+gmPrintDocuments[document].label+'…';
    const result=await window.electronAPI.exportPdf(html,filename);completed=result?.ok===true;canceled=!!(result?.canceled||result?.cancelled);gmPrintAssert(session);
    if(canceled)status.textContent='Сохранение отменено';else if(completed)status.textContent='PDF сохранён: '+gmPrintDocuments[document].label+'. Подписи комиссии проставляются на бумажном экземпляре';else throw Error(result?.error||'Не удалось сохранить PDF');
   }catch(error){if(gmPrintActive(session)){errorBox.textContent=(completed&&!canceled?'PDF уже сохранён. ':'')+error.message;status.textContent='';}}finally{session.pending=false;if(gmPrintActive(session))gmPrintButtons(session);}
  };return session;
 }catch(error){showToast(error.message);return null;}
}
