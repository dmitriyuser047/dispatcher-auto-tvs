/* Application calculation catalog. No storage, UI or mutable application globals. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dispatcher-core.js'), require('./fuel-engine.js'),
      require('../js/45-cost-engine.js'), require('../js/47-procurement-engine.js'));
  } else {
    root.DispatcherEngine = factory(root.DispatcherCore, root.TvsFuelEngine, root.TvsCostEngine, root.ProcurementEngine);
  }
})(typeof globalThis === 'object' ? globalThis : this, function (core, fuel, costs, procurement) {
  'use strict';

  const sections = Object.freeze({
    fuel: Object.freeze(['vehicles', 'records', 'fuelPurchases', 'fuelCards', 'monthlyFuel']),
    fuelRecords: Object.freeze(['vehicles', 'records']),
    costs: Object.freeze(['vehicles', 'generators', 'records', 'genRecords', 'repairs', 'vehicleTo',
      'toRecords', 'workOrders', 'payments', 'fuelPurchases', 'partMovements', 'costEntries', 'costProfiles']),
    procurement: Object.freeze(['tanks', 'parts', 'tankIncomes', 'genRecords', 'generators',
      'fuelMovements', 'partMovements', 'dispatchJobs', 'procurementRules', 'procurementOrders'])
  });

  function create(options) {
    options = options == null ? {} : options;
    if (Object.prototype.toString.call(options) !== '[object Object]') throw Error('Настройки ядра должны быть объектом');
    if (!core || core.apiVersion !== 1 || typeof core.createEngine !== 'function' || !fuel || fuel.apiVersion !== 1 || !costs || !procurement)
      throw Error('Не загружены модули расчётного ядра');
    const runtime = core.createEngine({
      maxEntries: options.maxEntries == null ? 16 : options.maxEntries,
      maxCacheCharacters: options.maxCacheCharacters,
      modules: {
        fuel: { version:'1', sections:sections.fuel,
          calculate:(db, query) => fuel.buildLedger(db, query) },
        fuelRecords: { version:'1', sections:sections.fuelRecords,
          calculate:(db, query) => fuel.recordBalances(db, query.vehicleId, { from:query.from, to:query.to }) },
        costs: { version:'1', sections:sections.costs,
          calculate:(db, query) => costs.buildReport(db, query) },
        procurement: { version:'1', sections:sections.procurement,
          calculate:(db, query) => {
            if (!query.date) throw Error('Укажите дату расчёта закупок');
            return procurement.plan(db, query);
          } }
      }
    });
    function query(name, database, options, context) {
      const parameters = options == null ? {} : options;
      const isObject = value => value != null && Object.prototype.toString.call(value) === '[object Object]';
      if (name === 'fuelRecords' && isObject(database) && isObject(parameters)) {
        // A vehicle list asks for every journal separately. Fingerprint only the
        // selected vehicle's fresh rows, rather than copying the whole fleet for
        // every card. Keep malformed sections/rows visible to the calculation.
        const forVehicle = (rows, field) => Array.isArray(rows)
          ? rows.filter(row => row == null || row[field] === parameters.vehicleId) : rows;
        database = {
          vehicles:forVehicle(database.vehicles, 'id'),
          records:forVehicle(database.records, 'vehicleId')
        };
      }
      return runtime.query(name, database, options, context);
    }
    return Object.freeze({ query, stats:runtime.stats, clear:runtime.clear, describe:runtime.describe });
  }

  return Object.freeze({ apiVersion:1, sections, create });
});
