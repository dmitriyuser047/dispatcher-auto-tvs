// Opt-in desktop reminders. No polling survives the lifetime of this page.
(function () {
  'use strict';
  const api=window.electronAPI;
  let timer=null,busy=false,stopped=false,lastState=null,unsubscribe=null;
  const escape=value=>typeof htmlEsc==='function'?htmlEsc(value):String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function loadedMatches(state) {
    if(!state?.ok||typeof data==='undefined'||typeof _loadWriteBlocked!=='undefined'&&_loadWriteBlocked)return false;
    if(typeof _sync==='undefined'||!_sync.databaseToken||_sync.databaseToken!==state.databaseToken)return false;
    if(_sync.access?.user&&(state.user?.id!==_sync.access.user.id||state.user?.role!==_sync.access.user.role))return false;
    return true;
  }
  function issueSection(id) {
    if(id.startsWith('task:'))return'opsTasks';if(id.startsWith('document:'))return'assetDocuments';
    if(id.startsWith('to:vehicle:'))return'vehicleTo';if(id.startsWith('to:generator:'))return'toRecords';return null;
  }
  function queue() {
    if(typeof opsCollectIssues!=='function')return[];
    return opsCollectIssues().filter(issue=>{
      const section=issueSection(issue.id);
      return section&&(!_sync.access||Array.isArray(_sync.access.readable)&&_sync.access.readable.includes(section))&&
        (typeof wfIssueVisible!=='function'||wfIssueVisible(issue))&&(typeof _opsHidden==='undefined'||!_opsHidden.has(issue.id));
    });
  }
  function text(value,length) { return String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,length); }
  async function freshState() {
    const state=await api.getNotificationSettings();
    if(!state?.ok)throw Error(state?.error||'Не удалось прочитать настройки напоминаний');
    if(!loadedMatches(state))throw Error('Выбранная база ещё не загружена или изменилась. Обновите данные и откройте настройки заново.');
    lastState=state;return state;
  }
  async function poll() {
    if(stopped||busy||!api?.getNotificationSettings)return;
    busy=true;
    try {
      const reference=typeof data==='undefined'?null:data;
      const state=await freshState();
      if(stopped||!state.preferences.enabled||!state.supported||reference!==data)return;
      const issues=queue().slice(0,200).map(issue=>({id:text(issue.id,500),title:text(issue.title,240),body:text(issue.body,500)}));
      const result=await api.submitNotifications({key:state.key,issues});
      if(result&&!result.ok)lastState={...state,error:result.error};
    } catch(error) { if(lastState)lastState={...lastState,error:error.message}; }
    finally {busy=false;if(!stopped)timer=setTimeout(poll,5*60000);}
  }
  function setMessage(modal,message,bad=false) {
    const node=modal.querySelector('[data-notification-status]');if(!node)return;
    node.textContent=message;node.setAttribute('role',bad?'alert':'status');node.classList.toggle('notification-error',bad);
  }
  async function openNotificationSettings() {
    const previous=document.getElementById('notificationsModal');previous?.remove();
    const modal=document.createElement('div');modal.id='notificationsModal';modal.className='modal-overlay open';
    modal.innerHTML=`<div class="modal notifications-modal" role="dialog" aria-modal="true" aria-labelledby="notificationsTitle"><div class="modal-header"><div id="notificationsTitle" class="modal-title">Напоминания Windows</div><button type="button" class="icon-btn" aria-label="Закрыть">×</button></div><div class="modal-body"><p data-notification-status role="status">Проверяем настройки выбранной базы…</p></div></div>`;
    modal.querySelector('.icon-btn').onclick=()=>modal.remove();document.body.append(modal);
    if(typeof bindModalOverlay==='function')bindModalOverlay(modal);
    if(!api?.getNotificationSettings){setMessage(modal,'Системные напоминания доступны в установленной программе.');return;}
    let state;
    try{state=await freshState();}catch(error){setMessage(modal,error.message,true);return;}
    if(!modal.isConnected)return;
    const p=state.preferences,profile=state.user?.name||'Текущий профиль';
    let count=0;try{count=queue().length;}catch{}
    modal.querySelector('.modal-body').innerHTML=`
      <p class="notification-note">${escape(state.message)}</p>
      <p class="notification-note">${escape(profile)} · настройки действуют только для этой базы и учётной записи.</p>
      <form id="notificationSettingsForm">
        <label class="notification-toggle"><input name="enabled" type="checkbox" ${p.enabled?'checked':''} ${state.supported?'':'disabled'}> Включить напоминания</label>
        <p class="notification-note">Просроченные задачи, ТО в ближайшие 14 дней и документы со сроком до 30 дней. В очереди сейчас: ${count}. Одна сводка не чаще раза в 2 часа; одно событие — раз в день. Отложенные в центре внимания события учитываются.</p>
        <label class="notification-toggle"><input name="quietEnabled" type="checkbox" ${p.quietEnabled?'checked':''}> Тихие часы по времени компьютера</label>
        <div class="notification-times"><label>С <input name="quietStart" type="time" required value="${escape(p.quietStart)}"></label><label>До <input name="quietEnd" type="time" required value="${escape(p.quietEnd)}"></label></div>
        <p class="notification-note">${state.snoozedUntil>Date.now()?'Отложено до '+escape(new Date(state.snoozedUntil).toLocaleString('ru'))+'.':'Новые напоминания проверяются каждые 5 минут.'}</p>
        <p data-notification-status role="status">${escape(state.error||(!state.supported?'Windows не предоставляет уведомления в этом режиме. Проверьте разрешения системы.':state.quiet?'Сейчас действуют тихие часы. Проверочное уведомление отправляется только по вашей кнопке.':''))}</p>
        <div class="notification-actions"><button class="btn btn-primary" type="submit">Сохранить</button><button class="btn btn-ghost" type="button" data-notification-test ${state.supported?'':'disabled'}>Проверить уведомление</button></div>
        <div class="notification-actions"><button class="btn btn-ghost btn-sm" type="button" data-notification-snooze="60">Отложить на час</button><button class="btn btn-ghost btn-sm" type="button" data-notification-snooze="1440">На сутки</button><button class="btn btn-ghost btn-sm" type="button" data-notification-snooze="0">Снять отсрочку</button></div>
      </form>`;
    async function run(button,action) {
      if(button.disabled)return;button.disabled=true;
      try{const result=await action();if(!modal.isConnected)return;if(!result?.ok)throw Error(result?.error||'Не удалось применить настройки');setMessage(modal,result.message||'Настройки сохранены.');if(result.preferences)lastState={...state,...result};}
      catch(error){if(modal.isConnected)setMessage(modal,error.message,true);}
      finally{if(button.isConnected)button.disabled=false;}
    }
    modal.querySelector('form').onsubmit=event=>{
      event.preventDefault();const form=event.currentTarget;
      run(form.querySelector('[type="submit"]'),()=>api.saveNotificationSettings({key:state.key,preferences:{enabled:form.elements.enabled.checked,quietEnabled:form.elements.quietEnabled.checked,quietStart:form.elements.quietStart.value,quietEnd:form.elements.quietEnd.value}}));
    };
    modal.querySelector('[data-notification-test]').onclick=event=>run(event.currentTarget,()=>api.testNotification({key:state.key}));
    modal.querySelectorAll('[data-notification-snooze]').forEach(button=>button.onclick=()=>run(button,async()=>{const result=await api.snoozeNotifications({key:state.key,minutes:Number(button.dataset.notificationSnooze)});return{...result,message:button.dataset.notificationSnooze==='0'?'Отсрочка снята.':'Напоминания отложены.'};}));
    modal.querySelector('input')?.focus();
  }
  window.openNotificationSettings=openNotificationSettings;
  if(api?.onNotificationOpen)unsubscribe=api.onNotificationOpen(async target=>{
    try{
      if(!target||typeof target.key!=='string'||target.issueId!==null&&typeof target.issueId!=='string')return;
      const state=await freshState();if(state.key!==target.key)return;
      if(target.issueId===null)return;
      const issue=queue().find(item=>item.id===target.issueId);
      if(!issue){showToast('Событие уже обработано или отложено.');return;}
      // Reuse only a freshly rebuilt native action. IPC never supplies executable code or a URL.
      issue.run?.();
    }catch(error){if(typeof showToast==='function')showToast(error.message);}
  });
  if(api?.getNotificationSettings)timer=setTimeout(poll,60000);
  window.addEventListener('beforeunload',()=>{stopped=true;clearTimeout(timer);if(typeof unsubscribe==='function')unsubscribe();},{once:true});
})();
