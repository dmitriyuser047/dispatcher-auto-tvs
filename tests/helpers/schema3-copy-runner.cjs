'use strict';
const fs=require('node:fs'),path=require('node:path');
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),stop=process.argv[3],checkpoint=label=>{if(label===stop)process.exit(77);};
try{const service=config.cli?require('../../electron/sqlite-migration.cjs').createSqliteMigration({checkpoint}):require('../../electron/schema-upgrade.cjs').createSchemaUpgrade({checkpoint});const result=config.cli?service.migrateCopy(config.request):service.upgradeCopy(config.request);fs.writeFileSync(config.result,JSON.stringify(result));process.exit(0);}catch(error){fs.writeFileSync(config.result,JSON.stringify({error:error.message,code:error.code}));process.exit(1);}
