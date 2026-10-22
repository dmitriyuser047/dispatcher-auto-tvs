// Editing policies changes network accounts only. The local database owner
// retains the administrative recovery path on the server computer.
let _accessPolicyEditor=null;
const ACP_ACTION_LABELS={read:'Чтение',create:'Добавление',update:'Изменение',delete:'Удаление',
 'document:saveDraft':'Сохранение черновика','document:postDraft':'Проведение черновика','document:discardDraft':'Отмена черновика','document:post':'Проведение документа','document:void':'Аннулирование','document:reverse':'Сторно','document:settle':'Урегулирование',
 'fuel:issue':'Выдача топлива','fuel:measure':'Замер топлива','fuel:applyDifference':'Разбор разницы замера','fuel:voidMeasurement':'Отмена замера','fuel:reverseLegacyTransfer':'Сторно старой передачи',
 'procurement:saveOrder':'Заказ поставщику','procurement:activateLegacy':'Подтверждение старого заказа','procurement:cancelRemaining':'Отмена остатка заказа','procurement:supplierReturn':'Возврат поставщику',
 'cost:savePolicy':'Правила стоимости','cost:saveAllocation':'Распределение стоимости','repair:saveOrder':'Заказ на ремонт','repair:approve':'Согласование ремонта','repair:start':'Начало ремонта','repair:cancel':'Отмена ремонта',
 'calendar:configure':'Учётный календарь','calendar:confirmInterval':'Подтверждение времени','period:close':'Закрытие месяца','period:reopen':'Открытие месяца','shift:accept':'Приём смены','assignment:save':'Назначение сотрудника','catalog:merge':'Объединение справочника','print:capture':'Фиксация печатной формы','print:export':'Выгрузка печатной формы'};
const ACP_FIELDS={id:'Идентификатор',org:'Организация',organization:'Организация',site:'Объект',object:'Объект',name:'Наименование',date:'Дата',month:'Месяц',status:'Статус',notes:'Примечание',sum:'Сумма',qty:'Количество',price:'Цена',fuel:'Вид топлива',fuelUsed:'Расход топлива',fuelIncome:'Приход топлива',km:'Пробег',vehicleId:'Машина',generatorId:'ДЭС',driverId:'Сотрудник',attachments:'Вложения',number:'Номер',title:'Название'};
const acpClone=value=>JSON.parse(JSON.stringify(value));
function acPolicySummary(policy){
 if(!policy)return 'Вся область, доступная роли';
 if(!policy.grants?.length)return 'Доступ к записям закрыт';
 const match=value=>typeof value==='string'?(value||'пустое значение'):'все';
 return policy.grants.map(grant=>match(grant.org)+' / '+match(grant.site)).join('; ')+(policy.sections?' · ограничения действий и полей':'');
}
function acpCheck(context){
 if(_accessPolicyEditor!==context||!context.form?.isConnected||!context.form.closest('.modal-overlay')?.classList.contains('open')||context.stamp!==syncSessionStamp()||context.database!==data)throw Error('Форма, база или права изменились. Откройте настройки доступа заново.');
}
function acpFields(section,rule={}){
 const fields=new Map(Object.entries(ACP_FIELDS));
 for(const field of typeof WF_FIELDS!=='undefined'?WF_FIELDS[section]||[]:[])fields.set(field[0],field[1]);
 const keys=new Set(['id','org','site','notes',...Object.keys((data[section]||[])[0]||{}),...(rule.readFields||[]),...(rule.writeFields||[]),...(typeof WF_FIELDS!=='undefined'?WF_FIELDS[section]||[]:[]).map(field=>field[0])]);
 return [...keys].filter(key=>key!=='*'&&!['__proto__','constructor','prototype'].includes(key)).sort().map(key=>[key,fields.get(key)||key]);
}
function acpList(kind,values,choices){
 const all=values===undefined||values.includes('*');
 return `<label><input type="checkbox" data-acp-all="${kind}"${all?' checked':''}> Все разрешённые ролью</label><div data-acp-options="${kind}"${all?' hidden':''} style="display:flex;gap:8px;flex-wrap:wrap">${choices.map(([id,label])=>`<label style="font-size:12px"><input type="checkbox" data-acp-kind="${kind}" value="${htmlEsc(id)}"${!all&&values.includes(id)?' checked':''}> ${htmlEsc(label)}</label>`).join('')}</div>`;
}
function acpGrant(grant={org:'',site:''}){
 const cell=key=>{const any=typeof grant[key]!=='string';return `<label>${key==='org'?'Организация':'Объект'} <input data-acp-match="${key}" list="acp-${key}-names" value="${htmlEsc(any?'':grant[key])}"${any?' disabled':''} maxlength="500"><span><input type="checkbox" data-acp-any="${key}"${any?' checked':''}> ${key==='org'?'Все организации':'Все объекты'}</span></label>`;};
 return `<div class="acp-grant wf-card">${cell('org')} ${cell('site')}<details><summary>Действия в этой области</summary>${acpList('grantActions',grant.actions,_accessPolicyEditor.actions.map(action=>[action,ACP_ACTION_LABELS[action]||'Импорт · '+action.replace('import:','')]))}</details><button type="button" data-acp-remove>Удалить область</button></div>`;
}
async function acOpenUserPolicy(id){
 try{
  const [settings,catalog]=await Promise.all([window.electronAPI.getSettings(),window.electronAPI.getAccessCatalog?.()]);
  if(settings.networkMode==='client')throw Error('Изменяйте доступ на компьютере-сервере');
  const user=settings.serverUsers?.find(row=>row.id===id);if(!user)throw Error('Учётная запись уже удалена');
  if(!catalog?.actions||typeof AccessPolicy!=='object')throw Error('Справочник прав недоступен. Откройте программу заново.');
  const policy=AccessPolicy.normalize(user.accessPolicy),ctx={id,stamp:syncSessionStamp(),database:data,userFingerprint:PlatformKernel.stableSerialize(user),actions:catalog.actions,sections:catalog.sections,form:null,dirty:false,pending:null};_accessPolicyEditor=ctx;
  const choices=ctx.actions.map(action=>[action,ACP_ACTION_LABELS[action]||'Импорт · '+action.replace('import:','')]);
  openGenericModal('Область доступа · '+user.name,`<form id="acpForm"><p>Роль: <strong>${htmlEsc(AC_ROLE_LABELS[user.role]||user.role)}</strong>. Ограничения ниже сужают права роли. Исторические данные без подтверждённой организации и объекта недоступны ограниченной учётной записи.</p><label>Режим <select id="acpMode"><option value="role"${!policy?' selected':''}>Вся область роли</option><option value="scoped"${policy?' selected':''}>Выбранные области</option></select></label><div id="acpScope"${!policy?' hidden':''}><p>Каждая строка — разрешённая пара «организация + объект». Несколько строк объединяются. Без строк доступ к записям закрыт.</p><div id="acpGrants">${(policy?.grants||[]).map(acpGrant).join('')}</div><button type="button" id="acpAdd">Добавить область</button>
  ${['org','site'].map(key=>`<datalist id="acp-${key}-names">${[...new Set(ctx.sections.flatMap(section=>(data[section]||[]).map(row=>row[key])).filter(value=>typeof value==='string'&&value))].sort().map(value=>`<option value="${htmlEsc(value)}">`).join('')}</datalist>`).join('')}
  <p>Общие справочники доступны для чтения в пределах роли. Изменение общего справочника разрешается отдельно.</p><div style="max-height:46vh;overflow:auto">${ctx.sections.map(section=>{const rule=policy?.sections?.[section]||{},fields=acpFields(section,rule);return `<details class="acp-section wf-card" data-acp-section="${section}"><summary>${htmlEsc(PlatformSchema.descriptors[section]?.label||SYNC_NAMES[section]||section)}</summary><label><input type="checkbox" data-acp-rule${policy?.sections?.[section]?' checked':''}> Ограничить действия и поля</label><div data-acp-rule-body${!policy?.sections?.[section]?' hidden':''}><p>Действия</p>${acpList('actions',rule.actions,choices)}<p>Поля для чтения</p>${acpList('readFields',rule.readFields,fields)}<p>Поля для изменения</p>${acpList('writeFields',rule.writeFields,fields.filter(([key])=>!['id','scopeSnapshot','document','documentHistory','importProvenance','importBatch','history','lifecycleHistory','printHistory','snapshots'].includes(key)))}</div><label><input type="checkbox" data-acp-shared${policy?.sharedWrite?.includes('*')||policy?.sharedWrite?.includes(section)?' checked':''}> Разрешить изменение общего справочника в пределах роли</label></details>`;}).join('')}</div></div><p id="acpPreview"></p><p id="acpError" role="alert"></p><button class="btn btn-primary" type="submit">Проверить и сохранить права</button><button class="btn btn-ghost" type="button" id="acpBack">Назад</button></form>`,1000);
  ctx.form=document.getElementById('acpForm');
  ctx.form.onchange=event=>{ctx.dirty=true;const el=event.target;if(el.id==='acpMode')document.getElementById('acpScope').hidden=el.value!=='scoped';if(el.dataset.acpAny){const input=el.closest('label').querySelector('[data-acp-match]');input.disabled=el.checked;}if(el.dataset.acpAll)el.closest('label').parentElement.querySelector(`[data-acp-options="${el.dataset.acpAll}"]`).hidden=el.checked;if(el.hasAttribute('data-acp-rule'))el.closest('.acp-section').querySelector('[data-acp-rule-body]').hidden=!el.checked;};
  ctx.form.oninput=()=>{ctx.dirty=true;};
  ctx.form.onclick=event=>{if(event.target.closest('[data-acp-remove]')){event.target.closest('.acp-grant').remove();ctx.dirty=true;}};
  document.getElementById('acpAdd').onclick=()=>{acpCheck(ctx);document.getElementById('acpGrants').insertAdjacentHTML('beforeend',acpGrant());ctx.dirty=true;};
  document.getElementById('acpBack').onclick=async()=>{if(await accessPolicyFlush()){_accessPolicyEditor=null;await acOpenUsers();}};
  ctx.form.onsubmit=event=>{event.preventDefault();if(ctx.pending)return;ctx.pending=acpSave(ctx).finally(()=>{ctx.pending=null;});};
 }catch(error){showToast(error.message);}
}
function acpReadList(container,kind){if(container.querySelector(`[data-acp-all="${kind}"]`).checked)return undefined;return [...container.querySelectorAll(`[data-acp-kind="${kind}"]:checked`)].map(input=>input.value);}
function acpRead(ctx){
 acpCheck(ctx);if(ctx.form.querySelector('#acpMode').value==='role')return null;
 const descriptor={version:1,grants:[...ctx.form.querySelectorAll('.acp-grant')].map(container=>{const grant={};for(const key of ['org','site']){const any=container.querySelector(`[data-acp-any="${key}"]`).checked,value=container.querySelector(`[data-acp-match="${key}"]`).value;if(!any&&!value)throw Error('Укажите точное название или выберите явное разрешение всех организаций/объектов');grant[key]=any?{any:true}:value;}const actions=acpReadList(container,'grantActions');if(actions!==undefined)grant.actions=actions;return grant;}),sections:{},sharedWrite:[]};
 for(const container of ctx.form.querySelectorAll('.acp-section')){const name=container.dataset.acpSection;if(container.querySelector('[data-acp-shared]').checked)descriptor.sharedWrite.push(name);if(!container.querySelector('[data-acp-rule]').checked)continue;const rule={};for(const kind of ['actions','readFields','writeFields']){const list=acpReadList(container,kind);if(list!==undefined)rule[kind]=list;}descriptor.sections[name]=rule;}
 return AccessPolicy.normalize(descriptor);
}
async function acpSave(ctx){
 const button=ctx.form.querySelector('[type="submit"]');button.disabled=true;
 try{const descriptor=acpRead(ctx);ctx.form.querySelector('#acpPreview').textContent=acPolicySummary(descriptor);const reviewed=PlatformKernel.stableSerialize(descriptor);const approval=confirmAction('Сохранить права: '+acPolicySummary(descriptor)+'?');const yes=document.getElementById('confirmYes');if(yes)yes.textContent='Сохранить';if(!await approval)return;acpCheck(ctx);if(PlatformKernel.stableSerialize(acpRead(ctx))!==reviewed)throw Error('Права изменились после проверки. Проверьте их заново.');
  await acPersistUsers(users=>{acpCheck(ctx);const user=users.find(row=>row.id===ctx.id);if(!user||PlatformKernel.stableSerialize(user)!==ctx.userFingerprint)throw Error('Учётная запись изменена другим действием. Откройте её заново.');if(descriptor===null)delete user.accessPolicy;else user.accessPolicy=descriptor;});
  ctx.dirty=false;_accessPolicyEditor=null;showToast('Права сохранены. Сотруднику нужно заново загрузить данные.');await acOpenUsers();
 }catch(error){if(ctx.form.isConnected)ctx.form.querySelector('#acpError').textContent=error.message;else showToast(error.message);}finally{if(button.isConnected)button.disabled=false;}
}
async function accessPolicyFlush(){const ctx=_accessPolicyEditor;if(!ctx)return true;if(ctx.pending){await ctx.pending;if(_accessPolicyEditor!==ctx)return true;}if(!ctx.dirty)return true;if(!await confirmAction('Изменения прав ещё не сохранены. Закрыть форму без сохранения?'))return false;ctx.dirty=false;return true;}

function acpRenderScopeNote(){
 document.getElementById('accessScopeNote')?.remove();
 if(!_sync.access?.accessPolicy)return;
 const host=document.getElementById('mainContent');if(!host)return;
 const note=document.createElement('p');note.id='accessScopeNote';note.className='wf-note';note.setAttribute('role','status');
 note.textContent='Область доступа: '+acPolicySummary(_sync.access.accessPolicy)+'. Отчёты и итоги рассчитаны по доступным записям. История с неподтверждённой принадлежностью скрыта.';
 host.prepend(note);
}
if(typeof switchSection==='function'){const acpSwitchSection=switchSection;switchSection=function(...args){const result=acpSwitchSection.apply(this,args);acpRenderScopeNote();return result;};}
