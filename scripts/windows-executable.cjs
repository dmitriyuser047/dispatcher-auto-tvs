const path=require('node:path'),fs=require('node:fs'),{spawnSync}=require('node:child_process');
module.exports=async context=>{
 const root=path.resolve(__dirname,'..');
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 const exe=path.join(context.appOutDir,context.packager.appInfo.productFilename+'.exe');
 const editor=path.join(root,'.builder-cache','winCodeSign','rcedit-x64.exe');
 const version=pkg.version.split('-')[0]+'.0';
 const args=[exe,'--set-icon',path.join(root,'build','icon.ico'),'--set-file-version',version,'--set-product-version',version,'--set-version-string','ProductName',pkg.build.productName,'--set-version-string','FileDescription',pkg.description,'--set-version-string','CompanyName','ООО Технрайз Велл Сервис','--set-version-string','OriginalFilename',path.basename(exe),'--set-version-string','InternalName','Dispatcher'];
 const result=spawnSync(editor,args,{encoding:'utf8',windowsHide:true});
 if(result.error||result.status!==0)throw result.error||Error(result.stderr||'Unable to write Windows executable metadata');
};
