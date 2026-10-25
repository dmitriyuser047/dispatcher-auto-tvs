import fs=require('node:fs');
import path=require('node:path');
import vm=require('node:vm');
import {pathToFileURL} from 'node:url';
import {parentPort,workerData} from 'node:worker_threads';

export type Json=null|boolean|number|string|Json[]|{[key:string]:Json};
export type Row={[key:string]:Json};
export interface Mapping {format:'legacy'|'osv'|'comparison';defaultOrgName?:string;defaultObjectName?:string;date?:string;title?:string;useOpeningIfNoClosing?:boolean;target?:Row}
export interface DecodeRequest {file:{name:string;bytes:Uint8Array};mapping:Mapping;tempDirectory:string}
export interface DecodeResult {data:Record<string,Row[]>;issues:Row[];warnings:Row[];canImport:boolean}
interface DecodeError extends Error {code?:string;status?:number}
interface ArchiveBudget {input(bytes:number):void}
interface ArchiveTools {createArchiveBudget(options:Record<string,number>):ArchiveBudget;extractZipBounded(bytes:Buffer,directory:string,budget:ArchiveBudget):unknown}
interface Cell {v?:unknown;w?:unknown;f?:unknown}
interface Sheet {[key:string]:unknown}
interface Workbook {SheetNames:string[];Sheets:Record<string,Sheet>}
interface Xlsx {read(bytes:Uint8Array,options:Record<string,unknown>):Workbook;utils:{decode_range(ref:string):{s:{r:number;c:number};e:{r:number;c:number}};encode_cell(address:{r:number;c:number}):string;decode_cell(address:string):{r:number;c:number}}}
const LIMIT=25*1024*1024,ROWS=20000,COLUMNS=128,SHEETS=100,MAX_RESULT=24*1024*1024;
function fail(code:string,message:string):never {throw Object.assign(Error(message),{code,status:400});}
function rawString(bytes:Buffer):string {try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');}catch{return fail('IMPORT_JSON','Исходный JSON должен быть сохранён в UTF-8');}}

async function workbook(file:{name:string;bytes:Buffer},tempDirectory:string):Promise<{name:string;sheets:{name:string;rows:Json[][];formattedRows:(string|null)[][]}[]}> {
 const zipped=file.bytes.length>=4&&file.bytes.readUInt16LE(0)===0x4b50;
 if(zipped){
  const tools=await import(pathToFileURL(path.join(__dirname,'../ReestrBuilder/archive-budget.mjs')).href) as ArchiveTools,budget=tools.createArchiveBudget({inputBytes:LIMIT,entries:1000,entryBytes:LIMIT,extractedBytes:100*1024*1024,depth:1});budget.input(file.bytes.length);tools.extractZipBounded(file.bytes,tempDirectory,budget);
 }
 const context=vm.createContext({}, {codeGeneration:{strings:false,wasm:false}});vm.runInContext(fs.readFileSync(path.join(__dirname,'../vendor/xlsx.bundle.js'),'utf8'),context,{timeout:10000});
 const xlsx=(context as {XLSX?:Xlsx}).XLSX;if(!xlsx)fail('IMPORT_XLSX','Не загружен встроенный декодер Excel');
 const parsed=xlsx.read(new Uint8Array(file.bytes.buffer,file.bytes.byteOffset,file.bytes.byteLength),{type:'array',cellDates:false,cellFormula:false,cellText:true,sheetRows:ROWS+1,bookVBA:false,bookFiles:false});
 if(!Array.isArray(parsed.SheetNames)||!parsed.SheetNames.length||parsed.SheetNames.length>SHEETS||new Set(parsed.SheetNames).size!==parsed.SheetNames.length)fail('IMPORT_LIMIT','В книге допускается от 1 до 100 разных листов');
 const result:{name:string;rows:Json[][];formattedRows:(string|null)[][]}[]=[];let cells=0;
 for(const name of parsed.SheetNames){
  const sheet=parsed.Sheets[name];if(typeof name!=='string'||!sheet||typeof sheet!=='object')fail('IMPORT_XLSX','Повреждён лист книги');
  const literal=sheet['!fullref']??sheet['!ref'];if(literal===undefined){result.push({name,rows:[],formattedRows:[]});continue;}if(typeof literal!=='string')fail('IMPORT_XLSX','Повреждён диапазон листа');
  const range=xlsx.utils.decode_range(literal);if(!Number.isSafeInteger(range.e.r)||!Number.isSafeInteger(range.e.c)||range.s.r<0||range.s.c<0||range.e.r<range.s.r||range.e.c<range.s.c||range.e.r>=ROWS||range.e.c>=COLUMNS)fail('IMPORT_LIMIT','Лист превышает 20000 строк или 128 колонок');
  for(const key of Object.keys(sheet)){if(key.startsWith('!'))continue;const address=xlsx.utils.decode_cell(key);if(!Number.isSafeInteger(address.r)||!Number.isSafeInteger(address.c)||address.r<0||address.c<0||address.r>=ROWS||address.c>=COLUMNS)fail('IMPORT_LIMIT','Ячейка находится за пределами разрешённого диапазона');}
  const rows:Json[][]=[],formattedRows:(string|null)[][]=[];
  for(let r=0;r<=range.e.r;r++){const raw:Json[]=[],formatted:(string|null)[]=[];for(let c=0;c<=range.e.c;c++){
   if(++cells>2000000)fail('IMPORT_LIMIT','В книге слишком много ячеек');const value=sheet[xlsx.utils.encode_cell({r,c})] as Cell|undefined,cell=value?.v;
   if(cell!==undefined&&cell!==null&&typeof cell!=='string'&&typeof cell!=='number')fail('IMPORT_XLSX_CELL','В исходной таблице есть неподдерживаемое значение ячейки');
   if(typeof cell==='number'&&!Number.isFinite(cell)||typeof cell==='string'&&cell.length>20000||typeof value?.w==='string'&&value.w.length>20000)fail('IMPORT_LIMIT','Недопустимое значение или размер ячейки');
   raw.push(cell===undefined?null:cell);formatted.push(typeof value?.w==='string'?value.w:null);
  }rows.push(raw);formattedRows.push(formatted);}result.push({name,rows,formattedRows});
 }
 return {name:file.name,sheets:result};
}

export async function decode(request:DecodeRequest):Promise<DecodeResult> {
 if(!request||!request.file||typeof request.file.name!=='string'||!request.mapping||!['legacy','osv','comparison'].includes(request.mapping.format)||!(request.file.bytes instanceof Uint8Array))fail('IMPORT_FILE','Нужен исходный файл и подтверждённый профиль разбора');
 const bytes=Buffer.from(request.file.bytes);if(!bytes.length||bytes.length>LIMIT)fail('IMPORT_LIMIT','Исходный файл должен занимать от 1 байта до 25 МБ');const ext=path.extname(request.file.name).toLowerCase();let result:DecodeResult;
 if(request.mapping.format==='legacy'){
  if(ext!=='.json')fail('IMPORT_FORMAT','Для прежней базы нужен исходный JSON');let value:unknown;try{value=JSON.parse(rawString(bytes));}catch(error){if((error as DecodeError).code)throw error;fail('IMPORT_JSON','Исходный JSON не прочитан');}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['orgs','objects','mols','inventories','locGroupNames'].includes(key))||!['objects','mols','inventories'].some(key=>Object.hasOwn(value as object,key)))fail('IMPORT_JSON','Это не поддерживаемый исходный файл прежней инвентаризации');
  const decoder=require('../assets/core/asset-inventory-import.js') as {legacy(value:unknown,options:Record<string,string>):DecodeResult},options:Record<string,string>={};for(const key of ['defaultOrgName','defaultObjectName'] as const)if(request.mapping[key]!==undefined)options[key]=request.mapping[key]!;result=decoder.legacy(value,options);
 }else{
  if(!['.xls','.xlsx'].includes(ext))fail('IMPORT_FORMAT','Для табличного импорта нужен исходный XLS или XLSX');const book=await workbook({name:request.file.name,bytes},request.tempDirectory),decoder=require('../assets/core/asset-inventory-excel.js') as {decode(book:unknown,options:Record<string,unknown>):DecodeResult},options:Record<string,unknown>={format:request.mapping.format};for(const key of ['defaultOrgName','defaultObjectName','date','title','useOpeningIfNoClosing'] as const)if(request.mapping[key]!==undefined)options[key]=request.mapping[key];result=decoder.decode(book,options);
 }
 if(Object.values(result.data).reduce((sum,rows)=>sum+rows.length,0)>20000||result.data.inventorySessions?.some(session=>Array.isArray(session.rows)&&session.rows.length>20000))fail('IMPORT_LIMIT','Источник превышает 20000 записей');
 if(Buffer.byteLength(JSON.stringify(result))>MAX_RESULT)fail('IMPORT_LIMIT','Расшифровка превышает 24 МБ');return result;
}
if(parentPort){const port=parentPort;void decode(workerData as DecodeRequest).then(value=>port.postMessage({ok:true,value})).catch((error:unknown)=>{const e=error as DecodeError;port.postMessage({ok:false,code:e.code||'IMPORT_DECODE',error:e.message||'Источник не прочитан'});});}
