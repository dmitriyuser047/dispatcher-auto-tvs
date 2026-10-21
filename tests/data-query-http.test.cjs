'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const storage=require('../electron/storage');
const sqlite=require('../electron/sqlite-storage.cjs');
const server=require('../electron/server');
const access=require('../electron/access-control');
function call(port,route,token,headers={}){return new Promise((resolve,reject)=>{
 const req=http.request({host:'127.0.0.1',port,path:route,method:'GET',agent:false,headers:{...(token?{Authorization:'Bearer '+token}:{}),...headers}},res=>{
  let text='';res.setEncoding('utf8');res.on('data',part=>{text+=part;});res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text),text});}catch(error){reject(error);}});
 });req.setTimeout(5000,()=>req.destroy(Error('Synthetic query HTTP timeout')));req.on('error',reject);req.end();
});}
const route=value=>'/api/query?query='+encodeURIComponent(JSON.stringify(value));
async function fixture(t,format){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-data-query-http-'));
 t.after(()=>{server.stop();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('tvs-data-query-http-'));fs.rmSync(dir,{recursive:true,force:true});});
 const data={vehicles:[{id:7,plate:'СИНТЕТИКА',fuelBalance:923.537},{id:'7',plate:'STRING'}],records:[{id:7,vehicleId:7,date:'2026-09-01',km:1.125,note:'КамАЗ'},{id:'7',vehicleId:'7',date:'2026-09-02',km:2.125,note:'Second'},{id:'last',vehicleId:7,date:'2026-09-30',km:3}],payments:[{id:'private',sum:9988776655,date:'2026-09-01',description:'FINANCIAL-SECRET'}],auditLog:[{id:'legacy-private',section:'payments',after:{sum:9988776655,note:'FINANCIAL-SECRET'}}]};
 if(format==='sqlite')sqlite.create(dir,{data});else storage.writeAll(dir,data);
 const tokens={admin:'synthetic-query-admin-token-123456',dispatcher:'synthetic-query-dispatcher-token-123456',mechanic:'synthetic-query-mechanic-token-123456'},users=Object.keys(tokens).map(role=>({id:'query-'+role,name:'Synthetic '+role,role,enabled:true,tokenHash:access.hashToken(tokens[role])}));
 let settings={serverAccessConfigured:true,serverUsers:access.normalizeServerUsers(users)};
 const start=await server.start({port:0,dataDir:dir,settings:()=>settings});assert.equal(start.ok,true);
 return {dir,data,tokens,port:start.port,query:(value,role='admin')=>call(start.port,route(value),tokens[role]),
  change(role,patch){settings={...settings,serverUsers:access.normalizeServerUsers(settings.serverUsers.map(user=>user.role===role?{...user,...patch}:user))};}};
}
function safeError(result,status,code){assert.equal(result.status,status,result.text);assert.equal(result.body.ok,false);if(code)assert.equal(result.body.code,code);for(const key of ['rows','total','databaseToken','revision','nextCursor'])assert.equal(Object.hasOwn(result.body,key),false,key);assert.doesNotMatch(result.text,/FINANCIAL-SECRET|9988776655/);}

for(const format of ['json','sqlite']){
 test('HTTP '+format+' query returns bounded Unicode/date/asset pages and preserves stored facts',async t=>{
  const h=await fixture(t,format),before=storage.readSnapshot(h.dir);
  const first=await h.query({section:'records',limit:1,from:'2026-09',to:'2026-09',assetRef:'v:7'});assert.equal(first.status,200);assert.equal(first.body.ok,true);assert.equal(first.body.rows.length,1);assert.equal(first.body.rows[0].id,7);assert.equal(first.body.rows[0].km,1.125);assert.equal(first.body.total,3);assert.equal(first.body.backend,format);assert.ok(first.body.nextCursor);
  const second=await h.query({section:'records',limit:1,from:'2026-09',to:'2026-09',assetRef:'v:7',cursor:first.body.nextCursor});assert.equal(second.status,200);assert.equal(second.body.rows[0].id,'7');
  const searched=await h.query({section:'records',search:'КАМАЗ'});assert.equal(searched.status,200);assert.equal(searched.body.total,1);assert.equal(searched.body.rows[0].id,7);
  assert.deepEqual(storage.readSnapshot(h.dir),before);
 });

 test('HTTP '+format+' denies hidden financial search/count and rejects raw/nested audit queries',async t=>{
  const h=await fixture(t,format);
  for(const role of ['dispatcher','mechanic'])for(const section of ['payments','budget','contragents','costEntries','costProfiles'])safeError(await h.query({section,search:'FINANCIAL-SECRET',cursor:'bad'},role),403,'ACCESS_DENIED');
  for(const role of ['admin','dispatcher','mechanic'])safeError(await h.query({section:'auditLog',search:'FINANCIAL-SECRET'},role),400,'QUERY_UNSUPPORTED');
  const own=await h.query({section:'payments',search:'FINANCIAL-SECRET'});assert.equal(own.status,200);assert.equal(own.body.total,1);assert.equal(own.body.rows[0].sum,9988776655);
 });

 test('HTTP '+format+' reports stale section/filter/principal cursors as 409 and corrupt cursors as 400',async t=>{
  const h=await fixture(t,format),first=await h.query({section:'records',limit:1}),cursor=first.body.nextCursor;
  safeError(await h.query({section:'records',limit:1,cursor,search:'Second'}),409,'CURSOR_STALE');
  safeError(await h.query({section:'records',limit:1,cursor},'dispatcher'),409,'CURSOR_STALE');
  safeError(await h.query({section:'records',limit:1,cursor:'not-a-valid-cursor'}),400,'CURSOR_INVALID');
  const current=storage.readSnapshot(h.dir),changed=current.data.records.map((row,index)=>index?row:{...row,note:'Synthetic edited note'});
  assert.equal(storage.writeSections(h.dir,{databaseToken:current.databaseToken,base:{records:current.revisions.records},sections:{records:changed}},{principal:{id:'query-admin',name:'Synthetic admin',role:'admin'}}).ok,true);
  safeError(await h.query({section:'records',limit:1,cursor}),409,'CURSOR_STALE');assert.equal((await h.query({section:'records',limit:1})).status,200);
 });

 test('HTTP '+format+' rejects malformed and arbitrary query input without 500 or data changes',async t=>{
  const h=await fixture(t,format),before=storage.readSnapshot(h.dir);
  const invalid=[null,[],1,{section:'unknown'},{section:'records',limit:0},{section:'records',limit:201},{section:'records',limit:'2'},{section:'records',from:'2026-02-30'},{section:'records',sql:'SELECT * FROM metadata'},{section:'records',columns:['row_json']},{section:'records',jsonPath:'$.payment'},{section:'records',principal:{role:'admin'}},{section:'records',search:{}},{section:'records',assetRef:{id:7}}];
  for(const value of invalid)safeError(await h.query(value),400,'QUERY_INVALID');
  for(const suffix of ['query=%7B','query=','query=%25','query=null&extra=1','query=null&query=null','unexpected=1','query='+'x'.repeat(12000)])safeError(await call(h.port,'/api/query?'+suffix,h.tokens.admin),400,'QUERY_INVALID');
  const literal=await h.query({section:'records',search:"' OR 1=1; DROP TABLE sections; --"});assert.equal(literal.status,200);assert.equal(literal.body.total,0);
  assert.deepEqual(storage.readSnapshot(h.dir),before);
 });

 test('HTTP '+format+' authenticates every page with current credentials',async t=>{
  const h=await fixture(t,format),first=await h.query({section:'vehicles',limit:1},'dispatcher');assert.equal(first.status,200);
  h.change('dispatcher',{role:'viewer'});safeError(await h.query({section:'vehicles',limit:1,cursor:first.body.nextCursor},'dispatcher'),409,'CURSOR_STALE');
  const current=await h.query({section:'vehicles',limit:1},'dispatcher');assert.equal(current.status,200);
  // The changed account is now viewer, so change it by its current role.
  h.change('viewer',{enabled:false});safeError(await h.query({section:'vehicles',limit:1,cursor:current.body.nextCursor},'dispatcher'),401);
  safeError(await call(h.port,route({section:'vehicles'}),null),401);safeError(await call(h.port,route({section:'vehicles'}),h.tokens.admin,{Origin:'http://untrusted.invalid'}),401);
 });
}
