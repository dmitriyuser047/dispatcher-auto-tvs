// Seasonal profiles are inert templates. Only a reviewed group transition adds
// ordinary dated norm periods; viewing either screen never changes facts.
const SEASONAL_FUEL_FIELDS = {
  vehicles:[['norm','Базовая, л/100 км'],['normCity','Город, л/100 км'],['normHighway','Трасса, л/100 км'],['normIdle','Холостой ход, л/ч']],
  generators:[['norm','Постоянная, л/ч'],['norm100','При 100% нагрузки, л/ч'],['norm50','При 50% нагрузки, л/ч'],['normIdle','Холостой ход, л/ч']]
};
let seasonalFuelDialogState=null,seasonalFuelReferenceSequence=0,seasonalFuelReferenceEpoch=null;
const seasonalFuelReferences=new Map(),seasonalFuelReferenceKeys=new Map();
function seasonalFuelClone(value){return JSON.parse(JSON.stringify(value));}
function seasonalFuelEsc(value){return htmlEsc(String(value??''));}
function seasonalFuelTitle(section){return section==='vehicles'?'Авто':'ДЭС';}
function seasonalFuelSeason(season){return season==='summer'?'Летние':'Зимние';}
function seasonalFuelApi(){if(typeof SeasonalFuel==='undefined'||SeasonalFuel.apiVersion!==1)throw Error('Модуль сезонных норм не загружен. Откройте программу заново.');return SeasonalFuel;}
function seasonalFuelToday(){return typeof platformSessionContext==='function'?platformSessionContext().today:dispatcherLocalDate();}
function seasonalFuelStamp(){return JSON.stringify([typeof wfCommandContextStamp==='function'?wfCommandContextStamp():dispatcherContext(),seasonalFuelCapability(),typeof _sync==='undefined'?null:_sync.platform?.negotiation?.writeCompatible??null]);}
function seasonalFuelReadable(section){return typeof _sync==='undefined'||!_sync.access||(_sync.access.readable||[]).some(name=>name==='*'||name===section);}
function seasonalFuelCapability(){
  if(typeof _sync==='undefined'||!_sync.platform?.negotiation)return typeof window.electronAPI?.getSettings!=='function'&&typeof window.electronAPI?.getDataCacheContext!=='function';
  return _sync.platform.negotiation.selectedProfile?.capabilities?.some(item=>item.name==='seasonalFuelNormsV1'&&item.version===1)===true;
}
function seasonalFuelWritable(section,field){
  if(typeof _loadWriteBlocked!=='undefined'&&_loadWriteBlocked||typeof _sync!=='undefined'&&(_sync.platform?.readOnly||_sync.platform?.needsSchemaUpgrade||_sync.platform?.negotiation&&_sync.platform.negotiation.writeCompatible!==true)||!seasonalFuelCapability())return false;
  if(typeof _sync==='undefined'||!_sync.access)return true;
  const access=_sync.access,fields=access.fieldPermissions;
  return (access.writable||[]).some(name=>name==='*'||name===section)&&(!fields||!Object.hasOwn(fields,section)||Array.isArray(fields[section])&&fields[section].includes(field));
}
function seasonalFuelWriteReason(section,field){
  if(!seasonalFuelCapability())return 'Для сезонных норм обновите сервер до совместимой версии.';
  return seasonalFuelWritable(section,field)?'':'Сезонные нормы доступны только для просмотра: изменение запрещено правами или состоянием подключения.';
}
function seasonalFuelActive(row){return !row.archived&&!row.deleted&&!row.cancelled&&row.status!=='cancelled';}
function seasonalFuelLabel(section,row){return section==='vehicles'?[row.plate,row.make].filter(Boolean).join(' · ')||'Авто '+String(row.id):row.name||row.code||'ДЭС '+String(row.id);}
function seasonalFuelSummary(section,parameters){return !parameters?'Не заданы':SEASONAL_FUEL_FIELDS[section].map(([field,label])=>label+': '+(parameters[field]==null?'Не задано':precisionFormat(parameters[field]))).join(' · ');}
function seasonalFuelWarning(item){return item?.code==='SEASON_LEGACY_BASELINE'?'Прежние нормы до выбранной даты сохраняются. Карточек: '+item.cards+'. Исторические периоды не заменяются новым сезоном.':item.message||item;}
function seasonalFuelWarningsHtml(warnings){
  const cards=warnings.filter(item=>item?.code==='SEASON_LEGACY_BASELINE').length;let shownBaseline=false;
  const shown=warnings.flatMap(item=>{if(item?.code!=='SEASON_LEGACY_BASELINE')return [item];if(shownBaseline)return [];shownBaseline=true;return [{...item,cards}];});
  return shown.length?'<ul>'+shown.map(item=>'<li data-sf-warning="'+seasonalFuelEsc(item.code||'warning')+'">'+seasonalFuelEsc(seasonalFuelWarning(item))+'</li>').join('')+'</ul>':'';
}
function seasonalFuelIssueAction(issue){
  if(issue.id===undefined||issue.id===null)return null;
  if(issue.code!=='SEASON_HISTORY_CHANGED')return {kind:'profile',label:'Настроить нормы'};
  const ref=issue.sourceRef,recordId=ref?.section==='genRecords'?ref.id:issue.recordId;
  return recordId!==undefined&&recordId!==null?{kind:'record',recordId,label:'Открыть запись ДЭС'}:{kind:'journal',label:'Открыть журнал ДЭС'};
}
function seasonalFuelOpenIssue(state,issue){
  seasonalFuelCurrent(state,false);const action=seasonalFuelIssueAction(issue);if(!action)return;
  if(action.kind==='profile'){seasonalFuelProfilesOpen(state.section,issue.id);return;}
  if(state.section!=='generators'||!seasonalFuelReadable('generators')||!seasonalFuelReadable('genRecords'))throw Error('Журнал этой ДЭС недоступен для вашей роли');
  if(JSON.stringify(data.genRecords||[])!==state.issueRecordsText)throw Error('Исходный журнал ДЭС изменился. Повторите проверку перед открытием записи.');
  const generators=(data.generators||[]).filter(row=>row.id===issue.id);if(generators.length!==1)throw Error('ДЭС не найдена или её ID неоднозначен');
  let record=null;
  if(action.kind==='record'){
    if(issue.sourceRef&&issue.sourceRef.section!=='genRecords')throw Error('Источник записи ДЭС не подтверждён');
    const records=(data.genRecords||[]).filter(row=>row.id===action.recordId);if(records.length!==1||records[0].generatorId!==issue.id||issue.date&&records[0].date!==issue.date)throw Error('Исходная запись ДЭС не найдена однозначно');record=records[0];
  }
  closeModal('wfModal');switchSection('generators');selectGenerator(issue.id);
  const date=record?.date||issue.date;if(/^\d{4}-\d{2}-\d{2}$/.test(date||''))selectGenMonth(Number(date.slice(0,4)),Number(date.slice(5,7)));
  if(record)openEditGenRecord(record.id);
}
function seasonalFuelRegister(section,id,action){
  const stamp=seasonalFuelStamp(),analysis=typeof dispatcherAnalysisStamp==='function'?dispatcherAnalysisStamp():null,epoch=seasonalFuelReferenceEpoch;
  if(!epoch||epoch.database!==data||epoch.stamp!==stamp||epoch.analysis!==analysis){seasonalFuelReferences.clear();seasonalFuelReferenceKeys.clear();seasonalFuelReferenceEpoch={database:data,stamp,analysis};}
  const identity=JSON.stringify([section,typeof id,id,action]);if(seasonalFuelReferenceKeys.has(identity))return seasonalFuelReferenceKeys.get(identity);
  const key=++seasonalFuelReferenceSequence;seasonalFuelReferences.set(key,{section,id,action,database:data,stamp,analysis});seasonalFuelReferenceKeys.set(identity,key);return key;
}
function seasonalFuelOpenReference(key){
  const ref=seasonalFuelReferences.get(key);
  if(!ref||ref.database!==data||ref.stamp!==seasonalFuelStamp()||ref.analysis!==(typeof dispatcherAnalysisStamp==='function'?dispatcherAnalysisStamp():null)){showToast('Данные или сеанс изменились. Откройте актуальный раздел перед выбором сезонных норм.');return;}
  if(ref.action==='profiles')seasonalFuelProfilesOpen(ref.section,ref.id);else seasonalFuelOpen(ref.section,ref.action);
}
function seasonalFuelCardButton(section,id){return '<button type="button" class="btn btn-ghost btn-sm" data-seasonal-card="'+seasonalFuelEsc(section)+'" onclick="seasonalFuelOpenReference('+seasonalFuelRegister(section,id,'profiles')+')">Летние и зимние нормы</button>';}
function seasonalFuelGroupStatus(section,date){
  const rows=(data[section]||[]).filter(seasonalFuelActive);if(!rows.length)return 'Нет доступной активной техники';
  const counts={summer:0,winter:0,custom:0,missing:0};
  for(const row of rows){try{const value=seasonalFuelApi().currentSeason(section,row,date);counts[value.status==='seasonal'?value.season:value.status==='missing'?'missing':'custom']++;}catch{counts.missing++;}}
  if(counts.summer===rows.length)return 'Летние нормы · '+rows.length;
  if(counts.winter===rows.length)return 'Зимние нормы · '+rows.length;
  if(counts.custom===rows.length)return 'Обычные нормы по карточкам и датам · '+rows.length;
  return 'Смешанные: '+[['summer','летние'],['winter','зимние'],['custom','обычные'],['missing','не заданы']].filter(([key])=>counts[key]).map(([key,label])=>label+' '+counts[key]).join(', ');
}
function seasonalFuelPanelHtml(){
  if(typeof SeasonalFuel==='undefined')return '';
  const date=seasonalFuelToday();
  return '<section class="seasonal-fuel-panel" data-seasonal-panel aria-label="Сезонные нормы топлива"><div class="seasonal-fuel-panel-heading"><strong>Сезонные нормы</strong><small>На '+seasonalFuelEsc(fmtDate(date))+' · авто и ДЭС переключаются отдельно</small></div>'+['vehicles','generators'].filter(seasonalFuelReadable).map(section=>'<div class="seasonal-fuel-group" data-seasonal-group="'+section+'"><strong>'+seasonalFuelTitle(section)+'</strong><span class="seasonal-fuel-current" data-seasonal-status="'+section+'">'+seasonalFuelEsc(seasonalFuelGroupStatus(section,date))+'</span><div class="seasonal-fuel-buttons">'+['summer','winter'].map(season=>'<button type="button" class="btn btn-ghost btn-sm" data-seasonal-switch="'+section+':'+season+'"'+(!seasonalFuelWritable(section,'fuelNorms')?' disabled title="'+seasonalFuelEsc(seasonalFuelWriteReason(section,'fuelNorms'))+'"':'')+' onclick="seasonalFuelOpenReference('+seasonalFuelRegister(section,null,season)+')">'+seasonalFuelSeason(season)+'</button>').join('')+'<button type="button" class="btn btn-ghost btn-sm" data-seasonal-configure="'+section+'" onclick="seasonalFuelOpenReference('+seasonalFuelRegister(section,null,'profiles')+')">Настроить нормы</button></div></div>').join('')+'<p>Переключение применяется с выбранной даты к доступным активным карточкам. Профили настраиваются отдельно; коэффициенты и зимняя наценка автоматически не назначаются.</p>'+(!seasonalFuelCapability()?'<p class="seasonal-fuel-warning">Для сезонных норм обновите сервер до совместимой версии.</p>':'')+'</section>';
}
function seasonalFuelState(section,mode,id){
  if(!['vehicles','generators'].includes(section)||!seasonalFuelReadable(section))throw Error('Нормы этой группы недоступны для вашей роли');seasonalFuelApi();
  return {section,mode,id,database:data,context:seasonalFuelStamp(),originalText:JSON.stringify(data[section]||[]),baselineText:JSON.stringify(platformSaveBaseline()[section]||[]),readonly:!seasonalFuelWritable(section,mode==='profile'?'fuelSeasons':'fuelNorms'),pending:false,reviewed:null,operationId:null,requestText:null};
}
function seasonalFuelCurrent(state,write=true,baseline=false){
  if(state!==seasonalFuelDialogState||!state.form?.isConnected||!document.getElementById('wfModal')?.classList.contains('open')||!document.getElementById('wfModal').contains(state.form))throw Error('Форма закрыта или заменена. Откройте сезонные нормы заново.');
  if(state.database!==data||state.context!==seasonalFuelStamp())throw Error('База, пользователь или права изменились. Откройте форму заново. Введённые значения остаются в форме.');
  if(JSON.stringify(data[state.section]||[])!==state.originalText)throw Error('Карточки группы уже изменились. Повторно откройте форму и проверьте актуальные нормы.');
  if(write&&!seasonalFuelWritable(state.section,state.mode==='profile'?'fuelSeasons':'fuelNorms'))throw Error(seasonalFuelWriteReason(state.section,state.mode==='profile'?'fuelSeasons':'fuelNorms'));
  if(baseline&&(JSON.stringify(platformSaveBaseline()[state.section]||[])!==state.baselineText||state.baselineText!==state.originalText))throw Error('Сначала сохраните или отмените другие изменения карточек этой группы.');
}
function seasonalFuelModal(state,title,body){
  wfShowDialog(title,body);const modal=document.getElementById('wfModal');modal.querySelector('.wf-modal').classList.add('seasonal-fuel-modal');state.form=modal.querySelector('form');seasonalFuelDialogState=state;
  state.form.querySelector('[data-sf-cancel]').onclick=()=>closeModal('wfModal');
  state.form.onsubmit=event=>event.preventDefault();return state.form;
}
function seasonalFuelError(state,error){wfShowCommandError(state.form?.querySelector('[data-sf-error]'),error);}
function seasonalFuelRaw(state){
  if(state.mode==='apply')return JSON.stringify({from:state.form.elements.from.value,basis:state.form.elements.basis.value.trim()});
  return JSON.stringify(['summer','winter'].map(season=>[season,state.form.elements[season+'Enabled'].checked,...SEASONAL_FUEL_FIELDS[state.section].map(([key])=>state.form.elements[season+'_'+key].value)]));
}
function seasonalFuelInvalidate(state){state.reviewed=null;const form=state.form;form.elements.confirm.checked=false;form.querySelector('[data-sf-preview]').hidden=true;form.querySelector('[data-sf-confirm]').hidden=true;form.querySelector('[data-sf-save]').disabled=true;}
function seasonalFuelBind(state){
  const form=state.form;form.querySelector('[data-sf-review]').onclick=()=>{if(state.pending)return;form.querySelector('[data-sf-error]').textContent='';try{seasonalFuelPreview(state);}catch(error){seasonalFuelError(state,error);}};
  form.querySelector('[data-sf-save]').onclick=()=>void seasonalFuelCommit(state);
  const changed=event=>{if(state.pending)return;if(event.target===form.elements.confirm){form.querySelector('[data-sf-save]').disabled=!state.reviewed||!form.elements.confirm.checked;return;}seasonalFuelInvalidate(state);};form.addEventListener('input',changed);form.addEventListener('change',changed);
}
function seasonalFuelFooter(readonly,mode='apply'){const confirmation=mode==='profile'?'Подтверждаю летний и зимний наборы; действующие нормы по датам не меняются':'Подтверждаю выбранную дату и нормы после просмотра изменений';return '<div data-sf-preview hidden></div>'+(readonly?'':'<label class="seasonal-fuel-confirm" data-sf-confirm hidden><input type="checkbox" name="confirm"> '+confirmation+'</label>')+'<p class="seasonal-fuel-error" role="alert" data-sf-error></p><p role="status" data-sf-status></p><div class="seasonal-fuel-actions"><button type="button" class="btn btn-ghost" data-sf-cancel>Закрыть</button>'+(readonly?'':'<button type="button" class="btn btn-ghost" data-sf-review>Проверить изменения</button><button type="button" class="btn btn-primary" data-sf-save disabled>Подтвердить сохранение</button>')+'</div>';
}
function seasonalFuelOpen(section,season){
  try{
    if(!['summer','winter'].includes(season))throw Error('Выберите летние или зимние нормы');
    const state=seasonalFuelState(section,'apply');if(state.readonly)throw Error(seasonalFuelWriteReason(section,'fuelNorms'));state.season=season;
    const count=(data[section]||[]).filter(seasonalFuelActive).length;
    const form=seasonalFuelModal(state,seasonalFuelTitle(section)+' · '+seasonalFuelSeason(season).toLowerCase()+' нормы','<form class="seasonal-fuel-form" id="seasonalFuelApplyForm"><p>Переключение только группы «'+seasonalFuelTitle(section)+'»: '+count+' доступных активных карточек. Другая группа, пробег, моточасы, заправки и замеры не изменяются. Расход и нормы, уже записанные в журнале, сохраняются. Новые значения используются там, где расход рассчитывается по нормам карточки.</p><div class="seasonal-fuel-inputs"><label>Применять с даты<input type="date" name="from" value="'+seasonalFuelEsc(seasonalFuelToday())+'" required></label><label>Основание / документ<textarea name="basis" rows="2" maxlength="2000" required></textarea></label></div><p>Прежние нормы до выбранной даты сохраняются. Если уже задан следующий период, сезон будет действовать до него. Сначала проверьте список, затем подтвердите одно сохранение группы.</p>'+seasonalFuelFooter(false)+'</form>');
    seasonalFuelBind(state);form.elements.from.focus();
  }catch(error){showToast(error.message);}
}
function seasonalFuelProfilesOpen(section,id){
  try{
    if(id===undefined||id===null){seasonalFuelProfilesList(section);return;}
    const state=seasonalFuelState(section,'profile',id),matches=(data[section]||[]).filter(row=>row.id===id);if(matches.length!==1)throw Error('Карточка не найдена или её ID неоднозначен');state.asset=seasonalFuelClone(matches[0]);
    let profiles,invalidProfile=false;try{profiles=seasonalFuelApi().validateProfiles(section,state.asset)||{version:1,summer:null,winter:null};}catch{profiles={version:1,summer:null,winter:null};invalidProfile=true;}
    const form=seasonalFuelModal(state,seasonalFuelTitle(section)+' · летние и зимние нормы · '+seasonalFuelLabel(section,state.asset),'<form class="seasonal-fuel-form" id="seasonalFuelProfileForm"><p>Это два отдельных набора для последующего переключения группы. Сохранение профилей не меняет действующие нормы по датам и прошлые расчёты. Пустое поле означает «не задано», 0 — известный ноль.</p>'+(invalidProfile?'<p class="seasonal-fuel-warning">Сохранённый профиль некорректен. Заполните наборы заново или явно подтвердите их очистку; прежние данные не изменены.</p>':'')+(section==='generators'?'<p>Мощность ДЭС не является сезонной. При переключении сохраняется мощность, действующая на выбранную дату.</p>':'')+(state.readonly?'<p class="seasonal-fuel-warning">'+seasonalFuelEsc(seasonalFuelWriteReason(section,'fuelSeasons'))+'</p>':'')+'<div class="seasonal-fuel-profile-grid">'+['summer','winter'].map(season=>'<fieldset data-sf-season="'+season+'"><legend>'+seasonalFuelSeason(season)+' нормы</legend><label class="seasonal-fuel-enabled"><input type="checkbox" name="'+season+'Enabled"'+(profiles[season]?' checked':'')+(state.readonly?' disabled':'')+'> Набор настроен</label>'+SEASONAL_FUEL_FIELDS[section].map(([field,label])=>'<label>'+seasonalFuelEsc(label)+'<input name="'+season+'_'+field+'" inputmode="decimal" placeholder="Не задано" value="'+seasonalFuelEsc(profiles[season]?.[field]==null?'':precisionFormat(profiles[season][field]))+'"'+(state.readonly?' readonly':'')+'></label>').join('')+'</fieldset>').join('')+'</div>'+seasonalFuelFooter(state.readonly,'profile')+'</form>');
    if(!state.readonly){seasonalFuelBind(state);for(const season of ['summer','winter'])form.querySelector('[data-sf-season="'+season+'"]').addEventListener('input',event=>{if(event.target.name!==season+'Enabled')form.elements[season+'Enabled'].checked=true;});}
  }catch(error){showToast(error.message);}
}
function seasonalFuelProfilesList(section){
  if(!['vehicles','generators'].includes(section)||!seasonalFuelReadable(section)){showToast('Нормы этой группы недоступны');return;}
  const stamp=seasonalFuelStamp(),database=data,rows=data[section]||[],originalText=JSON.stringify(rows);
  wfShowDialog(seasonalFuelTitle(section)+' · настройка сезонных норм','<div class="seasonal-fuel-list"><p>Откройте карточку и заполните оба набора вручную. Значения одного сезона не копируются в другой, зимняя надбавка не рассчитывается. Архивные карточки не участвуют в общем переключении.</p><div class="seasonal-fuel-scroll"><table class="tbl"><thead><tr><th>Техника</th><th>Летние</th><th>Зимние</th><th>Настройка</th></tr></thead><tbody>'+rows.map((row,index)=>{let profiles,invalid=false;try{profiles=seasonalFuelApi().validateProfiles(section,row);}catch{invalid=true;}return '<tr data-seasonal-profile-id="'+seasonalFuelEsc(JSON.stringify([typeof row.id,row.id]))+'"><th>'+seasonalFuelEsc(seasonalFuelLabel(section,row))+(seasonalFuelActive(row)?'':'<small>Архив / не участвует в переключении</small>')+'</th><td>'+seasonalFuelEsc(invalid?'Проверьте профиль':seasonalFuelSummary(section,profiles?.summer))+'</td><td>'+seasonalFuelEsc(invalid?'Проверьте профиль':seasonalFuelSummary(section,profiles?.winter))+'</td><td><button type="button" class="btn btn-ghost btn-sm" data-sf-edit-index="'+index+'">Открыть нормы</button></td></tr>';}).join('')+'</tbody></table></div>'+(rows.length?'':'<p>Доступных карточек нет.</p>')+'</div>');
  const modal=document.getElementById('wfModal');modal.querySelector('.wf-modal').classList.add('seasonal-fuel-modal');modal.querySelectorAll('[data-sf-edit-index]').forEach(button=>{const row=rows[Number(button.dataset.sfEditIndex)];button.onclick=()=>{if(database!==data||stamp!==seasonalFuelStamp()||JSON.stringify(data[section]||[])!==originalText||!modal.classList.contains('open')||!modal.isConnected){showToast('Данные или сеанс изменились. Откройте список заново.');return;}seasonalFuelProfilesOpen(section,row.id);};});
}
function seasonalFuelPrepare(state){
  const raw=seasonalFuelRaw(state);if(state.requestText!==raw){state.requestText=raw;state.operationId=wfId('seasonal-fuel');}
  if(state.mode==='apply')return seasonalFuelApi().prepare(data,{section:state.section,season:state.season,from:state.form.elements.from.value,basis:state.form.elements.basis.value.trim(),operationId:state.operationId});
  const profiles={version:1};for(const season of ['summer','winter'])profiles[season]=state.form.elements[season+'Enabled'].checked?Object.fromEntries(SEASONAL_FUEL_FIELDS[state.section].map(([field])=>[field,precisionInput(state.form.elements[season+'_'+field],{scale:6,blank:'null'})])):null;
  return {canApply:true,profiles:seasonalFuelApi().validateProfiles(state.section,{...state.asset,fuelSeasons:profiles})};
}
function seasonalFuelPreview(state){
  seasonalFuelCurrent(state,true,true);const prepared=seasonalFuelPrepare(state),box=state.form.querySelector('[data-sf-preview]');state.reviewed=null;state.form.elements.confirm.checked=false;state.form.querySelector('[data-sf-save]').disabled=true;
  if(state.mode==='profile')box.innerHTML='<h4>Будут сохранены только профили</h4>'+['summer','winter'].map(season=>'<p><strong>'+seasonalFuelSeason(season)+': </strong>'+seasonalFuelEsc(seasonalFuelSummary(state.section,prepared.profiles[season]))+'</p>').join('')+'<p>Действующие периоды норм останутся прежними. Для применения используйте отдельную кнопку сезона в ГСМ.</p>';
  else{
    const rows=prepared.changes||[],issues=prepared.issues||[],warnings=prepared.warnings||[];
    state.issueRecordsText=JSON.stringify(data.genRecords||[]);
    box.innerHTML='<h4>'+seasonalFuelTitle(state.section)+': '+seasonalFuelSeason(state.season).toLowerCase()+' нормы с '+seasonalFuelEsc(fmtDate(state.form.elements.from.value))+'</h4><p>Доступных активных карточек: '+(prepared.counts?.active??0)+'. Изменений: '+(prepared.counts?.changed??rows.length)+'. Без изменений: '+(prepared.counts?.unchanged??0)+'.</p>'+((prepared.counts?.excluded??0)?'<p>Не участвуют в переключении: '+prepared.counts.excluded+'.</p>':'')+(issues.length?'<ul class="seasonal-fuel-issues">'+issues.map((issue,index)=>'<li>'+seasonalFuelEsc(issue.message)+' '+(seasonalFuelIssueAction(issue)?'<button type="button" class="btn btn-ghost btn-sm" data-sf-issue="'+index+'" data-sf-issue-kind="'+seasonalFuelIssueAction(issue).kind+'">'+seasonalFuelIssueAction(issue).label+'</button>':'')+'</li>').join('')+'</ul>':'')+seasonalFuelWarningsHtml(warnings)+(rows.length?'<div class="seasonal-fuel-scroll"><table class="tbl"><thead><tr><th>Техника</th><th>До переключения</th><th>Новые нормы</th><th>Действуют</th></tr></thead><tbody>'+rows.map(change=>'<tr data-sf-change-id="'+seasonalFuelEsc(JSON.stringify([typeof change.id,change.id]))+'"><th>'+seasonalFuelEsc(change.label||String(change.id))+'</th><td>'+seasonalFuelEsc(seasonalFuelSummary(state.section,change.parametersBefore))+'</td><td>'+seasonalFuelEsc(seasonalFuelSummary(state.section,change.parametersAfter))+'</td><td>С '+seasonalFuelEsc(fmtDate(state.form.elements.from.value))+(change.toExclusive?' до '+seasonalFuelEsc(fmtDate(effectiveParametersBefore(change.toExclusive))):' · без окончания')+(change.baselineAdded?'<small>Прежние нормы до выбранной даты сохраняются</small>':'')+'</td></tr>').join('')+'</tbody></table></div>':'');
    box.querySelectorAll('[data-sf-issue]').forEach(button=>{const issue=issues[Number(button.dataset.sfIssue)];button.onclick=()=>{try{seasonalFuelOpenIssue(state,issue);}catch(error){seasonalFuelError(state,error);}};});
    if(prepared.canApply&&rows.length===0)box.insertAdjacentHTML('beforeend','<p>На выбранную дату эти сезонные нормы уже установлены. Новое сохранение не требуется.</p>');
  }
  box.hidden=false;const canApply=prepared.canApply===true&&(state.mode==='profile'||prepared.changes?.length>0);state.form.querySelector('[data-sf-confirm]').hidden=!canApply;
  if(canApply)state.reviewed={raw:seasonalFuelRaw(state),text:JSON.stringify(prepared)};
}
async function seasonalFuelCommit(state){
  if(state.pending||state.readonly)return;let saved=false,unlock;const form=state.form;form.querySelector('[data-sf-error]').textContent='';
  try{
    seasonalFuelCurrent(state,true,true);if(!state.reviewed||state.reviewed.raw!==seasonalFuelRaw(state)||!form.elements.confirm.checked)throw Error('Проверьте изменения и подтвердите нормы после предпросмотра');
    const prepared=seasonalFuelPrepare(state);if(JSON.stringify(prepared)!==state.reviewed.text||prepared.canApply!==true)throw Error('Предпросмотр изменился. Проверьте нормы повторно');
    if(typeof _pendingSaveOperations!=='undefined'&&_pendingSaveOperations.size)throw Error('Дождитесь завершения текущего сохранения');
    const next=seasonalFuelClone(platformSaveBaseline()),changes=state.mode==='profile'?[{id:state.id}]:prepared.changes;
    for(const change of changes){const matches=(next[state.section]||[]).filter(row=>row.id===change.id);if(matches.length!==1)throw Error('Карточка не найдена однозначно');if(state.mode==='profile')matches[0].fuelSeasons=seasonalFuelClone(prepared.profiles);else matches[0].fuelNorms=seasonalFuelClone(change.after);}
    const auditBefore=JSON.stringify(data.auditLog||[]);state.pending=true;unlock=wfLockCommandForm(form);form.querySelector('[data-sf-save]').disabled=true;form.querySelector('[data-sf-review]').disabled=true;form.querySelector('[data-sf-status]').textContent='Ожидается подтверждение одного сохранения группы…';
    saved=await saveData(next,{noMerge:true,requiredCanonicalSections:[state.section],operation:{id:state.operationId},history:{action:state.mode==='profile'?'Сезонные профили норм':seasonalFuelTitle(state.section)+' · '+seasonalFuelSeason(state.season).toLowerCase()+' нормы',reason:state.mode==='profile'?'Явная настройка летних и зимних профилей без изменения действующих периодов':state.form.elements.from.value+': '+state.form.elements.basis.value.trim()}});
    if(saved!==true){const detail=typeof platformRuntimeStatus==='function'?platformRuntimeStatus().lastError?.message:'';throw Error((detail?detail+'. ':'')+'Сохранение не подтверждено. Введённые значения остаются в форме. Повтор неизменённой формы использует ту же операцию.');}
    seasonalFuelCurrent(state,false);if(state.reviewed.raw!==seasonalFuelRaw(state))throw Error('Форма изменилась в ожидании ответа');
    const canonical=next[state.section];if(!Array.isArray(canonical)||canonical.length!==(data[state.section]||[]).length)throw Error('Сервер не вернул полный подтверждённый раздел');
    for(const change of changes){const matches=canonical.filter(row=>row.id===change.id);if(matches.length!==1)throw Error('Сервер не вернул сохранённую карточку');if(state.mode==='profile')seasonalFuelApi().validateProfiles(state.section,matches[0]);else EffectivePeriods.validate(state.section,matches[0],'fuelNorms');}
    data[state.section]=seasonalFuelClone(canonical);if(JSON.stringify(data.auditLog||[])===auditBefore)data.auditLog=seasonalFuelClone(next.auditLog||[]);rebuildIndex();closeModal('wfModal');if(typeof syncRefreshView==='function')syncRefreshView([state.section]);if(typeof activeSection!=='undefined'&&activeSection==='fuelPurchases')renderFuelPurchases();showToast(state.mode==='profile'?'Профили сохранены. Действующие нормы не изменены.':'Сезонные нормы сохранены с выбранной даты.');
  }catch(error){seasonalFuelError(state,saved?Error('Сервер подтвердил сохранение, но форма, карточки или сеанс изменились. Проверьте исходную базу перед повтором. '+error.message):error);}
  finally{state.pending=false;if(unlock)unlock();form.querySelector('[data-sf-status]').textContent='';form.querySelector('[data-sf-save]').disabled=!state.reviewed||!form.elements.confirm.checked;form.querySelector('[data-sf-review]').disabled=false;}
}
