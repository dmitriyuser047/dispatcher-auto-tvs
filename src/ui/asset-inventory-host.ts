/** Typed adapter to the existing application shell. Inventory has no fleet links. */
declare let data:AssetInventoryWorkspace.Database;
declare const AssetInventory:AssetInventoryWorkspace.Core;
declare const _sync:{databaseToken?:string|null;epoch?:number;platform?:{storageKind?:string;schemaVersion?:number;readOnly?:boolean;negotiation?:{selectedProfile?:{capabilities?:Array<{name:string;version:number}>}}}};
declare function platformSessionContext():{today:string;blocked?:boolean;readable?:string[];writable?:string[]};
declare function wfCommandContextStamp():string;
declare function platformExecuteCommand(command:{type:string;version:number;input:AssetInventoryWorkspace.Row},options:{operationId:string}):Promise<AssetInventoryWorkspace.Ack>;
declare function lifecycleUpgradeOpen():void;
declare function showToast(message:string):void;
declare function wfId(prefix:string):string;

let assetInventoryMountedWorkspace:AssetInventoryWorkspace.Workspace|null=null;
let assetInventoryMountedIdentity:string|null=null;
const assetInventoryOwnSections=['inventoryOrgs','inventoryObjects','inventoryMols','inventoryItems','inventorySessions'];
function assetInventoryHostSnapshot():AssetInventoryWorkspace.Snapshot {
 const context=platformSessionContext(),platform=_sync.platform,has=(names:string[]|undefined,name:string):boolean=>!Array.isArray(names)||names.includes('*')||names.includes(name);
 const identity=JSON.stringify([_sync.databaseToken??null,_sync.epoch??null]);
 return {database:data,identity,analysisStamp:wfCommandContextStamp(),isSQLite:platform?.storageKind==='sqlite',schemaVersion:platform?.schemaVersion??0,capabilities:platform?.negotiation?.selectedProfile?.capabilities??[],canRead:assetInventoryOwnSections.every(name=>has(context.readable,name)),canWrite:context.blocked!==true&&platform?.readOnly!==true&&assetInventoryOwnSections.every(name=>has(context.writable,name)),today:context.today};
}
function assetInventoryWorkspaceInstance():AssetInventoryWorkspace.Workspace {
 if(assetInventoryMountedWorkspace)return assetInventoryMountedWorkspace;
 assetInventoryMountedWorkspace=AssetInventoryWorkspace.create({core:AssetInventory,snapshot:assetInventoryHostSnapshot,operationId:()=>wfId('asset-inventory'),execute:(input,options)=>platformExecuteCommand({type:'AssetInventoryAction',version:1,input},options),openUpgrade:()=>lifecycleUpgradeOpen(),confirmDiscard:message=>window.confirm(message),importFile:request=>assetInventoryImportWizard(request),exportFile:request=>assetInventoryExportDocument({format:request.format,sessionId:request.sessionId})});
 return assetInventoryMountedWorkspace;
}
function renderAssetInventorySection():void {
 const container=document.getElementById('mainContent');if(!container)throw Error('Не найден раздел программы');
 const snapshot=assetInventoryHostSnapshot(),workspace=assetInventoryWorkspaceInstance();
 if(assetInventoryMountedIdentity!==null&&assetInventoryMountedIdentity!==snapshot.identity)assetInventoryWorkspaceRevoke();
 if(!snapshot.canRead)assetInventoryWorkspaceRevoke();
 assetInventoryMountedIdentity=snapshot.identity;workspace.render(container);
}
function assetInventoryWorkspaceLeave():boolean {
 if(!assetInventoryMountedWorkspace)return true;
 const left=assetInventoryMountedWorkspace.unmount();if(!left)showToast('Завершите сохранение или закройте форму инвентаризации.');return left;
}
function assetInventoryWorkspaceFlush():Promise<boolean> {return assetInventoryMountedWorkspace?.flush()??Promise.resolve(true);}
function assetInventoryWorkspaceHasPendingEdits():boolean {return assetInventoryMountedWorkspace?.hasPendingEdits()??false;}
function assetInventoryWorkspaceRevoke():void {
 assetInventoryFilesRevoke();
 // Forced session changes must not leave old organization costs in the DOM.
 const workspace=assetInventoryMountedWorkspace as (AssetInventoryWorkspace.Workspace&{invalidate?:()=>void})|null;
 workspace?.invalidate?.();assetInventoryMountedIdentity=null;
}
