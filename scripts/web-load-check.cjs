'use strict';

// Bounded, synthetic loopback smoke check. This is not a production benchmark:
// it uses a temporary database and synthetic personal account settings.
// --workspace exercises the page startup response with a larger row fixture.
// --startup includes both browser startup requests; --disk-users reads the same
// synthetic hashed accounts through the runtime settings loader.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const {performance} = require('node:perf_hooks');
const {createGateway} = require('../web/server.cjs');
const access = require('../electron/access-control.js');
const sqlite = require('../electron/sqlite-storage.cjs');
const storage = require('../electron/storage.js');
const SCHEMA_VERSION = require('../electron/storage-format.cjs').SCHEMA_VERSION;

const USERS = 150;
const VEHICLES = 150;
const RECORDS = 450;
const WORKSPACE_VEHICLES = 52;
const WORKSPACE_RECORDS = 2100;
const WORKSPACE_GENERATORS = 30;
const WRITES = 10;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const PREFIX = 'tvs-web-load-check-';
const usage = [
  'node scripts/web-load-check.cjs [--workspace] [--startup] [--disk-users] [--concurrent-login] [--keepalive] [--gzip] [--writes]',
  '--workspace: 150 concurrent complete workspace reads using the larger synthetic fixture.',
  '--startup: implies --workspace; each session requests bootstrap + workspace concurrently, then fresh ping (450 GETs; initial peak 300).',
  '--disk-users: store synthetic account hashes in a temporary users.json and use the runtime account loader.',
  '--concurrent-login: establish all 150 personal sessions concurrently; default login remains sequential.',
  '--keepalive: reuse each user\'s own login connections with a browser-like six-socket agent; default opens a new connection per request.',
  '--gzip: request gzip responses, verify bounded decompression, and report wire bytes separately from decoded bytes.',
  '--writes: submit the existing ten distinct edits against one shared section revision, without retry.',
].join('\n');
const testerErrors = new WeakSet();
function testerError(code,message,details={}){const error=Object.assign(Error(message),{code,...details});testerErrors.add(error);return error;}
function safeDiagnostic(error,stage){
  const name=['Error','TypeError','ReferenceError','RangeError','SyntaxError','AssertionError'].includes(error?.name)?error.name:'Error';
  const code=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)?error.code:'LOAD_CHECK_EXCEPTION';
  const ordinary=typeof error?.message==='string'&&(/^(?:Cannot read properties of (?:undefined|null) \(reading '(?:id|name|role|ok|access|body|user|csrf|databaseToken|platform|descriptor|schemaVersion|loadedSections|length|responseBytes)'\)|[A-Za-z_$][A-Za-z0-9_$]* is not defined)$/.test(error.message));
  return {stage:error?.smokeStage||stage,name,code,message:testerErrors.has(error)||ordinary?error.message:'Unexpected error in synthetic HTTP or validation logic.'};
}
function responseShape(result){const body=result?.body;return {status:result?.status||0,bodyType:body===null?'null':Array.isArray(body)?'array':typeof body};}

function call(port, route, {payload, cookie, csrf, agent = false, gzip = false} = {}) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const request = http.request({
      hostname:'127.0.0.1', port, path:route,
      method:body === undefined ? 'GET' : 'POST', agent,
      headers:{Accept:'application/json',
        ...(gzip ? {'Accept-Encoding':'gzip'} : {}),
        ...(body === undefined ? {} : {'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}),
        ...(cookie ? {Cookie:cookie} : {}), ...(csrf ? {'X-CSRF-Token':csrf} : {}),
      },
    }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) response.destroy(testerError('SMOKE_RESPONSE_LIMIT','Synthetic response exceeds smoke-check limit.'));
        else chunks.push(chunk);
      });
      response.on('error', error=>reject(Object.assign(error,{smokeStage:'response-stream',responseStatus:response.statusCode,responseBytes:size})));
      response.on('end', () => {
        const rawEncoding=response.headers['content-encoding'],encoding=rawEncoding===undefined?'identity':typeof rawEncoding==='string'?rawEncoding.trim().toLowerCase():null;
        if(!['identity','gzip'].includes(encoding)){reject(testerError('SMOKE_UNEXPECTED_ENCODING','Synthetic response used an unsupported content encoding.',{smokeStage:'response-decode',responseStatus:response.statusCode,responseBytes:size}));return;}
        let decoded=Buffer.concat(chunks);
        if(encoding==='gzip')try{decoded=zlib.gunzipSync(decoded,{maxOutputLength:MAX_RESPONSE_BYTES});}
        catch(error){reject(testerError(error.code==='ERR_BUFFER_TOO_LARGE'?'SMOKE_DECODED_LIMIT':'SMOKE_INVALID_GZIP',error.code==='ERR_BUFFER_TOO_LARGE'?'Decoded synthetic response exceeds smoke-check limit.':'Synthetic response contained invalid gzip data.',{smokeStage:'response-decode',responseStatus:response.statusCode,responseBytes:size}));return;}
        try {
          resolve({status:response.statusCode, headers:response.headers,
            body:JSON.parse(decoded.toString('utf8')), responseBytes:size,decodedResponseBytes:decoded.length,contentEncoding:encoding, ms:performance.now() - started});
        } catch { reject(testerError('SMOKE_INVALID_JSON','Synthetic request returned invalid JSON.',{smokeStage:'response-json',responseStatus:response.statusCode,responseBytes:size,decodedResponseBytes:decoded.length})); }
      });
    });
    request.setTimeout(60000, () => request.destroy(testerError('SMOKE_TIMEOUT','Synthetic loopback request timed out.',{smokeStage:'request'})));
    request.on('error', error=>reject(Object.assign(error,{smokeStage:error.smokeStage||'request'})));
    request.end(body);
  });
}

function timing(results, wallMs) {
  const values = results.map(result => result.ms).sort((a,b) => a-b);
  const percentile = fraction => Math.round((values[Math.max(0,Math.ceil(values.length*fraction)-1)] || 0)*10)/10;
  return {...(wallMs===undefined?{}:{wallMs:Math.round(wallMs*10)/10}),p50Ms:percentile(.5),p95Ms:percentile(.95)};
}

function fixtureData(workspace = false) {
  const vehicleCount = workspace ? WORKSPACE_VEHICLES : VEHICLES;
  const recordCount = workspace ? WORKSPACE_RECORDS : RECORDS;
  const vehicles = Array.from({length:vehicleCount}, (_,i) => ({
    id:'load-v'+i, plate:'SYNTHETIC-'+String(i).padStart(3,'0'),
    make:'Synthetic load vehicle', org:'Synthetic load organization', object:'Synthetic object '+i%5,
    ...(workspace ? {model:'Synthetic service vehicle',year:2020+i%6,driver:'Synthetic driver '+i,
      note:'Synthetic technical passport used only for the bounded page-load check. Service site, shift and vehicle assignment are explicitly synthetic.'} : {}),
  }));
  const records = Array.from({length:recordCount}, (_,i) => ({
    id:'load-r'+i,vehicleId:vehicles[i%vehicleCount].id,
    date:workspace ? new Date(Date.UTC(2026,8,1+Math.floor(i/vehicleCount))).toISOString().slice(0,10) : '2026-10-'+(23+Math.floor(i/vehicleCount)),
    odoStart:10000+Math.floor(i/vehicleCount)*100,odoEnd:10100+Math.floor(i/vehicleCount)*100,km:100,
    ...(workspace ? {driver:'Synthetic driver '+i%vehicleCount,org:'Synthetic load organization',object:'Synthetic object '+i%5,
      route:'Synthetic service base — operating site '+i%5,
      note:'Synthetic recorded route with confirmed mileage and shift details. The vehicle travelled from the service base to its assigned operating site. '.repeat(2)} : {}),
  }));
  const generators = workspace ? Array.from({length:WORKSPACE_GENERATORS}, (_,i) => ({
    id:'load-g'+i,name:'Synthetic generator '+i,serial:'SYNTHETIC-DES-'+i,
    org:'Synthetic load organization',location:'Synthetic object '+i%5,object:'Synthetic object '+i%5,
    brand:'Synthetic',model:'Synthetic generator set',hoursInit:1000+i*10,
    note:'Synthetic generator passport and operating-site assignment for the bounded workspace response check.',
  })) : [];
  return workspace ? {vehicles,records,generators} : {vehicles,records};
}

function removeFixture(root) {
  // Verify the exact resolved deletion target before recursive cleanup.
  const absolute = fs.realpathSync(root);
  const tempParent = fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(absolute),tempParent,'Cleanup target must remain directly inside OS temp.');
  assert.ok(path.basename(absolute).startsWith(PREFIX),'Cleanup target must be this script\'s fixture.');
  assert.equal(fs.lstatSync(root).isSymbolicLink(),false,'Cleanup target must not be a symlink.');
  fs.rmSync(absolute,{recursive:true,force:true});
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { process.stdout.write(usage+'\n'); return; }
  if (args.some(argument => !['--writes','--workspace','--startup','--disk-users','--concurrent-login','--keepalive','--gzip'].includes(argument))) throw Error(usage);
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Use Node.js 24 or newer for this smoke check.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(),PREFIX));
  let gateway;const agents=[];
  const startup = args.includes('--startup'), workspace = startup || args.includes('--workspace'),
    diskUsers = args.includes('--disk-users'), concurrentLogin = args.includes('--concurrent-login'), keepAlive = args.includes('--keepalive'), gzip = args.includes('--gzip'), data = fixtureData(workspace);
  const sectionRows = Object.fromEntries(Object.entries(data).map(([name,rows]) => [name,rows.length]));
  const report = {
    kind:startup?'synthetic-browser-startup-smoke':'synthetic-loopback-smoke',users:USERS,
    fixture:{...sectionRows,datasetRows:Object.values(sectionRows).reduce((sum,count) => sum+count,0),sectionRows,
      serializedBytes:Buffer.byteLength(JSON.stringify(data)),storage:'temporary SQLite',settings:diskUsers?'on-disk synthetic account hashes':'in-memory synthetic accounts'},
    settingsSource:diskUsers?'disk':'memory',
    connectionModel:keepAlive?{kind:'per-user keep-alive',agents:USERS,maxSocketsPerUser:6,reuseFromLogin:true}:{kind:'new TCP connection per request'},
    acceptEncoding:gzip?'gzip':'not requested',
    productionCapacityVerified:false,
  };
  try {
    const dataDir = path.join(root,'db');
    sqlite.create(dataDir,{data});
    const credentials = Array.from({length:USERS},(_,i) => {
      const issued = access.issueToken();
      return {token:issued.token,user:{id:'load-user-'+i,name:'Synthetic load user '+i,
        role:i<WRITES?'admin':'viewer',enabled:true,tokenHash:issued.tokenHash}};
    });
    const accounts = {serverAccessConfigured:true,serverUsers:access.normalizeServerUsers(credentials.map(row => row.user))};
    let settings = accounts;
    if (diskUsers) {
      const usersFile = path.join(root,'users.json');
      // Credential tokens stay only in memory; the settings fixture contains
      // exactly the same user/hash records as the memory-backed comparison.
      fs.writeFileSync(usersFile,JSON.stringify({serverUsers:accounts.serverUsers}),{flag:'wx',mode:0o600});
      settings = () => require('../web/cli.cjs').loadUsers(usersFile);
    }
    gateway = await createGateway({dataDir,outboxDir:path.join(root,'outbox'),settings});

    const sessions = [], loginResults = [];
    let phaseStart = performance.now();
    // Establish 150 real personal sessions, without bypassing login or limiting
    // the later concurrent read burst to a smaller artificial connection pool.
    const login = async (credential,index) => {
      const agent=keepAlive?new http.Agent({keepAlive:true,maxSockets:6,maxFreeSockets:6}):undefined;if(agent)agents[index]=agent;
      const result = await call(gateway.port,'/web-api/login',{payload:{token:credential.token},agent,gzip});
      loginResults[index] = result;
      if (result.status !== 200 || result.body.ok !== true || result.body.user?.id !== credential.user.id)
        throw Error('Synthetic personal login failed: HTTP '+result.status+'.');
      const cookie = result.headers['set-cookie']?.[0]?.split(';')[0];
      assert.ok(cookie && typeof result.body.csrf === 'string','Login must return a real session and CSRF token.');
      sessions[index] = {cookie,csrf:result.body.csrf,agent,gzip,user:{id:credential.user.id,name:credential.user.name,role:credential.user.role}};
    };
    if (concurrentLogin) await Promise.all(credentials.map(login));
    else for (const [index,credential] of credentials.entries()) await login(credential,index);
    assert.equal(new Set(sessions.map(session => session.cookie)).size,USERS);
    report.login = {concurrency:concurrentLogin?USERS:1,attempted:USERS,ok:sessions.length,errors:0,...timing(loginResults,performance.now()-phaseStart)};

    const queryRoute = '/web-api/query?query='+encodeURIComponent(JSON.stringify({section:'vehicles',limit:50}));
    const readRoute = workspace ? '/web-api/workspace' : queryRoute;
    const validRead = result => workspace
      ? result.status === 200 && Array.isArray(result.body.loadedSections) && !result.body.loadedSections.includes('auditLog')
        && result.body.loadedSections.every(name => Array.isArray(result.body.data?.[name]))
        && !Object.hasOwn(result.body.data || {},'auditLog')
        && Object.entries(sectionRows).every(([name,count]) => result.body.data?.[name]?.length === count)
        && result.body.platform?.negotiation?.writeCompatible === true && typeof result.body.databaseToken === 'string'
      : result.status === 200 && result.body.ok === true && result.body.total === VEHICLES && result.body.rows?.length === 50;
    const validBootstrap = (result,session) => result.status === 200 && result.body.ok === true
      && result.body.csrf === session.csrf && result.body.user?.id === session.user.id
      && result.body.user?.name === session.user.name && result.body.user?.role === session.user.role
      && result.body.access?.user?.id === session.user.id && result.body.access?.user?.role === session.user.role
      && /^sha256:[a-f0-9]{64}$/.test(result.body.access?.policyStamp || '')
      && typeof result.body.databaseToken === 'string' && result.body.databaseToken.length > 0
      && result.body.platform?.descriptor?.schemaVersion === SCHEMA_VERSION && result.body.platform?.readOnly === false;
    phaseStart = performance.now();
    const reads = await Promise.all(sessions.map(async session => {
      const sessionStart = performance.now();
      let completed;
      try {
        if (startup) {
          // Wait for both outcomes even if one transport fails. A fast workspace
          // alone does not represent a completed browser startup.
          const replies = await Promise.allSettled([
            call(gateway.port,'/web-api/bootstrap',session), call(gateway.port,readRoute,session),
          ]);
          completed = replies.map((reply,index) => {
            if(reply.status==='fulfilled')return reply.value;
            const diagnostic=safeDiagnostic(reply.reason,index===0?'bootstrap-request':'workspace-request');
            return {status:Number.isSafeInteger(reply.reason?.responseStatus)?reply.reason.responseStatus:0,body:{code:diagnostic.code},responseBytes:reply.reason?.responseBytes||0,decodedResponseBytes:reply.reason?.decodedResponseBytes||0,ms:performance.now()-sessionStart,errorDiagnostic:{endpoint:index===0?'bootstrap':'workspace',...diagnostic}};
          });
          // Match the browser's cache-context read after both initial requests.
          // Send it even after a failed initial outcome so all 150 synthetic
          // sessions have an explicit, measured third-request result.
          try{completed.push(await call(gateway.port,'/web-api/ping',session));}
          catch(error){const diagnostic=safeDiagnostic(error,'ping-request');completed.push({status:Number.isSafeInteger(error?.responseStatus)?error.responseStatus:0,body:{code:diagnostic.code},responseBytes:error?.responseBytes||0,decodedResponseBytes:error?.decodedResponseBytes||0,ms:performance.now()-sessionStart,errorDiagnostic:{endpoint:'ping',...diagnostic}});}
          const [bootstrap,result,ping] = completed, bootstrapValid = validBootstrap(bootstrap,session), workspaceValid = validRead(result);
          const sameMetadata = result.body.access?.user?.id === session.user.id && result.body.access?.user?.role === session.user.role
            && result.body.access?.policyStamp === bootstrap.body.access?.policyStamp
            && result.body.databaseToken === bootstrap.body.databaseToken
            && result.body.platform?.storageKind === 'sqlite' && result.body.platform?.descriptor?.schemaVersion === SCHEMA_VERSION
            && result.body.platform?.negotiation?.databaseDescriptor?.schemaVersion === SCHEMA_VERSION;
          const pingValid = ping.status === 200 && ping.body.ok === true && ping.body.sections === true
            && ping.body.access?.user?.id === session.user.id && ping.body.access?.user?.role === session.user.role
            && /^sha256:[a-f0-9]{64}$/.test(ping.body.access?.policyStamp||'')
            && ping.body.access?.policyStamp === bootstrap.body.access?.policyStamp
            && typeof ping.body.databaseToken === 'string' && ping.body.databaseToken.length > 0
            && ping.body.databaseToken === result.body.databaseToken && ping.body.databaseToken === bootstrap.body.databaseToken
            && ping.body.platform?.descriptor?.schemaVersion === SCHEMA_VERSION && ping.body.platform?.readOnly === false;
          const valid = bootstrapValid && workspaceValid && sameMetadata && pingValid;
          return {status:completed.find(reply=>reply.status!==200)?.status??200,
            code:valid?undefined:!bootstrapValid?bootstrap.body.code||'BOOTSTRAP_INVALID':!workspaceValid?result.body.code||'WORKSPACE_INVALID':!sameMetadata?'STARTUP_METADATA_INVALID':ping.body.code||'PING_INVALID',
            valid,responseBytes:completed.reduce((sum,reply)=>sum+reply.responseBytes,0),decodedResponseBytes:completed.reduce((sum,reply)=>sum+reply.decodedResponseBytes,0),encodings:completed.map(reply=>reply.contentEncoding||'failed'),ms:performance.now()-sessionStart,
            bootstrapMs:bootstrap.ms,bootstrapValid,workspaceMs:result.ms,workspaceValid:workspaceValid&&sameMetadata,pingMs:ping.ms,pingValid,
            diagnostics:completed.flatMap(reply=>reply.errorDiagnostic?[reply.errorDiagnostic]:[])};
        }
        const result = await call(gateway.port,readRoute,session);
        // Validate each complete workspace before releasing its large row tree.
        // Keep timings and outcome counts, not 150 retained database copies.
        return {status:result.status,code:result.body.code,valid:validRead(result),responseBytes:result.responseBytes,decodedResponseBytes:result.decodedResponseBytes,encodings:[result.contentEncoding],ms:result.ms};
      }
      catch(error) { const diagnostic=safeDiagnostic(error,'read-validation');return {status:completed?(completed.find(reply=>reply.status!==200)?.status??200):0,code:diagnostic.code,valid:false,responseBytes:completed?.reduce((sum,reply)=>sum+reply.responseBytes,0)||0,decodedResponseBytes:completed?.reduce((sum,reply)=>sum+reply.decodedResponseBytes,0)||0,ms:performance.now()-sessionStart,
        diagnostics:[diagnostic,...(completed?completed.map((reply,index)=>({endpoint:['bootstrap','workspace','ping'][index],...responseShape(reply)})):[])]}; }
    }));
    const successfulReads = reads.filter(result => result.valid), outcomes = {};
    for (const result of reads) { const key = result.status+':'+(result.valid?'VERIFIED':result.code||'INVALID_RESPONSE'); outcomes[key]=(outcomes[key]||0)+1; }
    const diagnostics=new Map();for(const result of reads)for(const diagnostic of result.diagnostics||[]){const key=JSON.stringify(diagnostic),previous=diagnostics.get(key);if(previous)previous.count++;else diagnostics.set(key,{...diagnostic,count:1});}
    const encodings={};if(gzip)for(const result of reads)for(const encoding of result.encodings||[])encodings[encoding]=(encodings[encoding]||0)+1;
    report.reads = {route:startup?'bootstrap + workspace concurrently, then fresh ping per session; history deferred':workspace?'workspace canonical sections, history deferred':'query vehicles, limit 50',concurrency:USERS,attempted:reads.length,
      ...(startup?{httpConcurrency:USERS*2,httpRequests:USERS*3,latency:'per session until both initial responses and subsequent fresh ping complete',
        bootstrap:{ok:reads.filter(result=>result.bootstrapValid).length,errors:reads.filter(result=>!result.bootstrapValid).length,...timing(reads.map(result=>({ms:result.bootstrapMs??result.ms})))},
        workspace:{ok:reads.filter(result=>result.workspaceValid).length,errors:reads.filter(result=>!result.workspaceValid).length,...timing(reads.map(result=>({ms:result.workspaceMs??result.ms})))},
        ping:{ok:reads.filter(result=>result.pingValid).length,errors:reads.filter(result=>!result.pingValid).length,...timing(reads.map(result=>({ms:result.pingMs??result.ms})))}}:{}),
      outcomes,totalResponseBytes:reads.reduce((sum,result) => sum+result.responseBytes,0),
      ...(gzip?{totalDecodedResponseBytes:reads.reduce((sum,result)=>sum+result.decodedResponseBytes,0),responseEncodings:encodings}:{}),
      ...(diagnostics.size?{diagnostics:[...diagnostics.values()]}:{}),
      ok:successfulReads.length,errors:reads.length-successfulReads.length,...timing(reads,performance.now()-phaseStart)};
    assert.equal(report.reads.errors,0,'Every concurrent session must read its expected synthetic rows.');

    if (args.includes('--writes')) {
      const snapshotResult = await call(gateway.port,'/web-api/snapshot',sessions[0]);
      assert.equal(snapshotResult.status,200);
      const snapshot = snapshotResult.body;
      phaseStart = performance.now();
      const writes = await Promise.all(sessions.slice(0,WRITES).map(async (session,index) => {
        const payload = {databaseToken:snapshot.databaseToken,base:{vehicles:snapshot.revisions.vehicles},
          operation:{id:'synthetic-load-write-'+index},
          sections:{vehicles:snapshot.data.vehicles.map((row,rowIndex) => rowIndex===index?{...row,note:'Synthetic concurrent edit '+index}:row)}};
        try { return await call(gateway.port,'/web-api/sections',{...session,payload}); }
        catch { return {status:0,body:{code:'TRANSPORT_ERROR'},ms:performance.now()-phaseStart}; }
      }));
      const committed = writes.filter(result => result.status === 200 && result.body.ok === true).length;
      const conflicts = writes.filter(result => result.status === 409 && Array.isArray(result.body.conflicts)).length;
      const outcomes = {};
      for (const result of writes) {
        const kind = result.status+':'+(result.body.code || (Array.isArray(result.body.conflicts)?'CAS_CONFLICT':result.body.ok?'COMMITTED':'UNCONFIRMED'));
        outcomes[kind] = (outcomes[kind] || 0)+1;
      }
      const final = storage.readSnapshot(dataDir);
      const preserved = final.data.vehicles.filter(row => row.note?.startsWith('Synthetic concurrent edit ')).length;
      report.writes = {concurrency:WRITES,attempted:WRITES,committed,expectedCasConflicts:conflicts,
        errors:WRITES-committed-conflicts,preservedEdits:preserved,outcomes,
        workload:'distinct vehicle edits against one shared section revision; no automatic retry',
        ...timing(writes,performance.now()-phaseStart)};
      assert.equal(report.writes.errors,0,'Write outcomes must be confirmed commits or explicit CAS conflicts.');
      assert.equal(committed,1,'Exactly one write from the shared section revision must commit.');
      assert.equal(conflicts,WRITES-1,'Every other write must return an explicit CAS conflict without a retry.');
      assert.equal(preserved,committed,'Confirmed edits must remain in the fixture.');
    }
  } catch (error) {
    report.failure = error.message;
    throw error;
  } finally {
    for(const agent of agents)agent?.destroy();
    if (gateway) await gateway.close();
    removeFixture(root);
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
  }
}

if (require.main === module) void main().catch(error => {
  process.stderr.write('Web load smoke check failed: '+error.message+'\n');
  process.exitCode = 1;
});
