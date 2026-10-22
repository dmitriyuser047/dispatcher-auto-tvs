'use strict';
// Tickets live only in main memory. Renewal never sees or rewrites operation
// intent, persisted requests, database identity, policy stamps or outbox scope.
const compatibility=require('../assets/core/platform-compatibility.js');
const stable=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
const own=value=>JSON.parse(JSON.stringify(value));
const fail=()=>{throw Object.assign(Error('База, права или подключение изменились. Загрузите данные заново.'),{code:'SESSION_CHANGED'});};
function createWriteSessions({negotiate,localWriteOptions,assertContext,now=()=>Date.now()}){
 for(const item of [negotiate,localWriteOptions,assertContext,now])if(typeof item!=='function')throw TypeError('Missing write session capability');
 const sessions=new Map();
 const bound=context=>{assertContext(context);const value=sessions.get(context.senderId);return value?.scope===context.scope?value:null;};
 function publicResult(hello,result){return compatibility.negotiate(hello,result?.platform?.compatibility??null,result?.platform?.descriptor??null);}
 function validateRemote(context,result){
  assertContext(context);
  if(result?.ok!==true||result.databaseToken!==context.databaseToken||stable(result.access)!==stable(context.access))fail();
 }
 function bind(context,hello,result){
  assertContext(context);if(context.client)validateRemote(context,result);
  const profile=publicResult(hello,result),copy=profile.readCompatible?own(hello):null;
  if(profile.writeCompatible&&context.client&&(typeof result.writeTicket!=='string'||result.writeTicket.length>4096||!Number.isSafeInteger(result.writeTicketExpiresAt)))fail();
  sessions.set(context.senderId,{scope:context.scope,hello:copy,profile,ticket:context.client&&profile.writeCompatible?result.writeTicket:null,expiresAt:context.client&&profile.writeCompatible?result.writeTicketExpiresAt:0});
  return profile;
 }
 function invalidate(senderId){sessions.delete(senderId);}
 function localOptions(context){const session=bound(context);return localWriteOptions({hello:session?.hello??null,databaseToken:context.databaseToken,principal:context.principal});}
 async function remoteOptions(context){
  const session=bound(context);if(!session?.hello)return {};
  if(session.ticket&&session.expiresAt>now()+1500)return {ticket:session.ticket};
  let result;
  try{result=await negotiate(context.host,context.port,session.hello);}catch(error){assertContext(context);if(bound(context)!==session)fail();return {};}
  validateRemote(context,result);if(bound(context)!==session)fail();
  const profile=publicResult(session.hello,result);
  if(profile.writeCompatible&&typeof result.writeTicket==='string'&&result.writeTicket.length<=4096&&Number.isSafeInteger(result.writeTicketExpiresAt)&&result.writeTicketExpiresAt>now()){
   session.ticket=result.writeTicket;session.expiresAt=result.writeTicketExpiresAt;session.profile=profile;return {ticket:session.ticket};
  }
  session.ticket=null;session.expiresAt=0;session.profile=profile;return {};
 }
 return Object.freeze({bind,invalidate,localOptions,remoteOptions,profile:context=>bound(context)?.profile??null});
}
module.exports=Object.freeze({createWriteSessions});
