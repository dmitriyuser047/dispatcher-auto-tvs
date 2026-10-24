// Preview and export the saved organizational schedule without changing stock.
let generatorMaintenancePrintSession=null;
function printGeneratorMaintenancePlan(id){
 try{
  if(typeof GeneratorMaintenancePrint==='undefined')throw Error('Шаблон графика ТО не загружен');
  const context=platformSessionContext(),model=GeneratorMaintenancePrint.prepare(data,id,context),html=GeneratorMaintenancePrint.render(model),database=data,stamp=wfCommandContextStamp(),planText=JSON.stringify(data.generatorMaintenancePlans||[]);
  if(model.status==='approved'&&typeof platformSaveBaseline==='function'&&JSON.stringify(platformSaveBaseline().generatorMaintenancePlans||[])!==planText)throw Error('В графиках есть несохранённые изменения. Сначала загрузите подтверждённую редакцию');
  wfShowDialog('График ТО ДЭС · печатная форма','<form id="generatorMaintenancePrintForm" class="wf-form"><p class="wf-wide wf-note">'+(model.status==='approved'?'Утверждённая редакция. Реквизиты взяты из сохранённого снимка.':'Проект графика. Документ помечен «Не утверждён».')+'</p><iframe class="wf-wide" data-gmp-frame sandbox="" title="График ТО ДЭС" style="width:100%;height:480px;background:#fff;border:1px solid var(--border)"></iframe><p class="wf-wide" role="alert" data-gmp-error></p><p class="wf-wide" role="status" data-gmp-status></p><div class="wf-wide wf-actions"><button type="button" class="btn btn-ghost" data-gmp-close>Закрыть</button><button type="submit" class="btn btn-primary" data-gmp-pdf>Сохранить PDF для подписания</button></div></form>');
  const form=document.getElementById('generatorMaintenancePrintForm'),session=generatorMaintenancePrintSession={form,pending:false,database,stamp,model,html};
  form.querySelector('[data-gmp-frame]').srcdoc=html;
  const close=()=>{if(!session.pending){generatorMaintenancePrintSession=null;closeModal('wfModal');}};form.querySelector('[data-gmp-close]').onclick=close;form.closest('#wfModal').querySelector('.modal-header button').onclick=close;
  const assert=()=>{if(generatorMaintenancePrintSession!==session||!form.isConnected||!form.closest('#wfModal.open')||data!==database||wfCommandContextStamp()!==stamp||JSON.stringify(data.generatorMaintenancePlans||[])!==planText)throw Error('График, база или права изменились. Откройте печать заново');const fresh=GeneratorMaintenancePrint.prepare(data,id,platformSessionContext());if(JSON.stringify(fresh)!==JSON.stringify(model))throw Error('Источники графика изменились. Откройте печать заново');};
  form.onsubmit=async event=>{
   event.preventDefault();if(session.pending)return;const button=form.querySelector('[data-gmp-pdf]'),errorBox=form.querySelector('[data-gmp-error]'),status=form.querySelector('[data-gmp-status]');
   try{assert();if(typeof window.electronAPI?.exportPdf!=='function')throw Error('Сохранение PDF доступно в установленной программе');session.pending=true;button.disabled=true;errorBox.textContent='';status.textContent='Подготовка PDF…';
    const filename='График_ТО_ДЭС_'+String(model.snapshot.org||'Организация').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,80)+'_'+String(model.snapshot.year??'проект')+'_ред_'+String(model.revision||1)+'.pdf';
    const result=await window.electronAPI.exportPdf(html,filename);if(result?.canceled||result?.cancelled)status.textContent='Сохранение отменено';else if(result?.ok)status.textContent='PDF сохранён. Подписи комиссии проставляются на бумажном экземпляре';else throw Error(result?.error||'Не удалось сохранить PDF');
   }catch(error){errorBox.textContent=error.message;status.textContent='';}finally{session.pending=false;button.disabled=false;}
  };return session;
 }catch(error){showToast(error.message);return null;}
}
