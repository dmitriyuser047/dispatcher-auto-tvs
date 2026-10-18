'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const { EventEmitter }=require('node:events');
const { createNotificationService,bindingKey,validatePreferences,quietNow }=require('../electron/notifications');
const {canInvoke}=require('../electron/security');
const a={key:bindingKey(['db-a','account-a']),readable:['opsTasks','vehicleTo','toRecords','assetDocuments'],senderId:7};
const b={...a,key:bindingKey(['db-a','account-b'])};
const issue={id:'task:1',title:'Проверить машину',body:'Срок сегодня'};
function fixture(options={}) {
  let current=new Date(2026,9,18,12),saved={profiles:{}};
  const shown=[],opened=[];
  class FakeNotification extends EventEmitter {
    static isSupported(){return options.supported!==false;}
    constructor(value){super();this.value=value;}
    show(){if(options.throwShow)throw Error('synthetic failure');shown.push(this);}
    close(){this.closed=true;this.emit('close');}
  }
  const service=createNotificationService({Notification:FakeNotification,readState:()=>saved,writeState:value=>{if(options.diskFailure)throw Error('disk');saved=structuredClone(value);},now:()=>new Date(current),isCurrent:context=>options.currentKey===undefined||context.key===options.currentKey,onOpen:value=>opened.push(value),hidden:options.hidden});
  const enable=context=>service.update(context,{enabled:true,quietEnabled:false,quietStart:'22:00',quietEnd:'08:00'});
  return {service,shown,opened,enable,state:()=>saved,setTime:value=>{current=value;},submit:(context=a,issues=[issue])=>service.submit(context,{key:context.key,issues})};
}
test('notifications start disabled, persist opt-in per database and account, and have no timer',()=>{
  const f=fixture();assert.equal(f.service.status(a).preferences.enabled,false);assert.equal(f.submit().code,'disabled');assert.equal(f.shown.length,0);
  f.enable(a);assert.equal(f.service.status(a).preferences.enabled,true);assert.equal(f.service.status(b).preferences.enabled,false);
  const restarted=createNotificationService({Notification:{isSupported:()=>true},readState:f.state});assert.equal(restarted.status(a).preferences.enabled,true);
});
test('one digest consumes unique issues once a day and throttles newly appearing issues for two hours',()=>{
  const f=fixture();f.enable(a);
  assert.equal(f.submit(a,[issue,issue,{id:'document:2',title:'Страховка',body:'Истекает срок'}]).count,2);
  assert.equal(f.shown.length,1);assert.match(f.shown[0].value.body,/Страховка/);
  assert.equal(f.submit().code,'throttled');
  f.setTime(new Date(2026,9,18,15));assert.equal(f.submit().code,'unchanged');
  assert.equal(f.submit(a,[{...issue,id:'task:2'}]).count,1);
  f.setTime(new Date(2026,9,19,12));assert.equal(f.submit().count,1);
});
test('quiet hours span midnight, use local hours and defer without consuming the day',()=>{
  const f=fixture();f.service.update(a,{enabled:true,quietEnabled:true,quietStart:'22:00',quietEnd:'08:00'});
  f.setTime(new Date(2026,9,18,23));assert.equal(f.submit().code,'quiet');
  f.setTime(new Date(2026,9,19,7,59));assert.equal(f.submit().code,'quiet');
  f.setTime(new Date(2026,9,19,8));assert.equal(f.submit().count,1);
  assert.equal(quietNow({quietEnabled:true,quietStart:'12:00',quietEnd:'13:00'},new Date(2026,9,18,12,30)),true);
});
test('snooze survives settings reads and can be cleared',()=>{
  const f=fixture();f.enable(a);const until=f.service.snooze(a,60).snoozedUntil;
  assert.ok(until>0);assert.equal(f.submit().code,'snoozed');assert.equal(f.service.status(a).snoozedUntil,until);
  f.service.snooze(a,0);assert.equal(f.submit().count,1);
  assert.throws(()=>f.service.snooze(a,10081),/7 суток/);
});
test('context and role checks reject stale payloads and financial or arbitrary targets',()=>{
  const f=fixture();f.enable(a);
  assert.throws(()=>f.service.submit(b,{key:a.key,issues:[issue]}),/переключена/);
  assert.throws(()=>f.submit(a,[{...issue,id:'payments-overdue'}]),/не поддерживается/);
  assert.throws(()=>f.submit({...a,readable:[]}),/недоступен/);
  assert.throws(()=>f.submit(a,[{...issue,url:'https://example.test'}]),/Некорректное/);
  assert.throws(()=>f.submit(a,Array(201).fill(issue)),/большая/);
  assert.throws(()=>f.submit(a,[{...issue,title:'x'.repeat(241)}]),/текст/);
  assert.equal(f.shown.length,0);
});
test('click focuses only via a bounded native callback after rechecking the current binding',async()=>{
  const f=fixture({currentKey:a.key});f.enable(a);f.submit();f.shown[0].emit('click');
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.opened,[{key:a.key,issueId:issue.id,senderId:7}]);
  const stale=fixture({currentKey:b.key});stale.enable(a);stale.submit();stale.shown[0].emit('click');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(stale.opened.length,0);
});
test('disabling, switching and disposing close outstanding notifications and revoke their click',async()=>{
  const f=fixture();f.enable(a);f.submit();const n=f.shown[0];
  f.service.update(a,{enabled:false});assert.equal(n.closed,true);n.emit('click');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.opened.length,0);
  f.service.test(a,a.key);const n2=f.shown.at(-1);f.service.invalidate();assert.equal(n2.closed,true);
  f.service.dispose();assert.equal(f.service.status(a).supported,false);
});
test('explicit test works without opting in and does not consume a real reminder',()=>{
  const f=fixture();assert.equal(f.service.test(a,a.key).code,'submitted');assert.equal(f.service.status(a).preferences.enabled,false);
  f.enable(a);assert.equal(f.submit().count,1);assert.equal(f.shown.length,2);
});
test('hidden Electron tests and unsupported systems never instantiate/show native notifications',()=>{
  for(const options of [{hidden:true},{supported:false}]){
    const f=fixture(options);f.enable(a);assert.equal(f.submit().ok,false);assert.equal(f.service.test(a,a.key).ok,false);assert.equal(f.shown.length,0);
    assert.equal(Object.keys(f.state().profiles[a.key].seen).length,0);
  }
});
test('native errors are visible, release the daily reservation and do not overwrite changed preferences',()=>{
  const f=fixture();f.enable(a);f.submit();const n=f.shown[0];f.service.update(a,{enabled:false});
  n.emit('failed',{},'synthetic rejection');assert.match(f.service.status(a).error,/synthetic rejection/);assert.equal(f.service.status(a).preferences.enabled,false);
  f.enable(a);assert.equal(f.submit().count,1);
  const throwing=fixture({throwShow:true});throwing.enable(a);assert.equal(throwing.submit().ok,false);assert.match(throwing.service.status(a).error,/synthetic failure/);
});
test('failed preference persistence never enables or sends a notification',()=>{
  const f=fixture({diskFailure:true});assert.throws(()=>f.enable(a),/сохранить/);assert.equal(f.service.status(a).preferences.enabled,false);assert.equal(f.submit().code,'disabled');
});
test('failed ledger persistence does not consume a reminder in memory',()=>{
  const options={},f=fixture(options);f.enable(a);options.diskFailure=true;
  assert.throws(()=>f.submit(),/сохранить/);assert.equal(f.shown.length,0);
  options.diskFailure=false;assert.equal(f.submit().count,1);
});
test('malformed settings and untrusted window capabilities are rejected',()=>{
  for(const prefs of [{enabled:'yes'},{quietStart:'25:00'},{quietEnd:'22:00'},{url:'javascript:alert(1)'}])assert.throws(()=>validatePreferences(prefs));
  for(const page of [null,'pdf','reestr'])for(const channel of ['get-notification-settings','save-notification-settings','submit-notifications','test-notification','snooze-notifications'])assert.equal(canInvoke(page,channel),false);
});
