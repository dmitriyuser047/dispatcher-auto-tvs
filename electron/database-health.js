const storage = require('./storage');

function inspectData(data) {
  const counts = {}, issues = [];
  for (const name of storage.SECTIONS) {
    const rows = data[name] || [];
    storage.validateRows(name, rows);
    counts[name] = rows.length;
    const ids = new Set();
    for (const row of rows) {
      if (row.id == null) continue;
      if (ids.has(row.id)) issues.push({ section: name, code: 'duplicate-id', message: 'Повтор идентификатора в разделе ' + name + ': ' + row.id });
      ids.add(row.id);
    }
  }
  for (const [name, field, parent] of [
    ['records', 'vehicleId', 'vehicles'], ['vehicleTo', 'vehicleId', 'vehicles'],
    ['genRecords', 'generatorId', 'generators'], ['toRecords', 'generatorId', 'generators'],
    ['tankIncomes', 'tankId', 'tanks'], ['fuelPurchases', 'vehicleId', 'vehicles'],
  ]) {
    const ids = new Set((data[parent] || []).map(row => row.id));
    const missing = (data[name] || []).filter(row => row[field] && !ids.has(row[field]));
    if (missing.length) issues.push({ section: name, code: 'missing-parent', message: name + ': ' + missing.length + ' записей с отсутствующей связью (' + parent + ')' });
  }
  return { counts, issues, total: Object.values(counts).reduce((sum, count) => sum + count, 0) };
}

module.exports = { inspectData };
