import type {Identifier,JsonRow,JsonValue,SectionRows} from './platform-contracts';
import type {CommandContext,CommandPlan} from './command-source';
import type {DecimalCoreAPI} from './decimal-core';
export interface VehicleRecordActionInput {action:'save';record:JsonRow}
interface Contracts {apiVersion:number;identifier(value:unknown):value is Identifier;validateCommand(value:unknown):{input:unknown}}
interface Fuel {gsmCardKey(value:unknown):string;gsmCardAt(database:unknown,number:unknown,date:string):{org:string;provider:string}}

/** The ordinary mileage form owns these fields; other source facts stay on the server. */
export function createVehicleRecord(contracts:Contracts,decimal:DecimalCoreAPI,getFuel:()=>Fuel,getPeriods:()=>{isClosed(database:unknown,scope:unknown,date:unknown):boolean}){
 const editableFields=['id','vehicleId','date','km','kmGlonass','odoStart','odoEnd','driver','fuelGrade','fuelIssued','fuelSum','fuelUsed','fuelActual','fuelIdle','tankMeasured','fuelCardNum','note','route'] as const;
 const reads=['records','vehicles','fuelCards','fuelPeriods','appMeta'];
 const numeric:Record<string,number>={km:3,kmGlonass:3,odoStart:3,odoEnd:3,fuelIssued:3,fuelSum:2,fuelUsed:3,fuelActual:3,fuelIdle:3,tankMeasured:3};
 const fail=(code:string,message:string):never=>{throw Object.assign(Error(message),{code,status:400});};
 const equal=(a:JsonValue|undefined,b:JsonValue|undefined)=>JSON.stringify(a)===JSON.stringify(b);
 const parse=(value:unknown):VehicleRecordActionInput=>contracts.validateCommand({type:'VehicleRecordAction',version:1,input:value}).input as VehicleRecordActionInput;
 const dependencies=(value?:unknown):string[]=>{if(value!==undefined)parse(value);return reads.slice();};
 const footprint=(value?:unknown):string[]=>{if(value!==undefined)parse(value);return ['records'];};
 function plan(database:SectionRows,value:VehicleRecordActionInput,_context:CommandContext):CommandPlan {
  const input=parse(value),record=input.record,id=record.id,vehicleId=record.vehicleId;
  if(!contracts.identifier(id)||!contracts.identifier(vehicleId))fail('VEHICLE_RECORD_ID','Не подтверждён идентификатор записи или автомобиля.');
  const rows=database.records||[],matches=rows.filter(row=>row.id===id);if(matches.length>1)fail('AMBIGUOUS_REFERENCE','Запись журнала найдена неоднозначно.');const old=matches[0];
  if(old&&(old.deleted||old.cancelled||old.status==='cancelled'||old.status==='void'||old.status==='posted'))fail('VEHICLE_RECORD_LOCKED','Отменённая или проведённая запись изменяется отдельной корректировкой.');
  if(old&&old.fuelMovementId!==null&&old.fuelMovementId!==undefined&&old.fuelMovementId!=='')fail('FUEL_MOVEMENT_LINKED','Связанная выдача изменяется отдельной корректировкой движения топлива.');
  if(old&&old.vehicleId!==vehicleId)fail('VEHICLE_RECORD_VEHICLE','Нельзя переносить запись журнала в другую карточку автомобиля.');
  const vehicles=(database.vehicles||[]).filter(row=>row.id===vehicleId);if(vehicles.length!==1)fail('AMBIGUOUS_REFERENCE','Автомобиль не найден однозначно.');const vehicle=vehicles[0]!;
  if(vehicle.deleted||vehicle.cancelled||vehicle.status==='cancelled'||vehicle.archived&&!old)fail('VEHICLE_RECORD_VEHICLE','Нельзя добавить запись для недействующей карточки автомобиля.');
  const next:JsonRow={...(old||{}),...record};
  const periods=getPeriods();if(periods.isClosed(database,'fuel',record.date)||old&&typeof old.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(old.date)&&periods.isClosed(database,'fuel',old.date))fail('PERIOD_CLOSED','Журнал относится к закрытому периоду ГСМ.');
  for(const field of ['driver','fuelGrade','fuelCardNum','note']){const value=next[field];if(old&&equal(value,old[field]))continue;if(value!==undefined&&value!==null&&typeof value!=='string')fail('VEHICLE_RECORD_FIELD','Проверьте текстовое поле: '+field+'.');}
  if((!old||!equal(next.route,old.route))&&next.route!==undefined&&(!Array.isArray(next.route)||next.route.some(part=>typeof part!=='string')))fail('VEHICLE_RECORD_FIELD','Проверьте список маршрутов.');
  for(const [field,scale]of Object.entries(numeric)){
   const amount=next[field];if(old&&equal(amount,old[field]))continue;
   if(field!=='km'&&(amount===null||amount===undefined))continue;
   if(typeof amount!=='number'||!Number.isFinite(amount))fail('VEHICLE_RECORD_NUMBER','Проверьте числовое поле журнала: '+field+'.');
   try{decimal.parse(amount,{scale,nonNegative:true});}catch{fail('VEHICLE_RECORD_PRECISION','Проверьте точность и знак числового поля: '+field+'.');}
  }
  if(typeof next.km!=='number'||!Number.isFinite(next.km)||next.km<0)fail('VEHICLE_RECORD_NUMBER','Укажите неотрицательный пробег за день.');
  const start=next.odoStart,end=next.odoEnd;
  if(typeof start==='number'&&typeof end==='number'&&(!old||!equal(old.odoStart,start)||!equal(old.odoEnd,end)||!equal(old.km,next.km))){const difference=decimal.sub(decimal.sub(end,start),next.km);if(decimal.compare(end,start)<0||decimal.compare(difference,'0.11')>0||decimal.compare(difference,'-0.11')<0)fail('VEHICLE_RECORD_ODOMETER','Пробег не совпадает с разницей одометра.');}
  // Ownership comes from the same dated card rules as the ordinary form. Keep
  // historical attribution when neither the card nor its date was changed.
  if(!old||!equal(old.fuelCardNum,next.fuelCardNum)||old.date!==next.date){const fuel=getFuel(),key=fuel.gsmCardKey(next.fuelCardNum),cards=(database.fuelCards||[]).filter(card=>fuel.gsmCardKey(card.number)===key);if(key&&cards.length>1)fail('AMBIGUOUS_REFERENCE','Топливная карта найдена неоднозначно.');const owner=fuel.gsmCardAt(database,next.fuelCardNum,next.date as string);next.fuelOrg=owner.org||(!next.fuelCardNum?vehicle.org:'')||'';next.fuelProvider=owner.provider||'';}
  return {sections:{records:old?rows.map(row=>row===old?next:row):[...rows,next]},readSections:dependencies(),writeSections:['records'],entityIds:{recordId:id as Identifier}};
 }
 return Object.freeze({apiVersion:1 as const,editableFields,parse,dependencies,footprint,plan});
}
