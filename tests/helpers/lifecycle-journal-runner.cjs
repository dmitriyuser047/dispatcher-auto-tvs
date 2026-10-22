'use strict';
const fs=require('node:fs'),{run}=require('./lifecycle-journal-fixture.cjs');
const config=JSON.parse(fs.readFileSync(process.argv[2])),stop=process.argv[3];
try{const result=run(config,label=>{if(label===stop)process.exit(77);});fs.writeFileSync(config.result,JSON.stringify(result));process.exit(0);}catch(error){fs.writeFileSync(config.result,JSON.stringify({code:error.code,message:error.message}));process.exit(1);}
