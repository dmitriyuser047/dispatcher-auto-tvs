/* Generated from strict TypeScript by scripts/build-application.cjs.
 * Source/config sha256:edd01aa247bf4f454792beccc3d5ba320a1a347224ccbfb8d3121626218944c7. Do not edit directly. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.DispatcherApplication=factory();})(typeof globalThis==='object'?globalThis:this,function(){
'use strict';
const modules=Object.create(null),instances=Object.create(null);function define(name,deps,factory){if(Object.hasOwn(modules,name))throw Error('Duplicate application module '+name);modules[name]={deps,factory};}function resolve(name,owner){if(!name.startsWith('.'))return name;const parts=owner.split('/');parts.pop();for(const part of name.split('/')){if(part==='..')parts.pop();else if(part!=='.')parts.push(part);}return parts.join('/');}function load(name){if(Object.hasOwn(instances,name))return instances[name];const module=modules[name];if(!module)throw Error('Missing application module '+name);const exports={};instances[name]=exports;const result=module.factory(...module.deps.map(dep=>dep==='exports'?exports:dep==='require'?(request=>load(resolve(request,name))):load(resolve(dep,name))));if(result!==undefined)instances[name]=result;return instances[name];}
define("application/contracts", ["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.object = exports.isId = void 0;
    exports.fail = fail;
    exports.errorOf = errorOf;
    const isId = (value) => typeof value === 'string' && value !== '' || typeof value === 'number' && Number.isFinite(value);
    exports.isId = isId;
    const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
    exports.object = object;
    function fail(code, message) { throw Object.assign(Error(message), { code }); }
    function errorOf(error) { return { code: (0, exports.object)(error) && typeof error.code === 'string' ? error.code : 'SAVE_FAILED', message: (0, exports.object)(error) && typeof error.message === 'string' ? error.message : String(error) }; }
});
define("application/repository", ["require", "exports", "application/contracts"], function (require, exports, contracts_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createRepository = createRepository;
    /** All mutable live references stay at this boundary; views receive JSON copies. */
    function createRepository(ports) {
        const captures = new WeakMap();
        const copyRows = (value) => JSON.parse(JSON.stringify(ports.validateRows(value)));
        function baseline() {
            let saved;
            try {
                const parsed = ports.persisted() ? JSON.parse(ports.persisted()) : {};
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                    throw Error('snapshot');
                saved = parsed;
            }
            catch {
                throw Error('Не удалось прочитать исходный снимок. Загрузите базу заново.');
            }
            const sync = ports.sync();
            if (sync.enabled)
                for (const [name, json] of Object.entries(sync.synced))
                    saved[name] = JSON.parse(json);
            return saved;
        }
        function read(names, confirmed = false) {
            if (!ports.canRead(names))
                (0, contracts_1.fail)('ACCESS_DENIED', 'Нет доступа к запрошенным разделам базы.');
            const source = confirmed ? baseline() : ports.live();
            return Object.fromEntries(names.map(name => [name, copyRows(source[name] || [])]));
        }
        function capture(names) {
            const owner = ports.live(), token = Object.freeze({ key: Symbol('repository-capture') });
            captures.set(token, { owner: new WeakRef(owner), stamp: ports.stamp(), source: names.map(name => [name, JSON.stringify(owner[name] || [])]) });
            return token;
        }
        function assertCurrent(token) {
            const saved = captures.get(token);
            if (!saved || saved.owner.deref() !== ports.live() || saved.stamp !== ports.stamp() || saved.source.some(([name, json]) => json !== JSON.stringify(ports.live()[name] || [])))
                (0, contracts_1.fail)('STALE_VIEW', 'Данные или права изменились. Откройте раздел заново.');
        }
        function install(sections) { ports.install(Object.fromEntries(Object.entries(sections).map(([name, rows]) => [name, copyRows(rows)]))); }
        return Object.freeze({ baseline, read, capture, assertCurrent, install, isLive: (database) => database === ports.live(), copyRows });
    }
});
define("application/save-service", ["require", "exports", "application/contracts"], function (require, exports, contracts_2) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createSaveService = createSaveService;
    /** The existing checked transaction runtime remains the sole write authority. */
    function createSaveService(repository, ports) {
        async function save(database, options, persist) {
            const context = ports.context(), sameSession = () => context.identity === ports.context().identity;
            let submitted;
            try {
                if (context.blocked)
                    throw Error('Основная база не прочитана. Сначала восстановите подключение или базу.');
                if (ports.capabilities().needsSchemaUpgrade)
                    (0, contracts_2.fail)('SCHEMA_UPGRADE_REQUIRED', 'База открыта только для чтения. В разделе «Состояние программы» создайте отдельную обновлённую копию; исходная база останется прежней.');
                submitted = JSON.stringify(database);
                const previous = repository.baseline(), operation = (0, contracts_2.object)(options?.operation) ? options.operation : undefined;
                if (['dispatchJobs', 'workOrders'].some(name => JSON.stringify(previous[name] || []) !== JSON.stringify(database[name] || [])) && ports.capabilities().calendar !== 1)
                    (0, contracts_2.fail)('UNSUPPORTED_CALENDAR', 'Подключение не поддерживает проверку учётного календаря. Загрузите данные из совместимой версии программы.');
                const result = await ports.run({ id: operation?.id, previous, next: database, identity: context.identity, options: { allowLegacy: true, ...options, requireOperationReceipt: !!ports.capabilities().operations } }, async (plan) => {
                    if (!sameSession())
                        (0, contracts_2.fail)('SESSION_CHANGED', 'База или пользователь изменились. Откройте форму заново.');
                    if (ports.accessStamp(ports.context()) !== ports.accessStamp(context))
                        (0, contracts_2.fail)('STALE_ACCESS', 'Права или учётный календарь изменились. Проверьте форму заново.');
                    if (JSON.stringify(database) !== submitted)
                        (0, contracts_2.fail)('STALE_DRAFT', 'Данные изменились в ожидании сохранения. Повторите проверку формы.');
                    ports.clearAck();
                    const saved = await persist({ ...options, _platformManaged: true, requireOperationReceipt: !!ports.capabilities().operations, operation: { id: plan.id } });
                    if (saved !== true)
                        throw Error('Сохранение не подтверждено. Проверьте подключение и состояние базы.');
                    if (!sameSession())
                        (0, contracts_2.fail)('SESSION_CHANGED', 'База изменилась во время сохранения. Проверьте результат в исходной базе.');
                    const ack = ports.ack();
                    return ack?.ok ? { ...ack, identity: context.identity, operationId: (0, contracts_2.object)(ack.operationReceipt) ? ack.operationReceipt.id : undefined } : true;
                });
                ports.setError(null);
                return !!result;
            }
            catch (error) {
                if (sameSession() && repository.isLive(database))
                    ports.rollback(database);
                const failure = (0, contracts_2.errorOf)(error), issues = (0, contracts_2.object)(error) && Array.isArray(error.issues) ? error.issues : [], detail = issues.slice(0, 3).map(issue => (0, contracts_2.object)(issue) ? issue.message : null).filter((message) => typeof message === 'string').join('; '), message = failure.message + (detail && !failure.message.includes(detail) ? ': ' + detail : '');
                if (sameSession())
                    ports.setError({ code: failure.code, message, at: ports.now() });
                ports.toast('Сохранение остановлено: ' + message);
                return false;
            }
        }
        return Object.freeze({ save });
    }
});
define("application/row-commands", ["require", "exports", "application/contracts"], function (require, exports, contracts_3) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createRowCommands = createRowCommands;
    function createRowCommands(repository, saves, persist) {
        const sections = ['vehicles', 'generators', 'drivers'];
        async function execute(value) {
            let confirmed = false;
            try {
                const command = repository.copyRows([value])[0];
                if (command.type !== 'ChangeRows' || command.version !== 1 || !sections.includes(command.section) || typeof command.reason !== 'string' || !command.reason.trim() || typeof command.operationId !== 'string' || !command.operationId)
                    (0, contracts_3.fail)('ROW_COMMAND', 'Нужна команда изменения записей с основанием и кодом операции.');
                const section = command.section, edits = command.edits;
                if (!Array.isArray(edits) || !edits.length || edits.length > 1000)
                    (0, contracts_3.fail)('ROW_COMMAND', 'За одну операцию можно изменить от 1 до 1000 записей.');
                const capture = repository.capture([section]), saved = repository.baseline(), live = repository.read([section]);
                if (JSON.stringify(saved[section] || []) !== JSON.stringify(live[section] || []))
                    (0, contracts_3.fail)('UNSAVED_SECTION', 'В этом справочнике есть другие несохранённые изменения. Сначала сохраните или отмените их.');
                const rows = (saved[section] || []).slice(), seen = new Set();
                for (const edit of edits) {
                    if (!(0, contracts_3.isId)(edit.id) || !(0, contracts_3.object)(edit.changes) || edit.expected !== null && !(0, contracts_3.object)(edit.expected))
                        (0, contracts_3.fail)('ROW_COMMAND', 'Проверьте код записи и поля изменения.');
                    const key = JSON.stringify([typeof edit.id, edit.id]);
                    if (seen.has(key))
                        (0, contracts_3.fail)('ROW_COMMAND', 'Запись повторяется в одной операции.');
                    seen.add(key);
                    const matches = rows.map((row, index) => ({ row, index })).filter(item => item.row.id === edit.id);
                    if (edit.expected === null ? matches.length !== 0 : matches.length !== 1 || JSON.stringify(matches[0].row) !== JSON.stringify(edit.expected))
                        (0, contracts_3.fail)('STALE_ROW', 'Запись изменилась. Откройте её заново и проверьте поля.');
                    if (Object.hasOwn(edit.changes, 'id') && edit.changes.id !== edit.id)
                        (0, contracts_3.fail)('ROW_ID', 'Код записи нельзя менять через поля карточки.');
                    const next = { ...(matches[0]?.row || {}), ...edit.changes, id: edit.id };
                    if (edit.removeFields !== undefined) {
                        if (!Array.isArray(edit.removeFields) || edit.removeFields.some(name => typeof name !== 'string' || name === 'id' || ['__proto__', 'prototype', 'constructor'].includes(name)))
                            (0, contracts_3.fail)('ROW_FIELDS', 'Недопустимое удаляемое поле.');
                        for (const name of edit.removeFields)
                            delete next[name];
                    }
                    if (matches.length)
                        rows[matches[0].index] = next;
                    else
                        rows.push(next);
                }
                const next = { ...saved, [section]: rows }, auditCapture = repository.capture(['auditLog']), apply = options => persist(next, options);
                if (!await saves.save(next, { noMerge: true, requiredCanonicalSections: [section], operation: { id: command.operationId }, history: { action: 'Изменение карточек', reason: command.reason } }, apply))
                    return { ok: false, code: 'SAVE_UNCONFIRMED', message: 'Сохранение не подтверждено. Введённые поля остаются в форме.' };
                confirmed = true;
                repository.assertCurrent(capture);
                const install = { [section]: next[section] };
                // Observe ownership without requiring or exposing a readable history view.
                try {
                    repository.assertCurrent(auditCapture);
                    if (Array.isArray(next.auditLog))
                        install.auditLog = next.auditLog;
                }
                catch { }
                repository.install(install);
                return { ok: true, rows: repository.copyRows(next[section].filter(row => seen.has(JSON.stringify([typeof row.id, row.id])))) };
            }
            catch (error) {
                const failure = (0, contracts_3.errorOf)(error);
                return { ok: false, ...failure, ...(confirmed ? { committed: true, needsReload: true } : {}) };
            }
        }
        return Object.freeze({ execute });
    }
});
define("application/card-controller", ["require", "exports", "application/contracts"], function (require, exports, contracts_4) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createCardController = createCardController;
    /** Forms supply parsed fields; this controller owns identity, conflicts and writes. */
    function createCardController(repository, execute, allocate) {
        const states = new WeakMap();
        function open(section, id) {
            if (!['vehicles', 'generators', 'drivers'].includes(section))
                (0, contracts_4.fail)('CARD_SECTION', 'Неизвестный справочник карточек.');
            const rows = repository.read([section])[section] || [], matches = id === undefined ? [] : rows.filter(row => row.id === id);
            if (id !== undefined && (!(0, contracts_4.isId)(id) || matches.length !== 1))
                (0, contracts_4.fail)('CARD_TARGET', 'Карточка не найдена однозначно.');
            const handle = Object.freeze({ id: id === undefined ? allocate(section === 'vehicles' ? 'v' : section === 'generators' ? 'g' : 'person') : id, section, existing: id !== undefined });
            states.set(handle, { capture: repository.capture([section]), expected: matches[0] || null, operationText: null, operationId: '', pending: null });
            return handle;
        }
        function save(handle, fields) {
            const state = states.get(handle);
            if (!state)
                return Promise.resolve({ ok: false, code: 'CARD_SESSION', message: 'Откройте карточку заново.' });
            if (state.pending)
                return state.pending;
            try {
                repository.assertCurrent(state.capture);
                const supplied = repository.copyRows([fields])[0];
                if (Object.hasOwn(supplied, 'id') && supplied.id !== handle.id)
                    (0, contracts_4.fail)('ROW_ID', 'Код карточки не совпадает с открытой формой.');
                const changes = Object.fromEntries(Object.entries(supplied).filter(([name, value]) => name !== 'id' && (state.expected === null || JSON.stringify(state.expected[name]) !== JSON.stringify(value))));
                if (state.expected !== null && !Object.keys(changes).length)
                    return Promise.resolve({ ok: true, rows: repository.copyRows([state.expected]) });
                const text = JSON.stringify(changes);
                if (state.operationText !== text) {
                    state.operationText = text;
                    state.operationId = allocate('card-change');
                }
                const pending = execute({ type: 'ChangeRows', version: 1, section: handle.section, edits: [{ id: handle.id, expected: state.expected, changes }], reason: 'Изменение карточки', operationId: state.operationId });
                state.pending = pending;
                void pending.then(() => { state.pending = null; }, () => { state.pending = null; });
                return pending;
            }
            catch (error) {
                return Promise.resolve({ ok: false, ...(0, contracts_4.errorOf)(error) });
            }
        }
        return Object.freeze({ open, save });
    }
});
define("features/maintenance-setup/model", ["require", "exports", "application/contracts"], function (require, exports, contracts_5) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.typedKey = void 0;
    exports.interval = interval;
    exports.generators = generators;
    exports.visible = visible;
    const typedKey = (id) => JSON.stringify([typeof id, id]);
    exports.typedKey = typedKey;
    function interval(rule, format) { return [typeof rule.hours === 'number' && rule.hours > 0 ? 'каждые ' + format(rule.hours) + ' мтч' : '', typeof rule.months === 'number' && rule.months > 0 ? 'через ' + format(rule.months) + ' мес.' : ''].filter(Boolean).join(' или ') || 'Интервал не задан'; }
    function generators(rows, format) { return rows.filter(row => !row.archived && !row.deleted && (0, contracts_5.isId)(row.id)).map(row => ({ id: row.id, key: (0, exports.typedKey)(row.id), name: String(row.name || row.code || 'ДЭС №' + String(row.id)), serial: String(row.serial || ''), org: String(row.org || '').trim(), site: String(row.site || row.location || ''), rules: (Array.isArray(row.maintenanceRules) ? row.maintenanceRules : []).filter((rule) => rule !== null && typeof rule === 'object' && !Array.isArray(rule) && rule.enabled !== false).map(rule => ({ name: String(rule.label || 'Вид ТО не назван'), interval: interval(rule, format) })) })); }
    function visible(model) { const query = model.search.trim().toLocaleLowerCase('ru'); return model.generators.filter(row => (!model.org || row.org === model.org) && (!query || [row.name, row.serial, row.site].join(' ').toLocaleLowerCase('ru').includes(query))); }
});
define("features/maintenance-setup/view", ["require", "exports", "features/maintenance-setup/model"], function (require, exports, model_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createSetupView = createSetupView;
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[value]));
    function control(root, selector) { const node = root.querySelector(selector); if (!node)
        throw Error('Не загружен элемент настройки ТО: ' + selector); return node; }
    function rowHtml(row, index, model) { return '<tr><td><input type="checkbox" data-gm-setup-select="' + index + '" aria-label="Включить ' + esc(row.name) + ' в график"' + (model.selected.has(row.key) ? ' checked' : '') + '></td><th>' + esc(row.name) + '<small>' + esc([row.serial ? 'Зав. № ' + row.serial : '', row.org].filter(Boolean).join(' · ')) + '</small></th><td>' + esc(row.site || 'Объект не указан') + '</td><td>' + (row.rules.length ? row.rules.map(rule => '<div class="gm-setup-rule"><strong>' + esc(rule.name) + '</strong><small>' + esc(rule.interval) + '</small></div>').join('') : '<span class="gm-setup-missing">Виды ТО ещё не настроены</span>') + '</td><td><button type="button" class="btn btn-ghost btn-sm" data-gm-setup-edit="' + index + '">' + (model.canEdit ? 'Настроить ТО' : 'Посмотреть') + '</button></td></tr>'; }
    function createSetupView(dialog) {
        let root = null, events = null;
        function show(model, handlers) {
            events = handlers;
            root = dialog.show('Настройка ТО ДЭС', '<div class="gm-ui-form gm-setup" id="generatorMaintenanceSetup"><ol class="gm-setup-steps"><li class="active"><b>1</b><span>Настройте каждую ДЭС<small>Виды ТО и интервалы сохраняются в карточках</small></span></li><li><b>2</b><span>Задайте плановые часы<small>Счётчик возьмём из журнала ДЭС</small></span></li><li><b>3</b><span>Проверьте и сохраните график<small>Печать графика и ЗИП — отдельно</small></span></li></ol><p>Сначала укажите для каждой ДЭС, <strong>какие работы делать и через сколько моточасов</strong>. Затем выберите ДЭС для общего графика организации.</p><div class="gm-ui-grid"><label>Организация<select data-gm-setup-org><option value="">Все организации</option>' + model.organizations.map((org, index) => '<option value="' + index + '"' + (org === model.org ? ' selected' : '') + '>' + esc(org) + '</option>').join('') + '</select></label><label>Найти ДЭС или объект<input data-gm-setup-search placeholder="Название, заводской номер или объект"></label></div><div class="gm-setup-selection"><label><input type="checkbox" data-gm-setup-all> Выбрать все показанные ДЭС</label><span data-gm-setup-count></span></div><div data-gm-setup-list></div><div class="gm-setup-footer"><label>Год графика<input inputmode="numeric" data-gm-setup-year value="' + esc(model.year) + '"></label><button type="button" class="btn btn-primary" data-gm-setup-create>Перейти к часам и графику</button><button type="button" class="btn btn-ghost" data-gm-setup-plans>Открыть сохранённые графики</button></div><p class="gm-setup-footnote">Настройки ТО задаются один раз и подставляются в новые графики. Сами даты рассчитываются по введённой вами плановой наработке; фактическое обслуживание отмечается в журнале отдельно.</p><div role="status" class="gm-ui-error" data-gm-setup-error></div></div>');
            const active = root;
            control(active, '[data-gm-setup-org]').onchange = event => handlers.org(event.currentTarget.value);
            control(active, '[data-gm-setup-search]').oninput = event => handlers.search(event.currentTarget.value);
            control(active, '[data-gm-setup-all]').onchange = event => handlers.all(event.currentTarget.checked);
            control(active, '[data-gm-setup-create]').onclick = handlers.create;
            control(active, '[data-gm-setup-plans]').onclick = handlers.plans;
            update(model);
        }
        function update(model) {
            if (!root || !events)
                return;
            const handlers = events, rows = (0, model_1.visible)(model);
            control(root, '[data-gm-setup-list]').innerHTML = rows.length ? '<div class="gm-ui-scroll gm-setup-table"><table class="tbl"><thead><tr><th>В график</th><th>ДЭС</th><th>Объект</th><th>Настроенные виды ТО</th><th></th></tr></thead><tbody>' + rows.map((row, index) => rowHtml(row, index, model)).join('') + '</tbody></table></div>' : '<div class="gm-setup-empty">ДЭС по этим условиям не найдены. Измените организацию или поиск.</div>';
            root.querySelectorAll('[data-gm-setup-select]').forEach(input => { const row = rows[Number(input.dataset.gmSetupSelect)]; input.onchange = () => handlers.select(row.id, input.checked); });
            root.querySelectorAll('[data-gm-setup-edit]').forEach(button => { const row = rows[Number(button.dataset.gmSetupEdit)]; button.onclick = () => handlers.edit(row.id); });
            const all = control(root, '[data-gm-setup-all]'), selected = rows.filter(row => model.selected.has(row.key)).length;
            all.checked = rows.length > 0 && selected === rows.length;
            all.indeterminate = selected > 0 && selected < rows.length;
            control(root, '[data-gm-setup-count]').textContent = 'Выбрано ДЭС: ' + model.selected.size;
            control(root, '[data-gm-setup-create]').disabled = !model.selected.size || !model.canCreate;
        }
        return Object.freeze({ show, update, connected: () => !!root?.isConnected, year: () => root ? control(root, '[data-gm-setup-year]').value : '', error: (message) => { if (root)
                control(root, '[data-gm-setup-error]').textContent = message; } });
    }
});
define("features/maintenance-setup/controller", ["require", "exports", "application/contracts", "features/maintenance-setup/model"], function (require, exports, contracts_6, model_2) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createSetupController = createSetupController;
    function createSetupController(repository, view, ports) {
        let session = null;
        function open(options = {}) {
            try {
                if (ports.pending())
                    throw Error('Сохраните или отмените изменения открытой формы ТО.');
                if (!ports.readable())
                    throw Error('Нет доступа к карточкам ДЭС.');
                const items = (0, model_2.generators)(repository.read(['generators']).generators || [], ports.format), chosen = options.generatorId === undefined ? null : items.find(row => row.id === options.generatorId);
                if (options.generatorId !== undefined && !chosen)
                    throw Error('Выбранная ДЭС недоступна.');
                const model = { generators: items, organizations: [...new Set(items.map(row => row.org).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')), selected: new Set(options.selected || (chosen ? [chosen.key] : [])), org: chosen?.org || options.org || '', search: '', year: String(options.year || ports.year()), canEdit: ports.canEdit(), canCreate: ports.canCreate() }, current = { model, capture: repository.capture(['generators', 'generatorMaintenancePlans']) };
                session = current;
                const run = (action) => { try {
                    if (session !== current || !view.connected())
                        (0, contracts_6.fail)('STALE_VIEW', 'Форма настройки закрыта. Откройте её заново.');
                    repository.assertCurrent(current.capture);
                    view.error('');
                    action();
                }
                catch (error) {
                    view.error((0, contracts_6.errorOf)(error).message);
                } };
                view.show(model, { org: token => run(() => { model.org = token === '' ? '' : model.organizations[Number(token)] || ''; view.update(model); }), search: query => run(() => { model.search = query; view.update(model); }), all: checked => run(() => { for (const row of (0, model_2.visible)(model))
                        if (checked)
                            model.selected.add(row.key);
                        else
                            model.selected.delete(row.key); view.update(model); }), select: (id, checked) => run(() => { if (checked)
                        model.selected.add((0, model_2.typedKey)(id));
                    else
                        model.selected.delete((0, model_2.typedKey)(id)); view.update(model); }), edit: id => run(() => { model.year = view.year(); ports.edit(id, () => open({ org: model.org, year: model.year, selected: [...model.selected] })); }), plans: () => run(() => ports.plans(model.org)), create: () => run(() => {
                        const selected = model.generators.filter(row => model.selected.has(row.key));
                        if (!selected.length)
                            throw Error('Выберите хотя бы одну ДЭС.');
                        const orgs = [...new Set(selected.map(row => row.org))];
                        if (orgs.length !== 1 || !orgs[0])
                            throw Error('В один график включаются ДЭС одной организации. Уточните выбор и организацию в карточках.');
                        const year = ports.parseYear(view.year());
                        if (year < 1900 || year > 9999)
                            throw Error('Укажите год графика от 1900 до 9999.');
                        if (!ports.canCreate())
                            throw Error('Изменение недоступно: проверьте права и состояние подключения.');
                        ports.create({ org: orgs[0], year, title: 'График ТО ДЭС на ' + year + ' год', generatorIds: selected.map(row => row.id) });
                    }) });
            }
            catch (error) {
                ports.toast((0, contracts_6.errorOf)(error).message);
            }
        }
        return Object.freeze({ open });
    }
});
define("application/index", ["require", "exports", "application/contracts", "application/repository", "application/save-service", "application/row-commands", "application/card-controller", "features/maintenance-setup/controller", "features/maintenance-setup/view"], function (require, exports, contracts_7, repository_1, save_service_1, row_commands_1, card_controller_1, controller_1, view_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createSetupController = exports.createCardController = exports.createRowCommands = exports.createSaveService = exports.createRepository = exports.apiVersion = void 0;
    exports.createApplication = createApplication;
    Object.defineProperty(exports, "createRepository", { enumerable: true, get: function () { return repository_1.createRepository; } });
    Object.defineProperty(exports, "createSaveService", { enumerable: true, get: function () { return save_service_1.createSaveService; } });
    Object.defineProperty(exports, "createRowCommands", { enumerable: true, get: function () { return row_commands_1.createRowCommands; } });
    Object.defineProperty(exports, "createCardController", { enumerable: true, get: function () { return card_controller_1.createCardController; } });
    Object.defineProperty(exports, "createSetupController", { enumerable: true, get: function () { return controller_1.createSetupController; } });
    exports.apiVersion = 1;
    /** Composition root. Features depend on ports, never on a window or storage adapter. */
    function createApplication(ports) {
        const repository = (0, repository_1.createRepository)(ports.repository), saves = (0, save_service_1.createSaveService)(repository, ports.save), rows = (0, row_commands_1.createRowCommands)(repository, saves, ports.persist);
        const commands = Object.freeze({ saveSnapshot: (database, options, persist) => saves.save(database, options, persist), semantic: (command, options = {}) => ports.semantic(command, options), changeRows: (command) => ports.trackRows(ports.prepareRows ? ports.prepareRows().then(() => rows.execute(command)).catch((error) => ({ ok: false, ...(0, contracts_7.errorOf)(error) })) : rows.execute(command)) });
        const cards = (0, card_controller_1.createCardController)(repository, commands.changeRows, ports.allocateId), maintenanceSetup = (0, controller_1.createSetupController)(repository, (0, view_1.createSetupView)(ports.dialog), ports.setup);
        return Object.freeze({ repository, commands, cards, maintenanceSetup });
    }
});

return load('application/index');
});
