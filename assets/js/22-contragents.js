// Контрагенты: стабильные связи с расходами и архив.
let editingContragentId = null;
let caSearchQuery = '';
let caShowArchived = false;

function renderContragentsSection() {
  const list = data.contragents || [], q = finNameKey(caSearchQuery);
  const filtered = list.filter(c => (caShowArchived || !c.archived) && (!q || [c.name,c.inn,c.contact,c.phone,c.note].some(f => finNameKey(f).includes(q)))).sort((a,b) => (a.name || '').localeCompare(b.name || '', 'ru'));
  const stats = new Map();
  (data.payments || []).forEach(p => {
    const party = finResolveContragent(p), key = party?.id ?? p.contragentId;
    if (key==null||key==='') return;
    if (!stats.has(key)) stats.set(key, {count:0,sum:0,debt:0});
    const st = stats.get(key); st.count++; st.sum += finNumber(p.sum); st.debt += finDebt(p);
  });
  const rows = filtered.map(c => {
    const st = stats.get(c.id) || {count:0,sum:0,debt:0};
    const alias = typeof catalogMergeAliasHtml==='function' ? catalogMergeAliasHtml('contragents',c) : '';
    const merge = !c.mergedInto && typeof catalogMergeOpen==='function' && catalogMergeReadable() && catalogMergeWritable(['contragents']) ? `<button type="button" class="btn btn-ghost btn-sm" onclick="catalogMergeOpen('contragents',${htmlEsc(JSON.stringify(c.id))})">Объединить дубль</button>` : '';
    return `<tr><td style="font-weight:600">${htmlEsc(c.name || '')}${c.archived ? '<div style="font-size:11px;color:var(--text3)">В архиве</div>' : ''}${alias}</td><td>${htmlEsc(c.inn || '—')}</td><td>${htmlEsc(c.contact || '—')}</td><td>${htmlEsc(c.phone || '—')}</td><td>${htmlEsc(c.category || '—')}</td><td class="num">${st.count}</td><td class="num">${st.sum.toLocaleString('ru')} ₽</td><td class="num">${st.debt.toLocaleString('ru')} ₽</td><td>${htmlEsc(c.note || '')}</td><td>${c.mergedInto?'':`<button class="btn btn-ghost btn-sm" onclick="openEditContragent(${htmlEsc(JSON.stringify(c.id))})">Изменить</button>${c.archived ? `<button class="btn btn-ghost btn-sm" onclick="restoreContragent(${htmlEsc(JSON.stringify(c.id))})">Вернуть</button>` : `<button class="btn btn-ghost btn-sm" onclick="deleteContragent(${htmlEsc(JSON.stringify(c.id))})">Удалить</button>`}`}${merge}</td></tr>`;
  }).join('');
  const linkedCount = (data.payments || []).filter(p => finResolveContragent(p)).length;
  const unlinkedCount = (data.payments || []).filter(p => !finResolveContragent(p) && (p.contragent || p.contragentId)).length;
  document.getElementById('mainContent').innerHTML = `<div style="padding:24px 28px;width:100%;box-sizing:border-box;overflow:auto;height:100%"><div style="display:flex;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap"><input type="search" id="caSearch" placeholder="Название, ИНН, контакт…" value="${htmlEsc(caSearchQuery)}" oninput="caSearchQuery=this.value;const pos=this.selectionStart;renderContragentsSection();const input=document.getElementById('caSearch');input.focus();if(pos!==null)input.setSelectionRange(pos,pos)" style="flex:1;min-width:200px"><button class="primary-btn" onclick="openAddContragent()">+ Контрагент</button><label style="font-size:12px"><input type="checkbox" ${caShowArchived ? 'checked' : ''} onchange="caShowArchived=this.checked;renderContragentsSection()"> Показывать архив</label></div><p style="font-size:12px;color:var(--text3)">${list.filter(c => !c.archived).length} действующих · ${list.filter(c => c.archived).length} в архиве · ${linkedCount} расходов связаны со справочником${unlinkedCount ? ' · ' + unlinkedCount + ' расходов требуют привязки в разделе «Финансы»' : ''}</p>${filtered.length ? `<div style="overflow:auto"><table class="data-table" style="width:100%;min-width:1000px"><thead><tr><th>Название</th><th>ИНН</th><th>Контакт</th><th>Телефон</th><th>Категория</th><th>Док-тов</th><th>Расходы</th><th>Долг</th><th>Примечание</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="welcome"><h2>Нет контрагентов по выбранным условиям</h2></div>'}</div>`;
}

function openAddContragent() {
  editingContragentId = null;
  document.getElementById('caModalTitle').textContent = 'Добавить контрагента';
  ['caName','caInn','caContact','caPhone','caCategory','caNote'].forEach(id => { document.getElementById(id).value = ''; });
  openModal('contragentModal');
}

function openEditContragent(id) {
  const c = (data.contragents || []).find(x => x.id === id); if (!c) return;
  if(c.mergedInto){showToast('Это архивная ссылка. Измените основную карточку; история остаётся у исходной.');return;}
  editingContragentId = id; document.getElementById('caModalTitle').textContent = 'Редактировать контрагента';
  Object.entries({caName:'name',caInn:'inn',caContact:'contact',caPhone:'phone',caCategory:'category',caNote:'note'}).forEach(([field,key]) => { document.getElementById(field).value = c[key] || ''; });
  openModal('contragentModal');
}

function caValidInn(inn) {
  if (!/^(\d{10}|\d{12})$/.test(inn)) return false;
  const digit = weights => weights.reduce((sum, weight, i) => sum + weight * Number(inn[i]), 0) % 11 % 10;
  return inn.length === 10 ? digit([2,4,10,3,5,9,4,6,8]) === Number(inn[9]) : digit([7,2,4,10,3,5,9,4,6,8]) === Number(inn[10]) && digit([3,7,2,4,10,3,5,9,4,6,8]) === Number(inn[11]);
}

async function saveContragent() {
  const name = document.getElementById('caName').value.trim();
  if (!name) { showFieldError('Укажите название', 'caName'); return; }
  const previous = (data.contragents || []).find(c => c.id === editingContragentId);
  if(previous?.mergedInto){showToast('Архивная ссылка объединения доступна только для просмотра');return;}
  const inn = document.getElementById('caInn').value.trim();
  if (inn && inn !== previous?.inn && !caValidInn(inn)) { showFieldError('Проверьте ИНН: 10 или 12 цифр и контрольное число', 'caInn'); return; }
  if (inn && (data.contragents || []).some(c => c.id !== editingContragentId && c.inn === inn)) { showFieldError('Контрагент с таким ИНН уже есть, в том числе проверьте архив', 'caInn'); return; }
  if (!previous && !inn && (data.contragents || []).some(c => finNameKey(c.name) === finNameKey(name))) { showFieldError('Такое название уже есть. Выберите существующую карточку или укажите ИНН', 'caName'); return; }
  const obj = { ...(previous || {}), id: editingContragentId ?? 'ca_' + (globalThis.crypto?.randomUUID?.() || Date.now()), name, inn, contact: document.getElementById('caContact').value.trim(), phone: document.getElementById('caPhone').value.trim(), category: document.getElementById('caCategory').value.trim(), note: document.getElementById('caNote').value.trim() };
  if (!data.contragents) data.contragents = [];
  if (previous) data.contragents[data.contragents.findIndex(c => c.id === previous.id)] = obj; else data.contragents.push(obj);
  // A catalog rename never rewrites the party printed in a source document.
  if (!await saveData(data, {noMerge:true})) return;
  closeModal('contragentModal'); renderContragentsSection(); showToast(previous ? 'Контрагент обновлён, связи сохранены' : 'Контрагент добавлен');
}

async function deleteContragent(id) {
  const party = (data.contragents || []).find(c => c.id === id); if (!party) return;
  if(party.mergedInto){showToast('Архивная ссылка объединения сохраняет историю и не удаляется');return;}
  const linked = [...(data.payments || []), ...(data.budget || [])].some(row => row.contragentId === id || !row.contragentId && finResolveContragent(row)?.id === id);
  if (!await confirmAction(linked ? 'У контрагента есть расходы или бюджет. Переместить в архив с сохранением связей?' : 'Удалить контрагента?')) return;
  if (linked) party.archived = true; else data.contragents = data.contragents.filter(c => c.id !== id);
  if (!await saveData(data, {noMerge:true})) return;
  renderContragentsSection(); showToast(linked ? 'Контрагент в архиве' : 'Контрагент удалён');
}

async function restoreContragent(id) {
  const party = (data.contragents || []).find(c => c.id === id); if (!party) return;
  if(party.mergedInto){showToast('Архивная ссылка объединения не восстанавливается как отдельная карточка');return;}
  party.archived = false;
  if (!await saveData(data, {noMerge:true})) return;
  renderContragentsSection(); showToast('Контрагент возвращён из архива');
}
