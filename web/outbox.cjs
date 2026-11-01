'use strict';

// The server owns the exact reviewed intent; browsers never persist business
// envelopes or credentials. Reuse the desktop's tested durable receipt protocol.
const crypto = require('node:crypto');
const { createCommandOutbox } = require('../electron/command-outbox.cjs');
const { createOperationRecovery } = require('../electron/operation-recovery.cjs');

function createWebOutbox({ rootDir, send, lookup, assertCurrent = () => {} }) {
  if (typeof send !== 'function' || typeof lookup !== 'function' || typeof assertCurrent !== 'function')
    throw TypeError('Нужны транспорт, проверка квитанций и проверка текущего сеанса');
  const outbox = createCommandOutbox({ rootDir, maxEntries: 2048, maxPayloadBytes: 64 * 1024 * 1024, maxTotalBytes: 512 * 1024 * 1024 });
  function capture(context) {
    if (!context || typeof context.databaseToken !== 'string' || !context.databaseToken ||
        !context.access?.user?.id || !/^sha256:[a-f0-9]{64}$/.test(context.access.policyStamp || ''))
      throw Object.assign(Error('Не подтверждены база и права очереди'), { code: 'ACCESS_UNVERIFIED', status: 403 });
    const scope = crypto.createHash('sha256').update(JSON.stringify([
      'tvs-web-v1', context.databaseToken, context.access.user.id,
      context.access.user.role, context.access.policyStamp, context.access,
    ])).digest('hex');
    return { ...context, scope, client: true, backend: 'remote', supportsOperations: true, supportsCommands: true };
  }
  async function assertAcknowledgement(context) {
    try { await assertCurrent(context); }
    catch (error) {
      throw Object.assign(Error('Сеанс изменился после отправки. Проверьте исходную операцию перед повтором.'), {
        code: 'STORAGE_ACK_STALE', causeCode: error.code, status: error.status,
        unknown: true, definitive: false,
      });
    }
  }
  const recovery = createOperationRecovery({ outbox,
    send: async (context, json) => { await assertCurrent(context); const response = await send(context, json); await assertAcknowledgement(context); return response; },
    lookup: async (context, id, digest) => { await assertCurrent(context); const response = await lookup(context, id, digest); await assertCurrent(context); return response; },
  });
  async function invoke(action, context, input) {
    const captured = capture(context);
    await assertCurrent(captured);
    const result = await recovery[action](captured, input);
    if (['execute', 'retry'].includes(action)) await assertAcknowledgement(captured);
    else await assertCurrent(captured);
    return result;
  }
  return Object.freeze({
    execute: (context, payload) => invoke('execute', context, payload),
    reconcile: (context, id) => invoke('reconcile', context, id),
    retry: (context, id) => invoke('retry', context, id),
    list: context => invoke('list', context),
    discard: (context, id) => invoke('discard', context, id),
  });
}

module.exports = { createWebOutbox };
