'use strict';
// Called by the Windows configurator with its private candidate file. No HTTP
// listener or operation queue is opened during this installation check.
const path=require('node:path');
function parseArgs(argv){
  if(![2,3].includes(argv.length)||argv[0]!=='--config'||!path.isAbsolute(argv[1])||(argv.length===3&&argv[2]!=='--backup'))throw Error('Проверка: --config ABSOLUTE_CONFIG_JSON [--backup]');
  return {configPath:argv[1],backup:argv.length===3};
}
function checkConfiguration(configPath,{backup=false,runtime=require('../../local-runtime.cjs')}={}){
  const built=runtime.buildRuntime(configPath);
  if(backup)runtime.prepareBackup(built);
  return {ok:true,backupVerified:backup};
}
if(require.main===module){try{const {configPath,backup}=parseArgs(process.argv.slice(2));checkConfiguration(configPath,{backup});process.stdout.write(backup?'База, персональные учётные записи и резервный пакет проверены.\n':'Конфигурация проверена.\n');}catch(error){process.stderr.write('Проверка настройки: '+(error.code?error.code+': ':'')+error.message+'\n');process.exitCode=1;}}
module.exports={parseArgs,checkConfiguration};
