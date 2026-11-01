// Explicit plan composition only. Choosing catalogue positions never moves stock.
function gmPlanPartActive(part){return !!part&&typeof part==='object'&&!Array.isArray(part)&&!part.archived&&!part.deleted&&!part.cancelled&&part.status!=='cancelled'&&!Object.hasOwn(part,'mergedInto');}
function gmPlanPartsId(value){return typeof PlatformContracts!=='undefined'&&PlatformContracts.identifier(value);}
function gmPlanPartsChoices(s,row){
 if(!gmPlanPartsId(row.generatorId))return [];
 const counts=new Map();for(const part of s.parts||[])counts.set(gmUiId(part.id),(counts.get(gmUiId(part.id))||0)+1);
 return (s.parts||[]).map((part,index)=>({part,index})).filter(({part})=>part.active===true&&gmPlanPartActive(part)&&Object.hasOwn(part,'generatorId')&&part.generatorId===row.generatorId&&gmPlanPartsId(part.id)&&counts.get(gmUiId(part.id))===1);
}
function gmPlanPartsState(row){
 if(!row.partsPicker||row.partsPicker.generatorId!==row.generatorId)row.partsPicker={generatorId:row.generatorId,selectedIds:[],sourceIndex:'',open:!row.components.length,message:''};
 return row.partsPicker;
}
function gmPlanSavedKitIndex(s){
 const index=new Map(),parts=new Map(),ambiguous=new Set(),plans=data.generatorMaintenancePlans||[],planCounts=new Map();
 for(const part of s.parts||[]){if(parts.has(part.id))ambiguous.add(part.id);else parts.set(part.id,part);}
 for(const plan of plans)planCounts.set(plan?.id,(planCounts.get(plan?.id)||0)+1);
 for(const plan of plans){
  if(!plan||!gmPlanPartsId(plan.id)||planCounts.get(plan.id)!==1||!['draft','approved'].includes(plan.status))continue;
  let source=plan;
  if(plan.status==='approved'){
   try{
    const snapshot=plan.snapshot,approval=plan.approval;
    if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||snapshot.version!==1||!gmPlanPartsId(plan.rootId)||!Number.isSafeInteger(plan.revision)||plan.revision<1||Object.hasOwn(plan,'previousId')&&!gmPlanPartsId(plan.previousId)||!approval||typeof approval!=='object'||Array.isArray(approval)||typeof approval.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(approval.date)||!Number.isFinite(Date.parse(approval.date+'T12:00:00Z'))||new Date(approval.date+'T12:00:00Z').toISOString().slice(0,10)!==approval.date||typeof approval.document!=='string'||!approval.document.trim()||typeof approval.actor!=='string'||!approval.actor.trim()||typeof approval.at!=='string'||!Number.isFinite(Date.parse(approval.at)))continue;
    if(generatorMaintenanceApi().snapshotDigest(snapshot)!==plan.fingerprint||plan.id!==snapshot.planId||plan.rootId!==snapshot.rootId||plan.revision!==snapshot.revision||plan.previousId!==snapshot.previousId||PlatformKernel.stableSerialize(approval)!==PlatformKernel.stableSerialize(snapshot.approval))continue;
    source=snapshot;
   }catch{continue;}
  }else if(['approval','snapshot','fingerprint'].some(field=>Object.hasOwn(plan,field)))continue;
  if(!Array.isArray(source.rows))continue;
  const seen=new Set();
  for(const entry of source.rows){
   if(!entry||!gmPlanPartsId(entry.generatorId)||typeof entry.type!=='string'||!Array.isArray(entry.components)||!entry.components.length||entry.components.length>1000)continue;
   const components=[],ids=new Set();let valid=true;
   for(const component of entry.components){
    const part=component&&parts.get(component.partId),qty=component?.qty;
    if(!component||!gmPlanPartsId(component.partId)||ids.has(component.partId)||ambiguous.has(component.partId)||!part||part.active!==true||!gmPlanPartActive(part)||!Object.hasOwn(part,'generatorId')||part.generatorId!==entry.generatorId||qty!==null&&(typeof qty!=='number'||!Number.isFinite(qty)||qty<0||qty>1e12||!/^\d+(?:\.\d{1,3})?$/.test(String(qty)))){valid=false;break;}
    ids.add(component.partId);components.push({partId:component.partId,qty});
   }
   if(!valid)continue;
   const set=components.map(component=>[gmUiId(component.partId),component.qty]).sort((left,right)=>left[0]<right[0]?-1:left[0]>right[0]?1:0),key=JSON.stringify([gmUiId(entry.generatorId),entry.type,set]);
   if(seen.has(key))continue;seen.add(key);
   const kits=index.get(entry.generatorId)||[],label=[source.year==null?'Год не указан':String(source.year),source.title||'График без названия',entry.type||'Вид ТО не назван','ред. '+String(source.revision??plan.revision??1),plan.status==='approved'?'Утверждён':'Черновик','комплект '+(kits.length+1)].join(' · ');
   kits.push({label,planId:plan.id,type:entry.type,components});index.set(entry.generatorId,kits);
  }
 }
 return index;
}
function gmPlanSavedKits(s,row){
 const scope=typeof gmPlanForecastReadScope!=='undefined'&&gmPlanForecastReadScope?.session===s?gmPlanForecastReadScope:null;
 let index=scope?.componentKits?.parts===s.parts&&scope.componentKits.plans===data.generatorMaintenancePlans?scope.componentKits.index:null;
 if(!index){index=gmPlanSavedKitIndex(s);if(scope)scope.componentKits={parts:s.parts,plans:data.generatorMaintenancePlans,index};}
 return (index.get(row.generatorId)||[]).map(kit=>({...kit,components:kit.components.map(component=>({...component}))}));
}
function gmPlanKitPreviewHtml(s,kit){
 if(!kit)return '<p>Выберите сохранённый комплект и проверьте количества перед добавлением.</p>';
 return '<p>'+gmUiEsc(kit.label)+'</p><div class="gm-ui-scroll"><table class="tbl"><thead><tr><th>Позиция · артикул, наименование, единица</th><th>Количество на одно ТО</th></tr></thead><tbody>'+kit.components.map(component=>{const part=s.parts.find(part=>part.id===component.partId);return '<tr><td>'+gmUiEsc(part?.label||'Позиция № '+String(component.partId))+'</td><td>'+gmUiEsc(component.qty===null?'Не задано':precisionFormat(component.qty))+'</td></tr>';}).join('')+'</tbody></table></div><p>Добавятся только отсутствующие позиции. Уже введённые количества сохранятся.</p>';
}
function gmPlanPartsPickerHtml(s,row){
 const state=gmPlanPartsState(row),choices=gmPlanPartsChoices(s,row),selected=new Set(state.selectedIds),existing=new Set(row.components.map(component=>component.partId)),kits=gmPlanSavedKits(s,row),source=/^(?:0|[1-9]\d*)$/.test(state.sourceIndex)?kits[Number(state.sourceIndex)]:null,disabled=s.readonly?' disabled':'',missing=choices.filter(({part})=>!existing.has(part.id)),canAdd=missing.some(({part})=>selected.has(part.id));
 return '<details class="gm-plan-parts-picker" data-gm-parts-picker'+(state.open?' open':'')+'><summary>Выбрать детали для одного ТО · личный склад ДЭС</summary><p>Отметьте нужные позиции и добавьте их в комплект. Это план: выбор ничего не приходует, не резервирует и не списывает. Количество на одно выполнение укажите отдельно; складской остаток вместо него не подставляется.</p>'+(choices.length?'<div class="gm-plan-stock-picks">'+choices.map(({part,index})=>{const included=existing.has(part.id);return '<label><input type="checkbox" data-gm-part-pick value="'+index+'"'+(included||selected.has(part.id)?' checked':'')+(s.readonly||included?' disabled':'')+'> '+gmUiEsc(part.label)+(included?' <small>Уже в комплекте</small>':'')+'</label>';}).join('')+'</div>':'<p data-gm-parts-empty>В личном складе этой ДЭС нет доступных позиций. Добавьте их в карточке ДЭС; общие, чужие, архивные и удалённые позиции здесь не предлагаются.</p>')+'<div class="gm-ui-actions"><button type="button" class="btn btn-ghost btn-sm" data-gm-parts-select-all'+(s.readonly||!missing.length?' disabled':'')+'>Выбрать все доступные</button><button type="button" class="btn btn-ghost btn-sm" data-gm-parts-clear'+disabled+'>Снять выбор</button><button type="button" class="btn btn-primary btn-sm" data-gm-parts-add'+(s.readonly||!canAdd?' disabled':'')+'>Добавить выбранные детали</button></div><details class="gm-plan-kit-source" data-gm-saved-kits'+(source?' open':'')+'><summary>Скопировать комплект из сохранённого графика</summary><label>Источник комплекта<select data-gm-kit-source'+(s.readonly||!kits.length?' disabled':'')+'><option value="">Выберите график и вид ТО</option>'+kits.map((kit,index)=>'<option value="'+index+'"'+(String(index)===state.sourceIndex?' selected':'')+'>'+gmUiEsc(kit.label)+'</option>').join('')+'</select></label>'+(kits.length?'':'<p>Подходящих сохранённых комплектов для этой ДЭС нет. Источник с недоступной позицией не копируется частично.</p>')+'<div data-gm-kit-preview>'+gmPlanKitPreviewHtml(s,source)+'</div><button type="button" class="btn btn-ghost btn-sm" data-gm-kit-add'+(s.readonly||!source?' disabled':'')+'>Добавить комплект из графика</button></details><p role="status" data-gm-parts-message>'+gmUiEsc(state.message)+'</p></details>';
}
function gmPlanPartsPickerSync(s,row,node){
 const changed=!!row.partsPicker&&row.partsPicker.generatorId!==row.generatorId,state=gmPlanPartsState(row);if(changed)return;
 const picker=node.querySelector('[data-gm-parts-picker]');if(!picker)return;state.open=picker.open;
 const allowed=new Set(gmPlanPartsChoices(s,row).map(({part})=>part.id));state.selectedIds=[...new Set([...picker.querySelectorAll('[data-gm-part-pick]:checked')].filter(input=>!input.disabled&&/^(?:0|[1-9]\d*)$/.test(input.value)).map(input=>s.parts[Number(input.value)]?.id).filter(id=>allowed.has(id)))];
 const value=picker.querySelector('[data-gm-kit-source]')?.value||'';state.sourceIndex=/^(?:0|[1-9]\d*)$/.test(value)&&gmPlanSavedKits(s,row)[Number(value)]?value:'';
}
function gmPlanPartsPickerHasPending(row){const state=row.partsPicker;if(!state||state.generatorId!==row.generatorId)return false;const existing=new Set(row.components.map(component=>component.partId));return state.sourceIndex!==''||state.selectedIds.some(id=>!existing.has(id));}
function gmPlanPartsMerge(row,components){
 const existing=new Set(row.components.map(component=>component.partId)),added=components.filter(component=>!existing.has(component.partId));
 if(row.components.length+added.length>1000)throw Error('В одном выполнении ТО не может быть больше 1 000 комплектующих.');
 row.components.push(...added.map(component=>({partId:component.partId,qtyText:component.qty===null?'':precisionFormat(component.qty)})));
 return {added:added.length,preserved:components.length-added.length};
}
function gmPlanPartsPickerBind(s,row,node){
 const picker=node.querySelector('[data-gm-parts-picker]');if(!picker)return;
 const edit=action=>gmPlanEditRows(s,()=>{if(s.readonly)throw Error('График доступен только для просмотра.');action(gmPlanPartsState(row));},[row]);
 picker.querySelectorAll('[data-gm-part-pick]').forEach(input=>input.addEventListener('change',()=>edit(()=>{})));
 picker.querySelector('[data-gm-kit-source]').addEventListener('change',()=>edit(()=>{}));
 picker.querySelector('[data-gm-parts-select-all]').onclick=()=>edit(state=>{const existing=new Set(row.components.map(component=>component.partId));state.selectedIds=gmPlanPartsChoices(s,row).filter(({part})=>!existing.has(part.id)).map(({part})=>part.id);state.open=true;state.message='Позиции отмечены. Нажмите «Добавить выбранные детали»; количества потребуется указать отдельно.';});
 picker.querySelector('[data-gm-parts-clear]').onclick=()=>edit(state=>{state.selectedIds=[];state.sourceIndex='';state.message='Выбор позиций и источника комплекта очищен. Состав комплекта не изменён.';});
 picker.querySelector('[data-gm-parts-add]').onclick=()=>edit(state=>{const selected=new Set(state.selectedIds),components=gmPlanPartsChoices(s,row).filter(({part})=>selected.has(part.id)).map(({part})=>({partId:part.id,qty:null}));if(!components.length)throw Error('Отметьте позиции личного склада для добавления.');const result=gmPlanPartsMerge(row,components);state.selectedIds=[];state.open=true;state.message='Добавлено позиций: '+result.added+'. Количество на одно ТО не задано: заполните его в комплекте. Существующие позиции и количества сохранены.';});
 picker.querySelector('[data-gm-kit-add]').onclick=()=>edit(state=>{const kits=gmPlanSavedKits(s,row),source=/^(?:0|[1-9]\d*)$/.test(state.sourceIndex)?kits[Number(state.sourceIndex)]:null;if(!source)throw Error('Выберите и проверьте сохранённый комплект этой ДЭС.');const result=gmPlanPartsMerge(row,source.components);state.sourceIndex='';state.open=true;state.message='Из выбранного комплекта добавлено позиций: '+result.added+'. Уже существовало и сохранено без изменений: '+result.preserved+'. Неизвестные количества остаются незаданными.';});
}
