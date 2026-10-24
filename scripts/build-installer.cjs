// Build from a real, complete production dependency tree, including pnpm transitives.
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
require('./write-release-manifest.cjs').validateMetadata(pkg);
require('./write-release-manifest.cjs').assertCleanSource(root);
const version=pkg.version;
const env={...process.env,ELECTRON_BUILDER_CACHE:path.join(root,'.builder-cache')};
function run(args){const result=spawnSync(process.execPath,args,{cwd:root,env,stdio:'inherit',windowsHide:true});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);}
run([path.join(__dirname,'vendor-tesseract-worker.cjs')]);
run([path.join(__dirname,'verify-native-ocr-core.cjs')]);
run([path.join(__dirname,'ocr-model-tools.cjs'),'analyze','--output','audit/ocr-model-analysis.json']);
if(process.platform==='win32')run([path.join(root,'RECOVER-BUILDER-TOOLS.cjs')]);
run([path.join(__dirname,'prepare-installer-stage.cjs')]);
const stage=JSON.parse(fs.readFileSync(path.join(root,'audit','installer-stage-'+version+'.json'),'utf8'));
if(!path.isAbsolute(stage.stagePath)||!path.isAbsolute(stage.configPath))throw Error('Invalid installer staging paths');
run([require.resolve('electron-builder/cli.js'),'--projectDir',stage.stagePath,'--win','--x64','--publish','never','--config',stage.configPath]);
run([path.join(__dirname,'verify-build.cjs')]);
run([path.join(__dirname,'write-release-manifest.cjs')]);
