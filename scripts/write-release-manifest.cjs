// Local build metadata only. No release is published by this script.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const name=(pkg.prototype?'Dispatcher-Prototype-':'Dispatcher-Setup-')+pkg.version+'.exe';
const bytes=fs.readFileSync(path.join(root,'dist',name));
const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
const sha512=crypto.createHash('sha512').update(bytes).digest('base64');
function write(file,text){fs.writeFileSync(file+'.next',text);fs.renameSync(file+'.next',file);}
if(!pkg.prototype)throw Error('Этот скрипт разрешён только для отдельной сборки прототипа');
write(path.join(root,'dist','prototype-manifest.json'),JSON.stringify({version:pkg.version,installer:name,bytes:bytes.length,sha256,sha512,published:false,autoUpdates:false},null,2)+'\n');
write(path.join(root,'dist','SHA256SUMS.txt'),sha256+'  '+name+'\n');
process.stdout.write(JSON.stringify({version:pkg.version,installer:name,bytes:bytes.length,sha256,sha512,published:false},null,2)+'\n');
