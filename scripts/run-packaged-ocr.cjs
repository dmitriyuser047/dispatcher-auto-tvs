// No browser windows. Uses a local Electron runtime and isolated userData in the verifier.
const {spawn}=require('node:child_process');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const metadata=require('../package.json');
const electronVersion=metadata.devDependencies.electron.replace(/^[~^]/,'');
let executable;
try{
 if(require('electron/package.json').version!==electronVersion)throw Error('Installed Electron version differs');
 executable=require('electron');
 if(!fs.existsSync(executable))throw Error('Electron executable is missing');
}catch{
 const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'tvs-ocr-electron-'));
 const zip=path.join(process.env.LOCALAPPDATA||'', 'electron','Cache',`electron-v${electronVersion}-win32-x64.zip`);
 if(!fs.existsSync(zip))throw Error('Нет локального Electron для проверки OCR: '+zip);
 new(require('adm-zip'))(zip).extractAllTo(runtime,false);
 executable=path.join(runtime,'electron.exe');
}
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(executable,[path.join(__dirname,'verify-packaged-ocr.cjs')],{stdio:'inherit',windowsHide:true,env});
const timer=setTimeout(()=>{child.kill();process.stderr.write('Packaged OCR verification exceeded 5 minutes\n');process.exitCode=1;},300000);
timer.unref();
child.on('exit',code=>{clearTimeout(timer);process.exit(code??1);});
child.on('error',error=>{clearTimeout(timer);process.stderr.write(error.stack+'\n');process.exit(1);});
