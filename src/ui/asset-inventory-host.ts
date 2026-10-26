/** Inventory owns its database and command binding; the shell supplies access and date. */
declare let data:AssetInventoryWorkspace.Database;
declare const AssetInventory:AssetInventoryWorkspace.Core;
declare const _sync:{databaseToken?:string|null;epoch?:number;platform?:InventoryDatabasePlatform};
declare const PlatformCommands:{parseCommand(value:AssetInventoryWorkspace.Row):AssetInventoryWorkspace.Row;dependencies(value:AssetInventoryWorkspace.Row):string[];footprint(value:AssetInventoryWorkspace.Row):string[]};
declare const PlatformKernel:{requestDigest(value:AssetInventoryWorkspace.Row):string};
declare const PlatformContracts:{validateSections(value:Record<string,AssetInventoryWorkspace.Row[]>,registry:string[]):void};
declare const BusinessCalendar:{resolve(value:AssetInventoryWorkspace.Database,now:string):{today:string}};
declare function platformSessionContext():{today:string;blocked?:boolean;readable?:string[];writable?:string[];policyStamp?:string;accessPolicy?:unknown;fieldPermissions?:unknown;actor?:unknown};
declare function wfCommandContextStamp():string;
declare function platformExecuteCommand(command:{type:string;version:number;input:AssetInventoryWorkspace.Row},options:{operationId:string}):Promise<AssetInventoryWorkspace.Ack>;
declare function lifecycleUpgradeOpen():void;
declare function showToast(message:string):void;
declare function wfId(prefix:string):string;

interface InventoryDatabasePlatform {storageKind?:string;schemaVersion?:number;readOnly?:boolean;capabilities?:Array<{name:string;version:number}>;negotiation?:{selectedProfile?:{capabilities?:Array<{name:string;version:number}>}}}
interface InventoryDatabaseReply extends AssetInventoryWorkspace.Ack {data?:AssetInventoryWorkspace.Database;databaseToken?:string;revisions?:Record<string,number>;platform?:InventoryDatabasePlatform;access?:{readable?:string[];writable?:string[]};code?:string;cancelled?:boolean;sourceId?:string;source?:AssetInventoryWorkspace.Row;canImport?:boolean;issues?:unknown;warnings?:unknown;preview?:AssetInventoryWorkspace.Row;input?:AssetInventoryWorkspace.Row;changed?:string[]}
interface InventoryDatabaseCache {parent:string;token:string;database:AssetInventoryWorkspace.Database;revisions:Record<string,number>;platform:InventoryDatabasePlatform;access:{readable?:string[];writable?:string[]};stamp:number}
interface InventoryCommandIntent {parent:string;signature:string;envelope:AssetInventoryWorkspace.Row;pending:Promise<AssetInventoryWorkspace.Ack>|null;result:AssetInventoryWorkspace.Ack|null}
let assetInventoryMountedWorkspace:AssetInventoryWorkspace.Workspace|null=null;
let objectQuantityMountedWorkspace:AssetInventoryWorkspace.Workspace|null=null;
let assetInventoryMountedIdentity:string|null=null;
let assetInventoryDatabaseCache:InventoryDatabaseCache|null=null;
let assetInventoryDatabaseLoading:Promise<void>|null=null;
let assetInventoryDatabaseGeneration=0,assetInventoryRenderGeneration=0;
let assetInventoryVisibleMode:'inventory'|'quantity'|null=null;
const assetInventoryOwnSections=['inventoryOrgs','inventoryObjects','inventoryMols','inventoryItems','inventorySessions'];
const assetInventoryCommandIntents=new Map<string,InventoryCommandIntent>();
const assetInventoryEmptyDatabase:AssetInventoryWorkspace.Database={};
function assetInventoryDatabaseBridge():((payload:AssetInventoryWorkspace.Row)=>Promise<InventoryDatabaseReply>)|undefined {return (window as unknown as {electronAPI?:{inventoryDatabase?:(payload:AssetInventoryWorkspace.Row)=>Promise<InventoryDatabaseReply>}}).electronAPI?.inventoryDatabase;}
function assetInventoryParentIdentity():string {const context=platformSessionContext();return JSON.stringify([_sync.databaseToken??null,_sync.epoch??null,context.policyStamp??null,context.actor??null,context.readable??null,context.writable??null,context.accessPolicy??null,context.fieldPermissions??null]);}
function assetInventoryDatabaseToken():string|null {return assetInventoryDatabaseBridge()?(assetInventoryDatabaseCache?.parent===assetInventoryParentIdentity()?assetInventoryDatabaseCache.token:null):_sync.databaseToken??null;}
function assetInventoryHostSnapshot():AssetInventoryWorkspace.Snapshot {
 const context=platformSessionContext(),has=(names:string[]|undefined,name:string):boolean=>!Array.isArray(names)||names.includes('*')||names.includes(name),parent=assetInventoryParentIdentity();
 const independent=!!assetInventoryDatabaseBridge(),cache=assetInventoryDatabaseCache?.parent===parent?assetInventoryDatabaseCache:null,platform=independent?cache?.platform:_sync.platform;
 const canRead=assetInventoryOwnSections.every(name=>has(context.readable,name)&&(!independent||has(cache?.access.readable,name)));
 const today=independent&&cache&&typeof BusinessCalendar==='object'?BusinessCalendar.resolve(cache.database,new Date().toISOString()).today:context.today;
 return {database:independent?cache?.database??assetInventoryEmptyDatabase:data,identity:independent?JSON.stringify([parent,cache?.token??null]):parent,analysisStamp:independent?JSON.stringify([cache?.stamp??0,context.readable??null,context.writable??null]):wfCommandContextStamp(),isSQLite:platform?.storageKind==='sqlite',schemaVersion:platform?.schemaVersion??0,capabilities:platform?.negotiation?.selectedProfile?.capabilities??platform?.capabilities??[],canRead,canWrite:(!independent?context.blocked!==true:true)&&platform?.readOnly!==true&&(!independent||cache!==null)&&assetInventoryOwnSections.every(name=>has(context.writable,name)&&(!independent||has(cache?.access.writable,name))),today,...(independent?{databaseIndependent:true,databaseLabel:'База инвентаризации'}:{})};
}
async function assetInventoryDatabaseRequest(action:string,request?:AssetInventoryWorkspace.Row):Promise<InventoryDatabaseReply> {
 const rpc=assetInventoryDatabaseBridge(),parent=assetInventoryParentIdentity(),generation=assetInventoryDatabaseGeneration,token=_sync.databaseToken;
 if(!rpc||typeof token!=='string'||!token)throw Error('Нет подтверждённого подключения к базе инвентаризации');
 const result=await rpc({action,parentDatabaseToken:token,...(request?{request}:{})});
 if(parent!==assetInventoryParentIdentity()||generation!==assetInventoryDatabaseGeneration)throw Error('База, пользователь или доступ изменились. Откройте раздел заново.');
 return result;
}
function assetInventoryInstallDatabase(reply:InventoryDatabaseReply,parent:string):void {
 if(!reply.ok||!reply.data||typeof reply.databaseToken!=='string'||!reply.databaseToken||!reply.platform||assetInventoryOwnSections.some(name=>!Array.isArray(reply.data?.[name])))throw Error(reply.error||'База инвентаризации не подтвердила собственные данные');
 const old=assetInventoryDatabaseCache?.parent===parent?assetInventoryDatabaseCache:null,database=old?.database??{};
 for(const name of [...assetInventoryOwnSections,'appMeta'])if(Array.isArray(reply.data[name]))database[name]=JSON.parse(JSON.stringify(reply.data[name]));
 assetInventoryDatabaseCache={parent,token:reply.databaseToken,database,revisions:{...reply.revisions},platform:reply.platform,access:reply.access??{},stamp:(old?.stamp??0)+1};
}
async function assetInventoryLoadDatabase():Promise<void> {
 if(assetInventoryDatabaseLoading)return assetInventoryDatabaseLoading;
 const parent=assetInventoryParentIdentity(),pending=(async()=>{const reply=await assetInventoryDatabaseRequest('snapshot');assetInventoryInstallDatabase(reply,parent);})();
 assetInventoryDatabaseLoading=pending;try{await pending;}finally{if(assetInventoryDatabaseLoading===pending)assetInventoryDatabaseLoading=null;}
}
async function assetInventoryExecuteCommand(command:{type:string;version:number;input:AssetInventoryWorkspace.Row},options:{operationId:string}):Promise<AssetInventoryWorkspace.Ack> {
 if(!assetInventoryDatabaseBridge())return platformExecuteCommand(command,options);
 const cache=assetInventoryDatabaseCache,parent=assetInventoryParentIdentity(),id=options.operationId;
 if(!cache||cache.parent!==parent)return {ok:false,error:'Сначала дождитесь загрузки базы инвентаризации'};
 if(command.type!=='AssetInventoryAction')return {ok:false,error:'В базе инвентаризации разрешены только действия с имуществом'};
 const parsed=PlatformCommands.parseCommand(command),signature=JSON.stringify(parsed);let entry=assetInventoryCommandIntents.get(id);
 if(entry&&(entry.parent!==parent||entry.signature!==signature))return {ok:false,error:'Идентификатор операции уже связан с другим действием'};
 if(entry?.pending)return entry.pending;
 if(entry?.result?.ok)return entry.result;
 if(!entry){
  if(assetInventoryCommandIntents.size>=128){const oldest=[...assetInventoryCommandIntents].find(([,value])=>!value.pending&&!value.result?.unknown&&value.result?.definitive!==false);if(oldest)assetInventoryCommandIntents.delete(oldest[0]);else return {ok:false,error:'Проверьте неподтверждённые операции инвентаризации'};}
  const envelope:AssetInventoryWorkspace.Row={protocolVersion:1,databaseToken:cache.token,base:Object.fromEntries(PlatformCommands.dependencies(parsed).map(name=>[name,cache.revisions[name]??0])),operation:{id},command:parsed};
  (envelope.operation as AssetInventoryWorkspace.Row).digest=PlatformKernel.requestDigest(envelope);
  entry={parent,signature,envelope,pending:null,result:null};assetInventoryCommandIntents.set(id,entry);
 }
 const intent=entry,snapshot=assetInventoryHostSnapshot(),pending=(async()=>{
  let sent=false;
  try{
   if(!snapshot.canRead||!snapshot.canWrite)throw Error('Нет права изменения базы инвентаризации');
   sent=true;const result=await assetInventoryDatabaseRequest('execute',intent.envelope);
   if(!result.ok)return result;
   const receipt=result.operationReceipt as {id?:string;digest?:string;status?:string}|undefined,operation=intent.envelope.operation as AssetInventoryWorkspace.Row;
   if(result.databaseToken!==cache.token||receipt?.id!==id||receipt.digest!==operation.digest||!['committed','replayed'].includes(receipt.status??''))throw Error('Сервер не подтвердил квитанцию операции инвентаризации');
   const expected=[...new Set([...PlatformCommands.footprint(parsed),'auditLog'])],canonical=result.canonicalSections,changed=result.changed??Object.keys(canonical??{});
   // The command footprint permits changes; unchanged catalogs are omitted by
   // the server. Require canonical rows for each actual acknowledged change.
   if(!canonical||changed.some(name=>!expected.includes(name)||!Array.isArray(canonical[name]))||Object.keys(canonical).some(name=>!expected.includes(name)||!Array.isArray(canonical[name])))throw Error('Сервер не вернул канонические данные инвентаризации');
   PlatformContracts.validateSections(canonical,[...assetInventoryOwnSections,'auditLog']);
   if(Object.keys(canonical).some(name=>!Number.isSafeInteger(result.revisions?.[name])||Number(result.revisions?.[name])<0))throw Error('Сервер не подтвердил версии сохранённых разделов');
   const current=assetInventoryHostSnapshot();
   if(cache!==assetInventoryDatabaseCache||snapshot.identity!==current.identity||snapshot.analysisStamp!==current.analysisStamp||!current.canRead||!current.canWrite)throw Error('База или доступ к инвентаризации изменились во время сохранения');
   for(const [name,rows] of Object.entries(canonical)){if(assetInventoryOwnSections.includes(name))cache.database[name]=JSON.parse(JSON.stringify(rows));}
   cache.revisions={...cache.revisions,...result.revisions};cache.stamp++;
   return result;
  }catch(error){return {ok:false,error:error instanceof Error?error.message:String(error),...(sent?{unknown:true,definitive:false}:{})};}
 })();
 intent.pending=pending;try{const result=await pending;intent.result=result;return result;}finally{intent.pending=null;}
}
async function assetInventoryImportSource(request:AssetInventoryWorkspace.Row):Promise<InventoryDatabaseReply> {
 if(assetInventoryDatabaseBridge())return assetInventoryDatabaseRequest('importSource',request);
 const rpc=(window as unknown as {electronAPI?:{importSource?:(payload:AssetInventoryWorkspace.Row)=>Promise<InventoryDatabaseReply>}}).electronAPI?.importSource;
 if(!rpc)throw Error('Безопасный импорт файлов недоступен в этом подключении. Обновите программу.');return rpc(request);
}
async function assetInventoryExportRequest(request:{format:'xlsx'|'pdf';sessionId:AssetInventoryWorkspace.Id;databaseToken:string}):Promise<InventoryDatabaseReply> {
 if(assetInventoryDatabaseBridge())return assetInventoryDatabaseRequest('export',request);
 const rpc=(window as unknown as {electronAPI?:{assetInventoryExport?:(payload:typeof request)=>Promise<InventoryDatabaseReply>}}).electronAPI?.assetInventoryExport;
 if(!rpc)throw Error('Выгрузка инвентаризации недоступна в этом подключении. Обновите программу.');return rpc(request);
}
async function assetInventoryOpenDatabaseFolder():Promise<void> {const result=await assetInventoryDatabaseRequest('openFolder');if(!result.ok)throw Error(result.error||'Не удалось открыть папку базы инвентаризации');}
function assetInventoryWorkspaceInstance(mode:'inventory'|'quantity'='inventory'):AssetInventoryWorkspace.Workspace {
 const existing=mode==='quantity'?objectQuantityMountedWorkspace:assetInventoryMountedWorkspace;if(existing)return existing;
 const workspace=AssetInventoryWorkspace.create({mode,core:AssetInventory,snapshot:assetInventoryHostSnapshot,operationId:()=>wfId('asset-inventory'),execute:(input,options)=>assetInventoryExecuteCommand({type:'AssetInventoryAction',version:1,input},options),openUpgrade:()=>lifecycleUpgradeOpen(),confirmDiscard:message=>window.confirm(message),importFile:request=>assetInventoryImportWizard(request),exportFile:request=>assetInventoryExportDocument({format:request.format,sessionId:request.sessionId}),...(assetInventoryDatabaseBridge()?{openDatabaseFolder:assetInventoryOpenDatabaseFolder,openDocuments:()=>InventoryDocuments.open(),mountPhotos:input=>InventoryPhotos.mount(input)}:{})});
 if(mode==='quantity')objectQuantityMountedWorkspace=workspace;else assetInventoryMountedWorkspace=workspace;return workspace;
}
function objectQuantityWorkspaceInstance():AssetInventoryWorkspace.Workspace {return assetInventoryWorkspaceInstance('quantity');}
function renderAssetInventorySection():void {renderAssetInventoryMode('inventory');}
function renderObjectQuantitySection():void {renderAssetInventoryMode('quantity');}
function renderAssetInventoryMode(mode:'inventory'|'quantity'):void {
 const container=document.getElementById('mainContent');if(!container)throw Error('Не найден раздел программы');
 const independent=!!assetInventoryDatabaseBridge(),parent=assetInventoryParentIdentity(),sameView=assetInventoryVisibleMode===mode;
 if(independent&&assetInventoryDatabaseCache&&assetInventoryDatabaseCache.parent!==parent)assetInventoryWorkspaceRevoke();
 const snapshot=assetInventoryHostSnapshot(),workspace=assetInventoryWorkspaceInstance(mode);
 if(!independent){if(assetInventoryMountedIdentity!==null&&assetInventoryMountedIdentity!==snapshot.identity)assetInventoryWorkspaceRevoke();if(!snapshot.canRead)assetInventoryWorkspaceRevoke();assetInventoryMountedIdentity=snapshot.identity;workspace.render(container);return;}
 if(!snapshot.canRead){assetInventoryWorkspaceRevoke();workspace.render(container);return;}
 assetInventoryVisibleMode=mode;
 if(sameView&&assetInventoryDatabaseCache?.parent===parent){assetInventoryMountedIdentity=snapshot.identity;workspace.render(container);return;}
 const generation=++assetInventoryRenderGeneration;container.innerHTML='<section class="asset-inventory"><h2>'+(mode==='quantity'?'Количественный учёт':'Инвентаризация ОС')+'</h2><p data-ai-database-loading role="status">Загружается база инвентаризации…</p></section>';
 void assetInventoryLoadDatabase().then(()=>{if(generation!==assetInventoryRenderGeneration||assetInventoryVisibleMode!==mode||parent!==assetInventoryParentIdentity())return;assetInventoryMountedIdentity=assetInventoryHostSnapshot().identity;workspace.render(container);}).catch(error=>{
  if(generation!==assetInventoryRenderGeneration||assetInventoryVisibleMode!==mode)return;container.replaceChildren();const section=document.createElement('section'),heading=document.createElement('h2'),message=document.createElement('p'),retry=document.createElement('button');section.className='asset-inventory';heading.textContent='База инвентаризации';message.setAttribute('role','alert');message.setAttribute('data-ai-database-error','');message.textContent=error instanceof Error?error.message:String(error);retry.className='btn btn-secondary';retry.textContent='Повторить загрузку';retry.onclick=()=>{assetInventoryVisibleMode=null;renderAssetInventoryMode(mode);};section.append(heading,message,retry);container.append(section);
 });
}
function assetInventoryWorkspaceLeave():boolean {
 if(InventoryDocuments.hasPending()||AssetInventoryFiles.hasPending()){showToast('Завершите работу с файлами инвентаризации.');return false;}
 for(const workspace of [assetInventoryMountedWorkspace,objectQuantityMountedWorkspace])if(workspace&&!workspace.unmount()){showToast('Завершите сохранение или закройте форму учёта имущества.');return false;}assetInventoryVisibleMode=null;assetInventoryRenderGeneration++;return true;
}
async function assetInventoryWorkspaceFlush():Promise<boolean> {if(InventoryDocuments.hasPending()||AssetInventoryFiles.hasPending())return false;let ready=true;const pending=[...assetInventoryCommandIntents.values()].flatMap(intent=>intent.pending?[intent.pending]:[]);for(const workspace of [assetInventoryMountedWorkspace,objectQuantityMountedWorkspace])if(workspace&&!await workspace.flush())ready=false;if((await Promise.allSettled(pending)).some(result=>result.status!=='fulfilled'||!result.value.ok))ready=false;return ready;}
function assetInventoryWorkspaceHasPendingEdits():boolean {return InventoryDocuments.hasPending()||AssetInventoryFiles.hasPending()||[assetInventoryMountedWorkspace,objectQuantityMountedWorkspace].some(workspace=>workspace?.hasPendingEdits())||[...assetInventoryCommandIntents.values()].some(intent=>!!intent.pending);}
function assetInventoryWorkspaceRevoke():void {
 InventoryDocuments.revoke();assetInventoryFilesRevoke();for(const workspace of [assetInventoryMountedWorkspace,objectQuantityMountedWorkspace])workspace?.invalidate();assetInventoryMountedIdentity=null;assetInventoryVisibleMode=null;assetInventoryDatabaseCache=null;assetInventoryDatabaseLoading=null;assetInventoryDatabaseGeneration++;assetInventoryRenderGeneration++;assetInventoryCommandIntents.clear();
}
