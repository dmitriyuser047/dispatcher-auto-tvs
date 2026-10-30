import {errorOf,fail,isId,type Capture,type CatalogSection,type ChangeRows,type Id,type Row,type RowResult} from './contracts';
import type {Repository} from './repository';
export interface CardHandle{readonly id:Id;readonly section:CatalogSection;readonly existing:boolean}
interface State{capture:Capture;expected:Row|null;operationText:string|null;operationId:string;pending:Promise<RowResult>|null}
/** Forms supply parsed fields; this controller owns identity, conflicts and writes. */
export function createCardController(repository:Repository,execute:(command:ChangeRows)=>Promise<RowResult>,allocate:(prefix:string)=>string){
 const states=new WeakMap<CardHandle,State>();
 function open(section:CatalogSection,id?:Id):CardHandle{
  if(!['vehicles','generators','drivers'].includes(section))fail('CARD_SECTION','Неизвестный справочник карточек.');
  const rows=repository.read([section])[section]||[],matches=id===undefined?[]:rows.filter(row=>row.id===id);if(id!==undefined&&(!isId(id)||matches.length!==1))fail('CARD_TARGET','Карточка не найдена однозначно.');
  const handle=Object.freeze({id:id===undefined?allocate(section==='vehicles'?'v':section==='generators'?'g':'person'):id,section,existing:id!==undefined});states.set(handle,{capture:repository.capture([section]),expected:matches[0]||null,operationText:null,operationId:'',pending:null});return handle;
 }
 function save(handle:CardHandle,fields:Row):Promise<RowResult>{
  const state=states.get(handle);if(!state)return Promise.resolve({ok:false,code:'CARD_SESSION',message:'Откройте карточку заново.'});if(state.pending)return state.pending;
  try{
   repository.assertCurrent(state.capture);const supplied=repository.copyRows([fields])[0]!;if(Object.hasOwn(supplied,'id')&&supplied.id!==handle.id)fail('ROW_ID','Код карточки не совпадает с открытой формой.');
   const changes:Row=Object.fromEntries(Object.entries(supplied).filter(([name,value])=>name!=='id'&&(state.expected===null||JSON.stringify(state.expected[name])!==JSON.stringify(value))));
   if(state.expected!==null&&!Object.keys(changes).length)return Promise.resolve({ok:true,rows:repository.copyRows([state.expected])});
   const text=JSON.stringify(changes);if(state.operationText!==text){state.operationText=text;state.operationId=allocate('card-change');}
   const pending=execute({type:'ChangeRows',version:1,section:handle.section,edits:[{id:handle.id,expected:state.expected,changes}],reason:'Изменение карточки',operationId:state.operationId});state.pending=pending;void pending.then(()=>{state.pending=null;},()=>{state.pending=null;});return pending;
  }catch(error){return Promise.resolve({ok:false,...errorOf(error)});}
 }
 return Object.freeze({open,save});
}
