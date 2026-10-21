const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { dialog, shell, BrowserWindow } = require('electron');
const backup = require('./backup-service.cjs');
const SAFE_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.csv', '.xlsx', '.xls', '.docx', '.odt', '.ods']);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function register({ ipcMain, getDataDir, isClientMode, getSettings, knowledgeDir }) {
    const local = () => { if (isClientMode())
        throw Error('Файлы и резервный пакет создаются на компьютере с основной базой.'); };
    const filePath = id => { if (!/^[a-f0-9]{64}\.[a-z0-9]{1,6}$/.test(id))
        throw Error('Неверный ID файла'); return path.join(getDataDir(), 'attachments', id); };
    ipcMain.handle('add-attachment', async (event) => { try {
        local();
        const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Добавить документ', properties: ['openFile'], filters: [{ name: 'Документы', extensions: [...SAFE_EXT].map(x => x.slice(1)) }] });
        if (r.canceled)
            return { ok: false, canceled: true };
        const source = r.filePaths[0], ext = path.extname(source).toLowerCase();
        if (!SAFE_EXT.has(ext))
            throw Error('Неподдерживаемый тип документа');
        if (fs.statSync(source).size > 25 * 1024 * 1024)
            throw Error('Файл больше 25 МБ');
        const b = fs.readFileSync(source), hash = sha(b), id = hash + ext, dest = filePath(id);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (!fs.existsSync(dest))
            fs.writeFileSync(dest, b, { flag: 'wx' });
        return { ok: true, file: { id, name: path.basename(source), size: b.length, sha256: hash, addedAt: new Date().toISOString() } };
    }
    catch (e) {
        return { ok: false, error: e.message };
    } });
    ipcMain.handle('open-attachment', async (_event, id) => { try {
        local();
        const p = filePath(id);
        if (!SAFE_EXT.has(path.extname(p)))
            throw Error('Неподдерживаемый тип');
        const b = fs.readFileSync(p);
        if (sha(b) !== id.slice(0, 64))
            throw Error('Контрольная сумма документа не совпала');
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
        const b = Buffer.from(payload.bytes);
        if (b.length > 25 * 1024 * 1024)
            throw Error('Исходный файл больше 25 МБ');
        const hash = sha(b), ext = path.extname(String(payload.name || '')).toLowerCase();
        const suffix = /^\.[a-z0-9]{1,6}$/.test(ext) ? ext : '.bin', id = hash + suffix;
        const dest = path.join(getDataDir(), 'import-sources', id);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (!fs.existsSync(dest))
            fs.writeFileSync(dest, b, { flag: 'wx' });
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
