'use strict';

// Hash-verified local native core adapter for the TVS Tesseract.js 7 worker.
// Native source patch provenance is separate from the JS binding patch ledger.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KNOWN_VARIANTS = Object.freeze({
  lstm: { stem: 'tesseract-core-lstm', features: [], priority: 0 },
  'simd-lstm': { stem: 'tesseract-core-simd-lstm', features: ['simd'], priority: 1 },
  'relaxedsimd-lstm': { stem: 'tesseract-core-relaxedsimd-lstm', features: ['simd', 'relaxed-simd'], priority: 2 },
});
const NATIVE_CORE_CONTRACT = Object.freeze({
  artifactKind: 'tvs-tesseract-wasm-core', nativeVersion: '5.3.0-tvs1',
  tesseractJs: '7.0.0', upstreamCorePackage: '7.0.0', workerProtocol: 'tesseract-js-node-worker-7',
  abi: 'tesseract-webidl7-tvs1', oem: 1,
  requiredPatchIds: Object.freeze(['0001-lstm-dictionary-flags', '0002-clear-image-on-decode-failure', '0003-portable-wasm-build-paths', '0004-tvs-native-version', '0005-glue-overload-dispatch', '0006-lstm-unavailable-legacy-api']),
});
const API_METHODS = Object.freeze([
  'Version', 'Init', 'End', 'Clear', 'SetVariable', 'SetImageFile', 'SetRectangle',
  'Recognize', 'GetUTF8Text', 'GetJSONText', 'MeanTextConf', 'GetPageSegMode',
  'SaveParameters', 'RestoreParameters', 'FindLines', 'GetGradient', 'oem',
]);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw Object.assign(new Error(message), { code: 'OCR_CUSTOM_CORE' }); };
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const samePath = (left, right) => process.platform === 'win32' ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US') : left === right;

function verifiedAsset(root, descriptor, expectedName) {
  if (!descriptor || descriptor.path !== expectedName || path.isAbsolute(descriptor.path) || descriptor.path.includes('\\') || descriptor.path.split('/').some(part => !part || part === '.' || part === '..')) fail('Недопустимое имя артефакта custom core');
  if (!isHash(descriptor.sha256) || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes <= 0) fail('Не заполнены размер и hash артефакта custom core');
  const filename = path.join(root, descriptor.path), physicalRoot = fs.realpathSync(root), physicalFile = fs.realpathSync(filename);
  const relative = path.relative(physicalRoot, physicalFile);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) fail('Артефакт custom core выходит за пределы своего каталога');
  const bytes = fs.readFileSync(physicalFile);
  if (bytes.length !== descriptor.bytes || sha256(bytes) !== descriptor.sha256) fail('Размер или SHA256 custom core не совпадает с manifest: ' + descriptor.path);
  return { path: physicalFile, bytes };
}

function readManifest(coreDirectory, expected = {}) {
  if (!isHash(expected.manifestSha256)) fail('Runtime не передал закреплённый manifest hash custom core');
  const filename = path.join(coreDirectory, 'manifest.json'), bytes = fs.readFileSync(filename);
  if (sha256(bytes) !== expected.manifestSha256) fail('Manifest custom core не совпадает с проверенным runtime hash');
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.schemaVersion !== 1 || manifest.artifactKind !== 'tvs-tesseract-wasm-core') fail('Неподдерживаемый manifest custom core');
  if (typeof manifest.buildId !== 'string' || !manifest.buildId || expected.buildId && manifest.buildId !== expected.buildId) fail('Build ID custom core отличается от ожидаемого');
  if (manifest.expectedRuntimeVersion !== NATIVE_CORE_CONTRACT.nativeVersion) fail('Не совпадает закреплённая строка TessBaseAPI.Version()');
  const compatible = manifest.compatibility;
  for (const key of ['tesseractJs', 'upstreamCorePackage', 'workerProtocol', 'abi', 'oem']) if (compatible?.[key] !== NATIVE_CORE_CONTRACT[key]) fail('Custom core не соответствует контракту ' + key);
  if (compatible.wasmMemory64 !== false || compatible.pthreads !== false) fail('Custom core требует неподдерживаемую память/потоки');
  if (!isHash(manifest.patchSetSha256) || expected.patchSetSha256 && manifest.patchSetSha256 !== expected.patchSetSha256 || !Array.isArray(manifest.patches) || !manifest.patches.length) fail('Не совпадает набор патчей нативных исходников custom core');
  const patchLedger = manifest.patches.map(patch => {
    if (typeof patch.id !== 'string' || !patch.id || !isHash(patch.sha256) || !/^patches\/[a-zA-Z0-9_.-]+\.patch$/.test(patch.path || '') || !Number.isSafeInteger(patch.bytes) || patch.bytes <= 0) fail('Повреждён список патчей нативных исходников custom core');
    return { id: patch.id, sha256: patch.sha256 };
  }).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  if (sha256(Buffer.from(JSON.stringify(patchLedger), 'utf8')) !== manifest.patchSetSha256) fail('Содержимое patch ledger не соответствует patchSet hash');
  if (new Set(patchLedger.map(patch => patch.id)).size !== patchLedger.length) fail('Повторяющийся ID патча нативных исходников custom core');
  for (const patchId of NATIVE_CORE_CONTRACT.requiredPatchIds) if (!patchLedger.some(patch => patch.id === patchId)) fail('Отсутствует обязательный патч нативных исходников custom core: ' + patchId);
  if (!Array.isArray(manifest.variants) || !manifest.variants.length || manifest.variants.length > 3) fail('Нужен непустой перечень реально собранных LSTM-вариантов');
  const seen = new Set();
  for (const variant of manifest.variants) {
    const known = KNOWN_VARIANTS[variant.id];
    if (!known || seen.has(variant.id)) fail('Неизвестный или повторный вариант custom core');
    seen.add(variant.id);
    if (variant.lstmOnly !== true || variant.available !== true || JSON.stringify(variant.requiredFeatures) !== JSON.stringify(known.features)) fail('Feature flags custom core не соответствуют варианту');
    if (variant.js?.path !== known.stem + '.js' || variant.wasm?.path !== known.stem + '.wasm') fail('Имена glue/WASM не соответствуют варианту custom core');
  }
  if (!seen.has('lstm')) fail('Необходим scalar LSTM вариант для устройств без SIMD');
  return manifest;
}

function verifyManifestAssets(coreDirectory, manifest) {
  const variants = manifest.variants.map(variant => {
    const known = KNOWN_VARIANTS[variant.id];
    if (!known) fail('Неизвестный вариант custom core');
    const js = verifiedAsset(coreDirectory, variant.js, known.stem + '.js');
    const wasm = verifiedAsset(coreDirectory, variant.wasm, known.stem + '.wasm');
    if (wasm.bytes.length < 8 || wasm.bytes.readUInt32LE(0) !== 0x6d736100 || wasm.bytes.readUInt32LE(4) !== 1) fail('Файл custom core не является WASM v1');
    return { id: variant.id, js: { path: js.path, bytes: js.bytes.length, sha256: variant.js.sha256 }, wasm: { path: wasm.path, bytes: wasm.bytes.length, sha256: variant.wasm.sha256 } };
  });
  const patches = manifest.patches.map(patch => {
    const file = verifiedAsset(coreDirectory, patch, patch.path);
    return { id: patch.id, path: file.path, bytes: file.bytes.length, sha256: patch.sha256 };
  });
  return { variants, patches };
}

function validateModule(module, expectedVersion) {
  if (!module || typeof module.TessBaseAPI !== 'function' || typeof module.destroy !== 'function' || typeof module.getPointer !== 'function') fail('Custom core не экспортирует WebIDL/helpers Tesseract.js');
  for (const method of ['writeFile', 'readFile', 'unlink', 'mkdir']) if (typeof module.FS?.[method] !== 'function') fail('Custom core не экспортирует FS.' + method);
  for (const method of API_METHODS) if (typeof module.TessBaseAPI.prototype?.[method] !== 'function') fail('В custom core отсутствует обязательный API: ' + method);
  if (module.TessBaseAPI.prototype.Init.length !== 4) fail('ABI Init должен поддерживать четвёртый аргумент configFilename');
  // Validate the loaded module before the worker initializes any language.
  // Constructing this short-lived API object does not recognize an image.
  let probe;
  try {
    probe = new module.TessBaseAPI();
    const version = probe.Version();
    if (version !== expectedVersion) fail('Фактическая версия custom core отличается от manifest: ' + version);
    return version;
  } finally { if (probe) module.destroy(probe); }
}

function createLocalCoreAdapter({ coreDirectory, expected, featureDetect }) {
  if (!path.isAbsolute(coreDirectory)) fail('Нужен физический абсолютный каталог custom core');
  if (typeof featureDetect?.simd !== 'function' || typeof featureDetect?.relaxedSimd !== 'function') fail('Не передан штатный wasm-feature-detect');
  let selectedFactory = null, selection = null;
  const getCore = async (lstmOnly, suppliedCorePath, response) => {
    if (![true, 1, 3].includes(lstmOnly)) fail('Этот custom core поддерживает только LSTM OEM 1');
    if (!samePath(path.resolve(suppliedCorePath), path.resolve(coreDirectory))) fail('Worker получил другой путь custom core');
    if (selectedFactory) return selectedFactory;
    const manifest = readManifest(coreDirectory, expected);
    const hostSimd = await featureDetect.simd().catch(() => false), hostRelaxed = hostSimd && await featureDetect.relaxedSimd().catch(() => false);
    const available = manifest.variants.filter(variant => variant.requiredFeatures.every(feature => feature === 'simd' ? hostSimd : feature === 'relaxed-simd' ? hostRelaxed : false));
    available.sort((left, right) => KNOWN_VARIANTS[right.id].priority - KNOWN_VARIANTS[left.id].priority);
    const variant = available[0];
    if (!variant) fail('Нет совместимого с устройством custom core. Стоковое ядро не используется.');
    response?.progress?.({ status: 'loading tesseract core', progress: 0 });
    const known = KNOWN_VARIANTS[variant.id], js = verifiedAsset(coreDirectory, variant.js, known.stem + '.js'), wasm = verifiedAsset(coreDirectory, variant.wasm, known.stem + '.wasm');
    // require only the selected, hash-verified local glue. No package-level
    // tesseract.js-core fallback and no network fetch are permitted here.
    const exported = require(js.path), factory = typeof exported === 'function' ? exported : exported?.default;
    if (typeof factory !== 'function') fail('Glue custom core не экспортирует Emscripten MODULARIZE factory');
    selection = Object.freeze({
      buildId: manifest.buildId, manifestSha256: expected.manifestSha256, patchSetSha256: manifest.patchSetSha256,
      variant: variant.id, requiredFeatures: [...variant.requiredFeatures], jsSha256: variant.js.sha256, wasmSha256: variant.wasm.sha256,
      expectedRuntimeVersion: manifest.expectedRuntimeVersion, abi: manifest.compatibility.abi,
      corePath: coreDirectory, source: 'custom-local-wasm', stockFallback: false,
    });
    selectedFactory = async options => {
      const module = await factory({
        ...options,
        // Compile the exact verified bytes, not a second unverified disk read.
        wasmBinary: new Uint8Array(wasm.bytes),
        locateFile(name) { if (name === variant.wasm.path) return wasm.path; fail('Custom core запросил непредусмотренный файл: ' + name); },
      });
      const actualVersion = validateModule(module, manifest.expectedRuntimeVersion);
      Object.defineProperty(module, '__tvsCoreInfo', { value: Object.freeze({ ...selection, actualRuntimeVersion: actualVersion }), enumerable: false });
      return module;
    };
    response?.progress?.({ status: 'loading tesseract core', progress: 1 });
    return selectedFactory;
  };
  getCore.selection = () => selection;
  return getCore;
}

module.exports = { createLocalCoreAdapter, readManifest, verifyManifestAssets, validateModule, KNOWN_VARIANTS, API_METHODS, NATIVE_CORE_CONTRACT };
