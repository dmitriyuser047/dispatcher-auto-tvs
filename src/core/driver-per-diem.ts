import type {DecimalCoreAPI} from './decimal-core';

export type PerDiemId=string|number;
export interface PerDiemDay {date:string;units:string;reason:string}
export interface PerDiemTrip {id:PerDiemId;from:string;to:string;dailyRate:string;defaultUnits:'0'|'1';days:PerDiemDay[];advance:string;basis:string;destination:string;note:string;status:'active'|'cancelled';cancellationReason:string}
export interface PerDiemBook {version:1;trips:PerDiemTrip[]}
export interface PerDiemLine extends PerDiemDay {amount:string}
export interface PerDiemCalculation {trip:PerDiemTrip;lines:PerDiemLine[];calendarDays:number;paidDays:string;gross:string;advance:string;balance:string;toPay:string;toReturn:string}
interface PerDiemError extends Error {code:string;status:number}

/** Explicit organisation inputs only. No statutory rate, payroll posting or
 * inference of travel from mileage/timesheets is performed by this module. */
export function createDriverPerDiem(decimal:Readonly<DecimalCoreAPI>){
 function fail(code:string,message:string):never{const error=new Error(message) as PerDiemError;error.name='DriverPerDiemError';error.code=code;error.status=400;throw error;}
 if(decimal?.apiVersion!==1)fail('PER_DIEM_MODULE','Не загружены правила денежного расчёта суточных.');
 function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
  if(value===null||typeof value!=='object'||Array.isArray(value))fail('PER_DIEM_FORMAT','Некорректные параметры суточных.');
  const prototype:unknown=Object.getPrototypeOf(value);
  if(!(prototype===null||typeof prototype==='object'&&prototype!==null&&Object.getPrototypeOf(prototype)===null))fail('PER_DIEM_FORMAT','Нужны обычные JSON-параметры суточных.');
  for(const key of Reflect.ownKeys(value)){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!keys.includes(key)||!descriptor?.enumerable||descriptor.get||descriptor.set)fail('PER_DIEM_FORMAT','Неизвестные или исполняемые поля суточных запрещены.');}
  return value as Record<string,unknown>;
 }
 function list(value:unknown,max:number):unknown[]{if(!Array.isArray(value)||value.length>max)fail('PER_DIEM_LIMIT','Слишком большой список суточных.');for(const key of Reflect.ownKeys(value)){if(key==='length')continue;const desc=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=value.length||!desc?.enumerable||desc.get||desc.set)fail('PER_DIEM_FORMAT','Недопустимый список суточных.');}for(let index=0;index<value.length;index++)if(!Object.prototype.hasOwnProperty.call(value,index))fail('PER_DIEM_FORMAT','Пропуск записи суточных.');return value;}
 function text(value:unknown,label:string,required=false):string{if(typeof value!=='string'||value.length>2000||required&&!value.trim())fail('PER_DIEM_TEXT','Проверьте поле «'+label+'».');return value.trim();}
 function id(value:unknown):PerDiemId{if(typeof value==='string'&&value.trim()&&value.length<=200||typeof value==='number'&&Number.isFinite(value))return value;return fail('PER_DIEM_ID','Нужен код поездки.');}
 function day(value:unknown):string{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'0001-01-01'||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail('PER_DIEM_DATE','Укажите действительные даты поездки.');return value;}
 function dates(from:unknown,to:unknown):string[]{const first=day(from),last=day(to),start=Date.parse(first+'T00:00:00Z'),end=Date.parse(last+'T00:00:00Z'),count=(end-start)/86400000+1;if(count<1||count>366)fail('PER_DIEM_PERIOD','Период поездки должен составлять от 1 до 366 календарных дней.');return Array.from({length:count},(_,index)=>new Date(start+index*86400000).toISOString().slice(0,10));}
 function money(value:unknown):string{if(value===null||value===undefined||value==='')fail('PER_DIEM_AMOUNT','Укажите ставку и аванс явно; нулевое значение допустимо.');return decimal.parse(value,{scale:2,nonNegative:true,max:'999999999999.99'});}
 function units(value:unknown):string{return decimal.parse(value,{scale:3,nonNegative:true,max:'1'});}
 function normalize(input:unknown):PerDiemTrip{
  const row=object(input,['id','from','to','dailyRate','defaultUnits','days','advance','basis','destination','note','status','cancellationReason']);
  const range=dates(row.from,row.to);if(row.defaultUnits!=='0'&&row.defaultUnits!=='1')fail('PER_DIEM_RULE','Выберите правило оплаты дней поездки.');
  if(row.status!=='active'&&row.status!=='cancelled')fail('PER_DIEM_STATUS','Проверьте состояние расчёта суточных.');
  const seen=new Set<string>(),overrides=list(row.days,366).map(value=>{const item=object(value,['date','units','reason']),date=day(item.date);if(!range.includes(date)||seen.has(date))fail('PER_DIEM_DAY','Дни расчёта повторяются или выходят за период поездки.');seen.add(date);return {date,units:units(item.units),reason:text(item.reason,'Основание изменения дня',true)};}).sort((a,b)=>a.date.localeCompare(b.date));
  const cancellationReason=text(row.cancellationReason??'','Причина отмены',row.status==='cancelled');
  return {id:id(row.id),from:range[0]!,to:range[range.length-1]!,dailyRate:money(row.dailyRate),defaultUnits:row.defaultUnits,days:overrides,advance:money(row.advance),basis:text(row.basis,'Основание',true),destination:text(row.destination,'Место поездки',true),note:text(row.note??'','Примечание'),status:row.status,cancellationReason};
 }
 function calculate(input:unknown):PerDiemCalculation{
  const trip=normalize(input),overrides=new Map(trip.days.map(row=>[row.date,row])),lines=dates(trip.from,trip.to).map(date=>{const override=overrides.get(date),value=override?.units??trip.defaultUnits;return {date,units:value,reason:override?.reason??(trip.defaultUnits==='1'?'Календарный день по выбранному правилу':'День не выбран для оплаты'),amount:decimal.quantize(decimal.mul(trip.dailyRate,value),{scale:2,rounding:'half-away-from-zero'})};});
  const gross=decimal.sum(lines.map(row=>row.amount)),balance=decimal.sub(gross,trip.advance);
  return {trip,lines,calendarDays:lines.length,paidDays:decimal.sum(lines.map(row=>row.units)),gross,advance:trip.advance,balance,toPay:decimal.compare(balance,'0')>0?balance:'0',toReturn:decimal.compare(balance,'0')<0?decimal.sub('0',balance):'0'};
 }
 function validateBook(input:unknown):PerDiemBook{
  if(input===undefined)return {version:1,trips:[]};const book=object(input,['version','trips']);if(book.version!==1)fail('PER_DIEM_VERSION','Формат расчётов суточных не поддерживается.');
  const trips=list(book.trips,2000).map(normalize),seen=new Set<string>(),occupied=new Map<string,PerDiemId>();
  for(const trip of trips){const key=JSON.stringify([typeof trip.id,trip.id]);if(seen.has(key))fail('PER_DIEM_DUPLICATE','Код поездки повторяется.');seen.add(key);if(trip.status==='cancelled')continue;for(const date of dates(trip.from,trip.to)){if(occupied.has(date))fail('PER_DIEM_OVERLAP','Поездки этого водителя пересекаются: '+date+'. Проверьте даты или отмените ошибочный расчёт.');occupied.set(date,trip.id);}}
  return {version:1,trips};
 }
 function upsert(input:unknown,trip:unknown):PerDiemBook{const book=validateBook(input),row=normalize(trip),index=book.trips.findIndex(value=>value.id===row.id);if(index<0)book.trips.push(row);else book.trips[index]=row;return validateBook(book);}
 function summary(input:unknown){const book=validateBook(input),calculations=book.trips.filter(row=>row.status==='active').map(calculate);return {trips:calculations.length,paidDays:decimal.sum(calculations.map(row=>row.paidDays)),gross:decimal.sum(calculations.map(row=>row.gross)),advance:decimal.sum(calculations.map(row=>row.advance)),toPay:decimal.sum(calculations.map(row=>row.toPay)),toReturn:decimal.sum(calculations.map(row=>row.toReturn))};}
 return Object.freeze({apiVersion:1 as const,dates,normalize,calculate,validateBook,upsert,summary});
}
