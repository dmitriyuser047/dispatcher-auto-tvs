// No browser windows. Uses a local Electron runtime and isolated userData in the verifier.
const {spawn}=require('node:child_process');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
let executable;
try{executable=require('electron');}catch{
 const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-ocr-electron-'));
 const zip=path.join(process.env.LOCALAPPDATA,'electron','Cache','electron-v28.3.3-win32-x64.zip');
 if(!fs.existsSync(zip))throw Error('Нет локального Electron для проверки OCR: '+zip);
 new(require('adm-zip'))(zip).extractAllTo(runtime,false);
 executable=path.join(runtime,'electron.exe');
}
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(executable,[path.join(__dirname,'verify-packaged-ocr.cjs')],{stdio:'inherit',windowsHide:true,env});
child.on('exit',code=>process.exit(code??1));
child.on('error',error=>{process.stderr.write(error.stack+'\n');process.exit(1);});
