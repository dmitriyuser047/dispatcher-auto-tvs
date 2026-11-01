'use strict';

// A browser boundary around the retained trusted storage API. Personal tokens
// and short-lived writer proofs stay in this process, never in browser storage.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {performance}=require('node:perf_hooks'),{setTimeout:delay}=require('node:timers/promises');
const backend=require('../electron/server.js'),access=require('../electron/access-control.js');
const compatibility=require('../assets/core/platform-compatibility.js');
const ROOT=path.resolve(__dirname,'..'),COOKIE='tvs_web_session',MAX_RESPONSE=64*1024*1024;
const READ=/^\/(?:ping|snapshot|data|revisions|section\/[A-Za-z]+|query|history|operation)$/;
const WRITE=new Set(['/sections','/data','/commands','/negotiate','/import-source','/inventory-database','/document-print','/inventory-report']);
const MIME={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.wasm':'application/wasm','.gz':'application/gzip','.traineddata':'application/octet-stream'};
const failure=(status,code,message)=>Object.assign(Error(message),{status,code});
function response(res,status,value,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(value));}
function readBody(req,limit){return new Promise((resolve,reject)=>{let size=0,done=false;const chunks=[];const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};const timer=setTimeout(()=>finish(failure(408,'REQUEST_TIMEOUT','Время запроса истекло.')),30000);req.on('data',chunk=>{size+=chunk.length;if(size>limit){finish(failure(413,'BODY_TOO_LARGE','Слишком большой запрос.'));req.resume();}else if(!done)chunks.push(chunk);});req.on('end',()=>finish(null,Buffer.concat(chunks).toString('utf8')));req.on('aborted',()=>finish(failure(400,'REQUEST_ABORTED','Соединение прервано.')));req.on('error',()=>finish(failure(400,'REQUEST_ABORTED','Соединение прервано.')));});}
function parseJSON(text){try{return JSON.parse(text);}catch{throw failure(400,'INVALID_JSON','Некорректный JSON запроса.');}}
function operationStatus(result){return Array.isArray(result?.conflicts)?409:result?.queued||result?.code==='DB_BUSY'?503:result?.ok===false?400:200;}
function cookieId(header){const matches=String(header||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(COOKIE+'='));if(matches.length!==1)return null;const id=matches[0].slice(COOKIE.length+1);return /^[a-f0-9]{64}$/.test(id)?id:null;}
function safeEqual(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&crypto.timingSafeEqual(left,right);}
function publicUser(principal){return {id:principal.id,name:principal.name,role:principal.role};}
function callBackend(port,route,token,{method='GET',body,ticket}={}){return new Promise((resolve,reject)=>{const headers={Authorization:'Bearer '+token,Accept:'application/json'};if(body!==undefined){headers['Content-Type']='application/json';headers['Content-Length']=Buffer.byteLength(body);headers['X-TVS-Writer-Schema']=String(require('../electron/storage-format.cjs').SCHEMA_VERSION);if(ticket)headers['X-TVS-Write-Ticket']=ticket;}const request=http.request({hostname:'127.0.0.1',port,path:'/api'+route,method,headers,agent:false},res=>{const chunks=[];let size=0;res.on('data',part=>{size+=part.length;if(size>MAX_RESPONSE){res.destroy();reject(failure(502,'BACKEND_RESPONSE_LIMIT','Слишком большой ответ сервера.'));}else chunks.push(part);});res.on('error',()=>reject(failure(502,'BACKEND_UNAVAILABLE','Соединение с хранилищем прервано.')));res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch{reject(failure(502,'BACKEND_INVALID','Хранилище вернуло неверный ответ.'));}});});request.setTimeout(120000,()=>request.destroy(failure(504,'BACKEND_TIMEOUT','Сохранение не подтверждено. Проверьте исходную операцию перед повтором.')));request.on('error',error=>reject(error.status?error:failure(502,'BACKEND_UNAVAILABLE','Хранилище недоступно.')));request.end(body);});}

async function createGateway(options={}){
  const {dataDir,host='127.0.0.1',port=0,demo=false,sessionTtlMs=8*60*60*1000}=options;
  if(typeof dataDir!=='string'||!path.isAbsolute(dataDir)||!fs.statSync(dataDir).isDirectory())throw Error('Нужен существующий абсолютный каталог базы.');
  const network=require('./network.cjs').normalizeNetwork({host,allowedHosts:options.allowedHosts});
  if(!Number.isSafeInteger(sessionTtlMs)||sessionTtlMs<1000||sessionTtlMs>24*60*60*1000)throw Error('Неверное время веб-сеанса.');
  const settingsProvider=typeof options.settings==='function'?options.settings:()=>options.settings||{};
  const renderDocument=options.renderDocument||require('./pages.cjs').renderDocument;
  const usersService=options.usersFile?require('./users.cjs').createUserService({usersFile:options.usersFile}):null;
  const documents=require('./documents.cjs');
  let studio=null;
  const sessions=new Map(),attempts=new Map(),sockets=new Set();let active=true,listenPort=0;
  const started=await backend.start({port:0,host:'127.0.0.1',dataDir,settings:settingsProvider,serverName:'Веб-диспетчер ТВС',renderPdf:documents.renderArchivedPdf,...(options.backup?{backup:options.backup}:{})});
  if(!started.ok)throw Error(started.error);
  const backendPort=started.port;
  let outbox;try{outbox=options.outbox|| (options.outboxDir?require('./outbox.cjs').createWebOutbox({rootDir:options.outboxDir,
    async assertCurrent(context){const principal=principalFor(context.webSession);const fresh=await ping(context.webSession);if(principal.id!==context.access.user.id||fresh.access.policyStamp!==context.access.policyStamp||fresh.databaseToken!==context.databaseToken)throw failure(409,'SESSION_CHANGED','База или права изменились. Загрузите данные заново.');},
    async send(context,json){const payload=JSON.parse(json),result=await sendWrite({session:context.webSession,route:Object.hasOwn(payload,'command')?'/commands':'/sections',payload});if(result.status>=400&&!Array.isArray(result.body.conflicts))throw Object.assign(Error(result.body.error||'Запись не подтверждена.'),result.body,{status:result.status});return result.body;},
    async lookup(context,id,digest){const result=await lookup({session:context.webSession,id,digest});if(result.status!==200)throw Object.assign(Error(result.body.error||'Результат операции не подтверждён.'),result.body,{status:result.status});return result.body;},
  }):null);}catch(error){await backend.stop();throw error;}
  const cookie=(id,clear=false)=>COOKIE+'='+(clear?'':id)+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+(clear?0:Math.floor(sessionTtlMs/1000));
  function invalidate(req){const id=cookieId(req.headers.cookie);if(id){sessions.delete(id);if(studio)void studio.closeSession(id).catch(()=>{});}}
  function principalFor(session){if(!active||session.expiresAt<=Date.now()||!session.provisional&&sessions.get(session.id)!==session)throw failure(401,'LOGIN_REQUIRED','Веб-сеанс завершён. Войдите заново.');const principal=access.authenticate(session.token,settingsProvider(),{allowLegacy:false});if(!principal)throw failure(401,'ACCESS_REVOKED','Доступ отозван. Войдите заново.');return principal;}
  const readBinding=principal=>Object.freeze({id:principal.id,role:principal.role,policyStamp:principal.policyStamp});
  function assertReadAcknowledgement(session,captured,source=null){const principal=principalFor(session),current=readBinding(principal);if(Object.keys(captured).some(key=>captured[key]!==current[key])||source&&(source.policyStamp!==captured.policyStamp||source.user&&(source.user.id!==captured.id||source.user.role!==captured.role)))throw failure(409,'SESSION_CHANGED','Права изменились во время запроса. Загрузите данные заново.');return principal;}
  function getSession(req){const id=cookieId(req.headers.cookie),session=id&&sessions.get(id);if(!session||session.expiresAt<=Date.now()){if(id){sessions.delete(id);if(studio)void studio.closeSession(id).catch(()=>{});}throw failure(401,'LOGIN_REQUIRED','Требуется вход.');}const principal=principalFor(session);session.principal=principal;return session;}
  async function readBackend(session,route,options={}){
    // Only side-effect-free reads and compatibility handshakes may wait for a
    // trusted writer's physical lock. A business write is sent exactly once.
    if(options.method&&options.method!=='GET'&&!(options.method==='POST'&&route==='/negotiate'))throw Error('Повтор записи через адаптер чтения запрещён.');
    const captured=readBinding(principalFor(session)),deadline=performance.now()+5000;let backoff=20;
    for(;;){assertReadAcknowledgement(session,captured);const result=await callBackend(backendPort,route,session.token,options);if(result.status<400||result.body?.code!=='DB_BUSY')return result;
      assertReadAcknowledgement(session,captured);const remaining=deadline-performance.now();if(remaining<=0)throw failure(503,'DB_BUSY','База временно занята сохранением. Повторите чтение после его завершения.');await delay(Math.min(backoff,remaining));backoff=Math.min(backoff*2,200);if(performance.now()>=deadline)throw failure(503,'DB_BUSY','База временно занята сохранением. Повторите чтение после его завершения.');}
  }
  async function negotiate(session,hello=compatibility.describe().hello){const result=await readBackend(session,'/negotiate',{method:'POST',body:JSON.stringify(hello)});if(result.status!==200||result.body.ok!==true)throw failure(result.status,result.body.code||'NEGOTIATION_FAILED',result.body.error||'Не удалось проверить совместимость.');session.negotiation=result.body;return result.body;}
  async function ping(session){const result=await readBackend(session,'/ping');if(result.status!==200)throw failure(result.status,[401,403].includes(result.status)?'ACCESS_REVOKED':result.body.code||'BACKEND_UNAVAILABLE',result.body.error||'Не удалось подтвердить текущее состояние сервера.');return result.body;}
  async function queueContext(session){const fresh=await ping(session);return {databaseToken:fresh.databaseToken,access:fresh.access,principal:session.principal,webSession:session};}
  async function documentContext(session,captured){const fresh=await ping(session),current=()=>{assertReadAcknowledgement(session,captured);if(require('../electron/storage').databaseToken(dataDir)!==fresh.databaseToken)throw failure(409,'SESSION_CHANGED','Рабочая база изменилась. Перечитайте данные.');return principalFor(session);};return {dataDir,principal:current(),getPrincipal:current,assertCurrent:()=>{current();},backup:options.backup,...(options.documentRenderHtmlPdf?{renderHtmlPdf:options.documentRenderHtmlPdf}:{}),writeOptions:backend.localWriteOptions({hello:compatibility.describe().hello,databaseToken:fresh.databaseToken,principal:current()})};}
  function workspaceKey(principal,sections){
    const context=require('../electron/access-context.cjs');
    return sections.includes('auditLog')||context.hasNarrowing(principal)||['readable','writable'].some(name=>principal[name]&&!principal[name].includes('*'))?null:JSON.stringify([sections,principal.role,principal.policyStamp]);
  }
  function publishWorkspace(entry,frame,codec){
    if(entry.settled)return;
    const {session,captured,hello,res}=entry.value;
    try{
      if(res.destroyed||res.writableEnded)throw failure(499,'REQUEST_ABORTED','Соединение прервано.');
      const principal=assertReadAcknowledgement(session,captured);
      if(frame.envelope.access.policyStamp!==captured.policyStamp||frame.envelope.access.user.role!==captured.role)throw failure(409,'SESSION_CHANGED','Права изменились во время запроса. Загрузите данные заново.');
      // Only canonical data bytes are shared within an already waiting cohort.
      // Actor, permissions and exact browser profile belong to this response.
      const result={...frame.envelope,access:require('./workspace.cjs').publicAccess(principal)},profile=compatibility.describe();
      const negotiated=compatibility.negotiate(hello===undefined?profile.hello:hello,profile.serverProfile,result.platform.descriptor);
      result.platform={...result.platform,compatibility:profile.serverProfile,negotiation:negotiated,outbox:outbox?1:0};
      result.readOnly=result.platform.readOnly===true||!negotiated.writeCompatible;
      const reply=(codec||require('./json-frame.cjs').createJsonFrame(frame.dataJSON)).prepare(result,entry.value.acceptEncoding);
      assertReadAcknowledgement(session,captured,result.access);reply.send(res);entry.resolve();
    }catch(error){entry.reject(error);}
  }
  function publishBootstrap(entry,fresh){
    if(entry.settled)return;
    const {session,captured,res}=entry.value;
    try{
      if(res.destroyed||res.writableEnded)throw failure(499,'REQUEST_ABORTED','Соединение прервано.');
      const principal=principalFor(session),currentAccess=require('./workspace.cjs').publicAccess(principal);
      assertReadAcknowledgement(session,captured,currentAccess);
      response(res,200,{ok:true,csrf:session.csrf,version:fresh.version,user:publicUser(principal),access:currentAccess,platform:fresh.platform,databaseToken:fresh.databaseToken,demo,settings:{networkMode:'client',uiTheme:'dark',users:[{name:'Общая база веб-диспетчера'}],activeUser:0,web:true}});entry.resolve();
    }catch(error){entry.reject(error);}
  }
  function publishPing(entry,fresh){
    if(entry.settled)return;
    const {session,captured,res}=entry.value;
    try{
      if(res.destroyed||res.writableEnded)throw failure(499,'REQUEST_ABORTED','Соединение прервано.');
      const principal=assertReadAcknowledgement(session,captured),currentAccess=require('./workspace.cjs').publicAccess(principal);
      assertReadAcknowledgement(session,captured,currentAccess);
      response(res,200,{ok:true,name:'Веб-диспетчер ТВС',version:fresh.version,sections:true,databaseToken:fresh.databaseToken,protocol:'http:',platform:fresh.platform,access:currentAccess});entry.resolve();
    }catch(error){entry.reject(error);}
  }
  async function runWorkspaceCohort(batch){
    let backoff=20,blocked=false;
    for(;;){
      const waiting=[],principals=new Map();
      for(const entry of batch){if(entry.settled)continue;try{const principal=assertReadAcknowledgement(entry.value.session,entry.value.captured);if(performance.now()>=entry.value.deadline)throw failure(503,blocked?'DB_BUSY':'READ_QUEUE_TIMEOUT',blocked?'База временно занята сохранением. Повторите чтение после его завершения.':'Очередь чтения занята. Повторите запрос позже.');waiting.push(entry);principals.set(entry,principal);}catch(error){entry.reject(error);}}
      if(!waiting.length)return;
      const first=waiting[0];let publishing=false;
      try{
        if(first.value.kind==='bootstrap'||first.value.kind==='ping'){
          require('./status.cjs').withStorageStatus(dataDir,fresh=>{publishing=true;for(const entry of waiting)(entry.value.kind==='bootstrap'?publishBootstrap:publishPing)(entry,fresh);});return;
        }
        require('./workspace.cjs').withWorkspaceFrame(dataDir,{principal:principals.get(first),sections:first.value.sections},frame=>{
          publishing=true;
          // No previous cohort or late arrival can reuse this snapshot. All
          // members were waiting before this read, and publication is sync
          // under its physical lock. Scoped/history/legacy reads stay separate.
          const share=first.value.key!==null&&frame.envelope.platform.storageKind==='sqlite'&&frame.envelope.platform.schemaVersion===require('../electron/storage-format.cjs').SCHEMA_VERSION&&!frame.envelope.loadedSections.includes('auditLog');
          const codec=require('./json-frame.cjs').createJsonFrame(frame.dataJSON);
          publishWorkspace(first,frame,codec);
          for(const entry of waiting.slice(1)){
            if(share)publishWorkspace(entry,frame,codec);
            else try{const principal=assertReadAcknowledgement(entry.value.session,entry.value.captured);require('./workspace.cjs').withWorkspaceFrame(dataDir,{principal,sections:entry.value.sections},ownFrame=>publishWorkspace(entry,ownFrame));}catch(error){entry.reject(error);}
          }
        });
        return;
      }catch(error){
        if(publishing||error.code!=='DB_BUSY')throw error;
        blocked=true;
        const remaining=Math.min(...waiting.map(entry=>entry.value.deadline))-performance.now();
        if(remaining<=0)throw failure(503,'DB_BUSY','База временно занята сохранением. Повторите чтение после его завершения.');
        await delay(Math.min(backoff,remaining));backoff=Math.min(200,backoff*2);
      }
    }
  }
  const workspaceReads=require('./read-cohorts.cjs').createReadCohorts({key:value=>value.key,run:runWorkspaceCohort,isCancelled:value=>value.res.destroyed||value.res.writableEnded,maxPending:512,maxBatch:64});
  function originGuard(req){const code=require('./network.cjs').requestAllowed(req,network,listenPort);if(code)throw failure(403,code,code==='NETWORK_DENIED'?'Доступ разрешён только с этого компьютера и из настроенной локальной сети.':'Неверный адрес или источник запроса.');return 'http://'+req.headers.host;}
  function csrfGuard(req,session){if(!safeEqual(req.headers['x-csrf-token'],session.csrf))throw failure(403,'CSRF_DENIED','Обновите страницу перед сохранением.');}
  function prune(){const now=Date.now();for(const [id,session]of sessions)if(session.expiresAt<=now){sessions.delete(id);if(studio)void studio.closeSession(id).catch(()=>{});}for(const [id,attempt]of attempts)if(attempt.until<=now)attempts.delete(id);}
  async function staticFile(req,res,url){
    const pdfAsset=url.pathname.startsWith('/node_modules/')?require('./pdf-studio.cjs').staticAsset(decodeURIComponent(url.pathname)):null;
    if(pdfAsset){const stat=fs.statSync(pdfAsset.path);res.writeHead(200,{'Content-Type':pdfAsset.mime,'Content-Length':stat.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});if(req.method==='HEAD')res.end();else fs.createReadStream(pdfAsset.path).on('error',()=>res.destroy()).pipe(res);return true;}
    const pathname=decodeURIComponent(url.pathname),allowed=/^\/(assets\/(?:core|js|css|fonts|img|images|icons|ocr)|vendor|web\/public)\//.exec(pathname),ext=path.extname(pathname).toLowerCase();
    if(!allowed||!MIME[ext])return false;
    const target=path.resolve(ROOT,'.'+pathname);if(!target.startsWith(ROOT+path.sep))throw failure(404,'NOT_FOUND','Файл не найден.');
    let stat;try{stat=fs.statSync(target);if(!stat.isFile())return false;const actual=fs.realpathSync(target),permittedRoot=path.join(fs.realpathSync(ROOT),allowed[1]);if(!actual.startsWith(permittedRoot+path.sep))return false;}catch{return false;}
    const etag='W/"'+stat.size.toString(16)+'-'+stat.mtimeMs.toString(16)+'"',headers={'Content-Type':MIME[ext],'ETag':etag,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};
    const candidates=String(req.headers['if-none-match']||'').split(',').map(value=>value.trim());
    if(candidates.some(value=>value==='*'||value.replace(/^W\//,'')===etag.replace(/^W\//,''))){res.writeHead(304,headers);res.end();return true;}
    res.writeHead(200,{...headers,'Content-Length':stat.size});if(req.method==='HEAD')res.end();else fs.createReadStream(target).on('error',()=>res.destroy()).pipe(res);return true;
  }
  const server=http.createServer((req,res)=>{void(async()=>{
    try{
      if(!active)throw failure(503,'SERVER_STOPPED','Сервер остановлен.');originGuard(req);
      if(typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//')||req.url.length>14000||/[\\\0]/.test(req.url))throw failure(400,'URL_INVALID','Некорректный адрес.');
      let rawPath;try{rawPath=decodeURIComponent(req.url.split('?')[0]);}catch{throw failure(400,'URL_INVALID','Некорректный адрес.');}if(/[\\\0]/.test(rawPath)||rawPath.split('/').some(part=>part==='..'||part==='.'))throw failure(404,'NOT_FOUND','Страница не найдена.');
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname==='/web-api/login'||url.pathname==='/web-api/demo-login'&&demo&&typeof options.demoToken==='string'){
        if(req.method!=='POST')throw failure(405,'METHOD_DENIED','Требуется POST.');if(!String(req.headers['content-type']||'').startsWith('application/json'))throw failure(415,'CONTENT_TYPE','Требуется JSON.');
        prune();const ip=req.socket.remoteAddress||'local',attempt=attempts.get(ip)||{count:0,until:Date.now()+15*60000};if(attempt.count>=10)throw failure(429,'LOGIN_RATE_LIMIT','Слишком много попыток входа. Повторите позже.');
        const input=parseJSON(await readBody(req,8192));const token=url.pathname==='/web-api/demo-login'?options.demoToken:input?.token,principal=access.authenticate(token,settingsProvider(),{allowLegacy:false});
        if(!principal){attempt.count++;if(attempts.size<10000||attempts.has(ip))attempts.set(ip,attempt);throw failure(401,'LOGIN_INVALID','Неверный или отозванный персональный ключ.');}
        if(sessions.size>=5000)throw failure(503,'SESSION_LIMIT','Слишком много активных сеансов.');
        invalidate(req);const id=crypto.randomBytes(32).toString('hex'),session={id,token,principal,csrf:crypto.randomBytes(32).toString('hex'),expiresAt:Date.now()+sessionTtlMs,negotiation:null,provisional:true};assertReadAcknowledgement(session,readBinding(principal));session.provisional=false;sessions.set(id,session);attempts.delete(ip);
        response(res,200,{ok:true,csrf:session.csrf,user:publicUser(principal)},{'Set-Cookie':cookie(id)});return;
      }
      if(url.pathname.startsWith('/web-api/')){
        const session=getSession(req),captured=readBinding(session.principal),route=url.pathname.slice('/web-api'.length);
        if(req.method==='POST')csrfGuard(req,session);
        if(route==='/logout'){if(req.method!=='POST')throw failure(405,'METHOD_DENIED','Требуется POST.');invalidate(req);response(res,200,{ok:true},{'Set-Cookie':cookie('',true)});return;}
        if(route==='/bootstrap'){
          if(req.method!=='GET')throw failure(405,'METHOD_DENIED','Требуется GET.');await workspaceReads.enqueue({kind:'bootstrap',key:'storage-status',session,captured,res,deadline:performance.now()+5000});return;
        }
        if(route==='/ping'){
          if(req.method!=='GET')throw failure(405,'METHOD_DENIED','Требуется GET.');await workspaceReads.enqueue({kind:'ping',key:'storage-status',session,captured,res,deadline:performance.now()+5000});return;
        }
        if(route==='/users'){
          if(!usersService)throw failure(503,'USERS_UNAVAILABLE','Управление сотрудниками не настроено для этого запуска.');
          if(req.method==='GET'){const result=usersService.list({token:session.token});assertReadAcknowledgement(session,captured);response(res,200,result);return;}
          if(req.method!=='POST')throw failure(405,'METHOD_DENIED','Требуется POST.');
          if(!String(req.headers['content-type']||'').startsWith('application/json'))throw failure(415,'CONTENT_TYPE','Требуется JSON.');
          const input=parseJSON(await readBody(req,16384)),result=usersService.mutate({token:session.token,input});
          if(result.reauthenticate){invalidate(req);response(res,200,result,{'Set-Cookie':cookie('',true)});return;}
          assertReadAcknowledgement(session,captured);response(res,200,result);return;
        }
        if(route==='/workspace'){
          if(req.method!=='GET')throw failure(405,'METHOD_DENIED','Требуется GET.');
          const entries=[...url.searchParams];if(entries.length>2||new Set(entries.map(([key])=>key)).size!==entries.length||entries.some(([key])=>!['sections','hello'].includes(key)))throw failure(400,'WORKSPACE_QUERY_INVALID','Неверные параметры рабочей страницы.');
          const sections=url.searchParams.has('sections')?parseJSON(url.searchParams.get('sections')):undefined,hello=url.searchParams.has('hello')?parseJSON(url.searchParams.get('hello')):undefined;
          const names=require('./workspace.cjs').normalizeSections(sections);
          await workspaceReads.enqueue({kind:'workspace',session,captured,sections:names,hello,res,acceptEncoding:req.headers['accept-encoding'],key:workspaceKey(session.principal,names),deadline:performance.now()+5000});return;
        }
        if(['/attachment','/export-pdf','/document-print','/inventory-report','/native-import','/pdf-studio'].includes(route)){
          if(req.method!=='POST')throw failure(405,'METHOD_DENIED','Требуется POST.');
          if(!String(req.headers['content-type']||'').startsWith('application/json'))throw failure(415,'CONTENT_TYPE','Требуется JSON.');
          const payload=parseJSON(await readBody(req,40*1024*1024)),ctx=await documentContext(session,captured);
          const input=route==='/export-pdf'?{...payload,action:'pdf'}:route==='/document-print'?{action:'documentPrint',request:payload}:route==='/inventory-report'?{action:'inventoryReport',request:payload}:payload;
          let result;if(route==='/native-import')result=await require('./imports.cjs').handle(ctx,input);else if(route==='/pdf-studio'){studio??=require('./pdf-studio.cjs').createPdfStudio();result=await studio.handle({...ctx,sessionId:session.id},input);}else result=await documents.handle(ctx,input);
          try{assertReadAcknowledgement(session,captured);}catch(error){throw Object.assign(failure(503,'STORAGE_ACK_STALE','Сеанс изменился после операции. Проверьте результат перед повтором.'),{unknown:true,definitive:false});}response(res,200,result);return;
        }
        if(outbox&&['/pending-operations','/reconcile-operation','/retry-operation','/discard-operation'].includes(route)){
          const context=await queueContext(session);if(route==='/pending-operations'){if(req.method!=='GET')throw failure(405,'METHOD_DENIED','Требуется GET.');const operations=await outbox.list(context);assertReadAcknowledgement(session,captured,context.access);response(res,200,{ok:true,operations});return;}
          if(req.method!=='POST')throw failure(405,'METHOD_DENIED','Требуется POST.');const payload=parseJSON(await readBody(req,32768));if(!payload||typeof payload.id!=='string'||!/^[a-zA-Z0-9._:-]{1,200}$/.test(payload.id))throw failure(400,'OPERATION_INVALID','Нужен ID операции.');const action={'/reconcile-operation':'reconcile','/retry-operation':'retry','/discard-operation':'discard'}[route],result=await outbox[action](context,payload.id);response(res,200,action==='discard'?{ok:true,discarded:!!result}:result===undefined?{ok:true}:result);return;
        }
        if(!(req.method==='GET'&&READ.test(route)||req.method==='POST'&&WRITE.has(route)))throw failure(404,'NOT_FOUND','Неизвестный запрос.');
        const suffix=url.search;
        if(req.method==='GET'){
          let hello;
          if(route==='/snapshot'&&suffix){const entries=[...url.searchParams];if(entries.length!==1||entries[0][0]!=='hello'||Buffer.byteLength(entries[0][1])>12000)throw failure(400,'SNAPSHOT_QUERY_INVALID','Неверные параметры загрузки данных.');hello=parseJSON(entries[0][1]);}
          const result=await readBackend(session,route==='/snapshot'?route:route+suffix);
          if(route==='/snapshot'&&result.status===200){const negotiated=await negotiate(session,hello);if(result.body.databaseToken!==negotiated.databaseToken)throw failure(409,'SESSION_CHANGED','База изменилась во время запроса. Загрузите данные заново.');assertReadAcknowledgement(session,captured,negotiated.access);result.body.platform={...result.body.platform,compatibility:negotiated.platform.compatibility,negotiation:negotiated.compatibility,outbox:outbox?1:0};result.body.readOnly=result.body.platform.readOnly===true||!negotiated.compatibility.writeCompatible;}
          assertReadAcknowledgement(session,captured,result.body?.access||(typeof result.body?.policyStamp==='string'?{policyStamp:result.body.policyStamp}:null));
          response(res,result.status,result.body);return;
        }
        if(!String(req.headers['content-type']||'').startsWith('application/json'))throw failure(415,'CONTENT_TYPE','Требуется JSON.');
        const raw=await readBody(req,['/import-source','/inventory-database'].includes(route)?40*1024*1024:32*1024*1024),payload=parseJSON(raw);
        if(route==='/negotiate'){const value=await negotiate(session),{writeTicket,writeTicketExpiresAt,...visible}=value;assertReadAcknowledgement(session,captured,visible.access);response(res,200,visible);return;}
        if(outbox&&['/sections','/commands'].includes(route)){const result=await outbox.execute(await queueContext(session),payload);response(res,operationStatus(result),result);return;}
        const result=await sendWrite({session,route,payload});response(res,result.status,result.body);
      }else{
        if(!['GET','HEAD'].includes(req.method))throw failure(405,'METHOD_DENIED','Метод недоступен.');
        // Static files contain application code only. No directory listing,
        // source repository, settings, DB, outbox or server files are served.
        if(await staticFile(req,res,url))return;
        if(/^\/(?:assets|vendor|web)\//.test(url.pathname))throw failure(404,'NOT_FOUND','Файл не найден.');
        let session=null;try{session=getSession(req);}catch(error){if(error.status!==401)throw error;}
        if(!session&&url.pathname!=='/login'){res.writeHead(303,{Location:'/login?next='+encodeURIComponent(url.pathname+url.search),'Cache-Control':'no-store'});res.end();return;}
        if(session&&url.pathname==='/login'){res.writeHead(303,{Location:'/objects','Cache-Control':'no-store'});res.end();return;}
        if(session&&url.pathname==='/settings/users'&&!require('./users.cjs').canManageUsers(principalFor(session)))throw failure(403,'USERS_ACCESS_DENIED','Управление сотрудниками доступно администратору.');
        const captured=session?readBinding(session.principal):null,html=url.pathname==='/pdf-studio'?require('./pdf-studio.cjs').renderPage({csrf:session.csrf}):await renderDocument({url,csrf:session?.csrf||null,user:session?publicUser(session.principal):null,principal:session?principalFor(session):null,demo});
        if(session)assertReadAcknowledgement(session,captured);
        if(typeof html!=='string')throw failure(404,'NOT_FOUND','Страница не найдена.');
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline' blob:"+(url.pathname==='/pdf-studio'?" 'wasm-unsafe-eval'":"")+"; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});res.end(req.method==='HEAD'?undefined:html);
      }
    }catch(error){if(res.headersSent){res.destroy();return;}const status=error.status||500;if(status===401)invalidate(req);response(res,status,{ok:false,code:error.code||'WEB_FAILED',error:status>=500&&!error.status?'Ошибка веб-сервера.':error.message,...(error.unknown===true?{unknown:true,definitive:false}:{})},status===401?{'Set-Cookie':cookie('',true)}:{});}
  })();});
  async function sendWrite({session,route,payload}){const captured=readBinding(principalFor(session)),negotiated=await negotiate(session);assertReadAcknowledgement(session,captured,negotiated.access);const result=await callBackend(backendPort,route,session.token,{method:'POST',body:JSON.stringify(payload),ticket:negotiated.writeTicket});try{assertReadAcknowledgement(session,captured);}catch(error){if(result.status>=400)throw error;throw Object.assign(failure(503,'STORAGE_ACK_STALE','Сеанс изменился после отправки. Проверьте исходную операцию перед повтором.'),{unknown:true,definitive:false});}return result;}
  async function lookup({session,id,digest}){return readBackend(session,'/operation?id='+encodeURIComponent(id)+'&digest='+encodeURIComponent(digest));}
  server.requestTimeout=130000;server.headersTimeout=15000;server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});listenPort=server.address().port;}catch(error){await backend.stop();throw error;}
  return Object.freeze({port:listenPort,url:'http://127.0.0.1:'+listenPort,backendPort,async close(){active=false;sessions.clear();await workspaceReads.close();await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections?.();for(const socket of sockets)socket.destroy();});if(studio)await studio.close();await require('./imports.cjs').close();await backend.stop();}});
}
module.exports=Object.freeze({createGateway});
