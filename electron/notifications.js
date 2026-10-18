'use strict';

const crypto = require('node:crypto');
const DAY = 86400000;
const DEFAULTS = Object.freeze({ enabled:false, quietEnabled:true, quietStart:'22:00', quietEnd:'08:00' });
const MESSAGE = 'Напоминания работают, пока программа открыта, в том числе в свёрнутом окне. После закрытия программа их не отправляет.';
function bindingKey(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function validContext(context) { return !!context && /^[a-f0-9]{64}$/.test(context.key) && Array.isArray(context.readable); }
function clockMinutes(value) { if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw Error('Укажите время в формате ЧЧ:ММ'); return Number(value.slice(0,2))*60+Number(value.slice(3)); }
function validatePreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k=>!Object.hasOwn(DEFAULTS,k))) throw Error('Некорректные настройки напоминаний');
  const result = { ...DEFAULTS, ...value };
  if (typeof result.enabled !== 'boolean' || typeof result.quietEnabled !== 'boolean') throw Error('Некорректное состояние напоминаний');
  clockMinutes(result.quietStart); clockMinutes(result.quietEnd);
  if (result.quietStart === result.quietEnd) throw Error('Начало и конец тихих часов должны различаться');
  return result;
}
function quietNow(prefs, date) {
  if (!prefs.quietEnabled) return false;
  const minute = date.getHours()*60+date.getMinutes(), start=clockMinutes(prefs.quietStart), end=clockMinutes(prefs.quietEnd);
  return start < end ? minute>=start&&minute<end : minute>=start||minute<end;
}
function dayKey(date) { return `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`; }
function cleanText(value, max) { if (typeof value !== 'string' || !value.trim() || value.length>max || /[\u0000-\u001f\u007f]/.test(value)) throw Error('Некорректный текст напоминания'); return value.trim(); }
function validateIssue(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k=>!['id','title','body'].includes(k))) throw Error('Некорректное напоминание');
  const id=cleanText(value.id,500);
  let section;
  if (id.startsWith('task:')) section='opsTasks';
  else if (id.startsWith('document:')) section='assetDocuments';
  else if (id.startsWith('to:vehicle:')) section='vehicleTo';
  else if (id.startsWith('to:generator:')) section='toRecords';
  else throw Error('Этот вид напоминаний не поддерживается');
  if (!context.readable.includes(section)) throw Error('Раздел напоминания недоступен вашей учётной записи');
  return { id, title:cleanText(value.title,240), body:cleanText(value.body,500) };
}

/** Native notifications have no scheduler or links. The trusted renderer supplies a
 * fresh, bounded attention queue; main authenticates its live database binding. */
function createNotificationService({ Notification, readState=()=>({}), writeState=()=>{}, now=()=>new Date(), hidden=false, onOpen=()=>{}, isCurrent=()=>true }) {
  let state={ profiles:{} }, loadError='', lastError='', disposed=false;
  const active=new Map();
  try { const saved=readState(); if (saved && typeof saved==='object' && saved.profiles && typeof saved.profiles==='object') state={profiles:saved.profiles}; }
  catch { loadError='Не прочитаны настройки напоминаний. Они выключены; сохраните настройки заново.'; }
  function requireContext(context) { if (!validContext(context)) throw Error('Сначала загрузите выбранную базу'); }
  function profile(context) {
    requireContext(context);
    const raw=state.profiles[context.key];
    let prefs;
    try { prefs=validatePreferences(raw?.prefs || DEFAULTS); } catch { prefs={...DEFAULTS}; }
    return {prefs,seen:raw?.seen&&typeof raw.seen==='object'&&!Array.isArray(raw.seen)?{...raw.seen}:{},lastSent:Number(raw?.lastSent)||0,snoozedUntil:Number(raw?.snoozedUntil)||0,touched:Number(raw?.touched)||0};
  }
  function persist(key, record) {
    const previous=state;
    const profiles={...state.profiles,[key]:{...record,touched:now().getTime()}};
    const keys=Object.keys(profiles).sort((a,b)=>(profiles[b]?.touched||0)-(profiles[a]?.touched||0));
    state={profiles:Object.fromEntries(keys.slice(0,64).map(k=>[k,profiles[k]]))};
    try { writeState(state); loadError=''; } catch { state=previous; throw Error('Не удалось сохранить настройки напоминаний'); }
  }
  function supported() { try { return !disposed&&!hidden&&Notification?.isSupported?.()===true; } catch { return false; } }
  function status(context) {
    const p=profile(context);
    return {ok:true,key:context.key,preferences:p.prefs,snoozedUntil:p.snoozedUntil,supported:supported(),quiet:quietNow(p.prefs,now()),error:loadError||lastError||'',message:hidden?'Системные уведомления отключены в режиме проверки.':MESSAGE};
  }
  function closeAll() {
    for (const notification of active.keys()) { try { notification.close(); } catch {} }
    active.clear();
  }
  function update(context, value) {
    const p=profile(context); p.prefs=validatePreferences(value);
    persist(context.key,p); lastError=''; closeAll(); return status(context);
  }
  function snooze(context, minutes) {
    if (!Number.isInteger(minutes)||minutes<0||minutes>10080) throw Error('Отложить можно максимум на 7 суток');
    const p=profile(context);p.snoozedUntil=minutes?now().getTime()+minutes*60000:0;
    persist(context.key,p);closeAll();return status(context);
  }
  function show(context, title, body, issueId, onFailed) {
    if (!supported()) return {ok:false,code:hidden?'test-mode':'unsupported',error:hidden?'Системные уведомления отключены в режиме проверки.':'Системные уведомления недоступны. Проверьте разрешения Windows для приложения.'};
    closeAll(); lastError='';
    try {
      const notification=new Notification({title,body,silent:true,timeoutType:'default'});
      active.set(notification,context.key);
      notification.once('close',()=>active.delete(notification));
      notification.once('failed',(_event,error)=>{
        active.delete(notification);lastError='Windows не показала уведомление'+(error?': '+String(error).slice(0,160):'. Проверьте разрешения системы.');
        try { onFailed?.(); } catch {}
      });
      notification.once('click',()=>{
        if (!active.has(notification)||disposed) return;
        active.delete(notification);
        Promise.resolve().then(()=>isCurrent(context)).then(current=>{if(current&&!disposed)return onOpen({key:context.key,issueId,senderId:context.senderId});}).catch(()=>{});
      });
      notification.show();
      return lastError?{ok:false,code:'failed',error:lastError}:{ok:true,code:'submitted',message:'Уведомление передано Windows. Если оно не появилось, проверьте разрешения и режим «Не беспокоить» в системе.'};
    } catch(error) { lastError='Не удалось отправить уведомление: '+String(error.message||error).slice(0,160);return {ok:false,code:'failed',error:lastError}; }
  }
  function submit(context, payload) {
    const p=profile(context),date=now(),time=date.getTime();
    if (!payload || payload.key!==context.key) throw Error('База или учётная запись переключена. Обновите данные.');
    if (!Array.isArray(payload.issues)||payload.issues.length>200) throw Error('Слишком большая очередь напоминаний');
    const issues=payload.issues.map(issue=>validateIssue(issue,context));
    if (!p.prefs.enabled) return {ok:true,code:'disabled',count:0};
    if (p.snoozedUntil>time) return {ok:true,code:'snoozed',count:0};
    if (quietNow(p.prefs,date)) return {ok:true,code:'quiet',count:0};
    if (p.lastSent&&time-p.lastSent<2*3600000) return {ok:true,code:'throttled',count:0};
    const unique=[...new Map(issues.map(issue=>[issue.id,issue])).values()].filter(issue=>p.seen[bindingKey(issue.id)]?.day!==dayKey(date));
    if (!unique.length) return {ok:true,code:'unchanged',count:0};
    const title=unique.length===1?'Диспетчер ТВС · напоминание':`Диспетчер ТВС · требуют внимания: ${unique.length}`;
    const body=unique.slice(0,3).map(issue=>issue.title).join('\n')+(unique.length>3?`\nИ ещё ${unique.length-3}. Откройте центр внимания.`:'');
    const before={...p,seen:{...p.seen}};
    for(const issue of unique)p.seen[bindingKey(issue.id)]={day:dayKey(date),at:time};
    p.seen=Object.fromEntries(Object.entries(p.seen).filter(([,value])=>Number(value?.at)>=time-8*DAY).sort((a,b)=>b[1].at-a[1].at).slice(0,2000));
    p.lastSent=time;
    // Reserve before showing, so a failed disk write never sends an untracked reminder.
    persist(context.key,p);
    const rollback=()=>{const current=profile(context);if(current.lastSent!==time)return;persist(context.key,{...current,seen:before.seen,lastSent:before.lastSent});};
    const result=show(context,title,body,unique[0].id,rollback);
    if(!result.ok)rollback();
    return {...result,count:result.ok?unique.length:0};
  }
  function test(context, key) {
    requireContext(context);if(key!==context.key)throw Error('База переключена. Откройте настройки заново.');
    return show(context,'Диспетчер ТВС · проверка','Напоминания о задачах, ТО и документах. Нажмите, чтобы вернуться в программу.',null);
  }
  return {status,update,snooze,submit,test,invalidate:closeAll,dispose(){disposed=true;closeAll();}};
}
module.exports={createNotificationService,bindingKey,validatePreferences,quietNow,validateIssue};
