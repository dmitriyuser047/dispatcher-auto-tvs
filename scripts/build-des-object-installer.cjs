'use strict';
// Local build only. This product deliberately has no automatic update feed yet.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),profile=require('./des-object-build-profile.cjs');
require('./write-release-manifest.cjs').assertCleanSource(root);
const env={...process.env,ELECTRON_BUILDER_CACHE:path.join(root,'.builder-cache')};
function run(args,extra={}){const r=spawnSync(process.execPath,args,{cwd:root,env:{...env,...extra},stdio:'inherit',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status||1);}
for(const script of ['build-application.cjs','build-typed-core.cjs','build-inventory-ui.cjs','build-inventory-server.cjs','build-gsm-ui.cjs'])run([path.join(__dirname,script),'--check']);
if(process.platform==='win32')run([path.join(root,'RECOVER-BUILDER-TOOLS.cjs')]);
run([path.join(__dirname,'prepare-des-object-stage.cjs')]);
const stage=JSON.parse(fs.readFileSync(path.join(root,'audit','des-object-stage-'+profile.VERSION+'.json'),'utf8'));
run([require.resolve('electron-builder/cli.js'),'--projectDir',stage.stagePath,'--win','--x64','--publish','never','--config',stage.configPath]);
const directory=path.join(root,'dist','des-object');
run([path.join(__dirname,'verify-build.cjs'),'--des-object'],{TVS_PACKAGED_ASAR:path.join(directory,'win-unpacked','resources','app.asar')});
const verification=JSON.parse(fs.readFileSync(path.join(root,'audit','des-object-package-source.json'),'utf8'));
if(verification.status!=='PASS')throw Error('Пакет ДЭС объекта не прошёл проверку');
const installer='Des-Object-Setup-'+profile.VERSION+'.exe',bytes=fs.readFileSync(path.join(directory,installer)),manifest={version:profile.VERSION,coreVersion:require('../package.json').version,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim(),name:'dispatcher-des-object',appId:'com.tvs.dispatcher-des-object',installer,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),sha512:crypto.createHash('sha512').update(bytes).digest('base64'),archiveSha256:verification.archiveSha256,published:false,automaticUpdates:false};
fs.writeFileSync(path.join(directory,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(path.join(directory,'SHA256SUMS.txt'),manifest.sha256+'  '+installer+'\n');console.log(JSON.stringify(manifest,null,2));
