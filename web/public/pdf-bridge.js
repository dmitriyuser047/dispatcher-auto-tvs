/* Browser adapter for the retained PDF/OCR editor. Files enter through a
 * browser picker; private server paths and bearer credentials never enter it. */
(function () {
  'use strict';
  const MAX_FILES = 20, MAX_UPLOAD = 25 * 1024 * 1024, MAX_DOWNLOAD = 64 * 1024 * 1024;
  const themeListeners = new Set(), progressListeners = new Set();
  let csrf = document.querySelector('meta[name="tvs-csrf"]')?.content || '';
  let bootstrapPromise, editorPromise, initialData, databaseToken;
  let editorId = new URL(location.href).searchParams.get('editorId');
  if (!/^[a-f0-9]{64}$/.test(editorId || '')) editorId = null;
  let queue = Promise.resolve();
  // Desktop recovery is persistent on that computer; browser recovery belongs
  // to the authenticated server session. Keep the shared native UI unchanged.
  if (typeof MutationObserver === 'function') {
    const note = 'Автокопии проекта доступны в текущем сеансе. Скачайте проект, чтобы сохранить его для следующего входа.';
    const desktopNotes = new Set(['Локальные автоматические копии редактируемых проектов', 'Автокопии хранятся локально; исходные PDF и рабочая база не изменяются.', 'Локальные автоматические копии. Рабочая база и исходные файлы не изменяются.']);
    const update = node => {
      if (node.nodeType === 3) { if (desktopNotes.has(node.nodeValue)) node.nodeValue = note; return; }
      if (node.nodeType !== 1) return;
      if (desktopNotes.has(node.getAttribute('title'))) node.setAttribute('title', note);
      for (const child of node.childNodes) update(child);
    };
    const observer = new MutationObserver(changes => { for (const change of changes) { if (change.type === 'attributes') update(change.target); else for (const child of change.addedNodes) update(child); } });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
    update(document.body);
  }
  function emit(listeners, value) { for (const listener of listeners) { try { listener(value); } catch (error) { console.error(error); } } }
  function listen(listeners, callback) { if (typeof callback !== 'function') return () => {}; listeners.add(callback); return () => listeners.delete(callback); }
  async function request(route, body) {
    let response;
    try {
      response = await fetch('/web-api/' + route, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch (cause) { throw Object.assign(Error('Сервер недоступен. Проверьте результат операции перед повтором.'), { code: 'WEB_TRANSPORT', unknown: body !== undefined, cause }); }
    let result;
    try { result = await response.json(); } catch { throw Object.assign(Error('Сервер не подтвердил ответ PDF-редактора.'), { code: 'WEB_RESPONSE', status: response.status, unknown: body !== undefined }); }
    if (!response.ok) throw Object.assign(Error(result?.error || 'Не удалось выполнить действие PDF-редактора.'), result, { status: response.status });
    if (typeof result?.csrf === 'string') csrf = result.csrf;
    return result;
  }
  function bootstrap() {
    if (!bootstrapPromise) bootstrapPromise = request('bootstrap').then(result => {
      if (result?.ok !== true || typeof result.databaseToken !== 'string' || !result.databaseToken || !result.access?.user?.id || !csrf)
        throw Object.assign(Error('База и персональный сеанс не подтверждены. Войдите заново.'), { code: 'ACCESS_UNVERIFIED' });
      databaseToken = result.databaseToken; return result;
    }).catch(error => { bootstrapPromise = null; throw error; });
    return bootstrapPromise;
  }
  function send(action, payload, files) {
    const operation = async () => {
      await bootstrap();
      const result = await request('pdf-studio', { action, ...(action === 'create' ? {} : { editorId }), databaseToken,
        ...(payload === undefined ? {} : { payload }), ...(files === undefined ? {} : { files }) });
      if (result?.progress) emit(progressListeners, result.progress);
      return result;
    };
    const pending = queue.then(operation, operation); queue = pending.catch(() => {}); return pending;
  }
  function make(tag, text, className) { const element = document.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element; }
  function chooseFiles({ title, accept, multiple = false, initial = false, error = '' }) {
    return new Promise(resolve => {
      const dialog = make('dialog', '', 'pe-dialog'), heading = make('h2', title), detail = make('p', 'Выберите файл на своём компьютере. Редактор работает с отдельной копией.'),
        input = make('input'), label = make('label', 'Файл', 'pe-field'), actions = make('div', '', 'pe-dialog-actions');
      if (error) { detail.textContent = error; detail.setAttribute('role', 'alert'); }
      input.type = 'file'; input.accept = accept; input.multiple = multiple; input.setAttribute('aria-label', title); label.append(input);
      let done = false;
      const finish = files => { if (done) return; done = true; dialog.close(); dialog.remove(); resolve(files); };
      input.addEventListener('change', () => { if (input.files?.length) finish(Array.from(input.files)); });
      if (initial) { const back = make('a', 'Вернуться к диспетчеру'); back.href = '/objects'; actions.append(back); }
      else { const cancel = make('button', 'Отмена'); cancel.type = 'button'; cancel.addEventListener('click', () => finish(null)); actions.append(cancel); }
      dialog.addEventListener('cancel', event => { event.preventDefault(); if (!initial) finish(null); });
      dialog.append(heading, detail, label, actions); document.body.append(dialog); dialog.showModal(); input.focus();
    });
  }
  function toBase64(bytes) { let binary = ''; for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768)); return btoa(binary); }
  async function upload(files) {
    if (!files) return null;
    if (!files.length || files.length > MAX_FILES) throw Error('Выберите от 1 до 20 файлов.');
    let total = 0;
    for (const file of files) {
      if (typeof file.name !== 'string' || !file.name || file.name.length > 240 || /[<>:"/\\|?*\x00-\x1f]/.test(file.name) || /[. ]$/.test(file.name) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(file.name)) throw Error('Недопустимое имя выбранного файла.');
      if (!Number.isSafeInteger(file.size) || file.size < 1 || (total += file.size) > MAX_UPLOAD) throw Error('Общий размер выбранных файлов должен быть не больше 25 МБ.');
    }
    const result = [];
    for (const file of files) { const bytes = new Uint8Array(await file.arrayBuffer()); if (bytes.length !== file.size) throw Error('Не удалось подтвердить выбранный файл.'); result.push({ name: file.name, base64: toBase64(bytes) }); }
    return result;
  }
  async function ensureEditor() {
    if (editorId) return;
    if (!editorPromise) editorPromise = (async () => {
      await bootstrap();
      let error = '';
      for (;;) {
        let files;
        try { files = await upload(await chooseFiles({ title: 'Открыть PDF-документ', accept: '.pdf,application/pdf', initial: true, error })); }
        catch (issue) { error = issue.message; continue; }
        const result = await send('create', undefined, files);
        if (result?.ok !== true) { error = result?.error || 'PDF-документ не открыт. Выберите другой файл.'; continue; }
        if (!/^[a-f0-9]{64}$/.test(result.editorId || '')) throw Object.assign(Error('Сервер не подтвердил созданный PDF-редактор.'), { code: 'WEB_RESPONSE', unknown: true });
        editorId = result.editorId; initialData = result;
        const url = new URL(location.href); url.searchParams.set('editorId', editorId); history.replaceState(null, '', url.pathname + url.search + url.hash);
        break;
      }
    })().catch(error => { editorPromise = null; throw error; });
    await editorPromise;
  }
  async function invoke(action, payload) { await ensureEditor(); return send(action, payload); }
  async function pick(action, title, accept, multiple = false) {
    await ensureEditor(); const files = await upload(await chooseFiles({ title, accept, multiple }));
    return files ? send(action, undefined, files) : { ok: false, canceled: true };
  }
  async function checksum(bytes) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join(""); }
  function safeName(value) { const name = String(value || 'Документ').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 180); return name && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? name : 'Документ'; }
  async function download(result, format) {
    if (result?.ok !== true && result?.saved !== true) return result;
    if (typeof result.base64 !== 'string' || result.base64.length > Math.ceil(MAX_DOWNLOAD / 3) * 4 || !Number.isSafeInteger(result.bytes) || result.bytes < 1 || result.bytes > MAX_DOWNLOAD || !/^[a-f0-9]{64}$/.test(result.sha256 || '')) throw Error('Сервер не подтвердил готовый файл для загрузки.');
    let bytes; try { bytes = Uint8Array.from(atob(result.base64), value => value.charCodeAt(0)); } catch { throw Error('Сервер передал повреждённый файл.'); }
    if (bytes.length !== result.bytes) throw Error('Размер файла не совпадает с подтверждением сервера.');
    if (await checksum(bytes) !== result.sha256) throw Error('Контрольная сумма файла не совпадает.');
    const mime = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain;charset=utf-8', csv: 'text/csv;charset=utf-8', tvspdf: 'application/zip' }[format] || 'application/octet-stream';
    const filename = safeName(result.name || result.fileName || result.path), url = URL.createObjectURL(new Blob([bytes], { type: mime })), anchor = make('a');
    anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    const { base64: omitted, ...rest } = result; return { ...rest, path: filename, name: filename, downloadStarted: true };
  }
  window.pdfEditor = Object.freeze({
    getTheme: async () => { try { return localStorage.getItem('theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } },
    setTheme: async theme => { const value = theme === 'light' ? 'light' : 'dark'; try { localStorage.setItem('theme', value); } catch {} emit(themeListeners, value); return value; },
    onThemeChanged: callback => listen(themeListeners, callback), onOcrProgress: callback => listen(progressListeners, callback),
    getData: async () => {
      await ensureEditor();
      if (initialData) { const result = initialData; initialData = null; return result; }
      try { return await send('pdf-editor-data'); }
      catch (error) {
        if (error.status !== 404 || error.code !== 'WEB_PDF_MISSING') throw error;
        editorId = null; editorPromise = null;
        const url = new URL(location.href); url.searchParams.delete('editorId'); history.replaceState(null, '', url.pathname + url.search + url.hash);
        await ensureEditor(); const result = initialData; initialData = null; return result;
      }
    },
    openFile: () => pick('pdf-editor-open', 'Открыть другой PDF', '.pdf,application/pdf'),
    commitOpen: token => invoke('pdf-editor-commit-open', token), cancelOpen: token => invoke('pdf-editor-cancel-open', token),
    getFont: (style = 'regular') => invoke('pdf-editor-font', style),
    save: async pdfBase64 => download(await invoke('pdf-editor-save', { pdfBase64 }), 'pdf'),
    saveAs: async pdfBase64 => download(await invoke('pdf-editor-save-as', { pdfBase64 }), 'pdf'),
    mergePdf: () => pick('pdf-editor-merge', 'Добавить страницы PDF', '.pdf,application/pdf', true),
    insertImage: () => pick('pdf-editor-insert-image', 'Вставить изображение', '.png,.jpg,.jpeg,.bmp,.webp,image/png,image/jpeg,image/bmp,image/webp'),
    ocr: async (imageBase64, options = {}) => { emit(progressListeners, { status: 'recognizing text', progress: 0 }); const result = await invoke('pdf-editor-ocr', { imageBase64, options }); if (result?.ok) emit(progressListeners, { status: 'recognizing text', progress: 1 }); return result; },
    ocrInfo: () => invoke('pdf-editor-ocr-info'), processContent: payload => invoke('pdf-editor-process-content', payload), adoptProject: payload => invoke('pdf-editor-adopt-project', payload),
    exportDocument: async payload => download(await invoke('pdf-studio-export', payload), payload?.format),
    saveProject: async payload => download(await invoke('pdf-studio-save-project', payload), 'tvspdf'),
    openProject: () => pick('pdf-studio-open-project', 'Открыть проект PDF', '.tvspdf'), autosave: payload => invoke('pdf-studio-autosave', payload),
    recoveryList: () => invoke('pdf-studio-recovery-list'), recoveryOpen: id => invoke('pdf-studio-recovery-open', { id }), recoveryDelete: id => invoke('pdf-studio-recovery-delete', { id }),
    compareFile: () => pick('pdf-studio-compare-file', 'Выбрать PDF для сравнения', '.pdf,application/pdf'),
    exportPages: async payload => download(await invoke('pdf-studio-export-pages', payload), 'pdf'),
  });
})();
