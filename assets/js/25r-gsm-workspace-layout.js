// Presentation and navigation only. Existing forms own validation and writes.
let gsmPhysicalTankContext = null;

function gsmPhysicalTankIdentity() {
  return {
    analysis:typeof dispatcherAnalysisStamp === 'function' ? dispatcherAnalysisStamp() : null,
    session:typeof syncSessionStamp === 'function' ? syncSessionStamp() : null,
    identity:typeof dispatcherContext === 'function' ? dispatcherContext().identity : null
  };
}

function gsmSwitchView(view) {
  if (![...GSM_MAIN_VIEWS, ...GSM_EXTRA_VIEWS, ['manual']].some(([id]) => id === view)) return;
  fpView = view;
  renderFuelPurchases();
}

function gsmAddOperationDialog() {
  openGenericModal('Добавить операцию с топливом',
    '<div class="gsm-operation-choices">' +
    '<button type="button" class="btn btn-primary" onclick="closeModal(\'genericModal\');gsmAddReceipt()">Заправка техники</button><p>Поступление топлива в бак машины: дата, получатель, организация и литры.</p>' +
    '<button type="button" class="btn btn-ghost" onclick="closeModal(\'genericModal\');gsmSwitchView(\'manual\')">Внести выписку вручную</button><p>Несколько заправок с проверкой перед сохранением.</p>' +
    '<button type="button" class="btn btn-ghost" onclick="closeModal(\'genericModal\');gsmSwitchView(\'tanks\')">Приход, выдача или замер ёмкости</button><p>Выберите физическую ёмкость. В её карточке доступны источник, получатель и остаток после операции.</p>' +
    '</div>', 650);
}

function gsmOperationsHtml(ledger) {
  gsmMovementLedger = ledger;
  return '<section class="gsm-operations" aria-label="Операции с топливом"><div class="gsm-section-title"><div><h3>Операции с топливом</h3><p class="gsm-overview-note">Приход, расход и подтверждённые корректировки в баках техники за выбранный период. Движения физических ёмкостей открываются в их карточках.</p></div>' +
    '<button type="button" class="btn btn-ghost" onclick="gsmSwitchView(\'receipts\')">Открыть выписку</button></div>' +
    '<div class="gsm-movement-filters"><label class="gsm-movement-search"><span>Найти операцию</span><input type="search" aria-label="Поиск операций" placeholder="Машина, карта, организация, топливо…" value="' + fpEsc(gsmMovementSearch) + '" oninput="gsmSetMovementSearch(this.value)"></label>' +
    '<label><span>Вид операции</span><select class="fsel" aria-label="Вид операции" onchange="gsmSetMovementType(this.value)">' +
    [['', 'Все операции'], ['receipt', 'Приход'], ['consumption', 'Расход'], ['grade-reconciliation', 'Сверка марок'], ['measurement-correction', 'Корректировка по замеру']].map(([id, title]) => '<option value="' + id + '"' + (gsmMovementType === id ? ' selected' : '') + '>' + title + '</option>').join('') + '</select></label></div>' +
    '<div id="gsmBarrelMovementResults">' + gsmMovementListHtml(ledger) + '</div></section>';
}

function gsmPhysicalTanksHtml(ledger) {
  gsmPhysicalTankContext = null;
  const date = ledger.to || dispatcherLocalDate();
  const intro = '<div class="gsm-section-title"><div><h3>Физические ёмкости</h3><p class="gsm-overview-note">Места хранения топлива. Эти литры не прибавляются повторно к остаткам в баках машин.</p><p class="gsm-status">Расчёт на конец ' + fpEsc(fmtDate(date)) + (ledger.to ? '' : ' · для среза за месяц выберите его в фильтре') + '.</p></div></div>';
  if (!tankStockReadAllowed()) return intro + '<p class="gsm-status" role="status">Недостаточно доступа для проверки источников остатка ёмкостей.</p>';
  const tanks = (data.tanks || []).filter(tank => !tank.archived && (!gsmOrg || gsmOrgKey(tank.org) === gsmOrgKey(gsmOrg)) && (!gsmFuel || gsmGrade(tankFuelGrade(tank)) === gsmFuel));
  const snapshot = tankStockSnapshot();
  gsmPhysicalTankContext = { databaseRef:data, tanks, ...gsmPhysicalTankIdentity() };
  const cards = tanks.map((tank, index) => {
    const stock = tankStockAt(tank.id, date, true, snapshot);
    const events = (tankStockRow(tank.id, snapshot)?.events || []).filter(event => event.date <= date);
    const measurement = events.filter(event => event.kind === 'measurement' && !event.void && event.measurement?.observedQty != null).slice().sort((a, b) => b.date.localeCompare(a.date) || b.source.rowIndex - a.source.rowIndex)[0];
    return '<article class="gsm-physical-tank"><div class="gsm-section-title"><h3>' + fpEsc(tank.name || 'Ёмкость без названия') + '</h3><span class="gsm-barrel-grade">' + fpEsc(tankFuelGrade(tank)) + '</span></div>' +
      '<p class="gsm-status">' + fpEsc([tank.object, tank.location].filter(Boolean).join(' · ') || 'Место хранения не указано') + '</p><dl>' +
      '<dt>Организация</dt><dd>' + fpEsc(tankFuelOrg(tank)) + '</dd><dt>Расчётный остаток</dt><dd' + (stock.balance !== null && stock.balance < 0 ? ' class="gsm-error"' : '') + '>' + fpEsc(tankStockLabel(stock)) + (stock.balance === null ? '' : ' л') + '</dd>' +
      '<dt>Последний замер</dt><dd>' + (measurement ? fpEsc(precisionFormat(measurement.measurement.observedQty) + ' л · ' + fmtDate(measurement.date)) : 'Не внесён') + '</dd></dl>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-gsm-tank-index="' + index + '" onclick="gsmOpenPhysicalTank(' + index + ')">Карточка и движения →</button></article>';
  });
  return '<section class="gsm-physical-tanks-view" aria-label="Физические ёмкости">' + intro + '<div class="gsm-physical-tanks">' + (cards.join('') || '<p class="gsm-status">Действующих ёмкостей по выбранным фильтрам нет. Добавление и архив доступны в разделе «Ёмкости».</p>') + '</div></section>';
}

function gsmOpenPhysicalTank(index) {
  const context = gsmPhysicalTankContext;
  if (!context || activeSection !== 'fuelPurchases' || fpView !== 'tanks' || !Number.isSafeInteger(index)) return;
  const current=gsmPhysicalTankIdentity();
  if(context.databaseRef!==data||context.analysis!==current.analysis||context.session!==current.session||context.identity!==current.identity||!tankStockReadAllowed()) {
    gsmPhysicalTankContext=null;
    const panel=document.querySelector('.gsm-physical-tanks-view');
    if(panel){const note=document.createElement('p');note.className='gsm-status';note.setAttribute('role','status');note.textContent='База, исходные данные или права изменились. Дождитесь загрузки и заново откройте раздел ёмкостей.';panel.replaceChildren(note);}
    showToast('Сеанс или источники изменились. Откройте ёмкости после загрузки выбранной базы.');
    return;
  }
  const tank = context.tanks[index];
  if (!tank || !(data.tanks || []).includes(tank)) { showToast('Список ёмкостей изменился. Обновите раздел.'); return; }
  switchSection('tanks');
  selectTank(tank.id);
}
