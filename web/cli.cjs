'use strict';

const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createGateway}=require('./server.cjs'),access=require('../electron/access-control.js');
const {loadUsers}=require('./user-settings.cjs');
const usage='node web/cli.cjs --demo [--port 3380]\nnode web/cli.cjs --data-dir ABS --users-file ABS --state-dir ABS [--port 3380]';
function args(values){const result={};for(let i=0;i<values.length;i++){const name=values[i];if(['--demo','--help'].includes(name)){result[name.slice(2)]=true;continue;}if(!['--data-dir','--users-file','--state-dir','--port'].includes(name)||!values[i+1]||values[i+1].startsWith('--'))throw Error(usage);result[name.slice(2)]=values[++i];}return result;}
function absolute(value,label){if(typeof value!=='string'||!path.isAbsolute(value))throw Error(label+': укажите абсолютный путь.');return path.resolve(value);}
function demoDatabase(){
 const storage=require('../electron/storage.js');return {...Object.fromEntries(storage.SECTIONS.map(name=>[name,[]])),
 vehicles:[{id:'demo-v1',plate:'А123АА 14',make:'КамАЗ 43118',org:'ТВС',object:'КП-5 Тас-Юрях',status:'На ходу',driver:'Демо водитель КамАЗ',fuel:'diesel',fuelGrade:'ДТ',norm:32,odometer:186000,fuelBalance:180,tankVolume:350,toIntervalKm:10000},{id:'demo-v2',plate:'В456ВВ 14',make:'УАЗ 390995',org:'ТВС',object:'КП-18G',status:'На ходу',driver:'Демо водитель УАЗ',fuel:'gasoline',fuelGrade:'АИ-92',norm:18,odometer:82000,fuelBalance:40,tankVolume:75},{id:'demo-v3',plate:'С789СС 14',make:'ГАЗ NEXT',org:'ТВС',object:'Рембаза',status:'В ремонте',fuel:'diesel',fuelGrade:'ДТ',norm:22,odometer:124680,fuelBalance:60,tankVolume:100},{id:'demo-v4',plate:'Е234ЕЕ 14',make:'Урал 4320',org:'ТВС',object:'КП-19G',status:'На ходу',driver:'Демо водитель Урал',fuel:'diesel',fuelGrade:'ДТ',norm:36,odometer:214300,fuelBalance:160,tankVolume:300}],
 records:[{id:'demo-r1',vehicleId:'demo-v1',date:'2026-10-25',odoStart:186000,odoEnd:186230,km:230,fuelIssued:80,fuelActual:73.6,note:'Демонстрационная запись'},{id:'demo-r2',vehicleId:'demo-v1',date:'2026-10-26',odoStart:186230,odoEnd:186420,km:190,fuelIssued:60,fuelActual:60.8,note:'Демонстрационная запись'},{id:'demo-r3',vehicleId:'demo-v2',date:'2026-10-26',odoStart:82000,odoEnd:82150,km:150,fuelIssued:30,fuelActual:27,note:'Демонстрационная запись'}],
 generators:[{id:'demo-g1',name:'ДЭС-001',model:'Cummins C275D5',org:'ТВС',object:'КП-5 Тас-Юрях',location:'КП-5 Тас-Юрях',status:'В работе',power:200,norm:43,hoursInit:12450,fuelBalance:400},{id:'demo-g2',name:'ДЭС-004',model:'Doosan P126TI',org:'ТВС',object:'КП-5 Тас-Юрях',location:'КП-5 Тас-Юрях',status:'В работе',power:160,norm:35,hoursInit:6300,fuelBalance:300},{id:'demo-g3',name:'ДЭС-002',model:'Cummins C275D5',org:'ТВС',object:'КП-18G',location:'КП-18G',status:'В работе',power:200,norm:43,hoursInit:8900,fuelBalance:350}],
 genRecords:[{id:'demo-gr1',generatorId:'demo-g1',date:'2026-10-26',meterStart:12450,meterEnd:12474,hours:24,fuelIssued:1000,fuelUsed:900},{id:'demo-gr2',generatorId:'demo-g2',date:'2026-10-26',meterStart:6300,meterEnd:6324,hours:24,fuelIssued:800,fuelUsed:750}],
 tanks:[{id:'demo-tank',name:'Ёмкость КП-5',org:'ТВС',object:'КП-5 Тас-Юрях',fuel:'diesel',fuelGrade:'ДТ',capacity:10000,balanceInit:7000}],
 drivers:[{id:'demo-driver1',name:'Демо водитель',kind:'driver',employmentStatus:'active'}],
 fuelCards:[{id:'demo-cash',number:'НАЛИЧКА',provider:'Наличка',assignments:[]}],
 appMeta:[{id:'meta',toPlanInit:'web-demo'}]};
}
async function main(){
 const values=args(process.argv.slice(2));if(values.help){process.stdout.write(usage+'\n');return;}
 const port=Number(values.port||process.env.TVS_WEB_PORT||3380);if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('Порт должен быть от 1 до 65535.');
 let dataDir,outboxDir,settings,demoToken;
 if(values.demo){
   const parent=values['state-dir']?absolute(values['state-dir'],'Каталог состояния'):path.join(__dirname,'.local');fs.mkdirSync(parent,{recursive:true});const runDir=fs.mkdtempSync(path.join(parent,'demo-'));dataDir=path.join(runDir,'db');outboxDir=path.join(runDir,'outbox');
   require('../electron/sqlite-storage.cjs').create(dataDir,{data:demoDatabase()});const issued=access.issueToken();demoToken=issued.token;settings={serverAccessConfigured:true,serverUsers:access.normalizeServerUsers([{id:'demo-admin',name:'Демонстрационный администратор',role:'admin',enabled:true,tokenHash:issued.tokenHash}])};
 }else{
   dataDir=absolute(values['data-dir']||process.env.TVS_WEB_DATA_DIR,'Каталог базы');const usersFile=absolute(values['users-file']||process.env.TVS_WEB_USERS_FILE,'Файл учётных записей');outboxDir=absolute(values['state-dir']||process.env.TVS_WEB_STATE_DIR,'Каталог состояния');
   if(!fs.statSync(dataDir).isDirectory())throw Error('Каталог базы не найден.');loadUsers(usersFile);settings=()=>{try{return loadUsers(usersFile);}catch{return {serverAccessConfigured:true,serverUsers:[]};}};
 }
 const gateway=await createGateway({dataDir,outboxDir,settings,port,demo:!!values.demo,demoToken});process.stdout.write('Веб-диспетчер ТВС: '+gateway.url+'\n'+(values.demo?'Демонстрационная база. Вход кнопкой «Открыть демо».\n':'Локальный запуск. Вход по персональному ключу.\n'));
 let closing=false;const close=async()=>{if(closing)return;closing=true;await gateway.close();};process.once('SIGINT',()=>{void close().then(()=>process.exit(0));});process.once('SIGTERM',()=>{void close().then(()=>process.exit(0));});
}
if(require.main===module)void main().catch(error=>{process.stderr.write('Веб-диспетчер: '+error.message+'\n');process.exitCode=1;});
module.exports={demoDatabase,args,loadUsers};
