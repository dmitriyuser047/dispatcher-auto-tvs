const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { dialog, shell, BrowserWindow } = require('electron');
const backup = require('./backup-service.cjs');
const SAFE_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.csv', '.xlsx', '.xls', '.docx', '.odt', '.ods']);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function register({ ipcMain, getDataDir, isClientMode, getSettings, knowledgeDir, getPrincipal, getContext, assertContext }) {
    const local = () => { if (isClientMode())
        throw Error('Файлы и резервный пакет создаются на компьютере с основной базой.'); };
    const attachments=require('./attachment-access.cjs');
    ipcMain.handle('add-attachment', async (event, origin) => { try {
        local();
        const context=getContext?.(event),dir=path.resolve(getDataDir()),principal=getPrincipal?.(event);
        const captured=attachments.capture(dir,origin,{principal});
        const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Добавить документ', properties: ['openFile'], filters: [{ name: 'Документы', extensions: [...SAFE_EXT].map(x => x.slice(1)) }] });
        if (r.canceled)
            return { ok: false, canceled: true };
        const source = r.filePaths[0], ext = path.extname(source).toLowerCase();
        if (!SAFE_EXT.has(ext))
            throw Error('Неподдерживаемый тип документа');
        local();if(context)assertContext(context);if(path.resolve(getDataDir())!==dir)throw Error('Профиль базы изменился');
        const file=attachments.add(dir,captured,source,{principal:getPrincipal?.(event)});
        return {ok:true,file,databaseToken:captured.databaseToken};
    }
    catch (e) {
        return { ok: false, error: e.message };
    } });
    ipcMain.handle('open-attachment', async (event, origin) => { try {
        local();
        const {path:p}=attachments.inspect(getDataDir(),origin,{principal:getPrincipal?.(event)});
        if (!SAFE_EXT.has(path.extname(p)))
            throw Error('Неподдерживаемый тип');
        const err = await shell.openPath(p);
        if (err)
            throw Error(err);
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: e.message };
    } });
    ipcMain.handle('archive-import-source', async (_event, payload) => { try {
        local();
        require('./storage').assertWritable(getDataDir());
        const actor=getPrincipal?getPrincipal(_event):null;
        if(!actor||!require('./import-source.cjs').actions(actor).length)throw Error('Нет права сохранять источник импорта');
        const original=payload?.bytes;if(!(Array.isArray(original)||ArrayBuffer.isView(original))||original.length>25*1024*1024||Array.isArray(original)&&original.some(value=>!Number.isInteger(value)||value<0||value>255))throw Error('Нужны исходные байты размером до 25 МБ');
        const b = Buffer.from(original);
        if (b.length > 25 * 1024 * 1024)
            throw Error('Исходный файл больше 25 МБ');
        const hash = sha(b), ext = path.extname(String(payload.name || '')).toLowerCase();
        const suffix = /^\.[a-z0-9]{1,6}$/.test(ext) ? ext : '.bin', id = hash + suffix;
        const dest = path.join(getDataDir(), 'import-sources', id);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (fs.existsSync(dest)){const info=fs.lstatSync(dest);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||!fs.readFileSync(dest).equals(b))throw Error('Контрольная сумма сохранённого исходника не совпала');}
        else fs.writeFileSync(dest, b, { flag:'wx',mode:0o600 });
        return { ok: true, id, sha256: hash, size: b.length, name: path.basename(String(payload.name || 'source')) };
    }
    catch (e) {
        return { ok: false, error: e.message };
    } });
    ipcMain.handle('create-backup-package', async (event) => {
        try {
            local();
            const originalDir = path.resolve(getDataDir());
            const pick = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Резервный пакет базы и документов', defaultPath: 'TVS-backup-' + new Date().toISOString().slice(0, 10) + '.zip', filters: [{ name: 'ZIP', extensions: ['zip'] }] });
            if (pick.canceled)
                return { ok: false, canceled: true };
            local();
            if (path.resolve(getDataDir()) !== originalDir)
                throw Error('Профиль базы изменился. Повторите операцию.');
            return backup.createPackage({ sourceDir: originalDir, archivePath: pick.filePath, settings: getSettings(), knowledgeDir: knowledgeDir() });
        }
        catch (e) {
            return { ok: false, error: e.message };
        }
    });
    ipcMain.handle('verify-backup-package', async (event) => {
        try {
            local();
            const originalDir = path.resolve(getDataDir());
            const pick = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Выберите резервный пакет для проверки', properties: ['openFile'], filters: [{ name: 'ZIP', extensions: ['zip'] }] });
            if (pick.canceled)
                return { ok: false, canceled: true };
            local();
            if (path.resolve(getDataDir()) !== originalDir)
                throw Error('Профиль базы изменился. Повторите операцию.');
            backup.verifyPackage({ archivePath: pick.filePaths[0] });
            const folder = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Папка для отдельного восстановления', properties: ['openDirectory', 'createDirectory'] });
            if (folder.canceled)
                return { ok: false, canceled: true };
            local();
            if (path.resolve(getDataDir()) !== originalDir)
                throw Error('Профиль базы изменился. Повторите операцию.');
            const targetDir = path.join(path.resolve(folder.filePaths[0]), 'TVS-restored-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex'));
            return backup.restorePackage({ archivePath: pick.filePaths[0], targetDir, protectedDir: originalDir });
        }
        catch (e) {
            return { ok: false, error: e.message, path: null };
        }
    });
}
module.exports = { register };
