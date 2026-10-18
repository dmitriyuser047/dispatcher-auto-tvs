const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual: equal } = require('node:util');
const ID = /^change_[a-z0-9]+_[a-f0-9-]{36}$/;
const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
const key = row => row?.id ?? row?.month ?? null;
function keyed(rows) { return rows.every(r => key(r) != null) && new Set(rows.map(key)).size === rows.length; }
function createEvent(before, sections, context = {}) {
  const changes = [];
  for (const [section, after] of Object.entries(sections)) {
    const old = before[section] || [];
    if (equal(old, after)) continue;
    if (!keyed(old) || !keyed(after)) { changes.push({ section, key: null, before: clone(old), after: clone(after) }); continue; }
    const a = new Map(old.map((row, index) => [key(row), { row, index }]));
    const b = new Map(after.map((row, index) => [key(row), { row, index }]));
    for (const id of new Set([...a.keys(), ...b.keys()])) {
      const left = a.get(id), right = b.get(id);
      if (!equal(left?.row, right?.row)) changes.push({ section, key: id, index: left?.index ?? right.index, before: clone(left?.row), after: clone(right?.row) });
    }
    // Ordering is deliberately kept with the section if it is the only change.
    if (!changes.some(c => c.section === section)) changes.push({ section, key: null, before: clone(old), after: clone(after) });
  }
  if (!changes.length) return null;
  return { id: 'change_' + Date.now().toString(36) + '_' + randomUUID(), at: new Date().toISOString(),
    actor: String(context.actor || 'Система').slice(0, 120), action: String(context.action || 'Изменение данных').slice(0, 160),
    reverts: ID.test(context.reverts || '') ? context.reverts : null, changes };
}
function validEvent(event, sections) {
  return !!event && ID.test(event.id || '') && typeof event.at === 'string' && Array.isArray(event.changes) && event.changes.length > 0 &&
    event.changes.every(c => sections.includes(c.section) && (c.key === null ? Array.isArray(c.before) && Array.isArray(c.after) :
      ['string', 'number'].includes(typeof c.key) && (c.before === null || typeof c.before === 'object') && (c.after === null || typeof c.after === 'object')));
}
function brokenReferences(db) {
  const result = new Set();
  const ids = name => new Set((db[name] || []).map(row => row.id));
  const targets = Object.fromEntries(['vehicles','generators','records','genRecords','tanks','repairs','vehicleTo','toRecords','contragents'].map(n => [n, ids(n)]));
  const links = { vehicles:{tankId:'tanks'},generators:{tankId:'tanks'},monthlyFuel:{vehicleId:'vehicles'},records:{vehicleId:'vehicles'}, genRecords:{generatorId:'generators',tankId:'tanks'}, vehicleTo:{vehicleId:'vehicles'},
    toRecords:{generatorId:'generators'}, repairs:{vehicleId:'vehicles'}, tankIncomes:{tankId:'tanks'},
    fuelPurchases:{vehicleId:'vehicles',cardVehicleId:'vehicles',recordId:'records'}, payments:{vehicleId:'vehicles',generatorId:'generators'} };
  for (const [section, fields] of Object.entries(links)) for (const row of db[section] || []) for (const [field,target] of Object.entries(fields)) {
    if (row[field] && !targets[target].has(row[field])) result.add([section,key(row),field,row[field]].join('|'));
  }
  for (const row of db.payments || []) {
    const section = row.sourceSection || ({repair:'repairs',to:'vehicleTo',generatorTo:'toRecords',genTo:'toRecords'}[row.source]);
    if (section && row.sourceId && targets[section] && !targets[section].has(row.sourceId)) result.add('payments|' + key(row) + '|source|' + section + '|' + row.sourceId);
  }
  for (const card of db.fuelCards || []) for (const assignment of card.assignments || []) {
    if (assignment.vehicleId && !targets.vehicles.has(assignment.vehicleId)) result.add('fuelCards|' + key(card) + '|assignment|' + assignment.vehicleId);
  }
  return result;
}
function restoration(db, event, sections) {
  if (!validEvent(event, sections)) throw new Error('Повреждена запись истории');
  const next = clone(db), affected = new Set();
  for (const change of event.changes) {
    const rows = next[change.section] || [], current = change.key === null ? rows : rows.find(row => key(row) === change.key) || null;
    if (!equal(current, change.after)) throw new Error('После этой операции запись изменена. Восстановление остановлено: ' + change.section);
    if (change.key === null) next[change.section] = clone(change.before);
    else {
      const index = rows.findIndex(row => key(row) === change.key);
      if (index !== -1) rows.splice(index, 1);
      if (change.before !== null) rows.splice(Math.min(change.index || 0, rows.length), 0, clone(change.before));
      next[change.section] = rows;
    }
    affected.add(change.section);
  }
  const oldBroken = brokenReferences(db);
  if ([...brokenReferences(next)].some(ref => !oldBroken.has(ref))) throw new Error('Восстановление нарушит связи с более поздними документами');
  return Object.fromEntries([...affected].map(section => [section, next[section]]));
}
function summary(event) {
  return { id:event.id,at:event.at,actor:event.actor,action:event.action,reverts:event.reverts,
    count:event.changes.length,sections:[...new Set(event.changes.map(c => c.section))] };
}
module.exports = { ID, createEvent, validEvent, restoration, summary };
