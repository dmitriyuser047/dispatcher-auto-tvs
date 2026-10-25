/** Read-only boundary to the prepared ledger and the existing application shell. */
declare namespace GsmStatement {
 type Id=number|string;
 type Field='opening'|'issued'|'spent'|'correction'|'end';
 type Fields=Record<Field,number|null>;
 type SourceKind='vehicle'|'opening'|'purchase'|'record';
 interface Accounting {vehicleId?:Id;from?:string;opening?:unknown;basis?:string}
 interface Vehicle {id?:Id;plate?:string;name?:string;make?:string;fuelGrade?:string;fuelBalance?:unknown;fuelAccounting?:Accounting|null}
 interface JournalRecord {id?:Id;vehicleId?:Id;date:string;deleted?:boolean;cancelled?:boolean;status?:string;fuelGrade?:string;tankMeasured?:unknown;km?:unknown}
 interface Purchase {id?:Id}
 interface Database {vehicles?:Vehicle[];records?:JournalRecord[];fuelPurchases?:Purchase[]}
 interface LedgerRow {vehicleId:Id;org?:string;grade?:string;vehicle?:Vehicle;accountingFrom?:string;start?:unknown;issued?:unknown;spent?:unknown;correction?:unknown;end?:unknown}
 interface Movement {vehicleId?:Id;org?:string;grade?:string;date?:string;kind:string;source:string;purchaseId?:Id;recordId?:Id;qty?:unknown;idle?:unknown;delta?:unknown;manual?:boolean;cardNo?:string;provider?:string;fromGrade?:string;toGrade?:string}
 interface Issue {vehicleId?:Id;recordId?:Id;purchaseId?:Id;code:string;grade?:string;org?:string;orgs?:string[];field?:string;date?:string;message?:string;severity?:string}
 interface Ledger {rows:LedgerRow[];from?:string;to?:string;movements?:Movement[];issues?:Issue[];errors?:Issue[];accounting?:Accounting[]}
 interface Measurement {record:JournalRecord;order:number;qty:number|null}
 interface History {records:JournalRecord[];measurements:Measurement[];priorMeasurement:JournalRecord|null;unresolvedOpeningGap:boolean}
 interface Index {vehicles:Map<string,Vehicle[]>;records:Map<string,JournalRecord[]>;movements:Map<string,Movement[]>;issues:Map<string,Issue[]>;history:Map<string,History>}
 interface Model {row:LedgerRow;vehicle:Vehicle;token:string;issues:Issue[];movements:Movement[];consumption:Movement[];receipts:Movement[];measurements:Measurement[];fields:Fields;reasons:Partial<Record<Field,string>>;negative:boolean;unknown:boolean;review:boolean;sourceLabel:string;basis:string;accountingFrom:string}
 interface Context {ledger:Ledger;database:Database|null;stamp:unknown;rows:Model[];refs:Array<{kind:SourceKind;id:Id}>}
 interface Options {stage?:string}
 interface MeasurementPlan {measurements:Map<string,JournalRecord>;lastOnDate:Map<string,Id|undefined>;keyFor(record:JournalRecord):string}
 interface FuelApi {
  fqDate?:(value:string|null|undefined)=>boolean;
  fqRecordFuelFamily?:(record:JournalRecord,vehicle:Vehicle)=>string;
  fqMeasurementPlan?:(records:JournalRecord[],vehicle:Vehicle)=>MeasurementPlan;
  fqRecord?:(record:JournalRecord,vehicle:Vehicle)=>{source:string};
  openingEvidence?:(database:Database,vehicleId:Id,options:{before:string|undefined;family:string})=>{status:string};
 }
}
declare const data:GsmStatement.Database;
declare const DecimalCore:{parse(value:number|string):unknown;toNumberExact(value:unknown):number};
declare const TvsFuelEngine:GsmStatement.FuelApi;
declare function gsmOrgKey(value:unknown):string;
declare function gsmFamily(value:unknown):string;
declare function gsmVisible(row:GsmStatement.LedgerRow):boolean;
declare function fmtDate(value:string):string;
declare function dispatcherAnalysisStamp():unknown;
declare function syncSessionStamp():unknown;
declare function showToast(message:string):void;
declare function renderFuelPurchases():void;
declare function switchSection(section:string):void;
declare function selectVehicle(id:GsmStatement.Id):void;
declare function fuelAccountingOpen(section:string,id:GsmStatement.Id):void;
declare function fpEdit(id:GsmStatement.Id):void;
declare function gsmEditRecord(id:GsmStatement.Id):void;
