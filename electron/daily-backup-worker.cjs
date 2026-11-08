'use strict';
const { workerData, parentPort } = require('node:worker_threads');
parentPort.postMessage(require('./daily-backup.cjs').execute(workerData.jobDir, workerData.source, workerData.nonce));
