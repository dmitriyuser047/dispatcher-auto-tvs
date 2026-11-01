'use strict';
(() => {
  const web = window.tvsWeb ||= {};
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label, primary = false) => {
    const node = el('button', 'tvs-button' + (primary ? ' tvs-button-primary' : ''), label);
    node.type = 'button';
    return node;
  };
  const mounted = new WeakSet();
  web.mountUsers = async container => {
    if (!container || mounted.has(container)) return;
    mounted.add(container);
    container.classList.add('tvs-users');
    let state = null, loading = false, dialog = null;
    const title = el('div', 'tvs-page-heading');
    const intro = el('div');
    intro.append(el('h1', '', 'Доступ сотрудников'), el('p', '', 'Персональные ключи и роли для работы с общей базой компании.'));
    const actions = el('div', 'tvs-users-actions');
    const refreshButton = button('Обновить'), addButton = button('Добавить сотрудника', true);
    actions.append(refreshButton, addButton); title.append(intro, actions);
    const status = el('p', 'tvs-users-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const error = el('p', 'tvs-users-error'); error.setAttribute('role', 'alert');
    const contents = el('div');
    const note = el('p', 'tvs-users-note', 'После отключения доступа или замены ключа прежний ключ перестаёт работать. Новый ключ показывается один раз; передайте его сотруднику лично.');
    container.replaceChildren(title, status, error, contents, note);
    async function request(input) {
      let response, value;
      try {
        response = await fetch('/web-api/users', {
          method: input ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
          headers: { Accept: 'application/json', ...(input ? { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="tvs-csrf"]')?.content || '' } : {}) },
          ...(input ? { body: JSON.stringify(input) } : {}),
        });
        value = await response.json();
      } catch {
        throw Object.assign(Error(input ? 'Сервер не подтвердил изменение. Обновите список. Если ключ уже заменён или сотрудник создан, выпустите для него новый ключ.' : 'Не удалось загрузить сотрудников. Проверьте соединение и обновите страницу.'), { unknown: !!input });
      }
      if (!response.ok || value.ok !== true) throw Object.assign(Error(value.error || 'Операция не выполнена.'), { code: value.code, status: response.status });
      return value;
    }
    function showError(problem) {
      error.replaceChildren(document.createTextNode(problem.message || 'Операция не выполнена.'));
      if (problem.status === 401) {
        const link = el('a', '', 'Войти заново'); link.href = '/login';
        error.append(document.createTextNode(' '), link);
      }
    }
    function busy(value) {
      loading = value;
      refreshButton.disabled = value; addButton.disabled = value || !state;
      contents.querySelectorAll('button').forEach(control => { control.disabled = value; });
    }
    function render() {
      const wrap = el('div', 'tvs-table-wrap'), table = el('table', 'tvs-data-table');
      const head = el('thead'), labels = el('tr');
      for (const label of ['Сотрудник', 'Роль', 'Доступ', 'Ключ', 'Действия']) { const cell = el('th', '', label); cell.scope = 'col'; labels.append(cell); }
      head.append(labels);
      const body = el('tbody'), roles = new Map(state.roles.map(role => [role.id, role]));
      const rows = [...state.users].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name, 'ru'));
      for (const user of rows) {
        const row = el('tr'), name = el('td'), role = el('td'), enabled = el('td'), key = el('td'), controls = el('td');
        name.append(el('strong', '', user.name));
        if (user.id === state.selfId) name.append(el('small', '', 'Ваша учётная запись'));
        role.append(el('span', '', roles.get(user.role)?.label || user.role));
        if (user.restricted) role.append(el('small', '', 'С ограничениями доступа'));
        const expired = user.expiresAt && Date.parse(user.expiresAt) <= Date.now();
        enabled.textContent = !user.enabled ? 'Отключён' : expired ? 'Срок истёк' : 'Активен';
        const date = user.rotatedAt || user.createdAt;
        key.textContent = date && Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleDateString('ru-RU') : 'Выдан ранее';
        const edit = button('Изменить'), rotate = button('Новый ключ');
        edit.setAttribute('aria-label', 'Изменить доступ: ' + user.name);
        rotate.setAttribute('aria-label', 'Выдать новый ключ: ' + user.name);
        edit.addEventListener('click', () => openEditor(user.id));
        rotate.addEventListener('click', () => openRotation(user.id));
        controls.className = 'tvs-users-row-actions'; controls.append(edit, rotate);
        row.append(name, role, enabled, key, controls); body.append(row);
      }
      table.append(head, body); wrap.append(table); contents.replaceChildren(wrap);
      status.textContent = 'Сотрудников: ' + state.users.length + ' · активных: ' + state.users.filter(user => user.enabled && (!user.expiresAt || Date.parse(user.expiresAt) > Date.now())).length;
    }
    async function refresh(clearError = true) {
      if (loading) return false;
      busy(true); if (clearError) error.textContent = '';
      status.textContent = 'Загружаем текущие права сотрудников…';
      try { state = await request(); render(); return true; }
      catch (problem) { state = null; contents.replaceChildren(); status.textContent = ''; showError(problem); return false; }
      finally { busy(false); }
    }
    function closeDialog() {
      if (!dialog) return;
      dialog.querySelectorAll('input').forEach(input => { input.value = ''; });
      dialog.close(); dialog.replaceChildren(); dialog.remove(); dialog = null;
    }
    function createDialog(label) {
      closeDialog();
      dialog = el('dialog', 'tvs-users-dialog');
      const heading = el('h2', '', label); heading.id = 'tvsUsersDialogTitle';
      dialog.setAttribute('aria-labelledby', heading.id);
      dialog.append(heading); container.append(dialog);
      // Explicit close buttons make the one-time-key lifetime unambiguous.
      dialog.addEventListener('cancel', event => { event.preventDefault(); });
      return dialog;
    }
    function field(label, input) {
      const wrap = el('label', 'tvs-field'); wrap.append(el('span', '', label), input); return wrap;
    }
    function keyDialog(result) {
      const target = createDialog('Персональный ключ: ' + result.user.name);
      target.append(el('p', '', 'Скопируйте ключ и передайте сотруднику. После закрытия он больше не будет показан.'));
      const keyInput = el('input'); keyInput.type = 'text'; keyInput.readOnly = true; keyInput.autocomplete = 'off'; keyInput.spellcheck = false;
      keyInput.value = result.key; result.key = null;
      target.append(field('Персональный ключ доступа', keyInput));
      const copied = el('p'); copied.setAttribute('role', 'status');
      const controls = el('div', 'tvs-users-actions'), copy = button('Скопировать ключ', true), close = button('Ключ сохранён, закрыть');
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(keyInput.value); copied.textContent = 'Ключ скопирован.'; }
        catch { keyInput.focus(); keyInput.select(); copied.textContent = 'Выделен весь ключ. Нажмите Ctrl+C, чтобы скопировать.'; }
      });
      close.addEventListener('click', () => { closeDialog(); if (result.reauthenticate) location.assign('/login'); });
      if (result.reauthenticate) target.append(el('p', '', 'Ваш прежний ключ заменён. После закрытия войдите с новым ключом.'));
      controls.append(copy, close); target.append(copied, controls); target.showModal(); keyInput.focus();
    }
    async function save(input, form) {
      if (loading) return;
      busy(true); form.querySelectorAll('button, input, select').forEach(control => { control.disabled = true; });
      error.textContent = '';
      try {
        const result = await request(input);
        const { key, ...visible } = result; result.key = null;
        state = visible; render(); closeDialog();
        if (key) keyDialog({ user: visible.user, key, reauthenticate: visible.reauthenticate });
        else status.textContent = 'Доступ сотрудника сохранён.';
      } catch (problem) {
        closeDialog(); showError(problem);
        // No automatic POST retry: a missing response can hide a saved change.
        state = null; contents.replaceChildren(); status.textContent = 'Обновите список перед следующей операцией.';
      } finally { busy(false); }
    }
    async function openEditor(id = null) {
      if (loading || !await refresh()) return;
      const user = id ? state.users.find(row => row.id === id) : null;
      if (id && !user) { showError(Error('Сотрудник больше не найден. Список обновлён.')); return; }
      const version = state.version, self = user?.id === state.selfId;
      const target = createDialog(user ? 'Изменить доступ сотрудника' : 'Новый сотрудник');
      const form = el('form', 'tvs-users-form'); form.autocomplete = 'off';
      const name = el('input'); name.name = 'name'; name.maxLength = 120; name.required = true; name.value = user?.name || '';
      const role = el('select'); role.name = 'role';
      for (const item of state.roles) { const option = el('option', '', item.label); option.value = item.id; option.selected = item.id === (user?.role || 'viewer'); role.append(option); }
      const description = el('p', 'tvs-users-note');
      const describe = () => { description.textContent = state.roles.find(item => item.id === role.value)?.description || ''; };
      role.addEventListener('change', describe); describe(); role.disabled = self;
      const enabled = el('input'); enabled.type = 'checkbox'; enabled.name = 'enabled'; enabled.checked = user?.enabled !== false; enabled.disabled = self;
      const enabledField = field('Доступ включён', enabled); enabledField.classList.add('tvs-users-check');
      form.append(field('Имя сотрудника', name), field('Роль', role), description, enabledField);
      if (self) form.append(el('p', 'tvs-users-note', 'Собственную роль администратора и доступ изменить нельзя.'));
      if (user?.restricted) form.append(el('p', 'tvs-users-note', 'Для этой учётной записи действуют дополнительные ограничения. Смена роли сохраняет их.'));
      const controls = el('div', 'tvs-users-actions'), cancel = button('Отмена'), submit = button(user ? 'Сохранить' : 'Создать и выдать ключ', true);
      submit.type = 'submit'; cancel.addEventListener('click', closeDialog); controls.append(cancel, submit); form.append(controls);
      form.addEventListener('submit', event => { event.preventDefault(); if (form.reportValidity()) void save({ action: user ? 'update' : 'create', version, ...(user ? { id: user.id } : {}), name: name.value, role: self ? user.role : role.value, enabled: self ? user.enabled : enabled.checked }, form); });
      target.append(form); target.showModal(); name.focus();
    }
    async function openRotation(id) {
      if (loading || !await refresh()) return;
      const user = state.users.find(row => row.id === id);
      if (!user) { showError(Error('Сотрудник больше не найден. Список обновлён.')); return; }
      const version = state.version, target = createDialog('Заменить ключ: ' + user.name), form = el('form');
      form.append(el('p', '', 'Прежний ключ сразу перестанет работать. Сотруднику понадобится новый ключ для входа.'));
      if (!user.enabled) form.append(el('p', '', 'Учётная запись отключена. Замена ключа не включает доступ.'));
      const controls = el('div', 'tvs-users-actions'), cancel = button('Отмена'), submit = button('Заменить и показать ключ', true);
      submit.type = 'submit'; cancel.addEventListener('click', closeDialog); controls.append(cancel, submit); form.append(controls);
      form.addEventListener('submit', event => { event.preventDefault(); void save({ action: 'rotate-key', version, id }, form); });
      target.append(form); target.showModal(); cancel.focus();
    }
    refreshButton.addEventListener('click', () => { void refresh(); });
    addButton.addEventListener('click', () => { void openEditor(); });
    window.addEventListener('pagehide', closeDialog);
    await refresh();
  };
  const autoMount = () => { const container = document.querySelector('[data-tvs-users]'); if (container) void web.mountUsers(container); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount, { once: true });
  else autoMount();
})();
