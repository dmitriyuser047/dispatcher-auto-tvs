// Catalog merge is a reviewed command. Historical facts never move implicitly.
const CATALOG_MERGE_SECTIONS=['vehicles','generators','tanks','drivers','parts','contragents','fuelCards'];
let catalogMergeSession=null;
function catalogMergeToday(){return BusinessCalendar.resolve(data,new Date().toISOString()).today;}
function catalogMergeContext(){return platformSessionContext();}
function catalogMergeReadable(context=catalogMergeContext()){
 if(Array.isArray(context.readable)&&!context.readable.includes('*')&&!PlatformSchema.sections.every(name=>context.readable.includes(name)))return false;
 const policy=context.accessPolicy;if(!policy)return true;
 const allows=(values,action)=>values===undefined||Array.isArray(values)&&(values.includes('*')||values.includes(action));
 // A catalog review inventories the complete database. An owned subset or
 // hidden business fields cannot produce that global review in the browser.
 return Array.isArray(policy.grants)&&policy.grants.some(grant=>grant.org?.any===true&&grant.site?.any===true&&allows(grant.actions,'read'))&&PlatformSchema.sections.every(name=>{
  const rule=policy.sections?.[name],fields=rule?.readFields,ceiling=context.readFields?.[name];
  return allows(rule?.actions,'read')&&(fields===undefined||Array.isArray(fields)&&fields.includes('*'))&&(ceiling===undefined||Array.isArray(ceiling)&&ceiling.includes('*'));
 });
}
function catalogMergeWritable(names,context=catalogMergeContext()){
 return !context.blocked&&context.actor?.role==='admin'&&(!Array.isArray(context.writable)||context.writable.includes('*')||(names.length?names.every(name=>context.writable.includes(name)):CATALOG_MERGE_SECTIONS.some(name=>context.writable.includes(name))));
}
function catalogMergeFieldWritable(section,field){
 const permissions=catalogMergeContext().fieldPermissions;if(!permissions||!Object.hasOwn(permissions,section))return true;
 const fields=permissions[section];return Array.isArray(fields)&&(fields.includes('*')||fields.includes(field)||fields.includes(field.split(/[.[]/,1)[0]));
}
function catalogMergeLabel(section,row){
 return section==='vehicles'?[row.plate,row.make].filter(Boolean).join(' · '):section==='fuelCards'?[row.number,row.provider].filter(Boolean).join(' · '):row.name||row.title||row.code||'Без названия';
}
function catalogMergeSectionLabel(section){return PlatformSchema.descriptors?.[section]?.label||section;}
function catalogMergeIdLabel(id){return id==null||id===''?'Без устойчивого ID':(typeof id==='number'?'число ':'строка ')+JSON.stringify(id);}
function catalogMergeSourceStamp(){return JSON.stringify(PlatformSchema.sections.map(name=>[name,data[name]||[]]));}
function catalogMergeAssert(state){
 if(catalogMergeSession!==state||!state.form?.isConnected||document.getElementById('catalogMergeForm')!==state.form||!state.form.closest('#wfModal')?.classList.contains('open'))throw Error('Форма объединения закрыта или заменена. Откройте новый предпросмотр перед сохранением.');
 if(state.context!==wfCommandContextStamp()||state.database!==data||state.today!==catalogMergeToday())throw Error('База, пользователь, права или дата изменились. Откройте объединение заново; ввод остаётся в форме.');
 if(!catalogMergeReadable())throw Error('Для проверки объединения требуется доступ ко всем разделам базы. Обратитесь к администратору.');
 if(state.source!==catalogMergeSourceStamp())throw Error('Исходные данные изменились. Откройте объединение заново и повторно проверьте все связи. Ввод остаётся в форме.');
}
function catalogMergeAliasHtml(section,row){
 const alias=row?.mergedInto;if(!alias||alias.version!==1||alias.section!==section)return '';
 const context=catalogMergeContext();if(Array.isArray(context.readable)&&!context.readable.includes('*')&&!context.readable.includes(section))return '';
 const targets=(data[section]||[]).filter(item=>item.id===alias.id),label=targets.length===1?catalogMergeLabel(section,targets[0]):'Основная карточка';
 return '<p class="wf-note" data-catalog-alias>Архивная ссылка → '+htmlEsc(label)+' · '+htmlEsc(catalogMergeIdLabel(alias.id))+'. Исторические записи остаются у этой карточки.</p>';
}
function catalogMergeInvalidate(state,clearRefs=false){
 state.preview=null;state.form.elements.confirm.checked=false;state.form.querySelector('[data-cm-save]').disabled=true;
 state.form.querySelector('[data-cm-confirm]').hidden=true;
 if(clearRefs){state.selected=[];state.form.querySelector('[data-cm-review]').replaceChildren();}
}
function catalogMergeOptions(state,sourceId){
 const section=state.form.elements.section.value,rows=data[section]||[];
 state.choices=rows.map((row,index)=>({token:'entity-'+index,id:row.id,row}));
 const options='<option value="">Выберите карточку</option>'+state.choices.map(choice=>'<option value="'+choice.token+'">'+htmlEsc(catalogMergeLabel(section,choice.row)+' · '+catalogMergeIdLabel(choice.id)+(choice.row.mergedInto?' · архивная ссылка → '+catalogMergeIdLabel(choice.row.mergedInto.id):choice.row.archived?' · архив':''))+'</option>').join('');
 state.form.elements.source.innerHTML=options;state.form.elements.target.innerHTML=options;
 if(sourceId!==undefined){const matches=state.choices.filter(choice=>choice.id===sourceId);if(matches.length===1)state.form.elements.source.value=matches[0].token;}
 catalogMergeInvalidate(state,true);
}
function catalogMergeInput(state){
 const choice=name=>{const item=state.choices.find(row=>row.token===state.form.elements[name].value);if(!item)throw Error('Выберите обе карточки');return item;};
 const source=choice('source'),target=choice('target'),reason=state.form.elements.reason.value.trim();
 if(!reason)throw Error('Укажите основание объединения');
 return {section:state.form.elements.section.value,sourceId:source.id,targetId:target.id,reason,mutableRefs:state.selected.map(ref=>({...ref}))};
}
function catalogMergeReview(state){
 catalogMergeAssert(state);const input=catalogMergeInput(state);
 const context={today:state.today},readable=catalogMergeContext().readable;if(Array.isArray(readable))context.readable=readable;
 const preview=MergeCatalog.preview(data,input,context);
 const host=state.form.querySelector('[data-cm-review]');host.replaceChildren();
 const summary=document.createElement('div');summary.className='wf-note';summary.innerHTML='<h4>Архивная ссылка → основная карточка</h4><p>'+htmlEsc(preview.source.label)+' → '+htmlEsc(preview.target.label)+'</p><p>Проверка на '+htmlEsc(fmtDate(state.today))+'. Исходная карточка останется в архиве со ссылкой на основную. Остатки, начальные значения, нормы и реквизиты основной карточки не складываются и не заменяются. Исторические документы сохраняют прежние ID и тексты.</p><p>Новые операции оформляйте на основную карточку. Невыбранные связи останутся у дубля; будущие назначения при необходимости переназначьте отдельно.</p><p>Связей: '+preview.references.length+'. Отмечаются только разрешённые изменяемые связи; по умолчанию ни одна не выбрана.</p>';host.append(summary);
 if(preview.blockers.length){const box=document.createElement('div');box.className='wf-note';box.dataset.cmBlockers='';box.setAttribute('role','alert');box.innerHTML='<h4>Что мешает объединению</h4><ul>'+preview.blockers.map(issue=>'<li>'+htmlEsc(issue.message||issue.code)+'</li>').join('')+'</ul>';host.append(box);}
 if(preview.warnings.length){const grouped=new Map();for(const issue of preview.warnings){const message=typeof issue==='string'?issue:issue.message||issue.code;grouped.set(message,(grouped.get(message)||0)+1);}const box=document.createElement('div');box.className='wf-note';box.innerHTML='<h4>Проверьте</h4><ul>'+[...grouped].map(([message,count])=>'<li>'+htmlEsc(message)+(count>1?' ('+count+' связей)':'')+'</li>').join('')+'</ul>';host.append(box);}
 const table=document.createElement('table');table.className='tbl';table.style.minWidth='680px';table.innerHTML='<thead><tr><th>Выбор</th><th>Раздел / запись</th><th>Поле</th><th>Тип связи</th><th>Причина</th></tr></thead><tbody></tbody>';
 const labels={mutable:'Можно перенести',pinned:'Закреплена за источником',advisory:'Информационная',historical:'Историческая'};
 preview.references.forEach((ref,index)=>{
  const sourceRef=ref.target?.section===input.section&&ref.target.id===input.sourceId,eligible=sourceRef&&ref.mutable&&ref.classification==='mutable';
  const selected=state.selected.some(item=>item.relationId===ref.relationId&&item.rowId===ref.rowId&&item.path===ref.path),row=document.createElement('tr');row.dataset.cmRef=String(index);
  row.innerHTML='<td><input type="checkbox" data-cm-select="'+index+'" aria-label="Перенести связь '+htmlEsc(catalogMergeSectionLabel(ref.section)+' '+catalogMergeIdLabel(ref.rowId)+' '+ref.path)+'" '+(selected?'checked ':'')+(!eligible?'disabled':'')+'></td><td>'+htmlEsc(catalogMergeSectionLabel(ref.section))+'<br><small>'+htmlEsc(catalogMergeIdLabel(ref.rowId))+'</small></td><td>'+htmlEsc(ref.path||ref.field)+'<br><small>'+htmlEsc(sourceRef?'Ссылается на дубль':'Связь основной карточки / неоднозначная ссылка')+'</small></td><td>'+htmlEsc(labels[ref.classification]||ref.classification)+'</td><td>'+htmlEsc(!sourceRef&&ref.target?'Связь основной карточки сохраняется без изменений':ref.reason||'')+'</td>';
  row.querySelector('input').onchange=event=>{
   if(state.pending||!eligible)return;
   const key={relationId:ref.relationId,rowId:ref.rowId,path:ref.path};state.selected=state.selected.filter(item=>!(item.relationId===key.relationId&&item.rowId===key.rowId&&item.path===key.path));if(event.target.checked)state.selected.push(key);
   try{catalogMergeReview(state);}catch(error){catalogMergeInvalidate(state);wfShowCommandError(state.form.querySelector('[data-cm-error]'),error);}
  };table.querySelector('tbody').append(row);
 });
 const scroll=document.createElement('div');scroll.style.overflowX='auto';scroll.append(table);host.append(scroll);
 if(!preview.references.length){const empty=document.createElement('p');empty.textContent='Связей с исходной карточкой не найдено.';host.append(empty);}
 const writable=catalogMergeWritable(preview.writeSections||[input.section])&&['archived','archivedAt','mergedInto'].every(field=>catalogMergeFieldWritable(input.section,field))&&preview.references.filter(ref=>state.selected.some(item=>item.relationId===ref.relationId&&item.rowId===ref.rowId&&item.path===ref.path)).every(ref=>catalogMergeFieldWritable(ref.section,ref.field||ref.path));
 if(!writable){const note=document.createElement('p');note.textContent='Объединение недоступно: нет права изменения одного из затронутых разделов.';host.append(note);}
 state.preview={input:JSON.stringify(input),fingerprint:preview.fingerprint,canMerge:preview.canMerge&&writable};state.form.elements.confirm.checked=false;
 state.form.querySelector('[data-cm-confirm]').hidden=false;state.form.querySelector('[data-cm-save]').disabled=true;
}
async function catalogMergeCommit(state){
 if(state.pending)return;const errorNode=state.form.querySelector('[data-cm-error]');errorNode.textContent='';let unlock;
 try{
  catalogMergeAssert(state);const input=catalogMergeInput(state);
  if(!state.preview?.canMerge||state.preview.input!==JSON.stringify(input)||!state.form.elements.confirm.checked)throw Error('Проверьте актуальный предпросмотр, устраните ограничения и подтвердите объединение');
  const command={type:'MergeCatalog',version:1,input:{...input,reviewFingerprint:state.preview.fingerprint}},text=JSON.stringify(command);
  if(state.commandText!==text){state.commandText=text;state.operationId=wfId('catalog-merge');}
  state.pending=true;unlock=wfLockCommandForm(state.form);state.form.querySelector('[data-cm-status]').textContent='Ожидается подтверждение основной базы…';
  const result=await platformExecuteCommand(command,{operationId:state.operationId});
  if(state.context!==wfCommandContextStamp()||state.database!==data)throw Error('База, пользователь или права изменились. Проверьте результат в исходной базе; ввод остаётся в форме.');
  if(result?.ok!==true)throw Object.assign(Error(String(result?.message||result?.error||'Объединение не подтверждено')+(result?.committed&&result?.needsReload?' Операция сохранена, но требуется загрузить подтверждённые данные.':'')),{unknown:!!result?.unknown});
  if(document.getElementById('catalogMergeForm')===state.form)closeModal('wfModal');catalogMergeSession=null;
  if(typeof renderContragentsSection==='function'&&typeof activeSection!=='undefined'&&activeSection==='contragents')renderContragentsSection();
  if(typeof renderPersonnelSection==='function'&&typeof activeSection!=='undefined'&&['drivers','operators'].includes(activeSection))renderPersonnelSection();
  showToast('Карточки объединены. Исходная карточка сохранена как архивная ссылка.');
 }catch(error){wfShowCommandError(errorNode,error);state.form.querySelector('[data-cm-status]').textContent=error.unknown?'Результат не подтверждён. Проверьте очередь операций; повтор использует тот же запрос.':'Введённые значения сохранены в форме.';}
 finally{state.pending=false;unlock?.();}
}
function catalogMergeOpen(section='vehicles',id){
 try{
  if(catalogMergeSession?.pending)throw Error('Дождитесь подтверждения текущего объединения');
  if(typeof MergeCatalog==='undefined'||typeof MergeCatalog.preview!=='function'||typeof EntityIdentity==='undefined')throw Error('Не загружены правила объединения справочников. Обновите основную программу.');
  if(!catalogMergeReadable())throw Error('Для проверки объединения требуется доступ ко всем разделам базы. Скрытые данные не будут показаны. Обратитесь к администратору.');
  if(!CATALOG_MERGE_SECTIONS.includes(section))section='vehicles';
  wfShowDialog('Объединение карточек справочника','<form id="catalogMergeForm" class="wf-form"><p class="wf-wide wf-note">Выберите дубль и основную карточку. Сначала проверьте все связи. Объединение не удаляет историю и не переносит остатки.</p><label class="wf-wide"><span>Справочник</span><select name="section">'+CATALOG_MERGE_SECTIONS.map(name=>'<option value="'+name+'" '+(name===section?'selected':'')+'>'+htmlEsc(catalogMergeSectionLabel(name))+'</option>').join('')+'</select></label><label><span>Дубль → архивная ссылка</span><select name="source"></select></label><label><span>Основная карточка</span><select name="target"></select></label><label class="wf-wide"><span>Основание *</span><textarea name="reason" maxlength="2000" required></textarea></label><div class="wf-wide wf-actions"><button type="button" class="btn btn-ghost" data-cm-preview>Проверить все связи</button></div><div class="wf-wide" data-cm-review></div><label class="wf-wide" data-cm-confirm hidden><span><input type="checkbox" name="confirm"> Подтверждаю архивную ссылку и только отмеченные переносы связей</span></label><p class="wf-wide wf-note" role="status" data-cm-status></p><div class="wf-wide wf-note" role="alert" data-cm-error></div><div class="wf-wide wf-actions"><button type="button" class="btn btn-ghost" data-cm-cancel>Закрыть</button><button type="submit" class="btn btn-primary" data-cm-save disabled>Подтвердить объединение</button></div></form>');
  const form=document.getElementById('catalogMergeForm'),state=catalogMergeSession={form,context:wfCommandContextStamp(),database:data,source:catalogMergeSourceStamp(),today:catalogMergeToday(),selected:[],preview:null,pending:false};
  form.style.minWidth='0';form.style.overflowWrap='anywhere';for(const element of form.children)element.style.minWidth='0';form.querySelectorAll('select,textarea').forEach(element=>{element.style.minWidth='0';element.style.width='100%';});form.querySelectorAll('.wf-actions').forEach(element=>element.style.flexWrap='wrap');catalogMergeOptions(state,id);
  form.closest('.modal-overlay').querySelector('.modal-header button').onclick=()=>{if(!state.pending){catalogMergeSession=null;closeModal('wfModal');}};
  form.elements.section.onchange=()=>{if(!state.pending)catalogMergeOptions(state);};
  for(const field of ['source','target'])form.elements[field].onchange=()=>{if(!state.pending)catalogMergeInvalidate(state,true);};
  form.elements.reason.oninput=()=>{if(!state.pending)catalogMergeInvalidate(state);};
  form.elements.confirm.onchange=()=>{form.querySelector('[data-cm-save]').disabled=!state.preview?.canMerge||!form.elements.confirm.checked;};
  form.querySelector('[data-cm-preview]').onclick=()=>{if(state.pending)return;form.querySelector('[data-cm-error]').textContent='';try{catalogMergeReview(state);}catch(error){catalogMergeInvalidate(state);wfShowCommandError(form.querySelector('[data-cm-error]'),error);}};
  form.querySelector('[data-cm-cancel]').onclick=()=>{if(!state.pending){catalogMergeSession=null;closeModal('wfModal');}};
  form.onsubmit=event=>{event.preventDefault();void catalogMergeCommit(state);};
 }catch(error){showToast(error.message);}
}
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&catalogMergeSession?.pending&&document.getElementById('wfModal')?.classList.contains('open')){event.preventDefault();event.stopImmediatePropagation();}},true);
