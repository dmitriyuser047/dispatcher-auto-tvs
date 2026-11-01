'use strict';

// Common bootstrap metadata is read once for the waiting requests. It contains
// no principal or business rows; the gateway checks each session at its ACK.
const storage = require('../electron/storage.js');
const sqlite = require('../electron/sqlite-storage.cjs');
const format = require('../electron/storage-format.cjs');
const compatibility = require('../assets/core/platform-compatibility.js');
const version = require('../package.json').version;
const invalidConsumer = () => Object.assign(Error('Обработка состояния базы должна быть синхронной.'), { code: 'STORAGE_STATUS_CONSUMER_ASYNC', status: 500 });

function withStorageStatus(dataDir, consume) {
  if (typeof consume !== 'function' || consume.constructor?.name === 'AsyncFunction') throw invalidConsumer();
  return storage.withDatabaseLock(dataDir, physical => {
    const read = () => {
      const descriptor = storage.descriptor(physical), databaseToken = storage.databaseToken(physical);
      return Object.freeze({ databaseToken, version, platform: Object.freeze({ descriptor,
        readOnly: !format.isCurrent(descriptor.schemaVersion), compatibility: compatibility.describe().serverProfile,
      }) });
    };
    const status = sqlite.exists(physical) ? sqlite.transaction(physical, read, { readOnly: true }) : read();
    // The SQL view has closed, while the physical lock remains held until all
    // synchronous consumers finish publishing their independently checked ACKs.
    const result = consume(status);
    if (result && typeof result.then === 'function') {
      if (typeof result.catch === 'function') result.catch(() => {});
      throw invalidConsumer();
    }
    return result;
  });
}

module.exports = Object.freeze({ withStorageStatus });
