import {fail,type Capture,type Database,type RepositoryPorts,type Row} from './contracts';

/** All mutable live references stay at this boundary; views receive JSON copies. */
export function createRepository(ports:RepositoryPorts){
 const captures=new WeakMap<Capture,{owner:WeakRef<Database>;stamp:string;source:[string,string][]}>();
 const copyRows=(value:unknown):Row[]=>JSON.parse(JSON.stringify(ports.validateRows(value))) as Row[];
 function baseline():Database{
  let saved:Database;try{const parsed:unknown=ports.persisted()?JSON.parse(ports.persisted()!):{};if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('snapshot');saved=parsed as Database;}catch{throw Error('Не удалось прочитать исходный снимок. Загрузите базу заново.');}
  const sync=ports.sync();if(sync.enabled)for(const [name,json]of Object.entries(sync.synced))saved[name]=JSON.parse(json) as Row[];return saved;
 }
 function read(names:readonly string[],confirmed=false):Database{
  if(!ports.canRead(names))fail('ACCESS_DENIED','Нет доступа к запрошенным разделам базы.');
  const source=confirmed?baseline():ports.live();return Object.fromEntries(names.map(name=>[name,copyRows(source[name]||[])]));
 }
 function capture(names:readonly string[]):Capture{
  const owner=ports.live(),token=Object.freeze({key:Symbol('repository-capture')});captures.set(token,{owner:new WeakRef(owner),stamp:ports.stamp(),source:names.map(name=>[name,JSON.stringify(owner[name]||[])])});return token;
 }
 function assertCurrent(token:Capture):void{
  const saved=captures.get(token);if(!saved||saved.owner.deref()!==ports.live()||saved.stamp!==ports.stamp()||saved.source.some(([name,json])=>json!==JSON.stringify(ports.live()[name]||[])))fail('STALE_VIEW','Данные или права изменились. Откройте раздел заново.');
 }
 function install(sections:Database):void{ports.install(Object.fromEntries(Object.entries(sections).map(([name,rows])=>[name,copyRows(rows)])));}
 return Object.freeze({baseline,read,capture,assertCurrent,install,isLive:(database:Database)=>database===ports.live(),copyRows});
}
export type Repository=ReturnType<typeof createRepository>;
