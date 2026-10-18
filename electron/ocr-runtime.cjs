'use strict';

// Shared, local-only Tesseract runtime. This is a transport/configuration layer,
// not a fork of Tesseract or a trained recognition model.
// The pinned v7 Node worker protocol is checked against installed source:
// tesseract.js/src/{createWorker,worker-script/index,worker-script/node/getCore}.js
// Public configuration reference: https://github.com/naptha/tesseract.js/blob/master/docs/api.md

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');
const { Worker } = require('worker_threads');

const RUNTIME_VERSION = '2.0.0';
const DECODE_PROFILE_VERSION = 'tvs-document-codes-native-1';
const TRANSPORT_VERSION = 'tesseract-js-node-worker-7';
const LANGUAGES = Object.freeze(['rus+eng', 'rus', 'eng']);
// PSM 12 invokes orientation/script detection. There is no bundled osd model,
// so it is deliberately absent; rotateAuto uses FindLines/GetGradient instead.
const PAGE_SEGMENT_MODES = Object.freeze([3, 4, 6, 7, 8, 11]);
const MODEL_PROFILES = Object.freeze(['default', 'accurate']);
const DECODE_MODES = Object.freeze(['document', 'codes', 'line', 'amount']);
// Native Tesseract thresholder selection, not a new image algorithm:
// src/ccmain/tesseractclass.cpp: thresholding_method INT_MEMBER
// 0=Otsu, 1=LeptonicaOtsu, 2=Sauvola; src/api/baseapi.cpp: Threshold().
const THRESHOLD_METHODS = Object.freeze({ otsu: 0, 'adaptive-otsu': 1, sauvola: 2 });
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const AMOUNT_WHITELIST = '0123456789.,−-+() /₽рубРУБ';
const DICTIONARY_OFF_REQUEST = Object.freeze({
  load_system_dawg: '0', load_freq_dawg: '0', load_unambig_dawg: '0',
  load_punc_dawg: '0', load_number_dawg: '0', load_bigram_dawg: '0',
});

const physicalPath = value => path.resolve(String(value)).replace(/([\\/])app\.asar(?=[\\/]|$)/i, '$1app.asar.unpacked');
const score = value => Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const clamp = (number, minimum, maximum) => Math.max(minimum, Math.min(maximum, number));
const safeCall = (fn, value) => { if (typeof fn === 'function') { try { fn(value); } catch (_) {} } };
const messageOf = error => String(error?.message || error || 'Ошибка OCR');
const failure = (message, code) => Object.assign(new Error(message), { code });
const abortError = () => Object.assign(failure('Распознавание отменено', 'OCR_ABORTED'), { name: 'AbortError' });

function box(value) {
  if (!value || typeof value !== 'object') return null;
  const x = value.x ?? value.x0, y = value.y ?? value.y0;
  const width = value.w ?? (value.x1 - value.x0), height = value.h ?? (value.y1 - value.y0);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x, y, w: width, h: height };
}

function normalizeResult(result) {
  const data = result?.data || result || {};
  const transform = data.imageTransform && typeof data.imageTransform === 'object' ? data.imageTransform : null;
  const exifOrientation = transform && Number.isInteger(transform.exifOrientation) && transform.exifOrientation >= 1 && transform.exifOrientation <= 8 ? transform.exifOrientation : null;
  const rotateRadians = Number.isFinite(data.rotateRadians) ? data.rotateRadians : Number.isFinite(transform?.rotateRadians) ? transform.rotateRadians : 0;
  const rawLines = Array.isArray(data.lines) && data.lines.length
    ? data.lines
    : (data.blocks || []).flatMap(block => (block.paragraphs || []).flatMap(paragraph => paragraph.lines || []));
  const lines = rawLines.map(line => {
    const bbox = box(line.bbox);
    const words = (line.words || []).map(word => {
      const wordBox = box(word.bbox);
      return wordBox && String(word.text || '').trim()
        ? { text: String(word.text), confidence: score(word.confidence), bbox: wordBox }
        : null;
    }).filter(Boolean);
    const text = String(line.text || words.map(word => word.text).join(' ')).trim();
    return bbox && text ? { text, confidence: score(line.confidence), bbox, words } : null;
  }).filter(Boolean);
  const words = lines.flatMap(line => line.words);
  return {
    text: String(data.text || ''), confidence: score(data.confidence), lines, words,
    coreVersion: typeof data.version === 'string' && data.version ? data.version : null,
    rotateRadians,
    imageTransform: { exifOrientation, rotateRadians, reported: !!transform },
    psm: data.psm ?? null, oem: data.oem ?? null,
  };
}

function dependencies(workerOverride, coreOverride) {
  const jsPackagePath = require.resolve('tesseract.js/package.json');
  const jsPackage = JSON.parse(fs.readFileSync(jsPackagePath, 'utf8'));
  if (jsPackage.version !== '7.0.0') throw failure('OCR transport закреплён за Tesseract.js 7.0.0. Проверьте совместимость обновлённого пакета.', 'OCR_PROTOCOL_VERSION');
  const jsRequire = createRequire(jsPackagePath);
  const corePackagePath = jsRequire.resolve('tesseract.js-core/package.json');
  const corePackage = JSON.parse(fs.readFileSync(corePackagePath, 'utf8'));
  if (corePackage.version !== '7.0.0') throw failure('OCR transport закреплён за Tesseract.js-core 7.0.0. Проверьте совместимость обновлённого core.', 'OCR_CORE_VERSION');
  const originalWorkerPath = physicalPath(path.join(path.dirname(jsPackagePath), 'src', 'worker-script', 'node', 'index.js'));
  const workerPath = physicalPath(workerOverride || originalWorkerPath);
  const corePath = physicalPath(coreOverride || path.join(path.dirname(workerPath), '..', 'tesseract-core'));
  if (!fs.statSync(workerPath, { throwIfNoEntry: false })?.isFile()) throw failure('Не найден локальный worker OCR: ' + workerPath, 'OCR_WORKER_MISSING');
  if (!fs.statSync(corePath, { throwIfNoEntry: false })?.isDirectory()) throw failure('Не найден локальный core OCR: ' + corePath, 'OCR_CORE_MISSING');
  let bindingPatch = null;
  const patchManifestPath = path.join(path.dirname(workerPath), 'UPSTREAM.json');
  if (fs.existsSync(patchManifestPath)) {
    const raw = fs.readFileSync(patchManifestPath), manifest = JSON.parse(raw.toString('utf8'));
    if (manifest.packageVersion !== jsPackage.version) throw failure('Версия локальной OCR-привязки не соответствует установленному Tesseract.js', 'OCR_BINDING_VERSION');
    if (!Array.isArray(manifest.files) || !manifest.files.length) throw failure('Повреждён список файлов локальной OCR-привязки', 'OCR_BINDING_MANIFEST');
    for (const required of ['upstream.cjs', 'worker.cjs', 'dump.cjs', 'set-image.cjs', 'get-core.cjs', 'index.cjs']) if (!manifest.files.some(file => file.file === required)) throw failure('В manifest OCR-привязки отсутствует обязательный файл: ' + required, 'OCR_BINDING_MANIFEST');
    for (const file of manifest.files) {
      const filename = path.resolve(path.dirname(workerPath), String(file.file || ''));
      if (!filename.startsWith(path.dirname(workerPath) + path.sep) || !/^[a-f0-9]{64}$/i.test(file.sha256 || '')) throw failure('Повреждён manifest локальной OCR-привязки', 'OCR_BINDING_MANIFEST');
      const digest = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
      if (digest !== file.sha256) throw failure('Файл OCR-привязки не совпадает с закреплённым hash: ' + file.file, 'OCR_BINDING_HASH');
    }
    bindingPatch = { kind: 'js-worker-binding', version: manifest.bindingPatchSetVersion ?? manifest.patchSetVersion, upstreamPackageVersion: manifest.packageVersion, upstream: manifest.upstream, manifestSha256: crypto.createHash('sha256').update(raw).digest('hex'), fileHashesVerified: true, nativeCoreManifest: manifest.nativeCoreManifest || null };
  }
  if (!bindingPatch?.fileHashesVerified || !(bindingPatch.version >= 2)) throw failure('Нужна комплектная обвязка OCR с проверкой собственного WASM-ядра; стоковый fallback отключён', 'OCR_NATIVE_BINDING_REQUIRED');
  const helperPath = path.join(path.dirname(workerPath), 'get-core.cjs');
  const helper = require(helperPath); // FS/hash helpers only; does not instantiate WASM.
  if (typeof helper.readManifest !== 'function' || typeof helper.verifyManifestAssets !== 'function') throw failure('Не подключена проверка manifest собственного OCR-ядра', 'OCR_NATIVE_CORE_HELPER');
  const manifestPath = path.join(corePath, 'manifest.json'), coreManifestBytes = fs.readFileSync(manifestPath);
  const manifestSha256 = crypto.createHash('sha256').update(coreManifestBytes).digest('hex');
  const nativeManifest = helper.readManifest(corePath, { manifestSha256 });
  const verified = helper.verifyManifestAssets(corePath, nativeManifest);
  const nativeCore = {
    buildId: nativeManifest.buildId, manifestSha256, patchSetSha256: nativeManifest.patchSetSha256,
    expectedRuntimeVersion: nativeManifest.expectedRuntimeVersion, abi: nativeManifest.compatibility.abi,
    source: 'custom-local-wasm', stockFallback: false,
    variants: nativeManifest.variants.map(variant => ({ id: variant.id, requiredFeatures: [...variant.requiredFeatures], jsSha256: variant.js.sha256, wasmSha256: variant.wasm.sha256 })),
    verifiedVariantFiles: verified.variants.length, verifiedNativePatchFiles: verified.patches.length,
  };
  return { workerPath, corePath, originalWorkerPath, bindingPatch, nativeCore,
    nativeCoreExpected: { corePath, buildId: nativeCore.buildId, manifestSha256, patchSetSha256: nativeCore.patchSetSha256 },
    packageVersions: { tesseractJs: jsPackage.version, tesseractJsCore: corePackage.version } };
}

function nativeCoreEvidence(value, config) {
  const expected = config.nativeCore, variant = expected.variants.find(item => item.id === value?.variant);
  if (!value || !variant || value.source !== 'custom-local-wasm' || value.stockFallback !== false) throw failure('Worker не подтвердил выбор собственного WASM-ядра', 'OCR_NATIVE_CORE_PROVENANCE');
  for (const key of ['buildId', 'manifestSha256', 'patchSetSha256', 'expectedRuntimeVersion', 'abi']) if (value[key] !== expected[key]) throw failure('Provenance собственного OCR-ядра не совпадает: ' + key, 'OCR_NATIVE_CORE_PROVENANCE');
  if (value.actualRuntimeVersion !== expected.expectedRuntimeVersion || value.jsSha256 !== variant.jsSha256 || value.wasmSha256 !== variant.wasmSha256) throw failure('Версия или hash выбранного WASM-ядра не совпадает с manifest', 'OCR_NATIVE_CORE_PROVENANCE');
  return { buildId: value.buildId, variant: value.variant, manifestSha256: value.manifestSha256, patchSetSha256: value.patchSetSha256,
    jsSha256: value.jsSha256, wasmSha256: value.wasmSha256, actualRuntimeVersion: value.actualRuntimeVersion, expectedRuntimeVersion: value.expectedRuntimeVersion,
    abi: value.abi, source: 'custom-local-wasm', stockFallback: false };
}

class WorkerTransport {
  constructor(config, onProgress) {
    this.id = 'tvs-ocr-' + crypto.randomUUID();
    this.requests = new Map(); this.sequence = 0; this.closed = false;
    this.onProgress = onProgress; this.termination = null;
    this.worker = new Worker(config.workerPath, {
      workerData: { tvsCore: config.nativeCoreExpected },
      // JS heap only; WebAssembly memory is managed by the pinned OCR core.
      resourceLimits: { maxOldGenerationSizeMb: 384 },
    });
    this.worker.on('message', packet => this.message(packet));
    this.worker.on('error', error => { void this.close(failure('Worker OCR: ' + messageOf(error), 'OCR_WORKER_ERROR')); });
    this.worker.on('exit', code => {
      if (!this.closed) void this.close(failure('Worker OCR остановился до завершения (код ' + code + ')', 'OCR_WORKER_EXIT'));
    });
  }
  message(packet) {
    if (this.closed || !packet || packet.workerId !== this.id) return;
    const key = packet.action + ':' + packet.jobId, request = this.requests.get(key);
    if (packet.status === 'progress') { safeCall(this.onProgress, packet.data || {}); return; }
    if (!request) return;
    this.requests.delete(key);
    if (packet.status === 'resolve') request.resolve({ jobId: packet.jobId, data: packet.data });
    else request.reject(failure(messageOf(packet.data), 'OCR_ENGINE_ERROR'));
  }
  send(action, payload, transferList = []) {
    if (this.closed) return Promise.reject(failure('Worker OCR уже закрыт', 'OCR_WORKER_CLOSED'));
    const jobId = this.id + '-' + (++this.sequence), key = action + ':' + jobId;
    return new Promise((resolve, reject) => {
      this.requests.set(key, { resolve, reject });
      try { this.worker.postMessage({ workerId: this.id, jobId, action, payload }, transferList); }
      catch (error) { this.requests.delete(key); reject(error); }
    });
  }
  async initialize(config, language, directory, initConfig) {
    // Use an explicit numeric OEM. The local adapter enforces LSTM-only and
    // selects exclusively among variants recorded in the native core manifest.
    const loaded = await this.send('load', { options: { lstmOnly: 1, corePath: config.corePath, logging: false } });
    this.nativeCore = nativeCoreEvidence(loaded?.data?.coreInfo, config);
    await this.send('loadLanguage', { langs: language, options: { langPath: directory, gzip: false, cacheMethod: 'none', lstmOnly: true } });
    await this.send('initialize', { langs: language, oem: 1, config: initConfig });
  }
  close(reason = failure('Worker OCR завершён', 'OCR_WORKER_CLOSED')) {
    if (this.termination) return this.termination;
    this.closed = true;
    for (const request of this.requests.values()) request.reject(reason);
    this.requests.clear();
    // Keep an error listener until terminate settles to avoid unhandled worker
    // errors if abort/timeout races with a failure inside native/WASM code.
    this.termination = Promise.resolve(this.worker.terminate()).catch(() => {}).finally(() => this.worker.removeAllListeners());
    return this.termination;
  }
}

function normalizeOptions(options = {}) {
  const language = options.language || 'rus+eng', profile = options.profile || 'default', decode = options.decode || 'document';
  if (!LANGUAGES.includes(language)) throw failure('Выберите русский и/или английский язык OCR', 'OCR_LANGUAGE');
  if (!MODEL_PROFILES.includes(profile)) throw failure('Неизвестный профиль моделей OCR', 'OCR_MODEL_PROFILE');
  if (!DECODE_MODES.includes(decode)) throw failure('Неизвестный режим декодирования OCR', 'OCR_DECODE_PROFILE');
  const threshold = options.threshold == null ? 'otsu' : options.threshold;
  if (typeof threshold !== 'string' || !Object.prototype.hasOwnProperty.call(THRESHOLD_METHODS, threshold)) throw failure('Выберите бинаризацию OCR: Otsu, Adaptive Otsu или Sauvola', 'OCR_THRESHOLD');
  const psm = options.psm == null ? (decode === 'document' ? 3 : 7) : Number(options.psm);
  if (!PAGE_SEGMENT_MODES.includes(psm)) throw failure(psm === 12 ? 'PSM 12 требует OSD-модель и не поддерживается. Используйте PSM 11 или отдельную коррекцию наклона.' : 'Неизвестный режим разметки OCR', 'OCR_PSM');
  const timeoutMs = clamp(Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 180000, 1000, 600000);
  const dpi = clamp(Number.isFinite(Number(options.dpi)) ? Number(options.dpi) : 300, 70, 1200);
  const autorotate = options.autorotate === true || options.autoRotate === true;
  let whitelist = decode === 'amount' ? AMOUNT_WHITELIST : '';
  if (options.whitelist != null) {
    if (!['codes', 'amount'].includes(decode)) throw failure('Ограничение символов допустимо только для явно выбранной области «код» или «сумма»', 'OCR_WHITELIST_SCOPE');
    if (typeof options.whitelist !== 'string' || options.whitelist.length > 512 || /[\r\n\0]/.test(options.whitelist)) throw failure('Некорректный набор допустимых символов OCR', 'OCR_WHITELIST');
    whitelist = options.whitelist;
  }
  const signal = options.signal;
  if (signal != null && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw failure('Некорректный сигнал отмены OCR', 'OCR_ABORT_SIGNAL');
  return { language, profile, decode, threshold, psm, timeoutMs, dpi, autorotate, whitelist, signal, onProgress: options.onProgress };
}

function initConfigFor(decode) {
  // Document/line intentionally retain Tesseract's default dictionaries.
  // Some native LSTM builds do not propagate these init flags to their Dict.
  // The codes/amount model variant therefore removes the LSTM DAWG components;
  // flags are recorded as requested configuration, not proof of suppression.
  return ['codes', 'amount'].includes(decode) ? { ...DICTIONARY_OFF_REQUEST } : {};
}

function inputRecord(input) {
  if (typeof input === 'string') {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) || /^data:/i.test(input)) throw failure('OCR принимает локальный файл или байты изображения; сетевые адреса не поддерживаются', 'OCR_LOCAL_ONLY');
    return { input: path.resolve(input), bytes: 0 };
  }
  const view = Buffer.isBuffer(input) ? input : input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!view || !view.byteLength || view.byteLength > MAX_IMAGE_BYTES) throw failure('Изображение OCR должно занимать от 1 байта до 50 МБ', 'OCR_IMAGE_SIZE');
  // Copy now: callers cannot change an already queued image underneath the job.
  return { input: Buffer.from(view), bytes: view.byteLength };
}

class OcrRuntime {
  constructor(options = {}) {
    this.rootDir = physicalPath(options.rootDir || path.join(__dirname, '..'));
    const roots = [...new Set([this.rootDir, physicalPath(path.join(process.resourcesPath || this.rootDir, 'app.asar.unpacked')), path.join(process.resourcesPath || this.rootDir, 'app')])];
    const defaultRoot = roots.find(directory => ['rus', 'eng'].every(language => fs.existsSync(path.join(directory, language + '.traineddata')))) || this.rootDir;
    this.assetRoot = defaultRoot;
    this.modelPaths = {
      default: physicalPath(options.modelPaths?.default || defaultRoot),
      accurate: physicalPath(options.modelPaths?.accurate || path.join(defaultRoot, 'assets', 'ocr', 'models', 'accurate')),
      codes: physicalPath(options.modelPaths?.codes || path.join(defaultRoot, 'assets', 'ocr', 'models', 'codes')),
    };
    const localBinding = path.join(this.rootDir, 'vendor', 'tesseract-worker', 'index.cjs');
    this.workerOverride = options.workerPath || (fs.existsSync(localBinding) ? localBinding : null); this.coreOverride = options.corePath;
    this.manifestPath = path.join(defaultRoot, 'assets', 'ocr', 'models-manifest.json');
    this.customModelPaths = new Set(Object.keys(options.modelPaths || {}));
    this.modelManifest = null; this.modelManifestError = null;
    try { this.modelManifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8')); if (this.modelManifest.schemaVersion !== 1 || !Array.isArray(this.modelManifest.models)) throw Error('Неподдерживаемый manifest моделей'); }
    catch (error) { this.modelManifest = null; this.modelManifestError = messageOf(error); }
    this.maxWorkers = clamp(Number.isFinite(Number(options.maxWorkers)) ? Math.floor(Number(options.maxWorkers)) : 2, 1, 4);
    this.maxQueuedJobs = 32; this.maxQueuedBytes = 128 * 1024 * 1024;
    this.queue = []; this.entries = new Map(); this.hashCache = new Map(); this.componentCache = new Map(); this.activeJobs = new Set(); this.queuedBytes = 0;
    this.disposed = false; this.config = null; this.coreVersions = new Set(); this.observedNativeCores = new Map(); this.globalProgress = options.onProgress;
    this.disposePromise = null;
  }
  getConfig() { if (!this.config) this.config = dependencies(this.workerOverride, this.coreOverride); return this.config; }
  async traineddataComponents(filename, stat) {
    const key = filename + ':' + stat.size + ':' + stat.mtimeMs;
    if (this.componentCache.has(key)) return this.componentCache.get(key);
    let handle;
    try {
      handle = await fs.promises.open(filename, 'r');
      const prefix = Buffer.alloc(4); if ((await handle.read(prefix, 0, 4, 0)).bytesRead !== 4) throw Error('Нет заголовка traineddata');
      const count = prefix.readInt32LE(0);
      if (count < 23 || count > 256 || 4 + count * 8 >= stat.size) throw Error('Неверный заголовок traineddata');
      const offsets = Buffer.alloc(count * 8);
      if ((await handle.read(offsets, 0, offsets.length, 4)).bytesRead !== offsets.length) throw Error('Повреждена таблица компонентов traineddata');
      const present = []; let previous = -1;
      for (let index = 0; index < count; index++) {
        const offset = offsets.readBigInt64LE(index * 8);
        if (offset === -1n) continue;
        if (offset < BigInt(4 + count * 8) || offset >= BigInt(stat.size) || offset <= BigInt(previous)) throw Error('Неверное смещение компонента traineddata');
        present.push(index); previous = Number(offset);
      }
      if (![17, 21, 22].every(index => present.includes(index))) throw Error('В модели отсутствуют обязательные LSTM-компоненты 17/21/22');
      const components = { present, requiredLstmPresent: true, lstmDawgPresent: present.filter(index => [18, 19, 20].includes(index)) };
      this.componentCache.set(key, components); return components;
    } catch (error) { throw failure('Не удалось проверить модель ' + filename + ': ' + messageOf(error), 'OCR_MODEL_COMPONENTS'); }
    finally { if (handle) await handle.close().catch(() => {}); }
  }
  async modelFiles(effectiveProfile, language, hashes = true) {
    const directory = this.modelPaths[effectiveProfile], files = [];
    for (const lang of language.split('+')) {
      const filename = path.join(directory, lang + '.traineddata'), stat = await fs.promises.stat(filename).catch(() => null);
      if (!stat?.isFile() || !stat.size) throw failure('Не найдена локальная модель OCR: ' + filename, 'OCR_MODEL_MISSING');
      if (stat.size > 150 * 1024 * 1024) throw failure('Модель OCR превышает допустимый размер: ' + filename, 'OCR_MODEL_SIZE');
      const components = await this.traineddataComponents(filename, stat);
      if (effectiveProfile === 'codes' && (components.lstmDawgPresent.length || components.present.some(index => ![17, 21, 22, 23].includes(index)))) throw failure('Модель codes должна содержать LSTM, алфавит и recoder без словарных DAWG-компонентов', 'OCR_CODES_DICTIONARY_PRESENT');
      const modelRecord = this.modelManifest?.models.find(model => path.resolve(this.assetRoot, String(model.path || '')) === filename);
      if (!modelRecord && !this.customModelPaths.has(effectiveProfile)) throw failure(this.modelManifest ? 'Комплектная модель не записана в manifest: ' + filename : 'Не найден корректный manifest моделей OCR: ' + this.modelManifestError, 'OCR_MODEL_MANIFEST');
      if (modelRecord && modelRecord.bytes !== stat.size) throw failure('Размер модели OCR отличается от manifest: ' + filename, 'OCR_MODEL_HASH');
      const fingerprint = filename + ':' + stat.size + ':' + stat.mtimeMs;
      let sha256 = this.hashCache.get(fingerprint);
      if (hashes && !sha256) {
        const hash = crypto.createHash('sha256'), stream = fs.createReadStream(filename);
        for await (const chunk of stream) hash.update(chunk);
        sha256 = hash.digest('hex'); this.hashCache.set(fingerprint, sha256);
      }
      if (sha256 && modelRecord && sha256 !== modelRecord.sha256) throw failure('Hash модели OCR отличается от manifest: ' + filename, 'OCR_MODEL_HASH');
      files.push({ language: lang, path: filename, bytes: stat.size, mtimeMs: stat.mtimeMs, ...(sha256 ? { sha256 } : {}), components,
        manifest: { version: this.modelManifest?.manifestVersion || null, modelId: modelRecord?.id || null, verification: modelRecord ? (sha256 ? 'sha256-matched' : 'size-and-header-only; hash-not-requested') : 'custom-model-path-not-listed', expectedSha256: modelRecord?.sha256 || null },
        precision: modelRecord?.precision || null, modelVersion: modelRecord?.version || null,
      });
    }
    return files;
  }
  recognize(input, options = {}) {
    if (this.disposed) return Promise.reject(failure('OCR runtime уже закрыт', 'OCR_RUNTIME_DISPOSED'));
    let settings, record;
    try {
      settings = normalizeOptions(options);
      if (settings.signal?.aborted) throw abortError();
      if (this.queue.length >= this.maxQueuedJobs) throw failure('Очередь OCR заполнена. Дождитесь завершения текущих документов.', 'OCR_QUEUE_FULL');
      record = inputRecord(input);
      if (this.queuedBytes + record.bytes > this.maxQueuedBytes) throw failure('В очереди OCR слишком много изображений. Дождитесь освобождения памяти.', 'OCR_QUEUE_MEMORY');
    } catch (error) { return Promise.reject(error); }
    const effectiveProfile = ['codes', 'amount'].includes(settings.decode) ? 'codes' : settings.profile;
    const key = effectiveProfile + ':' + settings.language + ':' + settings.decode;
    return new Promise((resolve, reject) => {
      const job = { id: crypto.randomUUID(), key, settings, effectiveProfile, input: record.input, bytes: record.bytes, resolve, reject, entry: null, settled: false, cancelled: false, started: false, timer: null, abortListener: null };
      if (settings.signal) {
        job.abortListener = () => this.cancel(job, abortError());
        settings.signal.addEventListener('abort', job.abortListener, { once: true });
      }
      this.queue.push(job); this.queuedBytes += job.bytes;
      if (settings.signal?.aborted) this.cancel(job, abortError()); else this.pump();
    });
  }
  settle(job, error, result) {
    if (job.settled) return;
    job.settled = true; clearTimeout(job.timer);
    if (job.abortListener) job.settings.signal.removeEventListener('abort', job.abortListener);
    if (error) job.reject(error); else job.resolve(result);
  }
  cancel(job, reason) {
    if (job.settled) return;
    job.cancelled = true;
    const index = this.queue.indexOf(job);
    if (index >= 0) { this.queue.splice(index, 1); this.queuedBytes -= job.bytes; job.input = null; }
    this.settle(job, reason);
    // The transport exists before language loading or Init, so cancellation can
    // terminate a stuck startup rather than waiting for createWorker to resolve.
    if (job.entry?.transport) void job.entry.transport.close(reason);
    this.pump();
  }
  pump() {
    if (this.disposed) return;
    for (let index = 0; index < this.queue.length;) {
      const job = this.queue[index]; let entry = this.entries.get(job.key);
      if (entry?.busy) { index++; continue; }
      if (!entry && this.entries.size >= this.maxWorkers) {
        const idle = [...this.entries.values()].filter(value => !value.busy).sort((a, b) => a.lastUsed - b.lastUsed)[0];
        if (!idle) { index++; continue; }
        this.entries.delete(idle.key); if (idle.transport) void idle.transport.close();
      }
      if (!entry) { entry = { key: job.key, busy: false, transport: null, ready: false, fingerprint: '', lastUsed: 0, job: null }; this.entries.set(job.key, entry); }
      this.queue.splice(index, 1); this.queuedBytes -= job.bytes;
      entry.busy = true; entry.job = job; job.entry = entry; job.started = true; this.activeJobs.add(job);
      job.timer = setTimeout(() => this.cancel(job, failure('Распознавание превысило допустимое время. Уменьшите область или число страниц.', 'OCR_TIMEOUT')), job.settings.timeoutMs);
      void this.execute(job, entry).then(result => this.settle(job, null, result), error => this.settle(job, error)).finally(() => {
        clearTimeout(job.timer); job.input = null; this.activeJobs.delete(job); entry.busy = false; entry.job = null; entry.lastUsed = Date.now();
        if (entry.transport?.closed || this.disposed) { if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key); }
        this.pump();
      });
    }
  }
  check(job) { if (job.cancelled || job.settings.signal?.aborted || this.disposed) throw abortError(); }
  progress(job, progress) {
    if (!job || job.cancelled || job.settled) return;
    const value = { status: String(progress.status || ''), progress: clamp(Number(progress.progress) || 0, 0, 1), jobId: job.id, language: job.settings.language, profile: job.settings.profile, effectiveModelProfile: job.effectiveProfile, decode: job.settings.decode };
    safeCall(job.settings.onProgress, value); safeCall(this.globalProgress, value);
  }
  async imageBytes(job) {
    this.check(job);
    if (typeof job.input !== 'string') return new Uint8Array(job.input);
    const stat = await fs.promises.stat(job.input);
    if (!stat.isFile() || !stat.size || stat.size > MAX_IMAGE_BYTES) throw failure('Изображение OCR должно занимать от 1 байта до 50 МБ', 'OCR_IMAGE_SIZE');
    const bytes = await fs.promises.readFile(job.input);
    this.check(job);
    if (bytes.length > MAX_IMAGE_BYTES) throw failure('Изображение изменилось и превышает 50 МБ', 'OCR_IMAGE_SIZE');
    return new Uint8Array(bytes);
  }
  async execute(job, entry) {
    try {
      this.check(job);
      const config = this.getConfig();
      // The stock upstream setter silently ignores SetVariable(false). The
      // pinned local binding checks that boolean and rejects unsupported keys.
      if (!config.bindingPatch?.fileHashesVerified || !(config.bindingPatch.version >= 1)) throw failure('Для проверки параметров OCR нужна комплектная локальная привязка Tesseract. Переустановите полную сборку.', 'OCR_PARAMETER_VALIDATION_REQUIRED');
      const files = await this.modelFiles(job.effectiveProfile, job.settings.language);
      this.check(job);
      const fingerprint = files.map(file => file.sha256).join(':');
      if (entry.transport && entry.fingerprint !== fingerprint) { await entry.transport.close(); entry.transport = null; entry.ready = false; }
      this.check(job);
      if (!entry.transport) {
        entry.transport = new WorkerTransport(config, value => this.progress(entry.job, value)); entry.fingerprint = fingerprint;
      }
      if (!entry.ready) {
        await entry.transport.initialize(config, job.settings.language, this.modelPaths[job.effectiveProfile], initConfigFor(job.settings.decode));
        entry.ready = true;
      }
      this.check(job);
      // Reset every setting that this runtime can vary on every job. A numeric
      // ROI cannot leak a whitelist or PSM into the next document recognition.
      const params = {
        tessedit_pageseg_mode: String(job.settings.psm), user_defined_dpi: String(job.settings.dpi),
        preserve_interword_spaces: '1', tessedit_char_whitelist: job.settings.whitelist,
        tessedit_char_blacklist: '', thresholding_method: String(THRESHOLD_METHODS[job.settings.threshold]),
      };
      await entry.transport.send('setParameters', { params });
      const image = await this.imageBytes(job);
      this.check(job);
      const raw = await entry.transport.send('recognize', { image, options: { rotateAuto: job.settings.autorotate, rotateRadians: 0 }, output: { text: true, blocks: true } }, [image.buffer]);
      this.check(job);
      const normalized = normalizeResult(raw);
      if (!entry.transport.nativeCore || normalized.coreVersion !== entry.transport.nativeCore.actualRuntimeVersion) throw failure('TessBaseAPI.Version() результата не соответствует загруженному собственному ядру', 'OCR_NATIVE_CORE_VERSION');
      if (normalized.coreVersion) this.coreVersions.add(normalized.coreVersion);
      this.observedNativeCores.set(entry.transport.nativeCore.manifestSha256 + ':' + entry.transport.nativeCore.variant, { ...entry.transport.nativeCore });
      const { coreVersion, rotateRadians, imageTransform, ...output } = normalized;
      const exifChanged = imageTransform.exifOrientation != null && imageTransform.exifOrientation !== 1;
      const coordinateSpace = imageTransform.exifOrientation == null ? 'engine-image;exif-transform-not-reported' : exifChanged ? (rotateRadians ? 'exif-and-angle-transformed-image' : 'exif-transformed-image') : rotateRadians ? 'tesseract-rotated-image' : 'input-image';
      const coordinateWarning = imageTransform.exifOrientation == null
        ? 'The worker did not report its EXIF transform. Verify orientation before mapping bounding boxes to the original image.'
        : exifChanged || rotateRadians ? 'Bounding boxes refer to the transformed engine image. Apply the inverse EXIF and angle transforms before mapping to the original image/PDF.' : null;
      return { ...output, meta: {
        runtimeVersion: RUNTIME_VERSION, decodeProfileVersion: DECODE_PROFILE_VERSION, transportVersion: TRANSPORT_VERSION,
        profile: job.settings.profile, effectiveModelProfile: job.effectiveProfile, language: job.settings.language, decode: job.settings.decode,
        psm: job.settings.psm, oem: 1, threshold: job.settings.threshold, thresholdingMethod: THRESHOLD_METHODS[job.settings.threshold],
        nativeParameterValidation: 'SetVariable return value checked; unsupported parameters reject the job', packageVersions: { ...config.packageVersions }, coreVersion,
        coreVersionSource: coreVersion ? 'TessBaseAPI.Version() returned by Tesseract worker' : 'not returned by worker',
        modelFiles: files.map(({ mtimeMs, ...file }) => file), initConfigRequested: initConfigFor(job.settings.decode),
        dictionaryPolicy: ['codes', 'amount'].includes(job.settings.decode) ? 'lstm-dawg-components-absent-verified; fresh-worker-no-user-dictionaries' : 'model-defaults',
        parameters: params, autorotate: job.settings.autorotate, rotateRadians, imageTransform,
        coordinateSpace, coordinateWarning,
        localOnly: true, workerPath: config.workerPath, corePath: config.corePath,
        bindingPatch: config.bindingPatch, bindingPatchVersion: config.bindingPatch?.version ?? null,
        nativeCore: { ...entry.transport.nativeCore }, coreResolution: 'manifest-verified-custom-local-wasm; no-stock-fallback',
        lstmCoreLoadArgument: 1, textPostprocessing: 'none', runtimeTrainingPerformed: false,
      } };
    } catch (error) {
      if (entry.transport) await entry.transport.close(error instanceof Error ? error : new Error(messageOf(error)));
      entry.ready = false;
      throw error instanceof Error ? error : new Error(messageOf(error));
    }
  }
  async info(options = {}) {
    let config = null, dependencyError = null;
    try { config = this.getConfig(); } catch (error) { dependencyError = messageOf(error); }
    const profiles = {};
    for (const name of ['default', 'accurate', 'codes']) {
      try { profiles[name] = { available: true, directory: this.modelPaths[name], modelFiles: await this.modelFiles(name, 'rus+eng', options.hashes === true) }; }
      catch (error) { profiles[name] = { available: false, directory: this.modelPaths[name], error: messageOf(error) }; }
    }
    return {
      runtimeVersion: RUNTIME_VERSION, decodeProfileVersion: DECODE_PROFILE_VERSION, transportVersion: TRANSPORT_VERSION,
      packageVersions: config?.packageVersions || null, observedCoreVersions: [...this.coreVersions], coreVersion: this.coreVersions.size === 1 ? [...this.coreVersions][0] : null,
      coreVersionSource: this.coreVersions.size ? 'returned by completed OCR jobs' : 'not observed; no OCR has run in this runtime',
      profiles, languages: [...LANGUAGES], pageSegmentationModes: [...PAGE_SEGMENT_MODES], decodeModes: [...DECODE_MODES], oem: 1,
      thresholds: Object.keys(THRESHOLD_METHODS), thresholdMethods: { ...THRESHOLD_METHODS }, defaultThreshold: 'otsu',
      nativeParameterValidationAvailable: !!config?.bindingPatch?.fileHashesVerified && config.bindingPatch.version >= 1,
      defaultProfile: 'default', defaultDecode: 'document', defaultAutorotate: false,
      workerPath: config?.workerPath || null, corePath: config?.corePath || null, dependencyError,
      bindingPatch: config?.bindingPatch || null, bindingPatchVersion: config?.bindingPatch?.version ?? null, modelManifestVersion: this.modelManifest?.manifestVersion || null,
      nativeCore: config?.nativeCore ? { ...config.nativeCore, observed: [...this.observedNativeCores.values()] } : null,
      localOnly: true, maxWorkers: this.maxWorkers, residentWorkers: this.entries.size, activeJobs: this.activeJobs.size,
      queuedJobs: this.queue.length, queuedBytes: this.queuedBytes, disposed: this.disposed,
      notices: ['PSM 12/OSD is not enabled without an OSD model.', 'Codes and amount use a separate model variant, not document-wide correction.', 'Confidence is an engine score, not a guarantee that a field is correct.'],
    };
  }
  dispose() {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    const reason = failure('OCR runtime закрыт', 'OCR_RUNTIME_DISPOSED');
    for (const job of [...this.queue, ...this.activeJobs]) { job.cancelled = true; this.settle(job, reason); job.input = null; }
    this.queue.length = 0; this.queuedBytes = 0;
    this.disposePromise = Promise.all([...this.entries.values()].map(entry => entry.transport ? entry.transport.close(reason) : Promise.resolve())).then(() => { this.entries.clear(); this.hashCache.clear(); this.componentCache.clear(); });
    return this.disposePromise;
  }
}

let sharedRuntime = null;
function createOcrRuntime(options) { return new OcrRuntime(options); }
function getSharedOcrRuntime(options = {}) {
  if (!sharedRuntime || sharedRuntime.disposed) sharedRuntime = createOcrRuntime(options);
  else if (options.rootDir && physicalPath(options.rootDir) !== sharedRuntime.rootDir) throw failure('Общий OCR runtime уже связан с другой папкой программы', 'OCR_RUNTIME_CONFIGURATION');
  else if (options.workerPath && physicalPath(options.workerPath) !== sharedRuntime.getConfig().workerPath) throw failure('Общий OCR runtime уже использует другой worker. Настройте его до первого обращения.', 'OCR_RUNTIME_CONFIGURATION');
  else if (options.corePath && physicalPath(options.corePath) !== sharedRuntime.getConfig().corePath) throw failure('Общий OCR runtime уже использует другое WASM-ядро. Настройте его до первого обращения.', 'OCR_RUNTIME_CONFIGURATION');
  return sharedRuntime;
}

module.exports = {
  createOcrRuntime, getSharedOcrRuntime, normalizeResult,
  RUNTIME_VERSION, DECODE_PROFILE_VERSION, TRANSPORT_VERSION,
  LANGUAGES, PAGE_SEGMENT_MODES, MODEL_PROFILES, DECODE_MODES, THRESHOLD_METHODS,
};
