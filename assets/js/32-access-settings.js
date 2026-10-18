// Сетевые учётные записи отделены от локальных профилей папок базы.
// На диск передаётся только SHA-256 случайного персонального токена.
const AC_ROLE_LABELS = {
  admin:'Администратор', dispatcher:'Диспетчер', mechanic:'Механик',
  accountant:'Бухгалтер', viewer:'Наблюдатель · все данные',
};
const AC_ROLE_HELP = {
  admin:'Все разделы и операции.',
  dispatcher:'Транспорт, назначения, журналы и ГСМ. Платежи, бюджет и контрагенты недоступны.',
  mechanic:'ТО, ремонт, запчасти и документы. Платежи, бюджет и контрагенты недоступны.',
  accountant:'Все данные для чтения; изменение финансов, реестров и учёта ГСМ.',
  viewer:'Чтение всех данных, включая финансовые. Изменение учётных данных запрещено.',
};

function renderAccessSettingsPanel() {
  const host = document.getElementById('settingsBody');
  if (!host || document.getElementById('accessSettingsPanel') || !_appSettings) return;
  const section = document.createElement('div');
  section.id = 'accessSettingsPanel';
  section.className = 'settings-section';
  if (_appSettings.networkMode === 'client') {
    section.innerHTML = '<div class="settings-section-title">Сетевая учётная запись</div><p style="font-size:12px;color:var(--text3)">В поле «Ключ сети» укажите выданный вам персональный токен. Имя и права назначаются на компьютере-сервере.</p>';
  } else {
    const users = _appSettings.serverUsers || [], enabled = users.filter(u => u.enabled !== false).length;
    section.innerHTML = `<div class="settings-section-title">Сетевые учётные записи</div><p style="font-size:12px;color:var(--text3)">${users.length ? `${enabled} действующих из ${users.length}. Персональные токены определяют права на сервере.` : 'Для совместимости используется общий ключ. Создайте персональные учётные записи, чтобы назначить роли.'}</p><button class="btn btn-ghost btn-sm" onclick="acOpenUsers()">Управление доступом</button>`;
  }
  host.appendChild(section);
}

function acRoleOptions(role) {
  return Object.entries(AC_ROLE_LABELS).map(([key,label]) => `<option value="${key}"${key === role ? ' selected' : ''}>${htmlEsc(label)}</option>`).join('');
}

async function acOpenUsers() {
  try {
    const settings = await window.electronAPI.getSettings();
    if (settings.networkMode === 'client') { showToast('Управление доступом выполняется на компьютере-сервере'); return; }
    const users = settings.serverUsers || [];
    openGenericModal('Сетевые учётные записи', `<p style="font-size:13px;color:var(--text3)">Каждому сотруднику выдаётся свой токен. После создания первой учётной записи общий ключ перестаёт давать доступ к серверу. Создайте администратора и передайте сотрудникам их токены.</p>
      <div style="padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:12px;font-size:12px">После изменения доступа перезапустите сетевой сервер в настройках. Уже сохранённые данные сотрудников остаются в базе.</div>
      <div style="max-height:42vh;overflow:auto">${users.map(u => `<div class="ac-user-row" data-user-id="${htmlEsc(u.id)}" style="padding:12px 0;border-bottom:1px solid var(--border)">
        <div class="form-row"><div class="form-group"><label>Имя сотрудника</label><input class="ac-user-name" maxlength="120" value="${htmlEsc(u.name || '')}"></div>
        <div class="form-group"><label>Роль</label><select class="ac-user-role">${acRoleOptions(u.role)}</select></div>
        <div class="form-group"><label>Действует до (необязательно)</label><input class="ac-user-expiry" type="date" value="${u.expiresAt ? htmlEsc(String(u.expiresAt).slice(0,10)) : ''}"></div></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label style="font-size:12px"><input class="ac-user-enabled" type="checkbox" style="width:auto"${u.enabled !== false ? ' checked' : ''}> Доступ разрешён</label><button class="btn btn-primary btn-sm" onclick="acUpdateUser(${htmlJs(u.id)})">Сохранить права</button><button class="btn btn-ghost btn-sm" onclick="acRotateUserToken(${htmlJs(u.id)})">Заменить токен</button><span style="font-size:11px;color:var(--text3)">${u.rotatedAt || u.createdAt ? 'Выдан: ' + htmlEsc(new Date(u.rotatedAt || u.createdAt).toLocaleDateString('ru-RU')) : ''}</span></div>
      </div>`).join('') || '<p style="color:var(--text3)">Учётных записей пока нет.</p>'}</div>
      <div style="margin-top:16px"><strong style="font-size:14px">Новая учётная запись</strong><div class="form-row" style="margin-top:8px"><div class="form-group"><label>Имя сотрудника</label><input id="acNewName" maxlength="120" placeholder="Иванов Иван"></div><div class="form-group"><label>Роль</label><select id="acNewRole">${acRoleOptions(users.length ? 'dispatcher' : 'admin')}</select></div></div><button class="btn btn-primary btn-sm" onclick="acCreateUser()">Создать и выдать токен</button></div>
      <details style="font-size:12px;margin-top:16px"><summary>Что разрешено каждой роли</summary>${Object.entries(AC_ROLE_HELP).map(([role,help]) => `<p><strong>${htmlEsc(AC_ROLE_LABELS[role])}.</strong> ${htmlEsc(help)}</p>`).join('')}</details>
      <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn btn-ghost" onclick="closeModal('genericModal')">Закрыть</button></div>`,980);
  } catch (error) { showToast('Не удалось открыть учётные записи: ' + error.message); }
}

async function acGenerateToken() {
  if (!window.crypto?.getRandomValues || !window.crypto?.subtle) throw new Error('Криптографический генератор недоступен');
  const bytes = window.crypto.getRandomValues(new Uint8Array(32));
  const token = 'tvs_' + Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('');
  const hash = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return { token, tokenHash:Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,'0')).join('') };
}

async function acPersistUsers(change) {
  const settings = await window.electronAPI.getSettings();
  if (settings.networkMode === 'client') throw new Error('Изменяйте доступ на компьютере-сервере');
  const users = (settings.serverUsers || []).map(u => ({...u}));
  change(users);
  if (!users.some(u => u.enabled !== false && u.role === 'admin' && (!u.expiresAt || Date.parse(u.expiresAt) > Date.now()))) throw new Error('Нужна хотя бы одна действующая учётная запись администратора');
  const result = await window.electronAPI.saveSettings({...settings, serverUsers:users, serverAccessConfigured:true});
  if (result === false || result?.ok === false) throw new Error(result?.error || 'Настройки не сохранены');
  _appSettings = await window.electronAPI.getSettings();
  await renderSettingsBody();
}

function acUserRow(id) {
  return Array.from(document.querySelectorAll('.ac-user-row')).find(row => row.dataset.userId === id);
}

async function acUpdateUser(id) {
  const row = acUserRow(id);
  if (!row) return;
  const name = row.querySelector('.ac-user-name').value.trim();
  const role = row.querySelector('.ac-user-role').value;
  const enabled = row.querySelector('.ac-user-enabled').checked;
  const expiry = row.querySelector('.ac-user-expiry').value;
  if (!name || !Object.hasOwn(AC_ROLE_LABELS,role)) { showToast('Укажите имя сотрудника и роль'); return; }
  try {
    await acPersistUsers(users => {
      const user = users.find(u => u.id === id);
      if (!user) throw new Error('Учётная запись уже удалена');
      Object.assign(user,{name,role,enabled,expiresAt:expiry ? expiry + 'T23:59:59.999+03:00' : null});
    });
    showToast('Права сохранены. Перезапустите сетевой сервер.');
    await acOpenUsers();
  } catch (error) { showToast(error.message); }
}

async function acCreateUser() {
  const name = document.getElementById('acNewName')?.value.trim();
  const role = document.getElementById('acNewRole')?.value;
  if (!name || !Object.hasOwn(AC_ROLE_LABELS,role)) { showToast('Укажите имя сотрудника и роль'); return; }
  try {
    const issued = await acGenerateToken();
    const idBytes = window.crypto.getRandomValues(new Uint8Array(12));
    const id = 'user_' + Array.from(idBytes,b => b.toString(16).padStart(2,'0')).join('');
    await acPersistUsers(users => users.push({id,name,role,enabled:true,tokenHash:issued.tokenHash,createdAt:new Date().toISOString()}));
    acShowToken(name,issued.token);
  } catch (error) { showToast(error.message); }
}

async function acRotateUserToken(id) {
  if (!await confirmAction('Заменить персональный токен? Старый перестанет работать после перезапуска сервера. Сотруднику нужно передать новый.')) return;
  try {
    const issued = await acGenerateToken();
    let name = '';
    await acPersistUsers(users => {
      const user = users.find(u => u.id === id);
      if (!user) throw new Error('Учётная запись уже удалена');
      name = user.name;
      user.tokenHash = issued.tokenHash;
      user.rotatedAt = new Date().toISOString();
    });
    acShowToken(name,issued.token);
  } catch (error) { showToast(error.message); }
}

function acShowToken(name,token) {
  openGenericModal('Персональный токен · ' + name, '<p>Скопируйте токен и передайте сотруднику для поля «Ключ сети» на его компьютере. После закрытия этого окна посмотреть токен повторно нельзя; при утрате выдайте новый.</p><input id="acIssuedToken" readonly autocomplete="off" style="font-family:monospace;width:100%;padding:10px"><p style="font-size:12px;color:var(--text3)">Перезапустите сетевой сервер, чтобы применить учётные записи.</p><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-primary" onclick="acCopyToken()">Скопировать</button><button class="btn btn-ghost" onclick="acForgetToken()">Закрыть</button></div>',760);
  const input = document.getElementById('acIssuedToken');
  input.value = token;
  input.focus(); input.select();
  const modal = document.getElementById('genericModal');
  if (modal) {
    const observer = new MutationObserver(() => {
      if (!modal.classList.contains('open') || !document.getElementById('acIssuedToken')) {
        input.value = '';
        observer.disconnect();
      }
    });
    observer.observe(modal,{attributes:true,attributeFilter:['class'],childList:true,subtree:true});
  }
}

async function acCopyToken() {
  const input = document.getElementById('acIssuedToken');
  if (!input) return;
  try { await navigator.clipboard.writeText(input.value); showToast('Токен скопирован'); }
  catch { input.focus(); input.select(); showToast('Нажмите Ctrl+C, чтобы скопировать выделенный токен'); }
}

function acForgetToken() {
  const input = document.getElementById('acIssuedToken');
  if (input) input.value = '';
  closeModal('genericModal');
}

// Подключить скрипт после 12-settings.js. Все существующие способы открытия
// настроек автоматически получают дополнительную секцию.
if (typeof renderSettingsBody === 'function') {
  const acOriginalRenderSettingsBody = renderSettingsBody;
  renderSettingsBody = async function(...args) {
    const result = await acOriginalRenderSettingsBody.apply(this,args);
    renderAccessSettingsPanel();
    return result;
  };
}
