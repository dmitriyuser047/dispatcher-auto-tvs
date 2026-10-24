// The steps organise existing read views. Only the final workspace owns act commands.
let gsmActStepsState = { databaseRef:null, stamp:null, scope:null, step:0 };
const GSM_ACT_STEPS = [
  { stage:'opening', title:'Остатки', description:'Проверьте входящий остаток каждой машины и дату, от которой он рассчитан.' },
  { stage:'receipts', title:'Поступления', description:'Сверьте заправки с выпиской и проверьте, кому принадлежит топливо и в какую машину оно поступило.' },
  { stage:'measurements', title:'Замеры', description:'Проверьте подтверждённые остатки и даты замеров. Отсутствующий замер не означает нулевой остаток.' },
  { stage:'checks', title:'Проверка', description:'Разберите замечания расчёта по первоисточникам. Исправления вносятся только по подтверждённым данным.' },
  { stage:'document', title:'Акт', description:'Проверьте итог, подготовьте акт и откройте сохранённые документы.' }
];

function gsmActStepsReset() {
  gsmActStepsState = { databaseRef:null, stamp:null, scope:null, step:0 };
}

function gsmActStepsCurrent() {
  const databaseRef = typeof data === 'undefined' ? null : data;
  const stamp = typeof dispatcherAnalysisStamp === 'function' ? dispatcherAnalysisStamp() : null;
  const scope = JSON.stringify([
    typeof fpMonth === 'undefined' ? '' : fpMonth,
    typeof gsmOrg === 'undefined' ? '' : gsmOrgKey(gsmOrg),
    typeof gsmFuel === 'undefined' ? '' : gsmFuel,
    typeof gsmActDateValue === 'function' ? gsmActDateValue() : ''
  ]);
  // A newly prepared ledger for the same sources must not send the user back to step 1.
  if (gsmActStepsState.databaseRef !== databaseRef || gsmActStepsState.stamp !== stamp || gsmActStepsState.scope !== scope) {
    gsmActStepsState = { databaseRef, stamp, scope, step:0 };
  }
  return gsmActStepsState;
}

function gsmActSetStep(index) {
  if (!Number.isInteger(index) || index < 0 || index >= GSM_ACT_STEPS.length) return;
  gsmActStepsCurrent().step = index;
  renderFuelPurchases();
}

// Called by the existing command workflow only after a canonical save ACK.
// Rebind even when that ACK replaced data or changed the selected act date.
function gsmActStepsDocumentSaved() {
  gsmActStepsCurrent().step = 4;
}

function gsmActStepsIssueHtml(issue) {
  const vehicle = issue.vehicleId != null ? gsmVehicle(issue.vehicleId) : null;
  const context = [issue.date && fmtDate(issue.date), vehicle && fpVehicleTitle(vehicle), issue.org, issue.grade].filter(Boolean);
  const links = gsmWriteoffIssueLinks(issue);
  return '<li class="gsm-act-steps-issue" data-gsm-act-issue="' + fpEsc(issue.code || '') + '">' +
    (context.length ? '<p class="gsm-act-steps-issue-context">' + context.map(fpEsc).join(' · ') + '</p>' : '') +
    '<p>' + fpEsc(issue.message || issue.title || issue.code || 'Проверьте источник расчёта') + '</p>' +
    (links ? '<div class="gsm-act-steps-issue-actions">' + links + '</div>' : '') + '</li>';
}

function gsmActStepsChecksHtml() {
  let model;
  try { model = gsmWriteoffModel(); }
  catch (error) {
    return '<div class="gsm-act-steps-unavailable" role="status"><p>' + fpEsc(error.message || 'Расчёт не готов. Обновите раздел и повторите проверку.') + '</p>' +
      '<button type="button" class="btn btn-ghost" onclick="renderFuelPurchases()">Обновить расчёт</button></div>';
  }
  const issues = model.issues || [];
  const errors = issues.filter(issue => issue.severity === 'error');
  const warnings = issues.filter(issue => issue.severity !== 'error');
  const groups = [
    { key:'error', label:'Ошибки расчёта', items:errors, empty:'Ошибок расчёта не найдено.' },
    { key:'warning', label:'Предупреждения', items:warnings, empty:'Предупреждений нет.' }
  ];
  return '<div class="gsm-act-steps-check-summary" aria-label="Итог проверки источников">' + groups.map(group =>
    '<div class="gsm-act-steps-check-count is-' + group.key + '"><span>' + group.label + '</span><strong data-gsm-act-issue-count="' + group.key + '">' + group.items.length + '</strong></div>'
  ).join('') + '</div><p class="gsm-act-steps-check-status" role="status">' +
    (model.canPost ? 'Расчёт допускает проведение. На последнем шаге проверьте состав и основания акта.' : 'Проведение сейчас недоступно. Проверьте замечания и состояние акта на последнем шаге.') +
    '</p>' + groups.map(group => '<section class="gsm-act-steps-check-group is-' + group.key + '" aria-label="' + group.label + '"><h4>' + group.label + '</h4>' +
      (group.items.length ? '<ul data-gsm-act-issues="' + group.key + '">' + group.items.map(gsmActStepsIssueHtml).join('') + '</ul>' : '<p class="gsm-act-steps-empty">' + group.empty + '</p>') + '</section>'
    ).join('') + '<div class="gsm-act-steps-check-help"><p>В подробной проверке доступны хронология остатков и дополнительные ссылки на источники. Открытие проверки ничего не меняет.</p>' +
    '<button type="button" class="btn btn-ghost" onclick="gsmOpenDiagnostics()">Подробная проверка ГСМ</button></div>';
}

function gsmActStepsHtml(ledger) {
  const state = gsmActStepsCurrent(), current = GSM_ACT_STEPS[state.step];
  let body;
  if (current.stage === 'opening' || current.stage === 'measurements') {
    body = typeof gsmVehicleStatementHtml === 'function' ? gsmVehicleStatementHtml(ledger, { stage:current.stage }) :
      '<p class="gsm-act-steps-unavailable" role="status">Ведомость машин не загружена. Откройте раздел заново.</p>';
  } else if (current.stage === 'receipts') body = gsmReceiptsHtml(ledger);
  else if (current.stage === 'checks') body = gsmActStepsChecksHtml();
  else body = gsmWriteoffWorkspaceHtml(ledger);
  const scopeLabel = [fpMonthLabel(fpMonth), gsmOrg || 'Все организации', gsmFuel || 'Все марки топлива'].join(' · ');
  return '<section class="gsm-act-steps" aria-label="Подготовка акта ГСМ по шагам"><div class="gsm-act-steps-heading"><div><h3>Подготовка акта ГСМ</h3>' +
    '<p>' + fpEsc(scopeLabel) + '</p></div><span class="gsm-act-steps-position">Шаг ' + (state.step + 1) + ' из ' + GSM_ACT_STEPS.length + '</span></div>' +
    '<nav class="gsm-act-steps-nav" aria-label="Шаги подготовки акта"><ol>' + GSM_ACT_STEPS.map((step, index) =>
      '<li><button type="button" class="gsm-act-steps-tab' + (index === state.step ? ' is-current' : '') + '" data-gsm-act-step="' + index + '"' +
      (index === state.step ? ' aria-current="step"' : '') + ' aria-controls="gsmActStepsPanel" onclick="gsmActSetStep(' + index + ')"><span class="gsm-act-steps-number" aria-hidden="true">' + (index + 1) + '</span><span>' + step.title + '</span></button></li>'
    ).join('') + '</ol></nav><section id="gsmActStepsPanel" class="gsm-act-steps-panel" data-gsm-act-panel="' + state.step + '" data-gsm-act-stage="' + current.stage + '" aria-labelledby="gsmActStepsTitle">' +
    '<div class="gsm-act-steps-stage-heading"><h3 id="gsmActStepsTitle">' + current.title + '</h3><p>' + current.description + '</p></div>' + body + '</section>' +
    '<footer class="gsm-act-steps-footer"><p>Шаги можно открывать в любом порядке. Переходы не сохраняют данные и не проводят акт.</p><div class="gsm-act-steps-controls">' +
    (state.step > 0 ? '<button type="button" class="btn btn-ghost" data-gsm-act-previous onclick="gsmActSetStep(' + (state.step - 1) + ')">Назад: ' + GSM_ACT_STEPS[state.step - 1].title + '</button>' : '') +
    (state.step < GSM_ACT_STEPS.length - 1 ? '<button type="button" class="btn btn-primary" data-gsm-act-next onclick="gsmActSetStep(' + (state.step + 1) + ')">Дальше: ' + GSM_ACT_STEPS[state.step + 1].title + '</button>' : '') +
    '</div></footer></section>';
}
