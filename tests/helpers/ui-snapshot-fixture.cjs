'use strict';
// Browser-only synthetic IPC fixture. Production sees snapshot/section APIs;
// writeData is retained solely as the existing tests' failure/delay hook.
const schema=require('../../assets/core/platform-schema.js'),format=require('../../electron/storage-format.cjs'),compatibility=require('../../assets/core/platform-compatibility.js');
function bootstrap({database,token,names,descriptor,serverProfile,countWrites,rejectWrites}){
  const db=structuredClone(database);for(const name of names)if(!Array.isArray(db[name]))db[name]=[];
  const revisions=Object.fromEntries(names.map(name=>[name,1]));
  window.__disk=JSON.stringify(db);window.__writes=0;window.__reject=rejectWrites;
  window.electronAPI={
   writeData:async text=>{if(countWrites)window.__writes++;if(window.__reject)return false;window.__disk=text;return true;},
   readSnapshot:async({hello}={})=>{
    const negotiation=PlatformCompatibility.negotiate(hello,serverProfile,descriptor);
    if(!negotiation.readCompatible)throw Object.assign(Error('Synthetic client must prove readable compatibility'),{code:'READ_COMPATIBILITY_REQUIRED'});
    return JSON.stringify({data:JSON.parse(window.__disk),databaseToken:token,revisions:{...revisions},platform:{apiVersion:1,descriptor,compatibility:serverProfile,negotiation},readOnly:!negotiation.writeCompatible});
   },
   getRevisions:async()=>({...revisions,databaseToken:token}),
   readSection:async name=>({rev:revisions[name],rows:JSON.parse(window.__disk)[name]||[],databaseToken:token}),
   writeSections:async raw=>{
    const request=JSON.parse(raw),changed=Object.keys(request.sections||{});
    if(request.databaseToken!==token)return{ok:false,code:'DATABASE_CHANGED',error:'Synthetic database changed'};
    if(changed.some(name=>!names.includes(name)))return{ok:false,error:'Unknown synthetic section'};
    const conflicts=changed.filter(name=>request.base?.[name]!==revisions[name]);if(conflicts.length)return{ok:false,databaseToken:token,conflicts};
    const next=JSON.parse(window.__disk);for(const name of changed)next[name]=structuredClone(request.sections[name]);
    const result=await window.electronAPI.writeData(JSON.stringify(next));
    if(result!==true&&result?.ok!==true)return{ok:false};
    for(const name of changed)revisions[name]++;
    return{ok:true,databaseToken:token,revisions:{...revisions},canonicalSections:structuredClone(request.sections),...(request.operation?{operationReceipt:{id:request.operation.id,digest:request.operation.digest,status:'committed'}}:{})};
   }
  };
}
async function install(page,{database,token='synthetic-ui-snapshot24',countWrites=false,rejectWrites=false,setupData=null}={},setup){
 if(setup!==undefined&&typeof setup!=='function')throw TypeError('Synthetic UI setup must be a function');
 const input={database,token,names:schema.sections,descriptor:format.describe(format.SCHEMA_VERSION),serverProfile:compatibility.describe().serverProfile,countWrites,rejectWrites};
 // One script fixes bootstrap/setup ordering; Playwright does not guarantee the
 // relative execution order of separately registered initialization scripts.
 const content='('+bootstrap.toString()+')('+JSON.stringify(input)+');'+(setup?'\n('+setup.toString()+')('+JSON.stringify(setupData)+');':'');
 await page.addInitScript({content});
}
module.exports={install};
