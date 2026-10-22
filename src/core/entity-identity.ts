export type EntityId=string|number;
export type AssetSection='vehicles'|'generators'|'tanks';
export type AssetPrefix='v'|'g'|'t';
export type AssetTargets=Readonly<Partial<Record<AssetPrefix,AssetSection>>>;
export type AssetResolution=Readonly<{status:'known';section:AssetSection;id:EntityId;row:Readonly<Record<string,unknown>>}>|Readonly<{status:'invalid'|'missing'|'ambiguous';section?:AssetSection;reason:string}>;
export interface EntityIdentityAPI {
 readonly apiVersion:1;
 identifier(value:unknown):value is EntityId;
 presentId(value:unknown):boolean;
 typedKey(section:unknown,id:unknown):string;
 assetRef(db:unknown,section:unknown,id:unknown):string;
 resolveAsset(db:unknown,ref:unknown,targets?:AssetTargets):AssetResolution;
}
interface IdentityError extends Error {code:string;status:number}

/** Persisted legacy asset refs remain strings; their ambiguity is never guessed away. */
export function createEntityIdentity():EntityIdentityAPI {
 const defaults:AssetTargets=Object.freeze({v:'vehicles',g:'generators',t:'tanks'});
 function fail(code:string,message:string):never {const error=new Error(message) as IdentityError;error.name='EntityIdentityError';error.code=code;error.status=400;throw error;}
 function identifier(value:unknown):value is EntityId {return typeof value==='string'&&value.trim().length>0||typeof value==='number'&&Number.isFinite(value);}
 const presentId=(value:unknown):boolean=>value!==undefined&&value!==null&&value!=='';
 function typedKey(section:unknown,id:unknown):string {if(typeof section!=='string'||!section.trim()||!identifier(id))fail('INVALID_IDENTITY','Нужны раздел и устойчивый типизированный ID');return JSON.stringify([section,typeof id,id]);}
 function object(value:unknown):value is Record<string,unknown> {if(value===null||typeof value!=='object'||Array.isArray(value))return false;const prototype:unknown=Object.getPrototypeOf(value);return prototype===null||typeof prototype==='object'&&prototype!==null&&Object.getPrototypeOf(prototype)===null;}
 function field(row:Record<string,unknown>,key:string):unknown {const descriptor=Object.getOwnPropertyDescriptor(row,key);if(descriptor?.get||descriptor?.set)throw Error('accessor');return descriptor?.value;}
 function rows(db:unknown,section:AssetSection):readonly Readonly<Record<string,unknown>>[] {
  if(!object(db))throw Error('database');const list=field(db,section);if(!Array.isArray(list))throw Error('section');const result:Record<string,unknown>[]=[];
  for(let index=0;index<list.length;index++){const item=Object.getOwnPropertyDescriptor(list,String(index));if(!item||item.get||item.set||!object(item.value))throw Error('row');const row=item.value as Record<string,unknown>;field(row,'id');result.push(row);}return result;
 }
 function resolveAsset(db:unknown,ref:unknown,targets:AssetTargets=defaults):AssetResolution {
  if(typeof ref!=='string')return Object.freeze({status:'invalid',reason:'asset-ref'});
  const match=/^([vgt]):([\s\S]+)$/.exec(ref);if(!match)return Object.freeze({status:'invalid',reason:'asset-ref'});
  const prefix=match[1] as AssetPrefix,text=match[2]!;let section:unknown;
  try{if(!object(targets))throw Error('targets');section=field(targets,prefix);}catch{return Object.freeze({status:'invalid',reason:'targets'});}
  if(section!=='vehicles'&&section!=='generators'&&section!=='tanks')return Object.freeze({status:'invalid',reason:'asset-kind'});
  let candidates:readonly Readonly<Record<string,unknown>>[];
  try{candidates=rows(db,section).filter(row=>{const id=field(row,'id');return identifier(id)&&String(id)===text;});}
  catch{return Object.freeze({status:'invalid',section,reason:'database-shape'});}
  if(candidates.length!==1)return Object.freeze({status:candidates.length?'ambiguous':'missing',section,reason:candidates.length?'legacy-string-collision':'not-found'});
  const row=candidates[0]!,id=field(row,'id') as EntityId;return Object.freeze({status:'known',section,id,row});
 }
 function assetRef(db:unknown,section:unknown,id:unknown):string {
  if(!identifier(id)||section!=='vehicles'&&section!=='generators'&&section!=='tanks')fail('INVALID_IDENTITY','Укажите технику и типизированный ID');
  let entries:readonly Readonly<Record<string,unknown>>[];try{entries=rows(db,section);}catch{return fail('INVALID_DATABASE','Не удалось проверить идентичность техники');}
  const exact=entries.filter(row=>field(row,'id')===id),matches=entries.filter(row=>{const value=field(row,'id');return identifier(value)&&String(value)===String(id);});
  if(exact.length>1||matches.length>1)fail('AMBIGUOUS_ASSET','Строковая ссылка на технику неоднозначна; выбор первой записи запрещён');
  if(exact.length!==1)fail('ASSET_NOT_FOUND','Не найдена техника с таким типизированным ID');
  const prefix=section==='vehicles'?'v':section==='generators'?'g':'t';return prefix+':'+String(id);
 }
 return Object.freeze({apiVersion:1 as const,identifier,presentId,typedKey,assetRef,resolveAsset});
}
