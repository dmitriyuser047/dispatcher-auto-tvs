export type Id=string|number;
export type Json=null|boolean|number|string|Json[]|{[key:string]:Json};
export type Row={[key:string]:Json};
export type Database=Record<string,Row[]>;
export type Options=Record<string,unknown>;
export interface Context extends Record<string,unknown>{identity:string;blocked?:boolean}
export interface SyncState{enabled:boolean;synced:Record<string,string>;platform:Record<string,unknown>}
export interface RepositoryPorts{
 live():Database;persisted():string|null;sync():SyncState;
 stamp():string;canRead(names:readonly string[]):boolean;validateRows(value:unknown):Row[];
 install(sections:Database):void;
}
export interface Capture{readonly key:symbol}
export interface RuntimeInput{id?:unknown;previous:Database;next:Database;identity:string;options:Options}
export interface SavePorts{
 context():Context;accessStamp(context:Context):string;capabilities():Record<string,unknown>;
 run(input:RuntimeInput,persist:(plan:{id:string})=>Promise<unknown>):Promise<unknown>;
 clearAck():void;ack():Record<string,unknown>|null;
 rollback(database:Database):void;setError(error:{code:string;message:string;at:string}|null):void;
 toast(message:string):void;now():string;
}
export type Persist=(options:Options)=>Promise<boolean>;
export type CatalogSection='vehicles'|'generators'|'drivers';
export interface RowEdit{id:Id;expected:Row|null;changes:Row;removeFields?:string[]}
export interface ChangeRows{type:'ChangeRows';version:1;section:CatalogSection;edits:RowEdit[];reason:string;operationId:string}
export interface RowResult{ok:boolean;code?:string;message?:string;committed?:boolean;needsReload?:boolean;rows?:Row[]}
export const isId=(value:unknown):value is Id=>typeof value==='string'&&value!==''||typeof value==='number'&&Number.isFinite(value);
export const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function fail(code:string,message:string):never{throw Object.assign(Error(message),{code});}
export function errorOf(error:unknown):{code:string;message:string}{return {code:object(error)&&typeof error.code==='string'?error.code:'SAVE_FAILED',message:object(error)&&typeof error.message==='string'?error.message:String(error)};}
