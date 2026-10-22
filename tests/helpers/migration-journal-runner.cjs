'use strict';
const fs=require('node:fs'),path=require('node:path'),{run}=require('./migration-journal-fixture.cjs');
const configuration=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),stop=process.argv[3];
try{const report=run(configuration,label=>{if(label===stop)process.exit(77);});fs.writeFileSync(path.join(configuration.directory,'result.json'),JSON.stringify(report));process.exit(0);}catch(error){fs.writeFileSync(path.join(configuration.directory,'result.json'),JSON.stringify({error:error.message,code:error.code}));process.exit(1);}
