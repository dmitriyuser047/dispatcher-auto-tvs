'use strict';
// Node worker entry for the patched, local Tesseract.js native binding.
const { parentPort, workerData } = require('worker_threads');
const upstreamRequire = require('./upstream.cjs');
const worker = require('./worker.cjs');
const { createLocalCoreAdapter } = require('./get-core.cjs');
if (!workerData || !workerData.tvsCore) throw Error('Runtime не передал ожидаемый manifest custom core');
const getCore = createLocalCoreAdapter({
  coreDirectory: workerData.tvsCore.corePath, expected: workerData.tvsCore,
  featureDetect: upstreamRequire('wasm-feature-detect'),
});
worker.setAdapter({
  getCore,
  gunzip: upstreamRequire('./src/worker-script/node/gunzip'),
  fetch: async () => { throw Error('Сетевое получение моделей OCR отключено: используйте комплектные локальные модели'); },
  ...upstreamRequire('./src/worker-script/node/cache'),
});
parentPort.on('message', packet => worker.dispatchHandlers(packet, response => parentPort.postMessage(response)));
