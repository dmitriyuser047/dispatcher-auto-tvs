const path=require('node:path'),fs=require('node:fs'),{spawnSync}=require('node:child_process');
module.exports=async context=>{
 const root=path.resolve(__dirname,'..');
 const info=context.packager.appInfo;
 const exe=path.join(context.appOutDir,info.productFilename+'.exe');
 const editor=path.join(root,'.builder-cache','winCodeSign','rcedit-x64.exe');
 const version=info.version.split('-')[0]+'.0';
 const args=[exe,'--set-icon',path.join(root,'build','icon.ico'),'--set-file-version',version,'--set-product-version',version,'--set-version-string','ProductName',info.productName,'--set-version-string','FileDescription',info.description,'--set-version-string','CompanyName','ООО Технрайз Велл Сервис','--set-version-string','OriginalFilename',path.basename(exe),'--set-version-string','InternalName',info.id==='com.tvs.dispatcher-des-object'?'DESObject':'Dispatcher'];
 const result=spawnSync(editor,args,{encoding:'utf8',windowsHide:true});
 if(result.error||result.status!==0)throw result.error||Error(result.stderr||'Unable to write Windows executable metadata');
};
