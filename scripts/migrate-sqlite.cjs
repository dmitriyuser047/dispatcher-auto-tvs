'use strict';
// Deliberately no profile/default data path, automatic launch or update action.
const { migrateCopy } = require('../electron/sqlite-migration.cjs');
function parseArgs(argv) {
  const options = {};
  for (let index=0;index<argv.length;index++) {
    const argument = argv[index];
    if (argument === '--help' && argv.length === 1) return {help:true};
    if (!['--source','--target'].includes(argument) || options[argument.slice(2)] !== undefined || !argv[index+1] || argv[index+1].startsWith('--'))
      throw new Error('Укажите только --source <папка JSON> --target <новая папка SQLite>');
    options[argument.slice(2)] = argv[++index];
  }
  if (!options.source || !options.target) throw new Error('Обязательны оба явных параметра: --source и --target');
  return {sourceDir:options.source,targetDir:options.target};
}
function main(argv = process.argv.slice(2), output = process) {
  try {
    const options = parseArgs(argv);
    if (options.help) { output.stdout.write('Создание отдельной SQLite копии без изменения JSON:\nnode scripts/migrate-sqlite.cjs --source <папка JSON> --target <новая папка SQLite>\n'); return 0; }
    output.stdout.write(JSON.stringify(migrateCopy(options),null,2) + '\n');
    return 0;
  } catch (error) {
    output.stderr.write(JSON.stringify({ok:false,code:error.code || 'MIGRATION_ARGUMENTS',message:error.message}) + '\n');
    return 1;
  }
}
module.exports = { parseArgs,main };
if (require.main === module) process.exitCode = main();
