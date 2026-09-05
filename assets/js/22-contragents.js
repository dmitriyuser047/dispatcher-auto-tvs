// Контрагенты
// Выделено из index.html

// ─── КОНТРАГЕНТЫ ──────────────────────────────────────
let editingContragentId = null;
let caSearchQuery = '';

function renderContragentsSection() {
  const list = data.contragents || [];
  const q = caSearchQuery.toLowerCase().trim();
  const filtered = q ? list.filter(c => [c.name,c.inn,c.contact,c.phone,c.note].some(f=>(f||'').toLowerCase().includes(q))) : list;
  filtered.sort((a,b) => (a.name||'').localeCompare(b.name||''));

  const totalPayments = (data.payments||[]);
  const caStats = {};
  totalPayments.forEach(p => {
    const key = (p.contragent||'').trim();
    if (!key) return;
    if (!caStats[key]) caStats[key] = {count:0, sum:0};
    caStats[key].count++;
    caStats[key].sum += (p.sum||0);
  });

  const rows = filtered.map(c => {
    const st = caStats[(c.name||'').trim()] || {count:0, sum:0};
    return `<tr>
      <td style="font-weight:600">${c.name||''}</td>
      <td>${c.inn||'—'}</td>
      <td>${c.contact||'—'}</td>
      <td>${c.phone||'—'}</td>
      <td>${c.category||'—'}</td>
      <td class="num">${st.count}</td>
      <td class="num">${st.sum ? st.sum.toLocaleString('ru-RU') + ' ₽' : '—'}</td>
      <td>${c.note||''}</td>
      <td style="white-space:nowrap">
        <button class="btn-icon" title="Редактировать" onclick="openEditContragent('${c.id}')"><svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="btn-icon" title="Удалить" onclick="deleteContragent('${c.id}')"><svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m5-3h4a1 1 0 011 1v1H9V4a1 1 0 011-1z"/></svg></button>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('mainContent').innerHTML = `
    <div style="padding:24px 28px;width:100%;box-sizing:border-box">
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap">
        <input type="text" placeholder="Поиск по названию, ИНН, контакту..." value="${caSearchQuery}"
          oninput="caSearchQuery=this.value;renderContragentsSection()"
          style="flex:1;min-width:200px;padding:8px 14px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--input-bg);color:var(--text)">
        <button class="primary-btn" onclick="openAddContragent()">+ Контрагент</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-value counter" data-target="${list.length}">0</div><div class="stat-label">Всего</div></div>
        <div class="stat-card"><div class="stat-value counter" data-target="${Object.keys(caStats).length}">0</div><div class="stat-label">С платежами</div></div>
        <div class="stat-card"><div class="stat-value counter" data-target="${totalPayments.reduce((s,p)=>s+(p.sum||0),0)}">0</div><div class="stat-label">Общий оборот ₽</div></div>
      </div>
      ${filtered.length ? `<div style="overflow-x:auto"><table class="data-table" style="width:100%">
        <thead><tr><th>Название</th><th>ИНН</th><th>Контакт</th><th>Телефон</th><th>Категория</th><th>Док-тов</th><th>Сумма</th><th>Примечание</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : `<div class="welcome"><h2>Нет контрагентов</h2><p>Нажмите «+ Контрагент» для добавления</p></div>`}
    </div>`;
}

function openAddContragent() {
  editingContragentId = null;
  document.getElementById('caModalTitle').textContent = 'Добавить контрагента';
  document.getElementById('caName').value = '';
  document.getElementById('caInn').value = '';
  document.getElementById('caContact').value = '';
  document.getElementById('caPhone').value = '';
  document.getElementById('caCategory').value = '';
  document.getElementById('caNote').value = '';
  openModal('contragentModal');
}

function openEditContragent(id) {
  const c = (data.contragents||[]).find(x=>x.id===id);
  if (!c) return;
  editingContragentId = id;
  document.getElementById('caModalTitle').textContent = 'Редактировать контрагента';
  document.getElementById('caName').value = c.name||'';
  document.getElementById('caInn').value = c.inn||'';
  document.getElementById('caContact').value = c.contact||'';
  document.getElementById('caPhone').value = c.phone||'';
  document.getElementById('caCategory').value = c.category||'';
  document.getElementById('caNote').value = c.note||'';
  openModal('contragentModal');
}

function saveContragent() {
  const name = document.getElementById('caName').value.trim();
  if (!name) { showFieldError('caName','Укажите название'); return; }
  const obj = {
    id: editingContragentId || ('ca_' + Date.now()),
    name,
    inn: document.getElementById('caInn').value.trim(),
    contact: document.getElementById('caContact').value.trim(),
    phone: document.getElementById('caPhone').value.trim(),
    category: document.getElementById('caCategory').value.trim(),
    note: document.getElementById('caNote').value.trim(),
  };
  if (editingContragentId) {
    const idx = data.contragents.findIndex(c=>c.id===editingContragentId);
    if (idx>=0) data.contragents[idx] = obj;
  } else {
    data.contragents.push(obj);
  }
  saveData();
  closeModal('contragentModal');
  renderContragentsSection();
  showToast(editingContragentId ? 'Контрагент обновлён' : 'Контрагент добавлен');
}

function deleteContragent(id) {
  if (!confirm('Удалить контрагента?')) return;
  data.contragents = data.contragents.filter(c=>c.id!==id);
  saveData();
  renderContragentsSection();
  showToast('Контрагент удалён');
}

