// Совместимые функции интерфейса; математика находится в переносимом ядре.
if (typeof TvsFuelEngine === 'undefined' || TvsFuelEngine.apiVersion !== 1) throw new Error('Не загружено ядро расчётов ГСМ (assets/core/fuel-engine.js)');
const GSM_UNKNOWN_ORG = TvsFuelEngine.constants.unknownOrg;
const GSM_EPS = TvsFuelEngine.constants.epsilon;
function gsmNumber(value) { return TvsFuelEngine.gsmNumber(value); }
function gsmRound(value) { return TvsFuelEngine.gsmRound(value); }
function gsmCardKey(value) { return TvsFuelEngine.gsmCardKey(value); }
function gsmOrgKey(value) { return TvsFuelEngine.gsmOrgKey(value); }
function gsmGrade(value, fallback) { return TvsFuelEngine.gsmGrade(value, fallback); }
function gsmVehicleGrade(v) { return TvsFuelEngine.gsmVehicleGrade(v); }
function gsmFamily(grade) { return TvsFuelEngine.gsmFamily(grade); }
function gsmInPeriod(date, from, to) { return TvsFuelEngine.gsmInPeriod(date, from, to); }
function gsmValidDate(date) { return TvsFuelEngine.gsmValidDate(date); }
function gsmMonthRange(month) { return TvsFuelEngine.gsmMonthRange(month); }
function gsmVehicleOrgAt(v, date) { return TvsFuelEngine.gsmVehicleOrgAt(v, date); }
function gsmCardAt(db, number, date) { return TvsFuelEngine.gsmCardAt(db, number, date); }
function gsmBuildLedger(db, options) {
  if (typeof dispatcherQuery === 'function' && typeof data !== 'undefined' && db === data) return dispatcherQuery('fuel', options);
  return TvsFuelEngine.buildLedger(db, options);
}

// Явные команды сохранения истории остаются в интерфейсном слое.
function gsmStampPurchase(p, db) {
  if (!p || p.sourceOrg) return;
  const owner = gsmCardAt(db, p.cardNo, p.date);
  if (!owner.org) return;
  p.sourceOrg = owner.org;
  p.sourceProvider = owner.provider;
  p.cardVehicleId = owner.vehicleId;
}
function gsmPreserveCardHistory(db, number) {
  (db.fuelPurchases || []).filter(p => gsmCardKey(p.cardNo) === gsmCardKey(number)).forEach(p => gsmStampPurchase(p, db));
  (db.records || []).filter(r => gsmCardKey(r.fuelCardNum) === gsmCardKey(number) && !r.fuelOrg).forEach(r => {
    const owner = gsmCardAt(db, number, r.date);
    if (owner.org) { r.fuelOrg = owner.org; r.fuelProvider = owner.provider; }
  });
}
function gsmPreserveVehicleHistory(db, vehicle) {
  (db.fuelCards || []).forEach(c => gsmPreserveCardHistory(db, c.number));
  (db.records || []).filter(r => r.vehicleId === vehicle.id && !r.fuelOrg && !r.fuelCardNum && gsmNumber(r.fuelIssued) > 0)
    .forEach(r => { r.fuelOrg = gsmVehicleOrgAt(vehicle, r.date); });
  if (!vehicle.fuelBalanceSources) vehicle.fuelBalanceSources = [{ org: vehicle.org || GSM_UNKNOWN_ORG, grade: gsmVehicleGrade(vehicle), qty: gsmNumber(vehicle.fuelBalance) }];
}
