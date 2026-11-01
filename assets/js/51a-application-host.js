// The sole adapter from legacy window state to the typed application ports.
let _application=null;
let _applicationRowsLoad=null;
async function platformPrepareApplicationRows(){
 if(!window.tvsWeb?.active||typeof syncEnsureLoaded!=='function')return;
 const database=data,stamp=syncSessionStamp();
 if(_applicationRowsLoad?.database===database&&_applicationRowsLoad.stamp===stamp)return _applicationRowsLoad.operation;
 const entry={database,stamp,operation:syncEnsureLoaded(SYNC_SECTIONS,database)};_applicationRowsLoad=entry;
 try{await entry.operation;if(data!==database||syncSessionStamp()!==stamp)throw Object.assign(Error('База или права изменились во время загрузки. Откройте карточку заново.'),{code:'SESSION_CHANGED'});}finally{if(_applicationRowsLoad===entry)_applicationRowsLoad=null;}
}
function platformApplication(){
 if(_application)return _application;
 if(typeof DispatcherApplication==='undefined'||DispatcherApplication.apiVersion!==1||typeof DispatcherApplication.createApplication!=='function')throw Error('Не загружен слой приложения. Откройте программу заново.');
 _application=DispatcherApplication.createApplication({
  repository:{live:()=>data,persisted:()=>typeof _lastPersisted==='string'?_lastPersisted:null,sync:()=>typeof _sync==='undefined'?{enabled:false,synced:{},platform:{}}:_sync,stamp:()=>JSON.stringify([platformPrepareAccessStamp(platformSessionContext()),typeof _sync==='undefined'?null:[_sync.platform?.negotiation?.selectedProfile||null,!!_sync.platform?.readOnly]]),canRead:names=>{const readable=platformSessionContext().readable;return !Array.isArray(readable)||readable.includes('*')||names.every(name=>readable.includes(name));},validateRows:value=>PlatformContracts.validateSections({rows:value},['rows']).rows,install:sections=>{for(const [name,rows]of Object.entries(sections)){if(!PlatformSchema.sections.includes(name))throw Error('Неизвестный раздел приложения');data[name]=rows;}rebuildIndex();}},
  save:{context:platformSessionContext,accessStamp:platformPrepareAccessStamp,capabilities:()=>typeof _sync==='undefined'?{}:_sync.platform||{},run:(input,persist)=>platformRuntime().run(input,persist),clearAck:()=>{if(typeof _sync!=='undefined')_sync.lastResult=null;},ack:()=>typeof _sync==='undefined'?null:_sync.lastResult,rollback:database=>{if(typeof restoreSaveBaseline==='function')restoreSaveBaseline(database);},setError:error=>{_platformLastError=error;},toast:showToast,now:()=>new Date().toISOString()},
  allocateId:prefix=>wfId(prefix),prepareRows:platformPrepareApplicationRows,
  persist:(database,options)=>persistData(database,options),semantic:(command,options)=>platformExecuteDomainCommand(command,options),trackRows:operation=>{const barrier=operation.then(result=>result.ok===true);if(typeof _pendingSaveOperations!=='undefined'){_pendingSaveOperations.add(barrier);void barrier.then(()=>_pendingSaveOperations.delete(barrier),()=>_pendingSaveOperations.delete(barrier));}return operation;},
  dialog:{show:(title,html)=>{wfShowDialog(title,html);const modal=document.getElementById('wfModal');modal.querySelector('.wf-modal').classList.add('gm-ui-modal');return modal.querySelector('#generatorMaintenanceSetup');}},
  setup:{pending:()=>generatorMaintenanceHasPendingEdits(),readable:()=>gmUiRead(['generators']),canEdit:()=>gmUiWrite('generators',['maintenanceRules']),canCreate:()=>gmUiSupported('plans')&&gmUiWrite('generatorMaintenancePlans'),year:()=>gmUiToday().slice(0,4),parseYear:value=>precisionParse(value,{scale:0,blank:'error'}),format:value=>precisionFormat(value),toast:showToast,edit:(id,after)=>toOpenRules('generator',id,after),plans:org=>generatorMaintenanceOpen(org),create:seed=>generatorMaintenanceEdit(undefined,seed)}
 });return _application;
}
function platformCaptureCardForm(section,id,modalId){try{const modal=document.getElementById(modalId);if(modal._applicationCardPending){showToast('Дождитесь подтверждения сохранения карточки.');return null;}const handle=platformApplication().cards.open(section,id==null||id===''?undefined:id);modal._applicationCard=handle;return handle;}catch(error){showToast(error.message);return null;}}
async function platformSaveCardForm(section,id,fields,modalId){
 let modal,handle,controls;
 try{modal=document.getElementById(modalId);const existing=id!=null&&id!=='';handle=modal._applicationCard;if(!handle||handle.section!==section||handle.existing!==existing||existing&&handle.id!==id)handle=platformCaptureCardForm(section,id,modalId);if(!handle)return{ok:false,message:'Откройте карточку заново.'};
  const supplied=JSON.parse(JSON.stringify(fields));controls=[...modal.querySelectorAll('input,select,textarea,button')].map(control=>[control,control.disabled]);modal._applicationCardPending=handle;for(const [control]of controls)control.disabled=true;
  const result=await platformApplication().cards.save(handle,supplied);return {...result,id:handle.id};
 }catch(error){return {ok:false,message:error.message};}finally{if(modal?._applicationCardPending===handle){modal._applicationCardPending=null;if(modal._applicationCard===handle)for(const [control,disabled]of controls||[])if(control.isConnected)control.disabled=disabled;}}
}
const applicationOriginalClose=typeof closeModal==='function'?closeModal:null;
if(applicationOriginalClose)closeModal=function(id,...args){const modal=document.getElementById(id);if(modal?._applicationCardPending){showToast('Дождитесь подтверждения сохранения карточки.');return;}const result=applicationOriginalClose.call(this,id,...args);if(modal&&!modal.classList.contains('open'))modal._applicationCard=null;return result;};
