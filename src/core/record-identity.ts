interface IdentityDescriptor {field:string;natural?:{field:string;normalize?:string};composite?:string[]}
interface Registry {descriptors:Record<string,{identity:IdentityDescriptor}>}
interface Row {[key:string]:unknown}

/** Stable row keys for legacy section reconciliation, without health orchestration. */
export function createRecordIdentity(schema:Registry){
 const plain=(value:unknown):value is Row=>value!==null&&Object.prototype.toString.call(value)==='[object Object]';
 const present=(value:unknown):boolean=>value!==undefined&&value!==null&&value!=='';
 const scalarId=(value:unknown):value is string|number=>typeof value==='string'&&!!value.trim()&&value.length<=500&&!['__proto__','constructor','prototype'].includes(value)||typeof value==='number'&&Number.isSafeInteger(value);
 const idKey=(value:unknown):string=>typeof value+':'+String(value);
 const card=(value:unknown):string=>String(value||'').replace(/\D/g,'')||String(value||'').trim().toUpperCase();
 function stable(value:unknown,parents=new Set<object>()):string {
  if(value===undefined)return 'undefined';if(typeof value==='number'&&!Number.isFinite(value))return '<number:'+String(value)+'>';
  if(value===null||typeof value!=='object')return JSON.stringify(value)??'<'+typeof value+'>';
  if(parents.has(value))return '<cycle>';parents.add(value);
  const result=Array.isArray(value)?'['+value.map(child=>stable(child,parents)).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable((value as Row)[key],parents)).join(',')+'}';
  parents.delete(value);return result;
 }
 function rowIdentity(section:string,value:unknown,index:number):string {
  const identity=schema.descriptors[section]!.identity;
  if(plain(value)&&scalarId(value[identity.field]))return idKey(value[identity.field]);
  if(plain(value)&&identity.natural&&scalarId(value[identity.natural.field])){const key=identity.natural.normalize==='card'?card(value[identity.natural.field]):value[identity.natural.field];if(present(key))return 'natural:'+idKey(key);}
  if(plain(value)&&identity.composite&&identity.composite.some(field=>present(value[field])))return 'composite:'+stable(identity.composite.map(field=>value[field]??''));
  return '@'+index;
 }
 return Object.freeze({apiVersion:1 as const,rowIdentity});
}
export type RecordIdentityAPI=ReturnType<typeof createRecordIdentity>;
