// Local build metadata only. No release is published by this script.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const name='Dispatcher-Setup-'+pkg.version+'.exe';
const bytes=fs.readFileSync(path.join(root,'dist',name));
const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
const sha512=crypto.createHash('sha512').update(bytes).digest('base64');
function write(file,text){fs.writeFileSync(file+'.next',text);fs.renameSync(file+'.next',file);}
const versionFile=path.join(root,'version.json');
const version=JSON.parse(fs.readFileSync(versionFile,'utf8'));
if(version.version!==pkg.version)throw Error('Version manifest does not match package version');
write(path.join(root,'dist','latest.yml'),`version: ${pkg.version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${name}\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`);
version.sha256=sha256;write(versionFile,JSON.stringify(version,null,2)+'\n');
process.stdout.write(JSON.stringify({version:pkg.version,installer:name,bytes:bytes.length,sha256,sha512,published:false},null,2)+'\n');
