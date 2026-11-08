'use strict';
// The save captures only the current business checkpoint. Compression and the
// immutable history walk run in another thread, outside the database write lock.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), safe = require('./safe-file.cjs');
const jobs = new Map(), verified = new Map(), JOB = /^\.backup-job-\d{4}-\d{2}-\d{2}-[a-f0-9-]{36}$/;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
let launcher = null;
function fail(code, message) { throw Object.assign(Error(message), { code }); }
function read(file) { return JSON.parse(safe.readRegularFileSync(file, { maxBytes: 16384 })); }
function write(file, value) { const bytes = Buffer.from(JSON.stringify(value)), tmp = file + '.' + crypto.randomUUID() + '.tmp', fd = fs.openSync(tmp, 'wx', 0o600); let owned; try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    owned = fs.fstatSync(fd);
}
finally {
    fs.closeSync(fd);
} const pin = safe.verifiedDirectory(path.dirname(file)), deadline = Date.now() + 1000, signal = new Int32Array(new SharedArrayBuffer(4)); for (;;) {
    try {
        safe.assertDirectory(pin);
        const now = fs.lstatSync(tmp);
        if (now.isSymbolicLink() || now.ino !== owned.ino || now.dev !== owned.dev)
            fail('BACKUP_JOB', 'Временный статус изменён');
        fs.renameSync(tmp, file);
        return;
    }
    catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || Date.now() >= deadline)
            throw error;
        Atomics.wait(signal, 0, 0, 15);
    }
} }
function stamp(archive) { const parent = safe.verifiedDirectory(path.dirname(archive)), rows = []; const add = p => { const s = fs.lstatSync(p); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1)
    fail('BACKUP_PATH', 'Резервный файл заменён ссылкой'); rows.push([p, s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs]); }; add(archive); const parts = archive + '.parts'; if (fs.existsSync(parts)) {
    const folder = safe.verifiedDirectory(parts);
    for (const name of fs.readdirSync(folder.path).sort())
        add(path.join(folder.path, name));
    safe.assertDirectory(folder);
} safe.assertDirectory(parent); return JSON.stringify(rows); }
function jobInfo(jobDir, source) { const pin = safe.verifiedDirectory(jobDir), v = read(path.join(pin.path, 'job.json')); if (v.version !== 1 || v.source !== source || !/^data_\d{4}-\d{2}-\d{2}\.zip$/.test(v.archive) || v.snapshot !== 'checkpoint.json' || !/^\w{64}$/.test(v.sha256) || !Number.isSafeInteger(v.keep) || v.keep < 1)
    fail('BACKUP_JOB', 'Некорректное задание резервирования'); return { pin, value: v }; }
function dailyJobs(root, source, today) { const result = []; for (const name of fs.readdirSync(root.path).filter(n => JOB.test(n) && n.startsWith('.backup-job-' + today + '-'))) {
    const directory = path.join(root.path, name);
    safe.verifiedDirectory(directory);
    try {
        const raw = read(path.join(directory, 'job.json'));
        if (raw.source !== source)
            continue;
        const job = jobInfo(directory, source);
        read(path.join(directory, 'status.json'));
        result.push({ directory, job });
    }
    catch (error) {
        if (['ENOENT', 'BACKUP_JOB', 'SAFE_FILE_CHANGED'].includes(error.code))
            continue;
        throw error;
    }
} return result; }
function launch(jobDir, source) {
    if (launcher)
        return launcher(jobDir, source);
    if (!require('node:worker_threads').isMainThread)
        fail('BACKUP_SUPERVISOR_REQUIRED', 'Фоновые копии запускает основной процесс программы');
    if (jobs.has(jobDir)) {
        jobs.get(jobDir).requeue = true;
        return;
    }
    const nonce = crypto.randomUUID(), { Worker } = require('node:worker_threads'), worker = new Worker(path.join(__dirname, 'daily-backup-worker.cjs'), { workerData: { jobDir, source, nonce } }), record = { worker, requeue: false };
    jobs.set(jobDir, record);
    worker.on('message', result => { if (typeof result?.verifiedStamp === 'string')
        try {
            const job = jobInfo(jobDir, source), archive = path.join(path.dirname(jobDir), job.value.archive);
            if (stamp(archive) === result.verifiedStamp)
                { verified.delete(archive); verified.set(archive, result.verifiedStamp); while (verified.size > 64) verified.delete(verified.keys().next().value); }
        }
        catch { } });
    worker.on('error', error => { try {
        const job = jobInfo(jobDir, source);
        write(path.join(job.pin.path, 'status.json'), { state: 'failed', code: error.code || 'BACKUP_WORKER_FAILED', error: 'Фоновая резервная копия не завершена. Повторите резервирование.', updatedAt: new Date().toISOString() });
    }
    catch { } });
    worker.on('exit', code => { jobs.delete(jobDir); try {
        const job = jobInfo(jobDir, source), lock = path.join(job.pin.path, 'worker.lock');
        if (fs.existsSync(lock) && read(lock).nonce === nonce)
            fs.unlinkSync(lock);
        if (code !== 0)
            write(path.join(job.pin.path, 'status.json'), { state: 'failed', code: 'BACKUP_WORKER_EXIT', error: 'Резервирование прервано; задание сохранено для продолжения.', updatedAt: new Date().toISOString() });
        else if (record.requeue && read(path.join(job.pin.path, 'status.json')).state === 'queued')
            launch(jobDir, source);
    }
    catch { } });
    worker.unref();
}
function status(backupDir) {
    try {
        const root = safe.verifiedDirectory(backupDir), names = fs.readdirSync(root.path).filter(n => JOB.test(n)).sort();
        let latest = null, incompleteJobs = 0;
        for (const name of names) {
            const directory = path.join(root.path, name);
            safe.verifiedDirectory(directory);
            let state;
            try {
                state = read(path.join(directory, 'status.json'));
            }
            catch (error) {
                if (['ENOENT', 'SAFE_FILE_CHANGED'].includes(error.code)) {
                    incompleteJobs++;
                    continue;
                }
                throw error;
            }
            if (!['queued', 'running', 'complete', 'failed'].includes(state.state) || typeof state.updatedAt !== 'string')
                continue;
            if (!latest || state.updatedAt > latest.updatedAt)
                latest = { state: state.state, updatedAt: state.updatedAt, ...(typeof state.code === 'string' ? { code: state.code } : {}), ...(typeof state.error === 'string' ? { error: state.error } : {}), ...(Number.isSafeInteger(state.parts) ? { parts: state.parts } : {}) };
        }
        return latest ? { ...latest, ...(incompleteJobs ? { incompleteJobs } : {}) } : incompleteJobs ? { state: 'queued', incompleteJobs } : null;
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        if (error.code === 'SAFE_FILE_CHANGED')
            return { state: 'running' };
        return { state: 'failed', code: 'BACKUP_STATUS', error: 'Не удалось проверить фоновую резервную копию.' };
    }
}
function schedule(sourceDir, backupDir, keep = 30) {
    const storage = require('./storage'), source = fs.realpathSync.native(sourceDir);
    if (!storage.isDatabaseLockHeld(source))
        fail('BACKUP_LOCK_REQUIRED', 'Сначала зафиксируйте текущую базу');
    if (!Number.isSafeInteger(keep) || keep < 1 || keep > 10000)
        fail('BACKUP_KEEP', 'Некорректный срок хранения копий');
    if (!fs.existsSync(backupDir))
        fs.mkdirSync(backupDir, { recursive: true });
    const root = safe.verifiedDirectory(backupDir), today = new Date().toISOString().slice(0, 10), archive = 'data_' + today + '.zip', destination = path.join(root.path, archive);
    if (fs.existsSync(destination)) {
        const s = fs.lstatSync(destination);
        if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1)
            fail('BACKUP_PATH', 'Недопустимый файл резервной копии');
        if (verified.get(destination) === stamp(destination))
            return { state: 'complete', path: destination };
        for (const { directory, job } of dailyJobs(root, source, today)) {
            if (job.value.archive !== archive)
                continue;
            write(path.join(directory, 'status.json'), { state: 'queued', updatedAt: new Date().toISOString() });
            launch(directory, source);
            return { state: 'queued', path: destination };
        }
        const directory = path.join(root.path, '.backup-job-' + today + '-' + crypto.randomUUID());
        fs.mkdirSync(directory, { mode: 0o700 });
        write(path.join(directory, 'job.json'), { version: 1, source, archive, snapshot: 'checkpoint.json', sha256: '0'.repeat(64), keep, verifyOnly: true, createdAt: new Date().toISOString() });
        write(path.join(directory, 'status.json'), { state: 'queued', updatedAt: new Date().toISOString() });
        launch(directory, source);
        return { state: 'queued', path: destination };
    }
    // Resume persisted jobs after application restart. No new business snapshot or
    // history is silently substituted for the already captured checkpoint.
    for (const { directory, job } of dailyJobs(root, source, today)) {
        if (job.value.archive !== archive || job.value.verifyOnly)
            continue;
        const s = read(path.join(directory, 'status.json'));
        if (s.state === 'failed' && ['BACKUP_SOURCE_CHANGED', 'BACKUP_SOURCE_MISSING', 'ENOENT'].includes(s.code))
            continue;
        if (['queued', 'running', 'failed'].includes(s.state)) {
            launch(directory, source);
            return { state: 'queued', jobDir: directory, path: destination };
        }
    }
    const directory = path.join(root.path, '.backup-job-' + today + '-' + crypto.randomUUID());
    fs.mkdirSync(directory, { mode: 0o700 });
    const pin = safe.verifiedDirectory(directory), sql = require('./sqlite-storage.cjs'), capture = () => require('./multipart-backup.cjs').capture(source, path.join(pin.path, 'checkpoint.json')), captured = sql.exists(source) && !sql.inTransaction(source) ? sql.transaction(source, capture, { readOnly: true }) : capture();
    write(path.join(pin.path, 'job.json'), { version: 1, source, archive, snapshot: 'checkpoint.json', sha256: captured.sha256, keep, createdAt: new Date().toISOString() });
    write(path.join(pin.path, 'status.json'), { state: 'queued', updatedAt: new Date().toISOString() });
    safe.assertDirectory(root);
    launch(pin.path, source);
    return { state: 'queued', jobDir: pin.path, path: destination };
}
function dead(pid) { if (!Number.isSafeInteger(pid) || pid < 1)
    return false; try {
    process.kill(pid, 0);
    return false;
}
catch (error) {
    return error.code === 'ESRCH';
} }
function verifyCompleted(archivePath) { const before = stamp(archivePath); require('./backup-service.cjs').verifyPackage({ archivePath }); const after = stamp(archivePath); if (before !== after)
    fail('BACKUP_SOURCE_CHANGED', 'Резервная копия изменилась при проверке'); return after; }
function execute(jobDir, source, nonce = crypto.randomUUID()) {
    const { pin, value: job } = jobInfo(jobDir, source), lock = path.join(pin.path, 'worker.lock'), owner = { pid: process.pid, nonce }, root = safe.verifiedDirectory(path.dirname(pin.path));
    let fd;
    try {
        fd = fs.openSync(lock, 'wx', 0o600);
        fs.writeFileSync(fd, JSON.stringify(owner));
        fs.fsyncSync(fd);
    }
    catch (error) {
        if (error.code !== 'EEXIST')
            throw error;
        const previous = read(lock);
        if (!dead(previous.pid))
            return { state: 'running' };
        const again = read(lock);
        if (again.nonce !== previous.nonce)
            fail('BACKUP_JOB', 'Владелец задания изменился');
        fs.unlinkSync(lock);
        return execute(jobDir, source, nonce);
    }
    finally {
        if (fd !== undefined)
            fs.closeSync(fd);
    }
    try {
        const archivePath = path.join(root.path, job.archive);
        if (fs.existsSync(archivePath)) {
            const verifiedStamp = verifyCompleted(archivePath);
            write(path.join(pin.path, 'status.json'), { state: 'complete', updatedAt: new Date().toISOString() });
            return { state: 'complete', path: archivePath, verifiedStamp };
        }
        if (job.verifyOnly)
            fail('BACKUP_FILE_MISSING', 'Резервная копия отсутствует');
        const checkpoint = path.join(pin.path, job.snapshot), bytes = safe.readRegularFileSync(checkpoint, { maxBytes: 512 * 1024 * 1024 });
        if (sha(bytes) !== job.sha256)
            fail('BACKUP_CHECKPOINT', 'Сохранённая резервная точка изменена');
        write(path.join(pin.path, 'status.json'), { state: 'running', updatedAt: new Date().toISOString() });
        const result = require('./multipart-backup.cjs').createFromCapture({ sourceDir: source, capturePath: checkpoint, archivePath });
        const verifiedStamp = verifyCompleted(archivePath);
        write(path.join(pin.path, 'status.json'), { state: 'complete', parts: result.parts, updatedAt: new Date().toISOString() });
        prune(root.path, job.keep, job.archive);
        pruneCompletedJobs(root.path);
        return { ...result, verifiedStamp };
    }
    catch (error) {
        write(path.join(pin.path, 'status.json'), { state: 'failed', code: error.code || 'BACKUP_FAILED', error: String(error.message).slice(0, 1000), updatedAt: new Date().toISOString() });
        return { state: 'failed', code: error.code || 'BACKUP_FAILED' };
    }
    finally {
        safe.assertDirectory(pin);
        if (fs.existsSync(lock) && read(lock).nonce === owner.nonce)
            fs.unlinkSync(lock);
    }
}
function prune(directory, keep, current) { const root = safe.verifiedDirectory(directory), files = fs.readdirSync(root.path).filter(n => /^data_\d{4}-\d{2}-\d{2}\.(?:zip|json)$/.test(n)).sort(); for (const name of files.slice(0, Math.max(0, files.length - keep))) {
    if (name === current)
        continue;
    const target = path.join(root.path, name), s = fs.lstatSync(target);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1)
        continue;
    const parts = path.join(root.path, name + '.parts');
    if (fs.existsSync(parts)) {
        const pin = safe.verifiedDirectory(parts), owner = read(path.join(pin.path, 'owner.json'));
        if (owner.format !== 'tvs-backup-parts' || owner.index !== name)
            continue;
        const names = fs.readdirSync(pin.path);
        if (names.some(n => n !== 'owner.json' && !/^part-[0-9]{8}-[a-f0-9]{64}\.zip$/.test(n)))
            continue;
        let valid = true;
        for (const n of names) {
            const i = fs.lstatSync(path.join(pin.path, n));
            if (!i.isFile() || i.isSymbolicLink() || i.nlink !== 1)
                valid = false;
        }
        if (!valid)
            continue;
        safe.assertDirectory(pin);
        for (const n of names)
            fs.unlinkSync(path.join(pin.path, n));
        fs.rmdirSync(pin.path);
    }
    safe.assertDirectory(root);
    fs.unlinkSync(target);
} }
function pruneCompletedJobs(directory) {
    const root = safe.verifiedDirectory(directory);
    for (const name of fs.readdirSync(root.path).filter(n => JOB.test(n))) {
        const folder = path.join(root.path, name);
        try {
            const pin = safe.verifiedDirectory(folder), job = read(path.join(folder, 'job.json')), state = read(path.join(folder, 'status.json'));
            if (state.state !== 'complete' || typeof job.archive !== 'string' || !/^data_\d{4}-\d{2}-\d{2}\.zip$/.test(job.archive) || fs.existsSync(path.join(root.path, job.archive)) || fs.existsSync(path.join(folder, 'worker.lock')))
                continue;
            const names = fs.readdirSync(folder);
            if (names.some(n => !['checkpoint.json', 'job.json', 'status.json'].includes(n)))
                continue;
            let valid = true;
            for (const n of names) {
                const info = fs.lstatSync(path.join(folder, n));
                if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
                    valid = false;
            }
            if (!valid)
                continue;
            safe.assertDirectory(pin);
            for (const n of names)
                fs.unlinkSync(path.join(folder, n));
            safe.assertDirectory(root);
            fs.rmdirSync(folder);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                continue;
        }
    }
}
module.exports = Object.freeze({ schedule, status, execute, configureLauncher(value) { if (value !== null && typeof value !== 'function')
        throw TypeError('Нужен доверенный запуск фоновой копии'); launcher = value; }, launchCapturedJob(jobDir, source) { if (!JOB.test(path.basename(jobDir)))
        fail('BACKUP_JOB', 'Некорректная папка задания'); jobInfo(jobDir, source); return launch(jobDir, source); } });
