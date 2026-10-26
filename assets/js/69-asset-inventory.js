/* Generated from src/ui/asset-inventory.ts, src/ui/asset-inventory-host.ts, src/ui/asset-inventory-files.ts, src/ui/inventory-documents.ts, src/ui/inventory-photos.ts by scripts/build-inventory-ui.cjs.
 * TypeScript 5.9.3; source/config sha256:6b1cd74f02466f4db48e0be3bf55f8b9673d15f526a5ebe457f854b40a7ebb2e. Do not edit directly. */
"use strict";
/** Standalone property inventory UI. This adapter never accesses application globals,
 * paths, localStorage or fleet/stock data. All writes require a canonical host ACK. */
var AssetInventoryWorkspace;
(function (AssetInventoryWorkspace) {
    const catalogs = ['inventoryOrgs', 'inventoryObjects', 'inventoryMols', 'inventoryItems'];
    const sections = [...catalogs, 'inventorySessions'];
    const labels = { inventoryOrgs: 'Организации', inventoryObjects: 'Объекты', inventoryMols: 'МОЛ и счета', inventoryItems: 'Имущество' };
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
    const isId = (value) => typeof value === 'string' || typeof value === 'number' && Number.isFinite(value);
    const str = (value) => typeof value === 'string' ? value : '';
    const rows = (db, key) => db[key] ?? [];
    const list = (value) => Array.isArray(value) ? value : [];
    const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const numberText = (value) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ru-RU', { maximumFractionDigits: 3 }) : 'Неизвестно';
    // Core totals can be exact decimals outside the lossless Number range. Keep
    // those known strings distinct from a genuinely unknown (null) total.
    function exactText(row, key) { const decimal = row[key + 'Decimal']; if (typeof decimal === 'string' && /^-?\d+(?:\.\d+)?$/.test(decimal)) {
        const [integer, fraction] = decimal.split('.');
        return integer.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + (fraction ? ',' + fraction : '');
    } return numberText(row[key]); }
    const valueText = (value) => typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
    const source = (snapshot) => JSON.stringify(sections.map(key => [key, rows(snapshot.database, key)]));
    function inputNumber(value, scale) { const text = value.trim().replace(',', '.'); if (!text)
        return null; if (!new RegExp('^(?:0|[1-9]\\d*)(?:\\.\\d{1,' + scale + '})?$').test(text))
        throw Error('Введите неотрицательное десятичное число с точностью до ' + scale + ' знаков; пустое поле означает неизвестное значение.'); const result = Number(text); if (!Number.isFinite(result))
        throw Error('Число вне допустимого диапазона'); return result; }
    function required(parent, selector) { const node = parent.querySelector(selector); if (!node)
        throw Error('Форма инвентаризации была закрыта или заменена'); return node; }
    function field(form, name) { const element = form.elements.namedItem(name); if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement))
        throw Error('Не найдено поле ' + name); return element; }
    const control = (name, label, value = '', type = 'text') => '<label>' + esc(label) + '<input name="' + esc(name) + '" type="' + type + '" value="' + esc(value) + '"' + (type === 'number' ? ' step="any" min="0"' : '') + '></label>';
    const textArea = (name, label, value = '') => '<label class="ai-wide">' + esc(label) + '<textarea name="' + name + '">' + esc(value) + '</textarea></label>';
    const button = (action, label, extra = '') => '<button type="button" class="btn btn-secondary" data-ai-action="' + action + '" ' + extra + '>' + esc(label) + '</button>';
    function create(host) {
        if (host.core?.apiVersion !== 1)
            throw Error('Не загружено ядро инвентаризации');
        const quantity = host.mode === 'quantity', heading = quantity ? 'Количественный учет' : 'Инвентаризация ОС';
        let container = null, tab = quantity ? 'quantity' : 'registry', form = null;
        let filters = { account: '', search: '' };
        let renderSnapshot = null, renderSource = '', filePending = null, memberSequence = 0;
        const refs = new Map();
        let sequence = 0;
        function supported(snapshot) { return snapshot.isSQLite && snapshot.schemaVersion === 6 && snapshot.capabilities.some(capability => capability.name === 'inventoryV1' && capability.version === 1); }
        function writable(snapshot = host.snapshot()) { return supported(snapshot) && snapshot.canRead && snapshot.canWrite; }
        function importOptions(snapshot) { return !supported(snapshot) ? 'title="Для импорта сначала создайте совместимую копию базы"' : writable(snapshot) ? '' : 'disabled'; }
        function unavailable(snapshot) { if (!snapshot.isSQLite)
            return 'Инвентаризация ОС работает только в SQLite. Создайте отдельную обновлённую копию базы; исходная база сохранится.'; if (snapshot.schemaVersion !== 6 || !supported(snapshot))
            return 'Для инвентаризации нужна отдельная обновлённая копия SQLite и сервер с поддержкой инвентаризации.'; return 'У вас доступ только для просмотра инвентаризации.'; }
        function assertSnapshot(captured, checkSource, write = false) { const current = host.snapshot(); if (current.database !== captured.database || current.identity !== captured.identity || !current.canRead)
            throw Error('База, пользователь или доступ изменились. Закройте форму и откройте её в текущем сеансе.'); if (checkSource !== null && (current.analysisStamp !== captured.analysisStamp || source(current) !== checkSource || current.today !== captured.today))
            throw Error('Исходные данные или рабочая дата изменились. Откройте форму заново и повторите проверку.'); if (write && !writable(current))
            throw Error(unavailable(current)); return current; }
        function check(s, checkSource = true, write = false) { if (form !== s || !s.element.isConnected)
            throw Error('Форма закрыта или заменена'); return assertSnapshot(s.captured, checkSource ? s.source : null, write); }
        function lookup(db, section, id) { const found = rows(db, section).filter(row => row.id === id); if (found.length !== 1)
            throw Error('Запись не найдена однозначно'); return found[0]; }
        function reference(section, id) { if (!isId(id))
            throw Error('Недопустимый идентификатор'); const token = 'r' + (++sequence); refs.set(token, { section, id }); return token; }
        function selectOptions(values, selected, choices, empty = 'Выберите…') { let html = '<option value="">' + esc(empty) + '</option>'; for (const row of values) {
            if (!isId(row.id))
                continue;
            const token = 'c' + choices.size;
            choices.set(token, row.id);
            html += '<option value="' + token + '"' + (row.id === selected ? ' selected' : '') + '>' + esc(row.name || row.title || row.id) + '</option>';
        } return html; }
        function selectField(name, label, values, selected, choices, empty) { return '<label>' + esc(label) + '<select name="' + name + '">' + selectOptions(values, selected, choices, empty) + '</select></label>'; }
        function selected(s, name, optional = false) { const token = field(s.element, name).value; if (optional && !token)
            return undefined; if (!s.choices.has(token))
            throw Error('Выберите значение в поле «' + name + '»'); return s.choices.get(token); }
        function name(db, section, id) { const found = rows(db, section).find(row => row.id === id); return found ? str(found.name) : 'Неизвестно'; }
        function active(db, section) { return rows(db, section).filter(row => !row.archived); }
        function itemScope(db, item) { const mol = rows(db, 'inventoryMols').find(row => row.id === item.molId) ?? {}; return { mol, orgName: name(db, 'inventoryOrgs', mol.orgId), objectName: name(db, 'inventoryObjects', mol.objectId) }; }
        function itemParentsActive(db, item) { const mol = rows(db, 'inventoryMols').find(row => row.id === item.molId); return !!mol && !mol.archived && rows(db, 'inventoryOrgs').some(row => row.id === mol.orgId && !row.archived) && rows(db, 'inventoryObjects').some(row => row.id === mol.objectId && !row.archived); }
        function itemMatches(db, item) { const { mol } = itemScope(db, item); return (filters.org === undefined || mol.orgId === filters.org) && (filters.object === undefined || mol.objectId === filters.object) && (filters.mol === undefined || item.molId === filters.mol) && (!filters.account || mol.accountCode === filters.account) && (!filters.search || [item.name, item.code, mol.name].some(value => String(value ?? '').toLocaleLowerCase('ru-RU').includes(filters.search.toLocaleLowerCase('ru-RU')))); }
        function sessionMatches(session) { const entries = list(session.rows), search = filters.search.toLocaleLowerCase('ru-RU'); return (filters.object === undefined || session.objectId === filters.object) && ((filters.org === undefined && filters.mol === undefined && !filters.account) || entries.some(row => (filters.org === undefined || row.orgId === filters.org) && (filters.mol === undefined || row.molId === filters.mol) && (!filters.account || row.accountCode === filters.account))) && (!search || [session.title, session.objectName, ...entries.flatMap(row => [row.name, row.code, row.molName])].some(value => String(value ?? '').toLocaleLowerCase('ru-RU').includes(search))); }
        function status(message, error = false) { if (!container)
            return; const node = container.querySelector('[data-ai-status]'); if (node) {
            node.textContent = message;
            node.classList.toggle('ai-error', error);
        } }
        function render(target) {
            const snapshot = host.snapshot();
            if (form && (form.captured.database !== snapshot.database || form.captured.identity !== snapshot.identity || !snapshot.canRead))
                invalidate();
            container = target;
            renderSnapshot = snapshot;
            renderSource = source(snapshot);
            refs.clear();
            sequence = 0;
            if (!snapshot.canRead) {
                target.innerHTML = '<section class="asset-inventory"><h2>' + heading + '</h2><p role="alert">Нет доступа к собственным справочникам инвентаризации.</p></section>';
                return;
            }
            const db = snapshot.database, choices = new Map(), mols = active(db, 'inventoryMols').filter(mol => (filters.org === undefined || mol.orgId === filters.org) && (filters.object === undefined || mol.objectId === filters.object));
            const filterHtml = selectField('filterOrg', 'Организация', active(db, 'inventoryOrgs'), filters.org, choices, 'Все организации') + selectField('filterObject', 'Объект', active(db, 'inventoryObjects'), filters.object, choices, 'Все объекты') + selectField('filterMol', 'МОЛ', mols, filters.mol, choices, 'Все МОЛ') + '<label>Счёт<select name="filterAccount"><option value="">Все счета</option>' + [...new Set(mols.map(mol => str(mol.accountCode)).filter(Boolean))].map(account => '<option' + (account === filters.account ? ' selected' : '') + '>' + esc(account) + '</option>').join('') + '</select></label>' + control('filterSearch', 'Название / код', filters.search);
            const tabs = quantity ? ['quantity', 'registry'] : ['registry', 'sessions', 'documents'];
            target.innerHTML = '<section class="asset-inventory" data-asset-inventory' + (quantity ? ' data-object-quantity' : '') + '><header class="ai-heading"><div><h2>' + heading + '</h2><p>' + (quantity ? 'Учётное имущество объектов и последний подтверждённый факт по утверждённым описям.' : 'Собственный реестр имущества, подсчёт по объектам и зафиксированные описи.') + '</p></div><div class="ai-actions">' + (host.openDocuments ? button('sourceDocuments', 'Загрузить файлы / архив') : '') + button('importLegacy', 'Импорт прежней базы', importOptions(snapshot)) + button('importXlsx', 'Импорт Excel', importOptions(snapshot)) + '</div></header>' + (snapshot.databaseIndependent ? '<section class="ai-notice" data-ai-database><strong>' + esc(snapshot.databaseLabel || 'База инвентаризации') + '</strong><p>Отдельная база имущества, МОЛ и описей. Импорт сохраняется здесь.</p>' + (host.openDatabaseFolder ? button('openDatabaseFolder', 'Открыть папку базы') : '') + '</section>' : '') + (!writable(snapshot) ? '<div class="ai-notice" role="status">' + esc(unavailable(snapshot)) + (!supported(snapshot) ? button('upgrade', 'Создать обновлённую копию') : '') + '</div>' : '') + '<div class="ai-filters">' + filterHtml + '</div><div class="ai-tabs" role="tablist" aria-label="Подразделы ' + (quantity ? 'количественного учета' : 'инвентаризации') + '">' + tabs.map(value => '<button type="button" role="tab" aria-selected="' + (value === tab) + '" data-ai-tab="' + value + '">' + ({ quantity: 'Остатки по объектам', registry: quantity ? 'Имущество' : 'Реестр имущества', sessions: 'Подсчёты', documents: 'Документы' }[value]) + '</button>').join('') + '</div><p data-ai-status role="status" aria-live="polite"></p><div data-ai-content>' + (tab === 'quantity' ? quantityHtml(snapshot) : tab === 'registry' ? registryHtml(snapshot) : sessionsHtml(snapshot)) + '</div></section>';
            target.querySelectorAll('.ai-filters input,.ai-filters select').forEach(element => element.addEventListener('change', () => { try {
                if (!renderSnapshot)
                    throw Error('Откройте раздел заново');
                assertSnapshot(renderSnapshot, renderSource);
                const selectedId = choices.get(element.value);
                if (element.name === 'filterOrg') {
                    if (selectedId === undefined)
                        delete filters.org;
                    else
                        filters.org = selectedId;
                    delete filters.object;
                    delete filters.mol;
                    filters.account = '';
                }
                else if (element.name === 'filterObject') {
                    if (selectedId === undefined)
                        delete filters.object;
                    else
                        filters.object = selectedId;
                    delete filters.mol;
                    filters.account = '';
                }
                else if (element.name === 'filterMol') {
                    if (selectedId === undefined)
                        delete filters.mol;
                    else
                        filters.mol = selectedId;
                }
                else if (element.name === 'filterAccount')
                    filters.account = element.value;
                else
                    filters.search = element.value;
                render(target);
            }
            catch (error) {
                status(errorMessage(error), true);
            } }));
            target.querySelectorAll('[data-ai-tab]').forEach(element => element.onclick = () => { tab = element.dataset.aiTab; render(target); });
            target.querySelectorAll('[data-ai-action]').forEach(element => element.onclick = () => { void route(element); });
        }
        function catalogToolbar(snapshot) { return '<div class="ai-actions ai-toolbar">' + catalogs.map(section => button('catalog', labels[section], 'data-ai-section="' + section + '"')).join('') + button('newItem', 'Добавить имущество', writable(snapshot) ? '' : 'disabled') + '</div>'; }
        function registryHtml(snapshot) {
            const db = snapshot.database, items = active(db, 'inventoryItems').filter(item => itemMatches(db, item) && (!quantity || itemParentsActive(db, item)));
            return catalogToolbar(snapshot) + '<p class="ai-muted">Показано позиций: ' + items.length + '. ' + (quantity ? 'Пустое количество означает неизвестное значение.' : 'Пустое количество или стоимость означают неизвестное значение.') + '</p><div class="ai-scroll"><table><thead><tr><th>Организация / объект</th><th>МОЛ / счёт</th><th>Наименование / код</th><th>Ед.</th><th>Количество</th>' + (quantity ? '' : '<th>Стоимость</th>') + '<th>Действие</th></tr></thead><tbody>' + items.map(item => { const scope = itemScope(db, item); return '<tr data-ai-item="' + reference('inventoryItems', item.id) + '"><td>' + esc(scope.orgName) + '<small>' + esc(scope.objectName) + '</small></td><td>' + esc(scope.mol.name) + '<small>' + esc(scope.mol.accountCode) + '</small></td><td>' + esc(item.name) + '<small>' + esc(item.code) + '</small></td><td>' + esc(item.unit || 'Не задано') + '</td><td data-ai-value="qty" data-status="' + (typeof item.qty === 'number' && Number.isFinite(item.qty) ? 'known' : 'unknown') + '">' + esc(numberText(item.qty)) + '</td>' + (quantity ? '' : '<td data-ai-value="cost" data-status="' + (typeof item.cost === 'number' && Number.isFinite(item.cost) ? 'known' : 'unknown') + '">' + esc(numberText(item.cost)) + '</td>') + '<td>' + button('edit', 'Открыть', 'data-ai-ref="' + reference('inventoryItems', item.id) + '"') + '</td></tr>'; }).join('') + '</tbody></table>' + (items.length ? '' : '<p class="ai-empty">Пока нет имущества по выбранным фильтрам. Создайте организацию, объект и МОЛ, затем добавьте позиции.</p>') + '</div>';
        }
        function quantityHtml(snapshot) {
            try {
                return quantityModelHtml(snapshot);
            }
            catch (error) {
                return catalogToolbar(snapshot) + '<p role="alert" class="ai-error">Не удалось рассчитать количественный учет: ' + esc(errorMessage(error)) + '. Проверьте исходную инвентаризацию.</p>';
            }
        }
        function quantityModelHtml(snapshot) {
            if (!host.core.quantityModel)
                return '<p role="alert">Для количественного учета обновите программу: модель остатков недоступна.</p>';
            const model = host.core.quantityModel(snapshot.database, { ...(filters.org === undefined ? {} : { orgId: filters.org }), ...(filters.object === undefined ? {} : { objectId: filters.object }), ...(filters.mol === undefined ? {} : { molId: filters.mol }), account: filters.account, search: filters.search, asOf: snapshot.today }), entries = list(model.rows), totals = list(model.totals), summary = object(model.summary);
            const stateText = { unrecorded: 'Нет подтверждённого факта', scopeChanged: 'После описи изменены объект, организация или МОЛ', unitChanged: 'После описи изменена единица', ambiguous: 'Противоречивые описи на одну дату' };
            const cell = (row, key) => '<td data-ai-value="' + key + '" data-status="' + (row[key] !== null && row[key] !== undefined || typeof row[key + 'Decimal'] === 'string' ? 'known' : 'unknown') + '">' + esc(exactText(row, key)) + '</td>';
            return catalogToolbar(snapshot) + '<p class="ai-muted">Позиций: ' + entries.length + ' · объектов: ' + esc(summary.objects ?? 0) + '. Неизвестный учёт: ' + esc(summary.unknownAcct ?? 0) + ' · нет сопоставимого подтверждённого факта: ' + esc(summary.unknownFact ?? 0) + '. Факт — последняя утверждённая опись каждой позиции; даты могут различаться. Факт не меняет учётное количество. Пустые значения показаны как «Неизвестно»; нулевой остаток сохраняется.</p>' + list(model.issues).map(issue => '<p class="ai-notice">' + esc(issue.message) + '</p>').join('') + '<div class="ai-scroll"><table data-ai-quantity><thead><tr><th>Объект / организация</th><th>МОЛ / счёт</th><th>Имущество / код</th><th>Ед.</th><th>Учётное кол-во</th><th>Последний подтверждённый факт</th><th>Дата описи</th><th>Отклонение от текущего учёта</th><th>Действие</th></tr></thead><tbody>' + entries.map(row => '<tr data-ai-quantity-row><td>' + esc(row.objectName) + '<small>' + esc(row.orgName) + '</small></td><td>' + esc(row.molName) + '<small>' + esc(row.accountCode) + '</small></td><td>' + esc(row.name) + '<small>' + esc(row.code) + '</small></td><td>' + esc(row.unit || 'Не задано') + '</td>' + cell(row, 'qtyAcct') + cell(row, 'qtyFact') + '<td>' + esc(row.inventoryDate || 'Нет описи') + (row.comparisonStatus !== 'known' ? '<small>' + esc(stateText[str(row.comparisonStatus)] || 'Неизвестно') + '</small>' : '') + '</td>' + cell(row, 'difference') + '<td>' + button('edit', 'Карточка', 'data-ai-ref="' + reference('inventoryItems', row.itemId) + '"') + (isId(row.sessionId) ? button('session', 'Опись', 'data-ai-ref="' + reference('inventorySessions', row.sessionId) + '"') : '') + '</td></tr>').join('') + '</tbody></table>' + (entries.length ? '' : '<p class="ai-empty">Нет имущества по выбранным фильтрам. Загрузите инвентаризацию или создайте организацию, объект, МОЛ и позиции имущества.</p>') + '</div>' + (totals.length ? '<h3>Итоги по объектам, организациям и единицам</h3><div class="ai-scroll"><table data-ai-quantity-totals><thead><tr><th>Объект / организация</th><th>Ед.</th><th>Позиций</th><th>Учёт</th><th>Факт</th><th>Даты описи</th><th>Отклонение</th></tr></thead><tbody>' + totals.map(group => '<tr><td>' + esc(group.objectName) + '<small>' + esc(group.orgName) + '</small></td><td>' + esc(group.unit || 'Не задано') + '</td><td>' + esc(group.rows) + '</td>' + cell(group, 'qtyAcct') + cell(group, 'qtyFact') + '<td>' + esc(group.inventoryDate || ([group.inventoryDateFrom, group.inventoryDateTo].filter(Boolean).join(' — ') || 'Нет описи')) + '</td>' + cell(group, 'difference') + '</tr>').join('') + '</tbody></table></div><p class="ai-muted">Разные объекты, организации и единицы не складываются. Неизвестные значения исключают полный итог.</p>' : '') + '<h3>Описи и подсчёты</h3>' + sessionsHtml(snapshot);
        }
        function sessionsHtml(snapshot) { const sessions = rows(snapshot.database, 'inventorySessions').filter(session => sessionMatches(session) && (tab !== 'documents' || session.status === 'approved')); return '<div class="ai-actions ai-toolbar">' + button('createSession', 'Начать подсчёт по объекту', writable(snapshot) ? '' : 'disabled') + '</div><p class="ai-muted">Опись сохраняет учётные данные на момент создания. Просмотр и ввод факта не меняют реестр имущества.</p><div class="ai-scroll"><table><thead><tr><th>Дата / название</th><th>Объект</th><th>Организация</th><th>Редакция</th><th>Состояние</th><th>Позиций</th><th>Действие</th></tr></thead><tbody>' + sessions.map(session => '<tr><td>' + esc(session.date) + '<small>' + esc(session.title) + '</small></td><td>' + esc(session.objectName) + '</td><td>' + esc(session.orgName || 'Все организации объекта') + '</td><td>' + esc(session.revision) + '</td><td>' + esc(session.status === 'approved' ? 'Утверждена' : 'Черновик') + '</td><td>' + list(session.rows).length + '</td><td>' + button('session', 'Открыть', 'data-ai-ref="' + reference('inventorySessions', session.id) + '"') + '</td></tr>').join('') + '</tbody></table>' + (sessions.length ? '' : '<p class="ai-empty">Здесь появятся ' + (tab === 'documents' ? 'утверждённые описи' : 'подсчёты по объектам') + '.</p>') + '</div>'; }
        async function route(element) { try {
            if (filePending)
                throw Error('Дождитесь завершения работы с файлом');
            if (!renderSnapshot)
                throw Error('Откройте раздел заново');
            assertSnapshot(renderSnapshot, renderSource);
            const action = element.dataset.aiAction, ref = refs.get(element.dataset.aiRef ?? '');
            if (action === 'openDatabaseFolder' && host.openDatabaseFolder)
                await host.openDatabaseFolder();
            else if (action === 'upgrade')
                host.openUpgrade();
            else if (action === 'catalog')
                catalogList(element.dataset.aiSection);
            else if (action === 'newItem')
                openCatalog('inventoryItems');
            else if (action === 'edit' && ref)
                openCatalog(ref.section, ref.id);
            else if (action === 'session' && ref)
                openSession(ref.id);
            else if (action === 'createSession')
                createSession();
            else if (action === 'sourceDocuments' && host.openDocuments) {
                const pending = host.openDocuments();
                filePending = pending.then(() => { });
                try {
                    const result = await pending;
                    status(result.message || '');
                }
                finally {
                    filePending = null;
                }
            }
            else if (action === 'importLegacy' || action === 'importXlsx')
                await importFile(action === 'importLegacy' ? 'legacy' : 'xlsx');
        }
        catch (error) {
            status(errorMessage(error), true);
        } }
        function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
        function close(force = false) { if (!form)
            return true; if (form.pending)
            return false; if (!force && !form.committed && dirty(form) && !host.confirmDiscard('Закрыть форму и потерять несохранённые значения инвентаризации?'))
            return false; form.dispose?.(); form.overlay.remove(); form = null; return true; }
        function dirty(s) { return JSON.stringify([...new FormData(s.element)].filter(([key]) => key !== 'confirm')) !== s.initial; }
        function show(title, html, choices = new Map()) {
            if (!close())
                throw Error('Сначала завершите открытую форму');
            const captured = host.snapshot();
            if (!captured.canRead)
                throw Error('Нет доступа к инвентаризации');
            const overlay = document.createElement('div');
            overlay.className = 'ai-overlay';
            overlay.innerHTML = '<section class="ai-dialog" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><header><h3>' + esc(title) + '</h3>' + button('close', 'Закрыть') + '</header><form class="ai-form" data-ai-form>' + html + '</form></section>';
            document.body.append(overlay);
            const s = { element: required(overlay, 'form'), overlay, captured, source: source(captured), input: () => ({}), review: null, reviewText: '', operationText: '', operationId: '', pending: null, initial: '', committed: false, uncertain: false, choices };
            form = s;
            required(overlay, '[data-ai-action=close]').onclick = () => { close(); };
            overlay.onclick = event => { if (event.target === overlay)
                close(); };
            overlay.onkeydown = event => { if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close();
            }
            else if (event.key === 'Tab') {
                const enabled = [...overlay.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(node => node.getClientRects().length > 0);
                const first = enabled[0], last = enabled[enabled.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                }
                else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                }
            } };
            s.element.onsubmit = event => { event.preventDefault(); void commit(s); };
            s.element.addEventListener('input', event => { if (event.target.getAttribute('name') !== 'confirm')
                invalidateReview(s); });
            s.element.addEventListener('change', event => { if (event.target.getAttribute('name') !== 'confirm')
                invalidateReview(s); });
            s.initial = JSON.stringify([...new FormData(s.element)]);
            queueMicrotask(() => { if (form === s)
                s.element.querySelector('input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled)')?.focus(); });
            return s;
        }
        function footer(label = 'Сохранить') { return '<label class="ai-wide">Основание действия<textarea name="reason" required minlength="3"></textarea></label><p class="ai-error" data-ai-error role="alert"></p><div data-ai-preview hidden></div><label class="ai-confirm" data-ai-confirm hidden><input type="checkbox" name="confirm">Подтверждаю проверенное действие</label><p data-ai-pending role="status" aria-live="polite"></p><div class="ai-actions">' + button('review', 'Проверить') + '<button class="btn btn-primary" type="submit" data-ai-save disabled>' + esc(label) + '</button></div>'; }
        function seal(s) { s.initial = JSON.stringify([...new FormData(s.element)].filter(([key]) => key !== 'confirm')); const review = s.element.querySelector('[data-ai-action=review]'); if (review)
            review.onclick = () => { try {
                preview(s);
            }
            catch (error) {
                formError(s, error);
            } }; const confirm = s.element.querySelector('[name=confirm]'); if (confirm)
            confirm.onchange = () => { const save = s.element.querySelector('[data-ai-save]'); if (save)
                save.disabled = !!s.pending || !s.review?.canApply || !confirm.checked; }; if (!writable(s.captured))
            s.element.querySelectorAll('input,textarea,select,button').forEach(element => { element.disabled = true; }); }
        function invalidateReview(s) { if (s.uncertain)
            return; s.review = null; s.reviewText = ''; const preview = s.element.querySelector('[data-ai-preview]'); if (preview)
            preview.hidden = true; const confirm = s.element.querySelector('[name=confirm]'); if (confirm)
            confirm.checked = false; const box = s.element.querySelector('[data-ai-confirm]'); if (box)
            box.hidden = true; const save = s.element.querySelector('[data-ai-save]'); if (save)
            save.disabled = true; }
        function formError(s, error) { const node = s.element.querySelector('[data-ai-error]'); if (node)
            node.textContent = errorMessage(error); }
        function preview(s) { if (s.pending)
            return; if (s.uncertain)
            throw Error('Результат прежней операции пока неизвестен. Повторите то же подтверждённое действие без изменения полей.'); check(s, true, true); const input = s.input(), result = host.core.preview(s.captured.database, input, { today: s.captured.today }); s.review = result; s.reviewText = JSON.stringify(input); const node = required(s.element, '[data-ai-preview]'); node.innerHTML = '<h4>' + (result.canApply ? 'Действие готово к подтверждению' : 'Нужно исправить') + '</h4>' + [...result.issues, ...result.warnings].map(issue => '<p class="' + (result.issues.includes(issue) ? 'ai-error' : 'ai-muted') + '">' + esc(issue.message) + '</p>').join('') + (result.session ? '<p>Опись: ' + esc(result.session.objectName) + ' · позиций ' + list(result.session.rows).length + ' · ' + esc(result.session.date) + '.</p>' : '<p>Изменится собственный справочник инвентаризации. Факт подсчёта не создаётся.</p>'); node.hidden = false; required(s.element, '[data-ai-confirm]').hidden = !result.canApply; field(s.element, 'confirm').value = 'on'; field(s.element, 'confirm').checked = false; required(s.element, '[data-ai-save]').disabled = true; formError(s, ''); }
        function ackId(s, input, ack) { const creating = input.action === 'createSession' || input.action === 'revise' || input.action === 'saveCatalog' && !own(input, 'id'), section = input.action === 'saveCatalog' || input.action === 'archiveCatalog' ? str(input.section) : 'inventorySessions', target = creating ? s.operationId : (isId(input.id) ? input.id : input.sessionId); if (!isId(target))
            throw Error('Не удалось определить подтверждённую запись'); if (ack.operationReceipt?.id !== s.operationId)
            throw Error('Сервер не подтвердил квитанцию текущей операции'); const canonical = ack.canonicalSections?.[section]?.filter(row => row.id === target) ?? [], current = rows(host.snapshot().database, section).filter(row => row.id === target); if (canonical.length !== 1 || current.length !== 1 || JSON.stringify(canonical[0]) !== JSON.stringify(current[0]))
            throw Error('Сервер не вернул однозначную каноническую запись. Проверьте результат операции перед повторным действием.'); if (section === 'inventorySessions') {
            const value = canonical[0];
            if (input.action === 'createSession' && (value.rootId !== target || value.revision !== 1) || input.action === 'revise' && (value.previousId !== input.sessionId || value.rootId !== s.original?.rootId || value.revision !== Number(s.original?.revision) + 1))
                throw Error('Подтверждённая редакция не соответствует действию');
        } return target; }
        async function commit(s) {
            if (s.pending)
                return;
            let committed = false;
            try {
                check(s, true, true);
                const input = s.input(), text = JSON.stringify(input);
                if (!s.review?.canApply || text !== s.reviewText || !field(s.element, 'confirm').checked)
                    throw Error('Сначала проверьте содержание и подтвердите действие');
                if (s.uncertain && s.operationText !== text)
                    throw Error('Сначала получите результат прежней операции. Изменять её содержание при неизвестном результате нельзя.');
                if (s.operationText !== text) {
                    s.operationText = text;
                    s.operationId = host.operationId();
                }
                const states = [...s.overlay.querySelectorAll('input,button,select,textarea')].map(element => ({ element, disabled: element.disabled }));
                states.forEach(({ element }) => { element.disabled = true; });
                required(s.element, '[data-ai-pending]').textContent = 'Ожидается подтверждение операции…';
                const pending = (async () => { let ack; try {
                    ack = await host.execute({ ...input, reviewFingerprint: s.review.fingerprint }, { operationId: s.operationId });
                }
                catch (error) {
                    s.uncertain = true;
                    throw error;
                } if (!ack?.ok) {
                    s.uncertain = ack?.unknown === true || ack?.definitive === false;
                    throw Error(ack?.message || ack?.error || (ack?.unknown ? 'Результат операции пока неизвестен. Сохраните форму и повторите ту же операцию.' : 'Сохранение не подтверждено; поля остаются в форме.'));
                } s.uncertain = false; committed = true; check(s, false, true); const id = ackId(s, input, ack); s.committed = true; s.pending = null; close(true); if (container)
                    render(container); if (input.action === 'createSession' || input.action === 'saveDraft' || input.action === 'amendDraft' || input.action === 'approve' || input.action === 'revise')
                    openSession(id);
                else
                    status('Изменение справочника подтверждено.'); })();
                s.pending = pending;
                try {
                    await pending;
                }
                finally {
                    s.pending = null;
                    states.forEach(({ element, disabled }) => { element.disabled = disabled; });
                    if (s.uncertain)
                        s.element.querySelectorAll('input,textarea,select,[data-ai-action=review]').forEach(element => { element.disabled = true; });
                }
            }
            catch (error) {
                formError(s, committed ? Error('Операция подтверждена, но контекст формы изменился. Откройте запись в исходной базе. ' + errorMessage(error)) : error);
            }
            finally {
                const pending = s.element.querySelector('[data-ai-pending]');
                if (pending)
                    pending.textContent = '';
            }
        }
        function catalogList(section) { if (!catalogs.includes(section))
            throw Error('Неизвестный справочник'); const snapshot = host.snapshot(), entries = active(snapshot.database, section), tokens = new Map(); const body = entries.map((entry, index) => { if (!isId(entry.id))
            return ''; const token = 'e' + index; tokens.set(token, entry.id); return '<tr><td>' + esc(entry.name) + '</td><td>' + esc(section === 'inventoryMols' ? entry.accountCode : entry.note) + '</td><td>' + button('entry', 'Открыть', 'data-ai-entry="' + token + '"') + '</td></tr>'; }).join(''); const s = show(labels[section], '<p>Справочник имущества для инвентаризации и количественного учета.</p><div class="ai-actions">' + button('new', 'Добавить', writable(snapshot) ? '' : 'disabled') + '</div><div class="ai-scroll"><table><thead><tr><th>Наименование</th><th>Примечание / счёт</th><th></th></tr></thead><tbody>' + body + '</tbody></table></div><p data-ai-error role="alert" class="ai-error"></p>'); required(s.element, '[data-ai-action=new]').onclick = () => { try {
            check(s, true, true);
            openCatalog(section);
        }
        catch (error) {
            formError(s, error);
        } }; s.element.querySelectorAll('[data-ai-entry]').forEach(element => element.onclick = () => { try {
            check(s);
            const id = tokens.get(element.dataset.aiEntry ?? '');
            if (id === undefined)
                throw Error('Запись заменена');
            openCatalog(section, id);
        }
        catch (error) {
            formError(s, error);
        } }); }
        function openCatalog(section, id) { try {
            if (!catalogs.includes(section))
                throw Error('Неизвестный справочник');
            const snapshot = host.snapshot(), db = snapshot.database, entry = id === undefined ? null : lookup(db, section, id), choices = new Map();
            let html = '<div class="ai-grid">' + control('name', 'Наименование', str(entry?.name));
            if (section === 'inventoryMols')
                html += selectField('orgId', 'Организация', active(db, 'inventoryOrgs'), isId(entry?.orgId) ? entry.orgId : filters.org, choices) + selectField('objectId', 'Объект', active(db, 'inventoryObjects'), isId(entry?.objectId) ? entry.objectId : filters.object, choices) + control('accountCode', 'Счёт', str(entry?.accountCode));
            if (section === 'inventoryItems')
                html += selectField('molId', 'МОЛ / счёт', active(db, 'inventoryMols').map(mol => ({ ...mol, name: str(mol.name) + ' · ' + name(db, 'inventoryOrgs', mol.orgId) + ' / ' + name(db, 'inventoryObjects', mol.objectId) + ' · ' + str(mol.accountCode) })), isId(entry?.molId) ? entry.molId : filters.mol, choices) + control('code', 'Код / инвентарный номер', str(entry?.code)) + control('unit', 'Единица измерения', str(entry?.unit)) + control('qty', 'Учётное количество', valueText(entry?.qty)) + (quantity ? '' : control('cost', 'Учётная стоимость', valueText(entry?.cost)));
            html += textArea('note', 'Примечание', str(entry?.note)) + '</div>' + footer() + (entry && writable(snapshot) ? button('archive', 'В архив') : '');
            const s = show((entry ? 'Карточка: ' : 'Добавить: ') + labels[section], html, choices);
            s.input = () => { const payload = { name: field(s.element, 'name').value, note: field(s.element, 'note').value }; if (section === 'inventoryMols')
                Object.assign(payload, { orgId: selected(s, 'orgId'), objectId: selected(s, 'objectId'), accountCode: field(s.element, 'accountCode').value }); if (section === 'inventoryItems')
                Object.assign(payload, { molId: selected(s, 'molId'), code: field(s.element, 'code').value, unit: field(s.element, 'unit').value, qty: inputNumber(field(s.element, 'qty').value, 3), cost: quantity ? (entry?.cost ?? null) : inputNumber(field(s.element, 'cost').value, 2) }); return { action: 'saveCatalog', section, ...(id !== undefined ? { id } : {}), payload, reason: field(s.element, 'reason').value }; };
            if (entry) {
                const archive = s.element.querySelector('[data-ai-action=archive]');
                if (archive)
                    archive.onclick = () => { try {
                        check(s, true, true);
                        if (dirty(s) && !host.confirmDiscard('Отменить введённые изменения и перейти к архивированию?'))
                            return;
                        s.committed = true;
                        const next = show('Архивирование: ' + str(entry.name), '<p>Запись останется в сохранённых описях, но не будет доступна для новых подсчётов.</p>' + footer('В архив'));
                        next.input = () => ({ action: 'archiveCatalog', section, id, reason: field(next.element, 'reason').value });
                        seal(next);
                    }
                    catch (error) {
                        formError(s, error);
                    } };
            }
            seal(s);
        }
        catch (error) {
            status(errorMessage(error), true);
        } }
        function createSession() { const snapshot = host.snapshot(); if (!writable(snapshot))
            throw Error(unavailable(snapshot)); const choices = new Map(), s = show('Начать подсчёт по объекту', '<p>Учётные данные и названия будут скопированы в новую опись. Позже изменения реестра не перепишут эту опись.</p><div class="ai-grid">' + selectField('objectId', 'Объект', active(snapshot.database, 'inventoryObjects'), filters.object, choices) + selectField('orgId', 'Организация', active(snapshot.database, 'inventoryOrgs'), filters.org, choices, 'Все организации объекта') + control('date', 'Дата описи', snapshot.today, 'date') + control('title', 'Название описи') + '</div>' + footer('Создать черновик'), choices); s.input = () => { const orgId = selected(s, 'orgId', true); return { action: 'createSession', objectId: selected(s, 'objectId'), ...(orgId === undefined ? {} : { orgId }), date: field(s.element, 'date').value, title: field(s.element, 'title').value, reason: field(s.element, 'reason').value }; }; seal(s); }
        function commissionHtml(value) { const commission = object(value.commission), chairman = object(commission.chairman), members = list(commission.members); return '<fieldset><legend>Комиссия</legend><div class="ai-grid">' + control('chairmanName', 'ФИО председателя', str(chairman.name)) + control('chairmanPosition', 'Должность председателя', str(chairman.position)) + '</div><div data-ai-members>' + members.map((person, index) => memberHtml(person, index)).join('') + '</div>' + button('addMember', 'Добавить члена комиссии') + '</fieldset>'; }
        function memberHtml(person, index) { return '<div class="ai-member" data-ai-member="' + index + '">' + control('memberName' + index, 'ФИО', str(person.name)) + control('memberPosition' + index, 'Должность', str(person.position)) + button('removeMember', 'Убрать') + '</div>'; }
        function countMatches(row) { return row.countMode === 'samePrice' ? row.matches === true : typeof row.qtyAcct === 'number' && row.qtyFact === row.qtyAcct && row.costFact === row.costAcct; }
        function countValue(row, matches, qtyFact) { if (!host.core.countValue)
            throw Error('Обновите программу: расчёт по фиксированной цене не загружен.'); return host.core.countValue(row, { matches, qtyFact }); }
        function priceText(row) { const value = host.core.countValue?.(row, { matches: false, qtyFact: null }).unitPriceDecimal; return typeof value === 'string' ? value.replace('.', ',') : 'Не задана'; }
        function factsHtml(model, editable) {
            return '<div class="ai-scroll ai-facts"><table><thead><tr><th>Организация / МОЛ / счёт</th><th>Имущество / код</th><th>Ед.</th><th>Кол-во учёт</th><th>Совпадает</th><th>Кол-во факт</th>' + (quantity ? '' : '<th>Цена за единицу</th><th>Сумма учёт</th><th>Сумма факт</th>') + '<th>Решение</th><th>Примечание</th>' + (host.mountPhotos ? '<th>Фото позиции</th>' : '') + '</tr></thead><tbody>' + list(model.rows).map((row, index) => {
                const matches = countMatches(row), unknown = typeof row.qtyAcct !== 'number', legacy = row.countMode !== 'samePrice' && (row.qtyFact !== null || row.costFact !== null);
                return '<tr data-ai-fact="' + index + '" data-ai-count-row="' + index + '"><td>' + esc(row.orgName) + '<small>' + esc(row.molName) + ' · ' + esc(row.accountCode) + '</small></td><td>' + esc(row.name) + '<small>' + esc(row.code) + '</small></td><td>' + esc(row.unit || 'Не задано') + '</td><td>' + esc(numberText(row.qtyAcct)) + '</td><td><label class="ai-match"><input type="checkbox" name="matches' + index + '" aria-label="Совпадает: ' + esc(row.name) + '"' + (matches ? ' checked' : '') + (!editable || unknown ? ' disabled' : '') + '>Совпадает</label></td><td>' + (editable ? '<input aria-label="Фактическое количество: ' + esc(row.name) + '" name="qtyFact' + index + '" value="' + esc(valueText(row.qtyFact)) + '" inputmode="decimal"' + (matches ? ' readonly' : '') + '>' : esc(numberText(row.qtyFact))) + '</td>' + (quantity ? '' : '<td><span data-ai-count-price="' + index + '">' + esc(priceText(row)) + '</span></td><td>' + esc(numberText(row.costAcct)) + '</td><td>' + (editable ? '<input aria-label="Фактическая стоимость: ' + esc(row.name) + '" name="costFact' + index + '" value="' + esc(valueText(row.costFact)) + '" readonly inputmode="decimal">' : esc(numberText(row.costFact))) + (editable && legacy ? '<small data-ai-count-legacy="' + index + '">Сохранённая сумма. Изменение количества или галочки пересчитает её по учётной цене.</small>' : '') + '</td>') + '<td>' + (editable ? '<select aria-label="Решение: ' + esc(row.name) + '" name="action' + index + '">' + [['', 'Не выбрано'], ['writeoff', 'Списать'], ['transfer', 'Передать']].map(([value, label]) => '<option value="' + value + '"' + (row.action === value ? ' selected' : '') + '>' + label + '</option>').join('') + '</select>' : esc(row.action === 'writeoff' ? 'Списать' : row.action === 'transfer' ? 'Передать' : 'Не выбрано')) + '</td><td>' + (editable ? '<input aria-label="Примечание: ' + esc(row.name) + '" name="note' + index + '" value="' + esc(row.note) + '">' : esc(row.note)) + '</td>' + (host.mountPhotos ? '<td data-ai-photo-row="' + index + '"></td>' : '') + '</tr>';
            }).join('') + '</tbody></table></div>';
        }
        function summaryHtml(model) { const summary = object(model.summary), costs = object(summary.costs); return '<div class="ai-summary"><p>Позиций: ' + esc(summary.rows) + ' · проверено: ' + esc(summary.checked) + ' · недостача: ' + esc(summary.shortage) + ' · излишек: ' + esc(summary.surplus) + '</p>' + list(summary.quantities).map(group => '<p>' + esc(group.unit || 'Единица не задана') + ': учёт ' + esc(exactText(group, 'qtyAcct')) + '; факт ' + esc(exactText(group, 'qtyFact')) + '; разница ' + esc(exactText(group, 'difference')) + '.</p>').join('') + (quantity ? '' : '<p>Стоимость: учёт ' + esc(exactText(costs, 'costAcct')) + '; факт ' + esc(exactText(costs, 'costFact')) + '; разница ' + esc(exactText(costs, 'difference')) + '.</p>') + '<p class="ai-muted">Разные единицы не складываются. Неизвестные значения исключают полный итог.</p></div>'; }
        function openSession(id) {
            try {
                const snapshot = host.snapshot(), session = lookup(snapshot.database, 'inventorySessions', id), model = host.core.exportModel(session), readonly = session.status === 'approved' || !writable(snapshot);
                let html = '<div class="ai-actions">' + (quantity ? '' : button('exportXlsx', 'Сохранить Excel') + button('exportPdf', 'Сохранить PDF')) + (session.status === 'draft' && writable(snapshot) ? button('amendDraft', 'Исправить учётные данные') + button('approve', 'Утвердить') : '') + (session.status === 'approved' && writable(snapshot) ? button('revise', 'Новая редакция') : '') + '</div><p class="ai-muted">' + esc(model.objectName) + ' · ' + esc(model.orgName || 'Все организации объекта') + ' · редакция ' + esc(model.revision) + ' · ' + (session.status === 'approved' ? 'Утверждённая опись' : 'Черновик: документ не утверждён') + '</p>';
                if (readonly) {
                    const approval = object(model.approval), commission = object(model.commission), chairman = object(commission.chairman);
                    html += '<h4>' + esc(model.title) + '</h4><p>' + esc(model.date) + ' · ' + esc(model.note) + '</p>' + (session.status === 'approved' ? '<p>Утверждено ' + esc(approval.date) + ' · ' + esc(approval.document) + ' · ' + esc(approval.actor) + '</p>' : '') + '<p>Председатель: ' + esc(chairman.name) + ' · ' + esc(chairman.position) + '</p>' + list(commission.members).map(person => '<p>' + esc(person.name) + ' · ' + esc(person.position) + '</p>').join('') + factsHtml(model, false) + summaryHtml(model) + amendmentsHtml(model) + '<p data-ai-error class="ai-error" role="alert"></p>';
                }
                else
                    html += '<div class="ai-grid">' + control('date', 'Дата описи', str(session.date), 'date') + control('title', 'Название', str(session.title)) + textArea('note', 'Примечание', str(session.note)) + '</div>' + commissionHtml(session) + factsHtml(session, true) + summaryHtml(model) + amendmentsHtml(model) + footer('Сохранить факт');
                const s = show('Опись: ' + str(model.objectName), html);
                s.sessionId = id;
                s.original = clone(session);
                const touched = new Set();
                s.input = () => { const facts = list(session.rows).map((row, index) => { const qtyFact = inputNumber(field(s.element, 'qtyFact' + index).value, 3), matches = field(s.element, 'matches' + index).checked, newMode = row.countMode === 'samePrice' || touched.has(index) || row.qtyFact === null && row.costFact === null, counts = newMode ? countValue(row, matches, qtyFact) : { qtyFact, costFact: row.costFact ?? null }; return { qtyFact: counts.qtyFact, costFact: counts.costFact, ...(newMode ? { countMode: 'samePrice', matches } : {}), rowId: row.id, action: field(s.element, 'action' + index).value, note: field(s.element, 'note' + index).value }; }), members = [...s.element.querySelectorAll('[data-ai-member]')].map(node => { const inputs = node.querySelectorAll('input'); return { name: inputs[0]?.value ?? '', position: inputs[1]?.value ?? '' }; }); return { action: 'saveDraft', sessionId: id, payload: { date: field(s.element, 'date').value, title: field(s.element, 'title').value, note: field(s.element, 'note').value, commission: { chairman: { name: field(s.element, 'chairmanName').value, position: field(s.element, 'chairmanPosition').value }, members }, facts }, reason: field(s.element, 'reason').value }; };
                s.element.querySelectorAll('[data-ai-action]').forEach(element => element.onclick = () => { try {
                    check(s);
                    const action = element.dataset.aiAction;
                    if (action === 'exportXlsx' || action === 'exportPdf') {
                        if (dirty(s))
                            throw Error('Сначала сохраните или отмените изменения перед выгрузкой');
                        void exportFile(s, action === 'exportXlsx' ? 'xlsx' : 'pdf');
                    }
                    else if (action === 'approve' || action === 'revise' || action === 'amendDraft') {
                        if (dirty(s))
                            throw Error('Сначала сохраните или отмените изменения описи');
                        if (action === 'amendDraft')
                            amendDraftForm(s, id);
                        else
                            actionForm(s, id, action);
                    }
                    else if (action === 'addMember') {
                        const members = required(s.element, '[data-ai-members]');
                        const index = ++memberSequence + list(object(session.commission).members).length;
                        members.insertAdjacentHTML('beforeend', memberHtml({}, index));
                        bindMembers(s);
                        invalidateReview(s);
                    }
                }
                catch (error) {
                    formError(s, error);
                } });
                if (!readonly) {
                    list(session.rows).forEach((row, index) => {
                        const match = field(s.element, 'matches' + index), qty = field(s.element, 'qtyFact' + index);
                        const update = () => { if (s.pending || s.uncertain)
                            return; try {
                            check(s, true, true);
                            touched.add(index);
                            qty.readOnly = match.checked;
                            const counted = countValue(row, match.checked, inputNumber(qty.value, 3));
                            qty.value = valueText(counted.qtyFact);
                            const cost = s.element.elements.namedItem('costFact' + index);
                            if (cost instanceof HTMLInputElement)
                                cost.value = valueText(counted.costFact);
                            s.element.querySelector('[data-ai-count-legacy="' + index + '"]')?.remove();
                            invalidateReview(s);
                            formError(s, '');
                        }
                        catch (error) {
                            const cost = s.element.elements.namedItem('costFact' + index);
                            if (cost instanceof HTMLInputElement)
                                cost.value = '';
                            formError(s, error);
                        } };
                        match.addEventListener('change', () => { qty.value = match.checked ? valueText(row.qtyAcct) : ''; update(); });
                        qty.addEventListener('input', update);
                    });
                    bindMembers(s);
                    seal(s);
                }
                else
                    s.initial = JSON.stringify([...new FormData(s.element)]);
                if (host.mountPhotos)
                    s.dispose = host.mountPhotos({ container: s.element, sessionId: id, rows: list(session.rows), readOnly: readonly, isCurrent: () => { try {
                            check(s, false);
                            return true;
                        }
                        catch {
                            return false;
                        } }, setPending: pending => { s.pending = pending; } });
            }
            catch (error) {
                status(errorMessage(error), true);
            }
        }
        function amendmentsHtml(model) {
            const amendments = list(model.amendments);
            if (!amendments.length)
                return '';
            return '<section class="ai-summary" data-ai-amendments><h4>Исправления учётных данных</h4>' + amendments.map(amendment => {
                const before = object(amendment.before), after = object(amendment.after), row = list(model.rows).find(value => value.id === amendment.rowId);
                return '<div><p><strong>' + esc(row?.name ?? 'Позиция описи') + '</strong>: единица ' + esc(before.unit || 'Не задано') + ' → ' + esc(after.unit || 'Не задано') + '; количество ' + esc(numberText(before.qtyAcct)) + ' → ' + esc(numberText(after.qtyAcct)) + (quantity ? '' : '; стоимость ' + esc(numberText(before.costAcct)) + ' → ' + esc(numberText(after.costAcct))) + '.</p><p class="ai-muted">' + esc(amendment.reason) + ' · ' + esc(amendment.actor) + ' · ' + esc(amendment.at) + '</p></div>';
            }).join('') + '</section>';
        }
        function amendDraftForm(prior, id) {
            check(prior, true, true);
            const original = prior.original;
            if (original.status !== 'draft')
                throw Error('Утверждённую опись изменять нельзя. Создайте новую редакцию.');
            const entries = list(original.rows);
            prior.committed = true;
            const html = '<p>Выберите строки и укажите проверенные учётные данные. Пустое числовое поле означает неизвестное значение. Поправка сохранится с причиной и автором; исходный источник импорта и каталог имущества останутся прежними.</p><div class="ai-scroll"><table><thead><tr><th>Исправить</th><th>Имущество / МОЛ</th><th>Единица измерения</th><th>Учётное количество</th>' + (quantity ? '' : '<th>Учётная стоимость</th>') + '</tr></thead><tbody>' + entries.map((row, index) => '<tr data-ai-correction="' + index + '"><td><input type="checkbox" name="correct' + index + '" aria-label="Исправить: ' + esc(row.name) + '"></td><td>' + esc(row.name) + '<small>' + esc(row.code) + ' · ' + esc(row.molName) + '</small></td><td><input name="unit' + index + '" aria-label="Единица: ' + esc(row.name) + '" value="' + esc(row.unit) + '" disabled></td><td><input name="qtyAcct' + index + '" aria-label="Учётное количество: ' + esc(row.name) + '" value="' + esc(valueText(row.qtyAcct)) + '" inputmode="decimal" disabled></td>' + (quantity ? '' : '<td><input name="costAcct' + index + '" aria-label="Учётная стоимость: ' + esc(row.name) + '" value="' + esc(valueText(row.costAcct)) + '" inputmode="decimal" disabled></td>') + '</tr>').join('') + '</tbody></table></div>' + footer('Сохранить исправления');
            const s = show('Исправить учётные данные описи', html);
            s.original = original;
            s.input = () => ({ action: 'amendDraft', sessionId: id, corrections: entries.flatMap((row, index) => field(s.element, 'correct' + index).checked ? [{ rowId: row.id, unit: field(s.element, 'unit' + index).value, qtyAcct: inputNumber(field(s.element, 'qtyAcct' + index).value, 3), costAcct: quantity ? (row.costAcct ?? null) : inputNumber(field(s.element, 'costAcct' + index).value, 2) }] : []), reason: field(s.element, 'reason').value });
            s.element.querySelectorAll('input[type=checkbox][name^=correct]').forEach(element => element.addEventListener('change', () => { if (s.pending || s.uncertain)
                return; const row = element.closest('[data-ai-correction]'); row?.querySelectorAll('input:not([type=checkbox])').forEach(input => { input.disabled = !element.checked; }); }));
            seal(s);
        }
        function bindMembers(s) { s.element.querySelectorAll('[data-ai-action=removeMember]').forEach(element => element.onclick = () => { if (s.pending)
            return; try {
            check(s, true, true);
            element.closest('[data-ai-member]')?.remove();
            invalidateReview(s);
        }
        catch (error) {
            formError(s, error);
        } }); }
        function actionForm(prior, id, action) { check(prior, true, true); const original = prior.original; prior.committed = true; const s = show(action === 'approve' ? 'Утвердить опись' : 'Новая редакция описи', (action === 'approve' ? '<p>Утверждение фиксирует опись, подписи и решение. Каталог имущества автоматически не изменяется.</p><div class="ai-grid">' + control('date', 'Фактическая дата утверждения', '', 'date') + control('document', 'Решение / приказ') + '</div>' : '<p>Утверждённая опись сохранится. Будет создан отдельный черновик следующей редакции с прежними данными.</p>') + footer(action === 'approve' ? 'Утвердить' : 'Создать редакцию')); s.original = original; s.input = () => ({ action, sessionId: id, ...(action === 'approve' ? { date: field(s.element, 'date').value, document: field(s.element, 'document').value } : {}), reason: field(s.element, 'reason').value }); seal(s); }
        async function exportFile(s, format) { if (filePending || s.pending)
            return; let saved = false; try {
            check(s);
            if (s.sessionId === undefined)
                throw Error('Опись не выбрана');
            if (!host.exportFile)
                throw Error('Выгрузка ' + format.toUpperCase() + ' недоступна в этом подключении. Обновите программу или сервер.');
            const sessionId = s.sessionId, model = host.core.exportModel(lookup(host.snapshot().database, 'inventorySessions', sessionId));
            const controls = [...s.overlay.querySelectorAll('input,button,select,textarea')], states = controls.map(element => ({ element, disabled: element.disabled }));
            states.forEach(({ element }) => { element.disabled = true; });
            const pending = (async () => { const result = await host.exportFile({ format, sessionId, model }); saved = result.ok; check(s); if (!result.ok && !result.cancelled)
                throw Error(result.error || 'Файл не сохранён'); formError(s, result.cancelled ? 'Сохранение отменено' : result.message || 'Файл сохранён'); })();
            filePending = pending;
            s.pending = pending;
            try {
                await pending;
            }
            finally {
                filePending = null;
                s.pending = null;
                states.forEach(({ element, disabled }) => { element.disabled = disabled; });
            }
        }
        catch (error) {
            formError(s, saved ? Error('Файл уже сохранён, но контекст формы изменился. ' + errorMessage(error)) : error);
        } }
        async function importFile(format) {
            if (filePending)
                return;
            const snapshot = host.snapshot();
            assertSnapshot(snapshot, source(snapshot));
            // Legacy bases stay unchanged. The import action leads to the existing,
            // reviewed copy workflow before attempting any inventory file operation.
            if (!supported(snapshot)) {
                status('Для импорта создайте и выберите совместимую копию базы в открывшемся окне.');
                host.openUpgrade();
                return;
            }
            assertSnapshot(snapshot, source(snapshot), true);
            if (!host.importFile)
                throw Error('Безопасный предпросмотр импорта недоступен в этом подключении. Никакие данные не записаны.');
            const scope = { ...(filters.org === undefined ? {} : { orgId: filters.org }), ...(filters.object === undefined ? {} : { objectId: filters.object }), ...(filters.mol === undefined ? {} : { molId: filters.mol }) };
            const capturedSource = source(snapshot), pending = (async () => { const result = await host.importFile({ format, scope }); assertSnapshot(snapshot, null, true); if (!result.ok && !result.cancelled)
                throw Error(result.error || 'Импорт не подтверждён'); status(result.cancelled ? 'Импорт отменён' : result.message || 'Предпросмотр импорта открыт.'); if (source(host.snapshot()) !== capturedSource && container)
                render(container); })();
            filePending = pending;
            try {
                await pending;
            }
            finally {
                filePending = null;
            }
        }
        function hasPendingEdits() { return !!filePending || !!form && (!!form.pending || dirty(form)); }
        async function flush() { const pending = filePending ?? form?.pending; if (pending) {
            try {
                await pending;
            }
            catch {
                return false;
            }
        } if (form && dirty(form) && !form.committed)
            return false; return true; }
        function unmount() { if (filePending || !close())
            return false; container = null; renderSnapshot = null; refs.clear(); return true; }
        // Only a forced session/access revocation uses this path. Ordinary navigation
        // must retain dirty drafts and respect the pending-write unmount barrier.
        function invalidate() { form?.dispose?.(); form?.overlay.remove(); form = null; if (container)
            container.replaceChildren(); container = null; renderSnapshot = null; renderSource = ''; refs.clear(); filters = { account: '', search: '' }; }
        return { render, unmount, invalidate, flush, hasPendingEdits, openCatalog, openSession };
    }
    AssetInventoryWorkspace.create = create;
})(AssetInventoryWorkspace || (AssetInventoryWorkspace = {}));
let assetInventoryMountedWorkspace = null;
let objectQuantityMountedWorkspace = null;
let assetInventoryMountedIdentity = null;
let assetInventoryDatabaseCache = null;
let assetInventoryDatabaseLoading = null;
let assetInventoryDatabaseGeneration = 0, assetInventoryRenderGeneration = 0;
let assetInventoryVisibleMode = null;
const assetInventoryOwnSections = ['inventoryOrgs', 'inventoryObjects', 'inventoryMols', 'inventoryItems', 'inventorySessions'];
const assetInventoryCommandIntents = new Map();
const assetInventoryEmptyDatabase = {};
function assetInventoryDatabaseBridge() { return window.electronAPI?.inventoryDatabase; }
function assetInventoryParentIdentity() { const context = platformSessionContext(); return JSON.stringify([_sync.databaseToken ?? null, _sync.epoch ?? null, context.policyStamp ?? null, context.actor ?? null, context.readable ?? null, context.writable ?? null, context.accessPolicy ?? null, context.fieldPermissions ?? null]); }
function assetInventoryDatabaseToken() { return assetInventoryDatabaseBridge() ? (assetInventoryDatabaseCache?.parent === assetInventoryParentIdentity() ? assetInventoryDatabaseCache.token : null) : _sync.databaseToken ?? null; }
function assetInventoryHostSnapshot() {
    const context = platformSessionContext(), has = (names, name) => !Array.isArray(names) || names.includes('*') || names.includes(name), parent = assetInventoryParentIdentity();
    const independent = !!assetInventoryDatabaseBridge(), cache = assetInventoryDatabaseCache?.parent === parent ? assetInventoryDatabaseCache : null, platform = independent ? cache?.platform : _sync.platform;
    const canRead = assetInventoryOwnSections.every(name => has(context.readable, name) && (!independent || has(cache?.access.readable, name)));
    const today = independent && cache && typeof BusinessCalendar === 'object' ? BusinessCalendar.resolve(cache.database, new Date().toISOString()).today : context.today;
    return { database: independent ? cache?.database ?? assetInventoryEmptyDatabase : data, identity: independent ? JSON.stringify([parent, cache?.token ?? null]) : parent, analysisStamp: independent ? JSON.stringify([cache?.stamp ?? 0, context.readable ?? null, context.writable ?? null]) : wfCommandContextStamp(), isSQLite: platform?.storageKind === 'sqlite', schemaVersion: platform?.schemaVersion ?? 0, capabilities: platform?.negotiation?.selectedProfile?.capabilities ?? platform?.capabilities ?? [], canRead, canWrite: (!independent ? context.blocked !== true : true) && platform?.readOnly !== true && (!independent || cache !== null) && assetInventoryOwnSections.every(name => has(context.writable, name) && (!independent || has(cache?.access.writable, name))), today, ...(independent ? { databaseIndependent: true, databaseLabel: 'База инвентаризации' } : {}) };
}
async function assetInventoryDatabaseRequest(action, request) {
    const rpc = assetInventoryDatabaseBridge(), parent = assetInventoryParentIdentity(), generation = assetInventoryDatabaseGeneration, token = _sync.databaseToken;
    if (!rpc || typeof token !== 'string' || !token)
        throw Error('Нет подтверждённого подключения к базе инвентаризации');
    const result = await rpc({ action, parentDatabaseToken: token, ...(request ? { request } : {}) });
    if (parent !== assetInventoryParentIdentity() || generation !== assetInventoryDatabaseGeneration)
        throw Error('База, пользователь или доступ изменились. Откройте раздел заново.');
    return result;
}
function assetInventoryInstallDatabase(reply, parent) {
    if (!reply.ok || !reply.data || typeof reply.databaseToken !== 'string' || !reply.databaseToken || !reply.platform || assetInventoryOwnSections.some(name => !Array.isArray(reply.data?.[name])))
        throw Error(reply.error || 'База инвентаризации не подтвердила собственные данные');
    const old = assetInventoryDatabaseCache?.parent === parent ? assetInventoryDatabaseCache : null, database = old?.database ?? {};
    for (const name of [...assetInventoryOwnSections, 'appMeta'])
        if (Array.isArray(reply.data[name]))
            database[name] = JSON.parse(JSON.stringify(reply.data[name]));
    assetInventoryDatabaseCache = { parent, token: reply.databaseToken, database, revisions: { ...reply.revisions }, platform: reply.platform, access: reply.access ?? {}, stamp: (old?.stamp ?? 0) + 1 };
}
async function assetInventoryLoadDatabase() {
    if (assetInventoryDatabaseLoading)
        return assetInventoryDatabaseLoading;
    const parent = assetInventoryParentIdentity(), pending = (async () => { const reply = await assetInventoryDatabaseRequest('snapshot'); assetInventoryInstallDatabase(reply, parent); })();
    assetInventoryDatabaseLoading = pending;
    try {
        await pending;
    }
    finally {
        if (assetInventoryDatabaseLoading === pending)
            assetInventoryDatabaseLoading = null;
    }
}
async function assetInventoryExecuteCommand(command, options) {
    if (!assetInventoryDatabaseBridge())
        return platformExecuteCommand(command, options);
    const cache = assetInventoryDatabaseCache, parent = assetInventoryParentIdentity(), id = options.operationId;
    if (!cache || cache.parent !== parent)
        return { ok: false, error: 'Сначала дождитесь загрузки базы инвентаризации' };
    if (command.type !== 'AssetInventoryAction')
        return { ok: false, error: 'В базе инвентаризации разрешены только действия с имуществом' };
    const parsed = PlatformCommands.parseCommand(command), signature = JSON.stringify(parsed);
    let entry = assetInventoryCommandIntents.get(id);
    if (entry && (entry.parent !== parent || entry.signature !== signature))
        return { ok: false, error: 'Идентификатор операции уже связан с другим действием' };
    if (entry?.pending)
        return entry.pending;
    if (entry?.result?.ok)
        return entry.result;
    if (!entry) {
        if (assetInventoryCommandIntents.size >= 128) {
            const oldest = [...assetInventoryCommandIntents].find(([, value]) => !value.pending && !value.result?.unknown && value.result?.definitive !== false);
            if (oldest)
                assetInventoryCommandIntents.delete(oldest[0]);
            else
                return { ok: false, error: 'Проверьте неподтверждённые операции инвентаризации' };
        }
        const envelope = { protocolVersion: 1, databaseToken: cache.token, base: Object.fromEntries(PlatformCommands.dependencies(parsed).map(name => [name, cache.revisions[name] ?? 0])), operation: { id }, command: parsed };
        envelope.operation.digest = PlatformKernel.requestDigest(envelope);
        entry = { parent, signature, envelope, pending: null, result: null };
        assetInventoryCommandIntents.set(id, entry);
    }
    const intent = entry, snapshot = assetInventoryHostSnapshot(), pending = (async () => {
        let sent = false;
        try {
            if (!snapshot.canRead || !snapshot.canWrite)
                throw Error('Нет права изменения базы инвентаризации');
            sent = true;
            const result = await assetInventoryDatabaseRequest('execute', intent.envelope);
            if (!result.ok)
                return result;
            const receipt = result.operationReceipt, operation = intent.envelope.operation;
            if (result.databaseToken !== cache.token || receipt?.id !== id || receipt.digest !== operation.digest || !['committed', 'replayed'].includes(receipt.status ?? ''))
                throw Error('Сервер не подтвердил квитанцию операции инвентаризации');
            const expected = [...new Set([...PlatformCommands.footprint(parsed), 'auditLog'])], canonical = result.canonicalSections, changed = result.changed ?? Object.keys(canonical ?? {});
            // The command footprint permits changes; unchanged catalogs are omitted by
            // the server. Require canonical rows for each actual acknowledged change.
            if (!canonical || changed.some(name => !expected.includes(name) || !Array.isArray(canonical[name])) || Object.keys(canonical).some(name => !expected.includes(name) || !Array.isArray(canonical[name])))
                throw Error('Сервер не вернул канонические данные инвентаризации');
            PlatformContracts.validateSections(canonical, [...assetInventoryOwnSections, 'auditLog']);
            if (Object.keys(canonical).some(name => !Number.isSafeInteger(result.revisions?.[name]) || Number(result.revisions?.[name]) < 0))
                throw Error('Сервер не подтвердил версии сохранённых разделов');
            const current = assetInventoryHostSnapshot();
            if (cache !== assetInventoryDatabaseCache || snapshot.identity !== current.identity || snapshot.analysisStamp !== current.analysisStamp || !current.canRead || !current.canWrite)
                throw Error('База или доступ к инвентаризации изменились во время сохранения');
            for (const [name, rows] of Object.entries(canonical)) {
                if (assetInventoryOwnSections.includes(name))
                    cache.database[name] = JSON.parse(JSON.stringify(rows));
            }
            cache.revisions = { ...cache.revisions, ...result.revisions };
            cache.stamp++;
            return result;
        }
        catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error), ...(sent ? { unknown: true, definitive: false } : {}) };
        }
    })();
    intent.pending = pending;
    try {
        const result = await pending;
        intent.result = result;
        return result;
    }
    finally {
        intent.pending = null;
    }
}
async function assetInventoryImportSource(request) {
    if (assetInventoryDatabaseBridge())
        return assetInventoryDatabaseRequest('importSource', request);
    const rpc = window.electronAPI?.importSource;
    if (!rpc)
        throw Error('Безопасный импорт файлов недоступен в этом подключении. Обновите программу.');
    return rpc(request);
}
async function assetInventoryExportRequest(request) {
    if (assetInventoryDatabaseBridge())
        return assetInventoryDatabaseRequest('export', request);
    const rpc = window.electronAPI?.assetInventoryExport;
    if (!rpc)
        throw Error('Выгрузка инвентаризации недоступна в этом подключении. Обновите программу.');
    return rpc(request);
}
async function assetInventoryOpenDatabaseFolder() { const result = await assetInventoryDatabaseRequest('openFolder'); if (!result.ok)
    throw Error(result.error || 'Не удалось открыть папку базы инвентаризации'); }
function assetInventoryWorkspaceInstance(mode = 'inventory') {
    const existing = mode === 'quantity' ? objectQuantityMountedWorkspace : assetInventoryMountedWorkspace;
    if (existing)
        return existing;
    const workspace = AssetInventoryWorkspace.create({ mode, core: AssetInventory, snapshot: assetInventoryHostSnapshot, operationId: () => wfId('asset-inventory'), execute: (input, options) => assetInventoryExecuteCommand({ type: 'AssetInventoryAction', version: 1, input }, options), openUpgrade: () => lifecycleUpgradeOpen(), confirmDiscard: message => window.confirm(message), importFile: request => assetInventoryImportWizard(request), exportFile: request => assetInventoryExportDocument({ format: request.format, sessionId: request.sessionId }), ...(assetInventoryDatabaseBridge() ? { openDatabaseFolder: assetInventoryOpenDatabaseFolder, openDocuments: () => InventoryDocuments.open(), mountPhotos: input => InventoryPhotos.mount(input) } : {}) });
    if (mode === 'quantity')
        objectQuantityMountedWorkspace = workspace;
    else
        assetInventoryMountedWorkspace = workspace;
    return workspace;
}
function objectQuantityWorkspaceInstance() { return assetInventoryWorkspaceInstance('quantity'); }
function renderAssetInventorySection() { renderAssetInventoryMode('inventory'); }
function renderObjectQuantitySection() { renderAssetInventoryMode('quantity'); }
function renderAssetInventoryMode(mode) {
    const container = document.getElementById('mainContent');
    if (!container)
        throw Error('Не найден раздел программы');
    const independent = !!assetInventoryDatabaseBridge(), parent = assetInventoryParentIdentity(), sameView = assetInventoryVisibleMode === mode;
    if (independent && assetInventoryDatabaseCache && assetInventoryDatabaseCache.parent !== parent)
        assetInventoryWorkspaceRevoke();
    const snapshot = assetInventoryHostSnapshot(), workspace = assetInventoryWorkspaceInstance(mode);
    if (!independent) {
        if (assetInventoryMountedIdentity !== null && assetInventoryMountedIdentity !== snapshot.identity)
            assetInventoryWorkspaceRevoke();
        if (!snapshot.canRead)
            assetInventoryWorkspaceRevoke();
        assetInventoryMountedIdentity = snapshot.identity;
        workspace.render(container);
        return;
    }
    if (!snapshot.canRead) {
        assetInventoryWorkspaceRevoke();
        workspace.render(container);
        return;
    }
    assetInventoryVisibleMode = mode;
    if (sameView && assetInventoryDatabaseCache?.parent === parent) {
        assetInventoryMountedIdentity = snapshot.identity;
        workspace.render(container);
        return;
    }
    const generation = ++assetInventoryRenderGeneration;
    container.innerHTML = '<section class="asset-inventory"><h2>' + (mode === 'quantity' ? 'Количественный учёт' : 'Инвентаризация ОС') + '</h2><p data-ai-database-loading role="status">Загружается база инвентаризации…</p></section>';
    void assetInventoryLoadDatabase().then(() => { if (generation !== assetInventoryRenderGeneration || assetInventoryVisibleMode !== mode || parent !== assetInventoryParentIdentity())
        return; assetInventoryMountedIdentity = assetInventoryHostSnapshot().identity; workspace.render(container); }).catch(error => {
        if (generation !== assetInventoryRenderGeneration || assetInventoryVisibleMode !== mode)
            return;
        container.replaceChildren();
        const section = document.createElement('section'), heading = document.createElement('h2'), message = document.createElement('p'), retry = document.createElement('button');
        section.className = 'asset-inventory';
        heading.textContent = 'База инвентаризации';
        message.setAttribute('role', 'alert');
        message.setAttribute('data-ai-database-error', '');
        message.textContent = error instanceof Error ? error.message : String(error);
        retry.className = 'btn btn-secondary';
        retry.textContent = 'Повторить загрузку';
        retry.onclick = () => { assetInventoryVisibleMode = null; renderAssetInventoryMode(mode); };
        section.append(heading, message, retry);
        container.append(section);
    });
}
function assetInventoryWorkspaceLeave() {
    if (InventoryDocuments.hasPending() || AssetInventoryFiles.hasPending()) {
        showToast('Завершите работу с файлами инвентаризации.');
        return false;
    }
    for (const workspace of [assetInventoryMountedWorkspace, objectQuantityMountedWorkspace])
        if (workspace && !workspace.unmount()) {
            showToast('Завершите сохранение или закройте форму учёта имущества.');
            return false;
        }
    assetInventoryVisibleMode = null;
    assetInventoryRenderGeneration++;
    return true;
}
async function assetInventoryWorkspaceFlush() { if (InventoryDocuments.hasPending() || AssetInventoryFiles.hasPending())
    return false; let ready = true; const pending = [...assetInventoryCommandIntents.values()].flatMap(intent => intent.pending ? [intent.pending] : []); for (const workspace of [assetInventoryMountedWorkspace, objectQuantityMountedWorkspace])
    if (workspace && !await workspace.flush())
        ready = false; if ((await Promise.allSettled(pending)).some(result => result.status !== 'fulfilled' || !result.value.ok))
    ready = false; return ready; }
function assetInventoryWorkspaceHasPendingEdits() { return InventoryDocuments.hasPending() || AssetInventoryFiles.hasPending() || [assetInventoryMountedWorkspace, objectQuantityMountedWorkspace].some(workspace => workspace?.hasPendingEdits()) || [...assetInventoryCommandIntents.values()].some(intent => !!intent.pending); }
function assetInventoryWorkspaceRevoke() {
    InventoryDocuments.revoke();
    assetInventoryFilesRevoke();
    for (const workspace of [assetInventoryMountedWorkspace, objectQuantityMountedWorkspace])
        workspace?.invalidate();
    assetInventoryMountedIdentity = null;
    assetInventoryVisibleMode = null;
    assetInventoryDatabaseCache = null;
    assetInventoryDatabaseLoading = null;
    assetInventoryDatabaseGeneration++;
    assetInventoryRenderGeneration++;
    assetInventoryCommandIntents.clear();
}
/** Browser-selected bytes only. The host decodes, binds and stores sources;
 * this UI never supplies interpreted rows or a filesystem path. */
var AssetInventoryFiles;
(function (AssetInventoryFiles) {
    const ownSections = ['inventoryOrgs', 'inventoryObjects', 'inventoryMols', 'inventoryItems', 'inventorySessions'];
    const sectionLabels = { inventoryOrgs: 'Организации', inventoryObjects: 'Объекты', inventoryMols: 'МОЛ', inventoryItems: 'Имущество', inventorySessions: 'Описи' };
    const LIMIT = 25 * 1024 * 1024;
    let active = null;
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
    const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const items = (value) => Array.isArray(value) ? value.map(record) : [];
    const string = (value) => typeof value === 'string' ? value : '';
    const text = (error) => error instanceof Error ? error.message : String(error);
    const source = (snapshot) => JSON.stringify(ownSections.map(name => [name, snapshot.database[name] ?? []]));
    function required(parent, selector) { const node = parent.querySelector(selector); if (!node)
        throw Error('Окно работы с файлами закрыто'); return node; }
    function field(s, name) { return required(s.form, '[name="' + name + '"]'); }
    function supported(snapshot) { return snapshot.isSQLite && snapshot.schemaVersion === 6 && snapshot.capabilities.some(value => value.name === 'inventoryV1' && value.version === 1); }
    function verify(captured, baseline, write) {
        const current = assetInventoryHostSnapshot();
        if (current.database !== captured.database || current.identity !== captured.identity || !current.canRead)
            throw Error('База, пользователь или доступ изменились. Откройте работу с файлом заново.');
        if (baseline !== null && (current.analysisStamp !== captured.analysisStamp || source(current) !== baseline || current.today !== captured.today))
            throw Error('Исходные данные или права изменились. Повторно откройте импорт и проверьте источник.');
        if (!supported(current))
            throw Error('Нужна отдельная обновлённая копия SQLite с поддержкой инвентаризации.');
        if (write && !current.canWrite)
            throw Error('Нет права импорта данных инвентаризации.');
        return current;
    }
    function check(s, baseline = true) { if (active !== s || s.revoked || !s.form.isConnected)
        throw Error('Окно импорта закрыто или относится к другому сеансу'); verify(s.captured, baseline ? s.sourceText : null, true); if (assetInventoryDatabaseToken() !== s.token)
        throw Error('Выбрана другая база. Откройте импорт заново.'); }
    function showError(s, error) { if (active === s && !s.revoked)
        required(s.form, '[data-ai-file-error]').textContent = text(error); }
    function lock(s, busy) {
        s.busy = busy;
        s.overlay.querySelectorAll('input,select,textarea,button').forEach(element => {
            const isConfirm = element.getAttribute('name') === 'confirm';
            const isCommit = element.hasAttribute('data-ai-file-commit');
            const isClose = element.hasAttribute('data-ai-file-close');
            element.disabled = busy || s.uncertain && !isClose && !isCommit;
            if (isCommit)
                element.disabled = busy || s.preview?.canApply !== true || !required(s.form, '[name=confirm]').checked;
            if (isConfirm && s.preview?.canApply !== true)
                element.disabled = true;
        });
        required(s.form, '[data-ai-file-status]').textContent = busy ? 'Ожидается подтверждение…' : '';
        if (busy)
            s.overlay.focus();
        else if (document.activeElement === s.overlay || document.activeElement === document.body) {
            const target = s.preview?.canApply === true ? required(s.form, '[name=confirm]') : required(s.form, '[data-ai-file-review]');
            if (!target.disabled)
                target.focus();
        }
    }
    function clearPreview(s, restage) {
        if (s.busy || s.uncertain)
            return;
        s.preview = null;
        s.reviewInput = '';
        s.operationId = null;
        required(s.form, '[data-ai-file-confirm]').hidden = true;
        required(s.form, '[name=confirm]').checked = false;
        required(s.form, '[data-ai-file-preview]').replaceChildren();
        if (restage) {
            s.sourceId = null;
            s.source = null;
            s.base64 = null;
            s.mappingText = '';
            s.stagedFile = null;
            s.warnings = [];
        }
        lock(s, false);
    }
    function finish(s, result) {
        if (active !== s)
            return;
        s.reader?.abort();
        s.reader = null;
        s.base64 = null;
        s.file = null;
        s.stagedFile = null;
        s.source = null;
        s.preview = null;
        s.choices.clear();
        const file = s.form.querySelector('[name=file]');
        if (file)
            file.value = '';
        s.overlay.remove();
        active = null;
        s.resolve(result);
    }
    function close(s) {
        if (s.busy)
            return;
        if (s.uncertain) {
            if (!window.confirm('Результат импорта пока неизвестен. Закрытие окна не отменит уже выполненную операцию. Проверить результат позднее?'))
                return;
            finish(s, { ok: false, error: 'Результат импорта пока неизвестен. Проверьте квитанцию операции и список имущества перед повторным добавлением источника.' });
            return;
        }
        if (s.file && !window.confirm('Закрыть предпросмотр импорта? Реестр и описи ещё не изменены.'))
            return;
        finish(s, { ok: false, cancelled: true });
    }
    function hasPending() { return active !== null; }
    AssetInventoryFiles.hasPending = hasPending;
    function revoke() {
        const s = active;
        if (!s)
            return;
        s.revoked = true;
        s.reader?.abort();
        s.reader = null;
        s.base64 = null;
        s.file = null;
        s.stagedFile = null;
        s.source = null;
        s.preview = null;
        required(s.form, '[name=file]').value = '';
        s.overlay.remove();
        s.choices.clear();
        active = null;
        s.resolve({ ok: false, error: 'Сеанс изменился. Окно импорта и выбранный файл очищены.' });
    }
    AssetInventoryFiles.revoke = revoke;
    function options(s, section, selected) {
        return '<option value="">Не выбран</option>' + (s.captured.database[section] ?? []).filter(row => !row.archived).map(row => {
            if (typeof row.id !== 'string' && typeof row.id !== 'number')
                return '';
            const token = 'target-' + s.choices.size;
            s.choices.set(token, row.id);
            const name = (key, id) => (s.captured.database[key] ?? []).find(value => value.id === id)?.name ?? 'Неизвестно';
            return '<option value="' + token + '"' + (row.id === selected ? ' selected' : '') + '>' + esc(row.name) + (section === 'inventoryMols' ? ' · ' + esc(name('inventoryOrgs', row.orgId)) + ' / ' + esc(name('inventoryObjects', row.objectId)) + ' · ' + esc(row.accountCode) : '') + '</option>';
        }).join('');
    }
    function selected(s, name, section) {
        const token = field(s, name).value;
        if (!token)
            return undefined;
        const id = s.choices.get(token);
        if (id === undefined || !(s.captured.database[section] ?? []).some(row => row.id === id && !row.archived))
            throw Error('Выбранный справочник больше недоступен');
        return id;
    }
    function mapping(s) {
        const format = field(s, 'format').value, date = field(s, 'date').value;
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date) || !date && format !== 'auto')
            throw Error('Укажите дату источника или выберите автоматический разбор документа.');
        const result = { format, ...(date ? { date } : {}) };
        for (const name of ['defaultOrgName', 'defaultObjectName', 'title']) {
            const value = field(s, name).value;
            if (value.trim())
                result[name] = value;
        }
        if (format === 'osv')
            result.useOpeningIfNoClosing = field(s, 'useOpeningIfNoClosing').checked;
        if (format !== 'legacy') {
            const orgId = selected(s, 'targetOrg', 'inventoryOrgs'), objectId = selected(s, 'targetObject', 'inventoryObjects'), molId = selected(s, 'targetMol', 'inventoryMols');
            const target = { ...(orgId === undefined ? {} : { orgId }), ...(objectId === undefined ? {} : { objectId }), ...(molId === undefined ? {} : { molId }) };
            if (Object.keys(target).length)
                result.target = target;
        }
        return result;
    }
    function formatVisibility(s) { const format = field(s, 'format').value; required(s.form, '[data-ai-file-targets]').hidden = format === 'legacy'; required(s.form, '[data-ai-file-opening]').hidden = format !== 'osv'; }
    function readBytes(s, file) {
        if (file.size <= 0 || file.size > LIMIT)
            throw Error('Выберите непустой файл размером не более 25 МБ.');
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            s.reader = reader;
            reader.onload = () => {
                s.reader = null;
                const result = reader.result;
                if (typeof result !== 'string') {
                    reject(Error('Не удалось прочитать исходные байты файла'));
                    return;
                }
                const match = /^data:[^,]*;base64,([A-Za-z0-9+/]*={0,2})$/.exec(result), encoded = match?.[1];
                if (!encoded || encoded.length > Math.ceil(LIMIT / 3) * 4) {
                    reject(Error('Неверный размер или кодирование исходного файла'));
                    return;
                }
                const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0, actual = encoded.length / 4 * 3 - padding;
                if (actual !== file.size || actual <= 0 || actual > LIMIT) {
                    reject(Error('Число прочитанных байтов не соответствует выбранному файлу'));
                    return;
                }
                resolve(encoded);
            };
            reader.onerror = () => { s.reader = null; reject(Error('Не удалось прочитать выбранный файл')); };
            reader.onabort = () => { s.reader = null; reject(Error('Чтение файла прекращено после закрытия окна')); };
            reader.readAsDataURL(file);
        });
    }
    function messages(value, kind) { return items(value).map(issue => '<p class="' + kind + '">' + esc(issue.message || issue.code || 'Проверьте источник') + '</p>').join(''); }
    function warnings(s, ...values) { const seen = new Set(), all = [...s.warnings, ...values.flatMap(items)]; return messages(all.filter(value => { const key = JSON.stringify([value.code, value.message]); if (seen.has(key))
        return false; seen.add(key); return true; }), 'ai-muted'); }
    function sourceHtml(sourceValue) {
        const data = record(sourceValue.data);
        if (ownSections.some(section => !Array.isArray(data[section])))
            throw Error('Сервер не подтвердил полный состав собственных разделов источника');
        let html = '<h4>Состав выбранного источника</h4><p>' + ownSections.map(section => sectionLabels[section] + ': ' + items(data[section]).length).map(esc).join(' · ') + '</p>';
        const sessions = items(data.inventorySessions);
        if (sessions.length)
            html += '<div data-ai-source-sessions class="ai-summary">' + sessions.map(session => '<p><strong>' + esc(session.objectName) + '</strong> · ' + esc(session.orgName || 'Организация из строк описи') + ' · дата описи ' + esc(session.date) + ' · позиций ' + items(session.rows).length + '</p>').join('') + '</div>';
        const positions = items(data.inventoryItems);
        html += '<div class="ai-scroll"><table><thead><tr><th>Имущество</th><th>Код</th><th>Единица</th><th>Учётное количество</th><th>Учётная стоимость</th></tr></thead><tbody>' + positions.slice(0, 50).map(row => '<tr><td>' + esc(row.name) + '</td><td>' + esc(row.code) + '</td><td>' + esc(row.unit || 'Не задано') + '</td><td>' + esc(typeof row.qty === 'number' ? row.qty : 'Неизвестно') + '</td><td>' + esc(typeof row.cost === 'number' ? row.cost : 'Неизвестно') + '</td></tr>').join('') + '</tbody></table></div>';
        if (positions.length > 50)
            html += '<p>Показаны первые 50 из ' + positions.length + ' позиций. Будет проверен весь источник.</p>';
        return html + '<p class="ai-muted">Неизвестные значения не заменяются нулём. Единицы и учётные значения черновика можно позднее исправить отдельно с сохранением причины. Импорт не утверждает описи.</p>';
    }
    function importInput(s) {
        if (!s.sourceId || !s.source)
            throw Error('Сначала проверьте источник');
        const format = s.source.format;
        if (!['inventory-legacy-json', 'inventory-osv', 'inventory-comparison'].includes(string(format)))
            throw Error('Не подтверждён формат источника');
        const reason = field(s, 'reason').value;
        if (reason.trim().length < 3)
            throw Error('Укажите основание импорта не короче трёх символов');
        return { action: format === 'inventory-legacy-json' ? 'importLegacy' : 'importRows', sourceId: s.sourceId, reason };
    }
    async function review(s) {
        if (s.busy || s.uncertain)
            return;
        try {
            check(s);
            const file = required(s.form, '[name=file]').files?.[0] ?? s.file;
            if (!file)
                throw Error('Выберите исходный файл');
            const map = mapping(s), format = map.format;
            if (format === 'legacy' ? !/\.json$/i.test(file.name) : !/\.xlsx?$/i.test(file.name))
                throw Error(format === 'legacy' ? 'Для переноса прежней базы выберите JSON-файл.' : 'Выберите исходную книгу XLS или XLSX.');
            if (field(s, 'reason').value.trim().length < 3)
                throw Error('Укажите основание импорта не короче трёх символов');
            const rpc = assetInventoryImportSource;
            s.file = file;
            clearPreview(s, false);
            lock(s, true);
            showError(s, '');
            const mapText = JSON.stringify(map);
            if (!s.sourceId || s.mappingText !== mapText || s.stagedFile !== file) {
                s.base64 = await readBytes(s, file);
                check(s);
                const staged = await rpc({ action: 'stage', profile: 'asset-inventory', parser: { id: 'asset-inventory', version: 1 }, sections: ownSections.slice(), source: { name: file.name, base64: s.base64 }, mapping: map, databaseToken: s.token });
                s.base64 = null;
                check(s);
                if (!staged.ok) {
                    required(s.form, '[data-ai-file-preview]').innerHTML = messages(staged.issues, 'ai-error') + messages(staged.warnings, 'ai-muted');
                    throw Error(staged.error || staged.message || 'Сервер не смог проверить исходный файл');
                }
                if (staged.databaseToken !== s.token)
                    throw Error('Ответ относится к другой базе. Повторно откройте импорт.');
                const box = required(s.form, '[data-ai-file-preview]');
                if (staged.canImport === false) {
                    s.sourceId = null;
                    s.source = null;
                    s.preview = null;
                    box.innerHTML = '<h4>Источник нельзя импортировать полностью</h4>' + messages(staged.issues, 'ai-error') + messages(staged.warnings, 'ai-muted');
                    throw Error('Импорт заблокирован: неполный или неоднозначный источник не будет добавлен частично.');
                }
                if (!staged.ok || !staged.source || typeof staged.sourceId !== 'string' || !/^[a-f0-9]{64}$/.test(staged.sourceId))
                    throw Error(staged.error || staged.message || 'Сервер не подтвердил исходный файл');
                sourceHtml(staged.source);
                s.sourceId = staged.sourceId;
                s.source = staged.source;
                s.mappingText = mapText;
                s.stagedFile = file;
                s.warnings = [...items(staged.warnings), ...items(staged.source.warnings)];
                box.innerHTML = sourceHtml(staged.source) + messages(staged.warnings, 'ai-muted');
            }
            const input = importInput(s), reply = await rpc({ action: 'preview', profile: 'asset-inventory', sourceId: s.sourceId, reason: input.reason, databaseToken: s.token });
            check(s);
            if (!reply.ok || reply.databaseToken !== s.token || !reply.preview)
                throw Error(reply.error || reply.message || 'Предпросмотр источника не подтверждён');
            if (reply.input && (reply.input.sourceId !== s.sourceId || reply.input.action !== input.action || reply.input.reason !== input.reason))
                throw Error('Предпросмотр относится к другому действию');
            const preview = reply.preview;
            if (typeof preview.fingerprint !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(preview.fingerprint))
                throw Error('Сервер не подтвердил отпечаток проверки');
            s.preview = preview;
            s.reviewInput = JSON.stringify(input);
            required(s.form, '[data-ai-file-preview]').innerHTML = sourceHtml(s.source) + messages(preview.issues, 'ai-error') + warnings(s, preview.warnings) + '<p><strong>' + (preview.canApply === true ? 'Весь источник проверен. Импорт будет выполнен одной операцией.' : 'Импорт заблокирован. Исправьте источник или параметры.') + '</strong></p>';
            required(s.form, '[data-ai-file-confirm]').hidden = preview.canApply !== true;
            required(s.form, '[name=confirm]').checked = false;
        }
        catch (error) {
            showError(s, error);
        }
        finally {
            if (active === s && !s.revoked) {
                s.base64 = null;
                lock(s, false);
            }
        }
    }
    function canonical(s, ack) {
        if (!s.operationId || ack.operationReceipt?.id !== s.operationId || !ack.canonicalSections)
            throw Error('Сервер не вернул квитанцию и канонические разделы импорта');
        const snapshot = assetInventoryHostSnapshot();
        let imported = false, confirmed = false;
        for (const name of ownSections) {
            const values = ack.canonicalSections[name];
            if (!values)
                continue;
            confirmed = true;
            if (JSON.stringify(values) !== JSON.stringify(snapshot.database[name] ?? []))
                throw Error('Подтверждённые разделы не установлены в исходной базе');
            if (values.some(row => record(row.sourceMeta).importSourceId === s.sourceId))
                imported = true;
        }
        if (!confirmed || !imported)
            throw Error('Канонические данные не подтверждают импорт выбранного источника');
    }
    async function commit(s) {
        if (s.busy)
            return;
        try {
            check(s);
            const input = importInput(s), inputText = JSON.stringify(input);
            if (s.preview?.canApply !== true || inputText !== s.reviewInput || !required(s.form, '[name=confirm]').checked)
                throw Error('Сначала проверьте весь источник и подтвердите импорт');
            if (!s.operationId)
                s.operationId = wfId('asset-inventory-import');
            lock(s, true);
            showError(s, '');
            let ack;
            try {
                ack = await assetInventoryExecuteCommand({ type: 'AssetInventoryAction', version: 1, input: { ...input, reviewFingerprint: s.preview.fingerprint } }, { operationId: s.operationId });
            }
            catch (error) {
                s.uncertain = true;
                throw error;
            }
            if (!ack.ok) {
                s.uncertain = ack.unknown === true || ack.definitive === false;
                throw Error(ack.error || ack.message || 'Импорт не подтверждён. Выбранный файл и параметры сохранены.');
            }
            s.uncertain = true;
            check(s, false);
            canonical(s, ack);
            s.uncertain = false;
            finish(s, { ok: true, message: 'Импорт всего источника подтверждён. Проверьте реестр и черновики описей.' });
        }
        catch (error) {
            showError(s, (s.uncertain ? 'Результат операции пока не подтверждён; повтор использует ту же квитанцию. ' : '') + text(error));
        }
        finally {
            if (active === s && !s.revoked)
                lock(s, false);
        }
    }
    async function openImport(request) {
        if (active)
            return { ok: false, error: 'Сначала завершите открытый импорт' };
        const captured = assetInventoryHostSnapshot();
        try {
            verify(captured, source(captured), true);
        }
        catch (error) {
            return { ok: false, error: text(error) };
        }
        const token = assetInventoryDatabaseToken();
        if (typeof token !== 'string' || !token)
            return { ok: false, error: 'Сначала дождитесь подтверждения подключения к базе' };
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'ai-overlay ai-file-overlay';
            overlay.tabIndex = -1;
            overlay.innerHTML = '<section class="ai-dialog" role="dialog" aria-modal="true" aria-label="Импорт инвентаризации"><header><h3>Импорт инвентаризации ОС</h3><button type="button" class="btn btn-secondary" data-ai-file-close>Закрыть</button></header><form class="ai-form" data-ai-files-form><p>Выберите исходный файл размером до 25 МБ. Сервер проверит весь источник перед подтверждением. Просмотр не меняет реестр и описи.</p><div class="ai-grid"><label>Исходный файл<input type="file" name="file" accept="' + (request.format === 'legacy' ? '.json' : '.xls,.xlsx') + '"></label><label>Формат<select name="format">' + (request.format === 'legacy' ? '<option value="legacy">Прежняя база инвентаризации (JSON)</option>' : '<option value="auto">Определить по содержимому файла</option><option value="osv">Оборотно-сальдовая ведомость</option><option value="comparison">Сличительная ведомость</option>') + '</select></label><label>Дата, если её нет в документе<input type="date" name="date"></label><label>Название описи (если нужно)<input name="title"></label><label>Название организации, если нет в источнике<input name="defaultOrgName"></label><label>Название объекта, если нет в источнике<input name="defaultObjectName"></label></div><fieldset data-ai-file-targets><legend>Собственные справочники для Excel (необязательно)</legend><p>Выбирайте только при подтверждённом совпадении источника. Существующие записи не будут переименованы.</p><div class="ai-grid"><label>Организация<select name="targetOrg"></select></label><label>Объект<select name="targetObject"></select></label><label>МОЛ / счёт<select name="targetMol"></select></label></div></fieldset><label class="ai-confirm" data-ai-file-opening><input type="checkbox" name="useOpeningIfNoClosing">Если остатка на конец нет, использовать остаток на начало (только по явному подтверждению)</label><label>Основание импорта<textarea name="reason" required minlength="3"></textarea></label><p class="ai-error" data-ai-file-error role="alert"></p><div data-ai-file-preview></div><label class="ai-confirm" data-ai-file-confirm hidden><input type="checkbox" name="confirm">Подтверждаю импорт всего проверенного источника</label><p data-ai-file-status role="status" aria-live="polite"></p><div class="ai-actions"><button type="button" class="btn btn-secondary" data-ai-file-review>Проверить источник</button><button type="submit" class="btn btn-primary" data-ai-file-commit disabled>Импортировать</button></div></form></section>';
            if (request.format === 'legacy')
                required(overlay, 'form>p').insertAdjacentHTML('afterend', '<p class="ai-muted">Прежняя база переносится целиком в собственные справочники. Текущие фильтры раздела не ограничивают и не объединяют её данные.</p>');
            document.body.append(overlay);
            const s = { overlay, form: required(overlay, 'form'), captured, sourceText: source(captured), token, file: null, reader: null, base64: null, sourceId: null, source: null, mappingText: '', stagedFile: null, preview: null, reviewInput: '', operationId: null, uncertain: false, busy: false, revoked: false, choices: new Map(), warnings: [], resolve };
            active = s;
            if (request.selectedFile) {
                s.file = request.selectedFile;
                const chosen = document.createElement('p');
                chosen.dataset.aiSelectedOriginal = '';
                chosen.textContent = 'Исходный файл: ' + request.selectedFile.name;
                required(s.form, '[name=file]').insertAdjacentElement('afterend', chosen);
            }
            field(s, 'targetOrg').innerHTML = options(s, 'inventoryOrgs', request.scope.orgId);
            field(s, 'targetObject').innerHTML = options(s, 'inventoryObjects', request.scope.objectId);
            field(s, 'targetMol').innerHTML = options(s, 'inventoryMols', request.scope.molId);
            required(overlay, '[data-ai-file-close]').onclick = () => close(s);
            overlay.onclick = event => { if (event.target === overlay)
                close(s); };
            overlay.onkeydown = event => { if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(s);
            }
            else if (event.key === 'Tab') {
                const enabled = [...overlay.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(node => node.getClientRects().length > 0), first = enabled[0], last = enabled[enabled.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                }
                else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                }
            } };
            s.form.onsubmit = event => { event.preventDefault(); void commit(s); };
            required(s.form, '[data-ai-file-review]').onclick = () => { void review(s); };
            s.form.addEventListener('input', event => { const element = event.target; if (element.name === 'confirm')
                lock(s, false);
            else
                clearPreview(s, element.name !== 'reason'); });
            s.form.addEventListener('change', event => { const element = event.target; if (element.name === 'file') {
                s.file = element.files?.[0] ?? null;
                s.form.querySelector('[data-ai-selected-original]')?.remove();
            } if (element.name === 'format')
                formatVisibility(s); if (element.name === 'confirm')
                lock(s, false);
            else
                clearPreview(s, element.name !== 'reason'); });
            formatVisibility(s);
            lock(s, false);
            field(s, 'file').focus();
        });
    }
    AssetInventoryFiles.openImport = openImport;
    async function exportDocument(request) {
        const captured = assetInventoryHostSnapshot(), baseline = source(captured), token = assetInventoryDatabaseToken();
        try {
            verify(captured, baseline, false);
            if (typeof token !== 'string' || !token)
                throw Error('Нет подтверждённого подключения к базе');
            if (!(captured.database.inventorySessions ?? []).some(row => row.id === request.sessionId))
                throw Error('Опись не найдена в доступных данных');
            const rpc = assetInventoryExportRequest;
            const result = await rpc({ format: request.format, sessionId: request.sessionId, databaseToken: token });
            if (result.ok) {
                try {
                    verify(captured, baseline, false);
                }
                catch {
                    return { ok: true, message: 'Файл сохранён, но база или доступ изменились. Проверьте текущий сеанс.' };
                }
                return { ok: true, message: result.message || 'Файл сохранён' };
            }
            verify(captured, baseline, false);
            return result.cancelled ? { ok: false, cancelled: true } : { ok: false, error: result.error || result.message || (result.unknown ? 'Результат сохранения файла неизвестен. Проверьте выбранную папку.' : 'Файл не сохранён') };
        }
        catch (error) {
            return { ok: false, error: text(error) };
        }
    }
    AssetInventoryFiles.exportDocument = exportDocument;
})(AssetInventoryFiles || (AssetInventoryFiles = {}));
function assetInventoryImportWizard(request) { return AssetInventoryFiles.openImport(request); }
function assetInventoryExportDocument(request) { return AssetInventoryFiles.exportDocument(request); }
function assetInventoryFilesRevoke() { AssetInventoryFiles.revoke(); }
/** Original inventory documents, including files without countable positions. */
var InventoryDocuments;
(function (InventoryDocuments) {
    const LIMIT = 25 * 1024 * 1024;
    let active = null, importing = false, generation = 0;
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
    function node(s, selector) { const element = s.overlay.querySelector(selector); if (!element)
        throw Error('Окно файлов закрыто'); return element; }
    function check(s, write = false) { const snapshot = assetInventoryHostSnapshot(); if (active !== s || !s.overlay.isConnected || snapshot.identity !== s.identity || assetInventoryDatabaseToken() !== s.token || !snapshot.canRead)
        throw Error('База или доступ изменились. Откройте файлы заново.'); if (write && !snapshot.canWrite)
        throw Error('Нет права загрузки файлов инвентаризации.'); }
    async function request(s, action, input = {}) { check(s, action === 'documentsUpload'); const result = await assetInventoryDatabaseRequest(action, { ...input, databaseToken: s.token }); check(s); if (!result.ok)
        throw Error(result.error || 'Операция с файлом не подтверждена'); if (result.databaseToken !== undefined && result.databaseToken !== s.token)
        throw Error('Ответ относится к другой базе инвентаризации'); return result; }
    function message(s, text, error = false) { if (active !== s)
        return; const target = node(s, '[data-ai-documents-status]'); target.textContent = text; target.classList.toggle('ai-error', error); }
    function lock(s, busy) { s.busy = busy; s.overlay.querySelectorAll('input,button').forEach(element => { element.disabled = busy; }); node(s, '[data-ai-documents-upload]').disabled = busy || s.files.length === 0 || !assetInventoryHostSnapshot().canWrite; node(s, '[name=files]').disabled = busy || !assetInventoryHostSnapshot().canWrite; }
    function finish(s, result) { if (active !== s)
        return; s.overlay.remove(); s.files = []; active = null; s.resolve(result); }
    function close(s) { if (s.busy)
        return; if (s.files.length && !window.confirm('Закрыть окно? Выбранные файлы ещё не загружены.'))
        return; finish(s, { ok: true, message: s.message }); }
    function render(s) {
        const labels = { inventory: 'Опись / ведомость', order: 'Приказ', act: 'Акт', archive: 'Архив', other: 'Документ' };
        node(s, '[data-ai-documents-list]').innerHTML = '<p class="ai-muted">Сохранено файлов: ' + s.documents.length + '. Оригиналы не изменяют остатки. Позиции из описи добавляются после разбора и подтверждения.</p><div class="ai-scroll"><table><thead><tr><th>Файл / путь в архиве</th><th>Вид</th><th>Размер</th><th>Действия</th></tr></thead><tbody>' + s.documents.map(doc => '<tr data-ai-document-id="' + esc(doc.id) + '"><td>' + esc(doc.name) + '<small>' + esc(doc.path) + (doc.container ? ' · ' + esc(doc.container) : '') + '</small></td><td>' + esc(labels[doc.kind] || 'Документ') + '</td><td>' + esc((doc.bytes / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })) + ' КБ</td><td><div class="ai-actions"><button type="button" class="btn btn-secondary" data-ai-document-download="' + esc(doc.id) + '">Сохранить файл</button>' + (['.xls', '.xlsx', '.json'].includes(doc.extension.toLowerCase()) && assetInventoryHostSnapshot().canWrite ? '<button type="button" class="btn btn-secondary" data-ai-document-import="' + esc(doc.id) + '">Разобрать опись</button>' : '') + '</div></td></tr>').join('') + '</tbody></table></div>';
        s.overlay.querySelectorAll('[data-ai-document-download]').forEach(button => button.onclick = () => { void save(s, button.dataset.aiDocumentDownload ?? ''); });
        s.overlay.querySelectorAll('[data-ai-document-import]').forEach(button => button.onclick = () => { void importDocument(s, button.dataset.aiDocumentImport ?? ''); });
    }
    async function refresh(s) { const reply = await request(s, 'documentsList'); if (!Array.isArray(reply.documents))
        throw Error('Не получен список файлов'); s.documents = reply.documents; render(s); }
    function bytes(encoded) { const raw = atob(encoded), data = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++)
        data[i] = raw.charCodeAt(i); return data; }
    async function encoded(file) { const array = new Uint8Array(await file.arrayBuffer()); let raw = ''; for (let i = 0; i < array.length; i += 32768)
        raw += String.fromCharCode(...array.subarray(i, i + 32768)); return btoa(raw); }
    async function upload(s) { if (s.busy)
        return; try {
        check(s, true);
        if (!s.files.length)
            throw Error('Выберите файлы или архив');
        if (s.files.some(file => file.size > LIMIT) || s.files.reduce((sum, file) => sum + file.size, 0) > LIMIT)
            throw Error('За одну загрузку можно выбрать до 25 МБ исходных файлов.');
        lock(s, true);
        message(s, 'Загружаются и проверяются оригиналы…');
        const files = [];
        for (const file of s.files) {
            files.push({ name: file.name, base64: await encoded(file) });
            check(s, true);
        }
        const reply = await request(s, 'documentsUpload', { files, operationId: s.operationId });
        s.files = [];
        node(s, '[name=files]').value = '';
        await refresh(s);
        s.message = 'Файлы сохранены: ' + (reply.addedCount ?? 0) + '. Уже были в базе: ' + (reply.reusedCount ?? 0) + '.' + (reply.warnings?.length ? ' ' + reply.warnings.map(warning => warning.message).join(' ') : '');
        message(s, s.message);
    }
    catch (error) {
        message(s, error instanceof Error ? error.message : String(error), true);
    }
    finally {
        if (active === s)
            lock(s, false);
    } }
    async function save(s, id) { if (s.busy)
        return; try {
        lock(s, true);
        const reply = await request(s, 'documentSave', { id });
        message(s, reply.cancelled ? 'Сохранение отменено' : 'Оригинал сохранён в выбранную папку.');
    }
    catch (error) {
        message(s, error instanceof Error ? error.message : String(error), true);
    }
    finally {
        if (active === s)
            lock(s, false);
    } }
    async function importDocument(s, id) {
        if (s.busy)
            return;
        const currentGeneration = generation;
        try {
            check(s, true);
            lock(s, true);
            const reply = await request(s, 'documentRead', { id });
            if (typeof reply.name !== 'string' || typeof reply.base64 !== 'string')
                throw Error('Не получен оригинал файла');
            const file = new File([bytes(reply.base64)], reply.name);
            finish(s, { ok: true, message: s.message });
            importing = true;
            await Promise.resolve();
            if (currentGeneration !== generation)
                return;
            const result = await AssetInventoryFiles.openImport({ format: /\.json$/i.test(file.name) ? 'legacy' : 'xlsx', scope: {}, selectedFile: file });
            if (currentGeneration !== generation)
                return;
            if (result.ok && assetInventoryVisibleMode)
                renderAssetInventoryMode(assetInventoryVisibleMode);
            else if (result.error)
                showToast(result.error);
        }
        catch (error) {
            if (active === s)
                message(s, error instanceof Error ? error.message : String(error), true);
            else if (currentGeneration === generation)
                showToast(error instanceof Error ? error.message : String(error));
        }
        finally {
            if (currentGeneration === generation)
                importing = false;
            if (active === s)
                lock(s, false);
        }
    }
    async function open() {
        if (active || importing)
            return { ok: false, error: 'Сначала завершите открытое окно файлов' };
        const snapshot = assetInventoryHostSnapshot(), token = assetInventoryDatabaseToken();
        if (!snapshot.canRead || !token)
            return { ok: false, error: 'Сначала откройте базу инвентаризации' };
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'ai-overlay';
            overlay.tabIndex = -1;
            overlay.innerHTML = '<section class="ai-dialog" role="dialog" aria-modal="true" aria-label="Файлы инвентаризации"><header><h3>Файлы инвентаризации</h3><button type="button" class="btn btn-secondary" data-ai-documents-close>Закрыть</button></header><form class="ai-form" data-ai-documents-form><p>Загрузите один или несколько файлов любого формата. RAR и ZIP будут распакованы с сохранением исходного архива и всех документов. Приказы, акты и сканы сохраняются как оригиналы; разбор описи выполняется отдельно.</p><label>Файлы или архив<input type="file" name="files" multiple></label><div class="ai-actions"><button type="submit" class="btn btn-primary" data-ai-documents-upload disabled>Загрузить</button></div><p data-ai-documents-status role="status" aria-live="polite"></p><div data-ai-documents-list></div></form></section>';
            document.body.append(overlay);
            const s = { overlay, form: nodeFromOverlay(overlay), identity: snapshot.identity, token, files: [], operationId: '', busy: false, documents: [], resolve, message: '' };
            active = s;
            node(s, '[name=files]').onchange = event => { const input = event.target; s.files = [...(input.files ?? [])]; s.operationId = wfId('inventory-files'); lock(s, false); };
            s.form.onsubmit = event => { event.preventDefault(); void upload(s); };
            node(s, '[data-ai-documents-close]').onclick = () => close(s);
            overlay.onkeydown = event => { if (event.key === 'Escape') {
                event.preventDefault();
                close(s);
            }
            else if (event.key === 'Tab') {
                const list = [...overlay.querySelectorAll('button:not(:disabled),input:not(:disabled)')], first = list[0], last = list[list.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                }
                else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                }
            } };
            lock(s, true);
            void refresh(s).catch(error => message(s, error instanceof Error ? error.message : String(error), true)).finally(() => { if (active === s) {
                lock(s, false);
                node(s, '[name=files]').disabled = !snapshot.canWrite;
            } });
        });
    }
    InventoryDocuments.open = open;
    function nodeFromOverlay(overlay) { const form = overlay.querySelector('form'); if (!form)
        throw Error('Не создано окно файлов'); return form; }
    function hasPending() { return importing || !!active && (active.busy || active.files.length > 0); }
    InventoryDocuments.hasPending = hasPending;
    function revoke() { generation++; importing = false; if (active)
        finish(active, { ok: false, error: 'База или права изменились. Окно файлов очищено.' }); }
    InventoryDocuments.revoke = revoke;
})(InventoryDocuments || (InventoryDocuments = {}));
/** Photos are attached to a saved count row independently of unsaved counts. */
var InventoryPhotos;
(function (InventoryPhotos) {
    const LIMIT = 25 * 1024 * 1024, MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
    async function encoded(file) { const bytes = new Uint8Array(await file.arrayBuffer()); let raw = ''; for (let i = 0; i < bytes.length; i += 32768)
        raw += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(raw); }
    function mount(options) {
        const form = options.container, token = assetInventoryDatabaseToken();
        let disposed = false, busy = false;
        const loaded = new Set(), loading = new Set(), selected = new Map();
        let photos = [], observer = null;
        const current = () => !disposed && form.isConnected && options.isCurrent() && token !== null && assetInventoryDatabaseToken() === token;
        const cells = new Map();
        options.rows.forEach((_row, index) => { const cell = form.querySelector('[data-ai-photo-row="' + index + '"]'); if (cell)
            cells.set(index, cell); });
        function status(index, text, error = false) { const target = cells.get(index)?.querySelector('[data-ai-photo-status]'); if (target && current()) {
            target.textContent = text;
            target.classList.toggle('ai-error', error);
        } }
        async function request(action, input) { if (!current())
            throw Error('Опись или доступ изменились. Откройте фото заново.'); const result = await assetInventoryDatabaseRequest(action, { databaseToken: token, sessionId: options.sessionId, ...input }); if (!current())
            throw Error('Опись или доступ изменились.'); if (!result.ok)
            throw Error(result.error || 'Операция с фото не подтверждена.'); if (result.databaseToken !== undefined && result.databaseToken !== token)
            throw Error('Ответ фото относится к другой базе.'); return result; }
        async function load(photo, index) {
            if (loaded.has(photo.id) || loading.has(photo.id) || !current())
                return;
            loading.add(photo.id);
            try {
                const reply = await request('photoRead', { rowId: photo.rowId, id: photo.id });
                if (!MIMES.has(reply.mimeType ?? '') || typeof reply.base64 !== 'string' || reply.base64.length > Math.ceil(LIMIT / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(reply.base64))
                    throw Error('Не получен безопасный оригинал изображения.');
                const image = cells.get(index)?.querySelector('img[data-ai-photo-preview="' + photo.id + '"]');
                if (image) {
                    image.src = 'data:' + reply.mimeType + ';base64,' + reply.base64;
                    image.hidden = false;
                    loaded.add(photo.id);
                }
            }
            catch (error) {
                status(index, error instanceof Error ? error.message : String(error), true);
            }
            finally {
                loading.delete(photo.id);
            }
        }
        function render() {
            if (!current())
                return;
            observer?.disconnect();
            loaded.clear();
            for (const [index, cell] of cells) {
                const row = options.rows[index], own = photos.filter(photo => photo.rowId === row.id);
                cell.innerHTML = '<div class="ai-photo-list">' + own.map(photo => '<button type="button" class="ai-photo-thumb" data-ai-photo-open="' + esc(photo.id) + '" aria-label="Открыть фото: ' + esc(photo.name) + '"><img data-ai-photo-preview="' + esc(photo.id) + '" alt="' + esc(photo.name) + '" hidden loading="lazy"><span>' + esc(photo.name) + '</span></button>').join('') + '</div>' + (options.readOnly ? '' : '<label class="ai-photo-upload">Добавить фото<input type="file" data-ai-photo-input="' + index + '" accept="image/jpeg,image/png,image/webp,image/gif" multiple></label>') + '<small data-ai-photo-status role="status" aria-live="polite"></small>';
                cell.querySelector('[data-ai-photo-input]')?.addEventListener('change', event => { const input = event.target; if (input.files?.length)
                    void upload(index, [...input.files], input); });
                cell.querySelectorAll('[data-ai-photo-open]').forEach(button => button.onclick = () => { const photo = own.find(value => value.id === button.dataset.aiPhotoOpen); if (photo)
                    void show(photo, index); });
                cell.querySelectorAll('input,button').forEach(element => { element.disabled = busy; });
                if (observer)
                    observer.observe(cell);
                else
                    for (const photo of own.slice(0, 3))
                        void load(photo, index);
            }
        }
        async function refresh() { const reply = await request('photosList', {}); if (!Array.isArray(reply.photos))
            throw Error('Не получен список фотографий.'); photos = reply.photos; render(); }
        async function upload(index, files, input) {
            if (busy || options.readOnly || !current())
                return;
            cells.get(index)?.querySelector('[data-ai-photo-retry]')?.remove();
            const row = options.rows[index];
            if (files.length > 20 || files.some(file => file.size === 0 || file.size > LIMIT) || files.reduce((sum, file) => sum + file.size, 0) > LIMIT) {
                status(index, 'Выберите до 20 фотографий общим размером до 25 МБ.', true);
                return;
            }
            const signature = JSON.stringify(files.map(file => [file.name, file.size, file.lastModified]));
            let intent = selected.get(index);
            if (!intent || intent.signature !== signature) {
                intent = { signature, operationId: wfId('inventory-photo') };
                selected.set(index, intent);
            }
            const states = [...form.querySelectorAll('input,select,textarea,button')].map(element => ({ element, disabled: element.disabled }));
            states.forEach(({ element }) => { element.disabled = true; });
            busy = true;
            status(index, 'Загружается фото…');
            const pending = (async () => { const data = []; for (const file of files) {
                data.push({ name: file.name, base64: await encoded(file) });
                if (!current())
                    throw Error('Опись изменилась во время чтения фото.');
            } const reply = await request('photosUpload', { rowId: row.id, files: data, operationId: intent.operationId }); await refresh(); input.value = ''; selected.delete(index); for (const photo of photos.filter(value => value.rowId === row.id))
                await load(photo, index); status(index, 'Фото сохранено.' + (reply.warnings?.length ? ' ' + reply.warnings.map(value => value.message).join(' ') : '')); })();
            options.setPending(pending);
            try {
                await pending;
            }
            catch (error) {
                status(index, error instanceof Error ? error.message : String(error), true);
                if (current()) {
                    input.value = '';
                    const retry = document.createElement('button');
                    retry.type = 'button';
                    retry.className = 'btn btn-secondary';
                    retry.dataset.aiPhotoRetry = '';
                    retry.textContent = 'Повторить загрузку';
                    retry.onclick = () => { void upload(index, files, input); };
                    cells.get(index)?.append(retry);
                }
            }
            finally {
                options.setPending(null);
                busy = false;
                if (current()) {
                    states.forEach(({ element, disabled }) => { element.disabled = disabled; });
                    for (const cell of cells.values())
                        cell.querySelectorAll('input,button').forEach(element => { element.disabled = false; });
                }
            }
        }
        let viewer = null;
        async function show(photo, index) { if (busy || !current())
            return; try {
            await load(photo, index);
            if (!current())
                return;
            const original = cells.get(index)?.querySelector('img[data-ai-photo-preview="' + photo.id + '"]');
            if (!original?.src)
                throw Error('Фото пока не прочитано.');
            viewer?.remove();
            viewer = document.createElement('div');
            viewer.className = 'ai-overlay ai-photo-overlay';
            const dialog = document.createElement('section'), image = document.createElement('img'), close = document.createElement('button');
            dialog.className = 'ai-dialog ai-photo-viewer';
            dialog.setAttribute('role', 'dialog');
            dialog.setAttribute('aria-label', photo.name);
            image.src = original.src;
            image.alt = photo.name;
            close.type = 'button';
            close.className = 'btn btn-secondary';
            close.textContent = 'Закрыть фото';
            close.onclick = () => { viewer?.remove(); viewer = null; };
            dialog.append(close, image);
            viewer.append(dialog);
            document.body.append(viewer);
            viewer.onkeydown = event => { if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close.click();
            } };
            close.focus();
        }
        catch (error) {
            status(index, error instanceof Error ? error.message : String(error), true);
        } }
        if (typeof IntersectionObserver !== 'undefined')
            observer = new IntersectionObserver(entries => { for (const entry of entries)
                if (entry.isIntersecting) {
                    const pair = [...cells].find(([, cell]) => cell === entry.target);
                    if (pair)
                        for (const photo of photos.filter(value => value.rowId === options.rows[pair[0]]?.id))
                            void load(photo, pair[0]);
                } }, { rootMargin: '200px' });
        for (const [index, cell] of cells) {
            cell.innerHTML = '<small data-ai-photo-status role="status">Загружаются фотографии…</small>';
            status(index, 'Загружаются фотографии…');
        }
        void refresh().catch(error => { for (const index of cells.keys())
            status(index, error instanceof Error ? error.message : String(error), true); });
        return () => { disposed = true; observer?.disconnect(); viewer?.remove(); viewer = null; for (const cell of cells.values())
            cell.replaceChildren(); loaded.clear(); loading.clear(); selected.clear(); };
    }
    InventoryPhotos.mount = mount;
})(InventoryPhotos || (InventoryPhotos = {}));
