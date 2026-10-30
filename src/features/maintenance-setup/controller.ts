import {errorOf,fail,type Capture,type Id} from '../../application/contracts';
import type {Repository} from '../../application/repository';
import {generators,typedKey,visible,type SetupModel,type SetupOptions} from './model';
import type {SetupView} from './view';
export interface SetupPorts{pending():boolean;readable():boolean;canEdit():boolean;canCreate():boolean;year():string;parseYear(value:string):number;format(value:number):string;toast(message:string):void;edit(id:Id,after:()=>void):void;plans(org:string):void;create(seed:{org:string;year:number;title:string;generatorIds:Id[]}):void}
export function createSetupController(repository:Repository,view:SetupView,ports:SetupPorts){
 let session:{model:SetupModel;capture:Capture}|null=null;
 function open(options:SetupOptions={}):void{
  try{
   if(ports.pending())throw Error('Сохраните или отмените изменения открытой формы ТО.');if(!ports.readable())throw Error('Нет доступа к карточкам ДЭС.');
   const items=generators(repository.read(['generators']).generators||[],ports.format),chosen=options.generatorId===undefined?null:items.find(row=>row.id===options.generatorId);if(options.generatorId!==undefined&&!chosen)throw Error('Выбранная ДЭС недоступна.');
   const model:SetupModel={generators:items,organizations:[...new Set(items.map(row=>row.org).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru')),selected:new Set(options.selected||(chosen?[chosen.key]:[])),org:chosen?.org||options.org||'',search:'',year:String(options.year||ports.year()),canEdit:ports.canEdit(),canCreate:ports.canCreate()},current={model,capture:repository.capture(['generators','generatorMaintenancePlans'])};session=current;
   const run=(action:()=>void):void=>{try{if(session!==current||!view.connected())fail('STALE_VIEW','Форма настройки закрыта. Откройте её заново.');repository.assertCurrent(current.capture);view.error('');action();}catch(error){view.error(errorOf(error).message);}};
   view.show(model,{org:token=>run(()=>{model.org=token===''?'':model.organizations[Number(token)]||'';view.update(model);}),search:query=>run(()=>{model.search=query;view.update(model);}),all:checked=>run(()=>{for(const row of visible(model))if(checked)model.selected.add(row.key);else model.selected.delete(row.key);view.update(model);}),select:(id,checked)=>run(()=>{if(checked)model.selected.add(typedKey(id));else model.selected.delete(typedKey(id));view.update(model);}),edit:id=>run(()=>{model.year=view.year();ports.edit(id,()=>open({org:model.org,year:model.year,selected:[...model.selected]}));}),plans:()=>run(()=>ports.plans(model.org)),create:()=>run(()=>{
    const selected=model.generators.filter(row=>model.selected.has(row.key));if(!selected.length)throw Error('Выберите хотя бы одну ДЭС.');const orgs=[...new Set(selected.map(row=>row.org))];if(orgs.length!==1||!orgs[0])throw Error('В один график включаются ДЭС одной организации. Уточните выбор и организацию в карточках.');const year=ports.parseYear(view.year());if(year<1900||year>9999)throw Error('Укажите год графика от 1900 до 9999.');if(!ports.canCreate())throw Error('Изменение недоступно: проверьте права и состояние подключения.');ports.create({org:orgs[0],year,title:'График ТО ДЭС на '+year+' год',generatorIds:selected.map(row=>row.id)});
   })});
  }catch(error){ports.toast(errorOf(error).message);}
 }
 return Object.freeze({open});
}
