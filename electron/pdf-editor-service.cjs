const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Each editor owns its document. An editor opened later must never replace the
// bytes or destination of an already open window.
function registerPdfEditorService({ app, BrowserWindow, ipcMain, dialog }) {
  const sessions = new Map();
  const rootDir = path.resolve(__dirname, '..');
  const fontData = new Map();
  const fileWrites = new Map();
  const getOcrRuntime = () => require('./ocr-runtime.cjs').getSharedOcrRuntime({
    rootDir, workerPath: path.join(rootDir, 'vendor', 'tesseract-worker', 'index.cjs'), maxWorkers: 2,
  });
  let contentQueue = Promise.resolve();

  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const errorText = error => String(error && error.message || error || 'Неизвестная ошибка');
  const parentOf = event => BrowserWindow.fromWebContents(event.sender) || undefined;
  const sessionOf = event => {
    const session = sessions.get(event.sender.id);
    if (!session) throw new Error('Документ редактора не найден. Откройте PDF заново');
    return session;
  };
  const publicData = session => ({
    pdfBase64: session.pdfBase64,
    filePath: session.filePath,
    fileName: session.filePath ? path.basename(session.filePath) : (session.displayName || 'Документ.pdf'),
  });
  const canonicalPath = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  const samePath = (left, right) => !!left && !!right && canonicalPath(left) === canonicalPath(right);

  function decodeBase64(value, kind) {
    if (typeof value !== 'string') throw new Error('Не получены данные ' + kind);
    const encoded = value.replace(/^data:[^;,]+;base64,/i, '').replace(/\s/g, '');
    if (!encoded || !/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
      throw new Error('Повреждены данные ' + kind);
    }
    return Buffer.from(encoded, 'base64');
  }

  function assertPdf(bytes) {
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('Выбранный файл не является PDF');
  }

  async function readPdf(filePath) {
    const bytes = await fs.promises.readFile(filePath);
    assertPdf(bytes);
    const { PDFDocument } = require('pdf-lib');
    let parsed;
    try { parsed = await PDFDocument.load(bytes, { updateMetadata: false }); }
    catch (error) {
      if (/encrypt|password/i.test(errorText(error))) throw new Error('PDF защищён паролем. Откройте для редактирования копию без пароля');
      throw new Error('Не удалось открыть PDF: ' + errorText(error));
    }
    if (!parsed.getPageCount()) throw new Error('В PDF нет страниц');
    return { pdfBase64: bytes.toString('base64'), filePath, hash: digest(bytes), busy: false };
  }

  async function choosePdf(event, title) {
    const selection = await dialog.showOpenDialog(parentOf(event), {
      title,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    });
    if (selection.canceled || !selection.filePaths || !selection.filePaths[0]) return null;
    return readPdf(selection.filePaths[0]);
  }

  function setTitle(event, session) {
    const win = parentOf(event);
    if (win && !win.isDestroyed()) win.setTitle('PDF-редактор — ' + publicData(session).fileName);
  }

  ipcMain.handle('open-pdf-editor', async event => {
    try {
      const session = await choosePdf(event, 'Выберите PDF-файл для редактирования');
      if (!session) return { ok: false, canceled: true };
      const iconPath = path.join(rootDir, 'build', 'icon.ico');
      const pdfWin = new BrowserWindow({
        show: !app.commandLine.hasSwitch('tvs-test-hidden'),
        width: 1400, height: 900, minWidth: 900, minHeight: 600,
        title: 'PDF-редактор — ' + path.basename(session.filePath),
        icon: fs.existsSync(iconPath) ? iconPath : undefined,
        parent: parentOf(event),
        webPreferences: {
          preload: path.join(__dirname, 'pdf-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      const webContentsId = pdfWin.webContents.id;
      sessions.set(webContentsId, session);
      pdfWin.setMenuBarVisibility(false);
      pdfWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      pdfWin.webContents.on('will-navigate', event => event.preventDefault());
      pdfWin.on('closed', () => sessions.delete(webContentsId));
      try {
        await pdfWin.loadFile(path.join(rootDir, 'pdf-editor.html'));
      } catch (error) {
        sessions.delete(webContentsId);
        if (!pdfWin.isDestroyed()) pdfWin.destroy();
        throw error;
      }
      return { ok: true };
    } catch (error) { return { ok: false, error: errorText(error) }; }
  });

  ipcMain.handle('pdf-editor-data', event => {
    try { return publicData(sessionOf(event)); }
    catch (error) { return { ok: false, error: errorText(error) }; }
  });

  ipcMain.handle('pdf-editor-open', async event => {
    try {
      const previous = sessionOf(event);
      if (previous.busy) return { ok: false, error: 'Дождитесь окончания сохранения' };
      const session = await choosePdf(event, 'Открыть другой PDF');
      if (!session) return { ok: false, canceled: true };
      // The renderer still owns the previous document until PDF.js has loaded
      // the candidate successfully. Its save target must stay unchanged.
      if (sessions.get(event.sender.id) !== previous) return { ok: false, error: 'Документ уже изменён. Повторите открытие PDF' };
      const pendingToken = crypto.randomBytes(24).toString('hex');
      previous.pendingOpen = { token: pendingToken, session };
      return { ok: true, pendingToken, ...publicData(session) };
    } catch (error) { return { ok: false, error: errorText(error) }; }
  });

  ipcMain.handle('pdf-editor-commit-open', (event, token) => {
    try {
      const previous = sessionOf(event);
      if (previous.busy) return { ok: false, error: 'Дождитесь окончания сохранения' };
      const pending = previous.pendingOpen;
      if (!pending || typeof token !== 'string' || pending.token !== token) {
        return { ok: false, error: 'Открытие этого PDF уже отменено или заменено другим документом' };
      }
      // No asynchronous work follows the ownership check: document bytes,
      // filename and save destination become current in one operation.
      delete previous.pendingOpen;
      sessions.set(event.sender.id, pending.session);
      setTitle(event, pending.session);
      return { ok: true, ...publicData(pending.session) };
    } catch (error) { return { ok: false, error: errorText(error) }; }
  });

  ipcMain.handle('pdf-editor-cancel-open', (event, token) => {
    try {
      const session = sessionOf(event);
      if (!session.pendingOpen || typeof token !== 'string' || session.pendingOpen.token !== token) {
        return { ok: false, error: 'Открытие этого PDF уже отменено или заменено другим документом' };
      }
      delete session.pendingOpen;
      return { ok: true, canceled: true };
    } catch (error) { return { ok: false, error: errorText(error) }; }
  });

  // Write and flush a complete sibling file first. A failed write leaves the
  // original file intact; rename is the only operation replacing its contents.
  async function atomicWrite(filePath, bytes) {
    const tmpPath = path.join(path.dirname(filePath), '.' + path.basename(filePath) + '.' + crypto.randomBytes(10).toString('hex') + '.tmp');
    let handle;
    try {
      handle = await fs.promises.open(tmpPath, 'wx');
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.promises.rename(tmpPath, filePath);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.promises.unlink(tmpPath).catch(() => {});
    }
  }

  async function saveDocument(event, payload, saveAs) {
    let session;
    let ownsSave = false;
    try {
      session = sessionOf(event);
      if (session.busy) return { saved: false, error: 'Сохранение уже выполняется' };
      session.busy = true;
      ownsSave = true;
      const bytes = decodeBase64(payload && payload.pdfBase64, 'PDF');
      assertPdf(bytes);
      const { PDFDocument } = require('pdf-lib');
      const parsed = await PDFDocument.load(bytes, { updateMetadata: false });
      if (!parsed.getPageCount()) throw new Error('В PDF должна быть хотя бы одна страница');

      let savePath = session.filePath;
      if (saveAs || !savePath) {
        const baseName = savePath ? path.basename(savePath, path.extname(savePath)) + '_изменён.pdf' : 'Документ.pdf';
        const selection = await dialog.showSaveDialog(parentOf(event), {
          title: saveAs ? 'Сохранить PDF как…' : 'Сохранить PDF',
          defaultPath: savePath ? path.join(path.dirname(savePath), baseName) : baseName,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (selection.canceled || !selection.filePath) return { saved: false, canceled: true };
        savePath = /\.pdf$/i.test(selection.filePath) ? selection.filePath : selection.filePath + '.pdf';
      }

      // Serialize writes to the same target, including writes from separate
      // windows, so both cannot pass the original-file check simultaneously.
      const key = canonicalPath(savePath);
      const write = (fileWrites.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
        if (samePath(savePath, session.filePath)) {
          let existing;
          try { existing = await fs.promises.readFile(savePath); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (existing && digest(existing) !== session.hash) {
            return { saved: false, conflict: true, error: 'Файл уже изменён в другом окне или программе. Используйте «Сохранить как…», чтобы сохранить свою копию' };
          }
        }
        await atomicWrite(savePath, bytes);
        session.pdfBase64 = bytes.toString('base64');
        session.filePath = savePath;
        session.hash = digest(bytes);
        setTitle(event, session);
        return { saved: true, path: savePath, fileName: path.basename(savePath) };
      });
      fileWrites.set(key, write);
      try { return await write; }
      finally { if (fileWrites.get(key) === write) fileWrites.delete(key); }
    } catch (error) {
      return { saved: false, error: 'Не удалось сохранить PDF: ' + errorText(error) };
    } finally { if (session && ownsSave) session.busy = false; }
  }

  ipcMain.handle('pdf-editor-save', (event, payload) => saveDocument(event, payload, false));
  ipcMain.handle('pdf-editor-save-as', (event, payload) => saveDocument(event, payload, true));

  ipcMain.handle('pdf-editor-adopt-project', async (event, payload) => {
    try {
      const previous = sessionOf(event);
      if (previous.busy) throw new Error('Дождитесь окончания сохранения');
      const bytes = decodeBase64(payload && payload.pdfBase64, 'PDF проекта');
      assertPdf(bytes);
      const parsed = await require('pdf-lib').PDFDocument.load(bytes, { updateMetadata: false });
      if (!parsed.getPageCount()) throw new Error('В проекте нет страниц PDF');
      if (sessionOf(event) !== previous) throw new Error('Документ уже изменён');
      const displayName = path.basename(String(payload.title || 'Документ.pdf')).slice(0, 240);
      const session = { pdfBase64: bytes.toString('base64'), filePath: '', displayName, hash: digest(bytes), busy: false };
      sessions.set(event.sender.id, session);
      setTitle(event, session);
      return { ok: true };
    } catch (error) { return { ok: false, error: errorText(error) }; }
  });

  ipcMain.handle('pdf-editor-process-content', async (event, payload) => {
    let session;
    let ownsJob=false;
    try {
      session=sessionOf(event);
      if(session.contentBusy)throw new Error('Обработка содержимого этого документа уже выполняется');
      session.contentBusy=true;ownsJob=true;
      const bytes = decodeBase64(payload && payload.bytesBase64, 'PDF');
      assertPdf(bytes);
      if (bytes.length > 128 * 1024 * 1024) throw new Error('Для обработки содержимого выберите PDF до 128 МБ');
      const enginePath = path.join(__dirname, 'pdf-content-engine.cjs');
      const physicalEngine = enginePath.replace(/([\\/])app\.asar(?=[\\/]|$)/i, '$1app.asar.unpacked');
      const run=contentQueue.catch(()=>{}).then(()=>{
        if(event.sender.isDestroyed()||sessionOf(event)!==session)throw new Error('Документ уже закрыт или заменён');
        return require(fs.existsSync(physicalEngine) ? physicalEngine : enginePath).applyContentChanges(bytes, payload.changes, { rasterizePages: payload.rasterizePages });
      });
      contentQueue=run.catch(()=>{});
      const result = await run;
      return { ok: true, bytesBase64: Buffer.from(result.bytes).toString('base64'), warnings: result.warnings || [], pages: result.pages || [], engine: result.engine };
    } catch (error) { return { ok: false, error: errorText(error) }; }
    finally { if(session&&ownsJob)session.contentBusy=false; }
  });

  require('./pdf-document-services.cjs').registerPdfDocumentServices({ app, ipcMain, dialog, BrowserWindow, getSession: sessionOf });

  ipcMain.handle('pdf-editor-merge', async event => {
    try {
      sessionOf(event);
      const selection = await dialog.showOpenDialog(parentOf(event), {
        title: 'Выберите PDF для объединения',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        properties: ['openFile', 'multiSelections'],
      });
      if (selection.canceled || !selection.filePaths || !selection.filePaths.length) return { ok: false, canceled: true };
      const files = await Promise.all(selection.filePaths.map(async filePath => {
        const data = await readPdf(filePath);
        return { name: path.basename(filePath), base64: data.pdfBase64 };
      }));
      return { ok: true, files };
    } catch (error) { return { ok: false, error: errorText(error) }; }
  });

  ipcMain.handle('pdf-editor-insert-image', async event => {
    try {
      sessionOf(event);
      const selection = await dialog.showOpenDialog(parentOf(event), {
        title: 'Выберите изображение',
        filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] }],
        properties: ['openFile'],
      });
      if (selection.canceled || !selection.filePaths || !selection.filePaths[0]) return { ok: false, canceled: true };
      const filePath = selection.filePaths[0];
      const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.bmp': 'image/bmp', '.webp': 'image/webp' };
      const mimeType = mimeTypes[path.extname(filePath).toLowerCase()];
      if (!mimeType) throw new Error('Поддерживаются PNG, JPEG, BMP и WebP');
      const bytes = await fs.promises.readFile(filePath);
      return { ok: true, dataUrl: 'data:' + mimeType + ';base64,' + bytes.toString('base64'), name: path.basename(filePath), mimeType };
    } catch (error) { return { ok: false, error: errorText(error) }; }
  });

  ipcMain.handle('pdf-editor-font', async (event, requestedStyle = 'regular') => {
    try {
      sessionOf(event);
      const styles = {
        regular: { arial: 'arial.ttf', segoe: 'segoeui.ttf', liberation: 'Regular', dejavu: '' },
        bold: { arial: 'arialbd.ttf', segoe: 'segoeuib.ttf', liberation: 'Bold', dejavu: '-Bold' },
        italic: { arial: 'ariali.ttf', segoe: 'segoeuii.ttf', liberation: 'Italic', dejavu: '-Oblique' },
        boldItalic: { arial: 'arialbi.ttf', segoe: 'segoeuiz.ttf', liberation: 'BoldItalic', dejavu: '-BoldOblique' },
      };
      const style = typeof requestedStyle === 'string' ? requestedStyle : 'regular';
      const variant = styles[style];
      if (!variant) throw new Error('Неизвестное начертание шрифта');
      if (!fontData.has(style)) {
        const windowsDir = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
        const candidates = [
          path.join(rootDir, 'assets', 'fonts', 'NotoSans-' + variant.liberation + '.ttf'),
          path.join(rootDir, 'assets', 'fonts', 'DejaVuSans' + variant.dejavu + '.ttf'),
          path.join(windowsDir, 'Fonts', variant.arial),
          path.join(windowsDir, 'Fonts', variant.segoe),
          path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts', 'LiberationSans-' + variant.liberation + '.ttf'),
          '/usr/share/fonts/truetype/dejavu/DejaVuSans' + variant.dejavu + '.ttf',
        ];
        const fontPath = candidates.find(filePath => fs.existsSync(filePath));
        if (!fontPath) throw new Error('Не найден шрифт для русского текста');
        fontData.set(style, { ok: true, base64: (await fs.promises.readFile(fontPath)).toString('base64'), name: path.basename(fontPath), style });
      }
      return fontData.get(style);
    } catch (error) { return { ok: false, error: errorText(error) }; }
  });

  function disposeOcrWorker() { return getOcrRuntime().dispose(); }

  ipcMain.handle('pdf-editor-ocr-info', async event => {
    try { sessionOf(event);return {ok:true,...await getOcrRuntime().info()}; }
    catch(error) {return {ok:false,error:errorText(error)};}
  });

  ipcMain.handle('pdf-editor-ocr', async (event, payload) => {
    let session, ownsJob=false;
    const controller=new AbortController();
    const cancel=()=>controller.abort();
    try {
      session=sessionOf(event);
      if(session.ocrBusy)throw Error('Распознавание этого документа уже выполняется');
      session.ocrBusy=true;ownsJob=true;
      const bytes=decodeBase64(payload && payload.imageBase64,'изображения');
      const requested=payload.options||{};
      if(['codes','amount'].includes(requested.decode)&&requested.isRegion!==true)throw Error('Для режима реквизитов выделите отдельную текстовую область OCR');
      event.sender.once('destroyed',cancel);
      const result=await getOcrRuntime().recognize(bytes,{
        language:requested.language||'rus+eng',profile:requested.profile||'accurate',decode:requested.decode||'document',
        psm:requested.psm,threshold:requested.threshold,autorotate:false,timeoutMs:180000,signal:controller.signal,
        onProgress(progress){if(!event.sender.isDestroyed())event.sender.send('pdf-editor-ocr-progress',progress);},
      });
      return {ok:true,...result};
    }catch(error){return {ok:false,error:errorText(error)};}
    finally {event.sender.removeListener('destroyed',cancel);if(session&&ownsJob)session.ocrBusy=false;}
  });

  app.once('before-quit', () => { void disposeOcrWorker(); });
  return { disposeOcrWorker };
}

module.exports = { registerPdfEditorService };
