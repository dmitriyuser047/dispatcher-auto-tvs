'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../web/public/navigation.js'), 'utf8');

function fixture(search = '', section = 'dispatch', view='section') {
  const navigated = [], switched = [], edited = [], selected = [], newJobs = [];
  let modal = false;
  const noop = () => {};
  const context = vm.createContext({
    window: { tvsWeb: { active: true }, addEventListener: noop },
    document: { querySelector: selector => selector === 'meta[name="tvs-route"]' ? { content: JSON.stringify({ url: '/' + section, title: 'Synthetic route', section, view }) } : selector === '.modal-overlay.open' && modal ? {} : null,
      getElementById: () => ({}), addEventListener: noop },
    location: { origin: 'http://localhost:9393', search, assign: target => navigated.push(target) },
    URL, URLSearchParams, queueMicrotask,
    switchSection: (section, options) => switched.push({ section, options }), renderWorkspaceSection: noop,
    selectVehicle: id => selected.push(id), openGeneratorDetail: noop, selectGenerator: noop,
    renderDetail: noop, saveGenerator: noop, saveVehicle: noop, selectTank: noop, personnelOpenPerson: noop,
    renderReestrSection: noop,
    wfEdit: (section, id) => edited.push({ section, id }), dxJobNew: () => newJobs.push(true),
    openVehicleJournal: noop, openSettingsModal: noop, platformOpenSource: noop, showToast: noop,
    htmlEsc: value => String(value ?? ''), unifiedPendingSaves: 0,
    dxJobsView: 'board', dxJobsDate: '2026-10-26', dxJobsAllDates: false, dxJobsSiteUnset: false,
    fpView: 'receipts', fcSearch: '', caSearchQuery: '', finView:'table',
    WF_FIELDS: { dispatchJobs: [], opsTasks: [], assetDocuments: [] },
    wfSectionForTab: tab => ['dispatchJobs', 'assetAssignments', 'shiftReports'].includes(tab) ? 'dispatch' : 'workflows',
    platformSessionContext: () => ({ readable: ['vehicles', 'records', 'generators', 'genRecords', 'opsTasks', 'assetDocuments'] }),
    data: { vehicles: [{ id: 0 }], records: [{ id: 'record-0', vehicleId: 0 }], generators: [], drivers: [], dispatchJobs: [{ id: 'job-0' }] },
  });
  vm.runInContext(source, context, { filename: 'navigation.js' });
  return { context, navigated, switched, edited, selected, newJobs, block: value => { modal = value; } };
}
const flush = () => new Promise(resolve => queueMicrotask(resolve));
test('the vehicle document mounts its invoice block whenever the native card renders',()=>{
  const f=fixture('?asset=0','vehicles','vehicle'),mounted=[];f.context.window.tvsWeb.vehicleInvoices={mount:id=>mounted.push(id)};
  f.context.renderDetail({id:0});assert.deepEqual(mounted,[0]);f.context.renderDetail({id:'0'});assert.deepEqual(mounted,[0,'0']);
});
test('finance opens registry statistics and preserves the existing expenses and budget view',()=>{
  const f=fixture('','finances'),rendered=[];f.context.window.tvsWeb.financeRegistry={render:()=>rendered.push('registries')};assert.equal(f.context.renderWorkspaceSection('finances'),true);assert.deepEqual(rendered,['registries']);
  const expenses=fixture('?view=expenses','finances');let shown=0;expenses.context.window.tvsWeb.financeRegistry={render:()=>shown++,mountLegacyTabs:()=>{throw Error('Unexpected manual expense view');}};assert.equal(expenses.context.renderWorkspaceSection('finances'),true);assert.equal(shown,1);
  const legacy=fixture('?view=ledger','finances');let mounted=0;legacy.context.window.tvsWeb.financeRegistry={render:()=>{throw Error('Unexpected registry view');},mountLegacyTabs:()=>mounted++};legacy.context.renderWorkspaceSection('finances');assert.equal(mounted,1);
});
test('the existing budget editor stays available through its explicit planning address',async()=>{const f=fixture('?view=ledger&mode=budget','finances');await f.context.window.tvsWeb.startRoute();assert.equal(f.context.finView,'budget');assert.equal(f.switched[0].section,'finances');});
test('logistics starts its own workspace and renderer without opening the invoice section',async()=>{
  const f=fixture('','logistics','logistics');let rendered=0;
  f.context.window.tvsWeb.logistics={render:()=>rendered++};
  f.context.renderReestrSection=()=>{throw Error('Invoice renderer must remain independent');};
  await f.context.window.tvsWeb.startRoute();assert.equal(f.switched[0].section,'logistics');
  assert.equal(f.context.renderWorkspaceSection('logistics'),true);assert.equal(rendered,1);
});
test('registries has its own workspace and saved register sources open there',async()=>{
  const f=fixture('','registries','registries');let rendered=0;
  f.context.window.tvsWeb.registries={render:()=>rendered++};f.context.renderReestrSection=()=>{throw Error('Invoice renderer must remain independent');};
  await f.context.window.tvsWeb.startRoute();assert.equal(f.switched[0].section,'registries');assert.equal(f.context.renderWorkspaceSection('registries'),true);assert.equal(rendered,1);
  f.context.platformSessionContext=()=>({readable:['savedReestrs']});f.context.data.savedReestrs=[{id:0,kind:'payment-registry',registryVersion:1}];
  f.context.platformOpenSource('savedReestrs',0);await flush();const destination=new URL(f.navigated[0],'http://localhost');assert.equal(destination.pathname,'/registries');assert.equal(JSON.parse(destination.searchParams.get('register')),0);
});

test('workflow tabs and filters become real document URLs and restore on reload', async () => {
  const f = fixture();
  f.context.switchSection('dispatch', { workflowTab: 'dispatchJobs', query: 'synthetic', site: 'КП-5', org: 'ТВС', archive: true });
  await flush();
  const destination = new URL(f.navigated[0], 'http://localhost');
  assert.equal(destination.searchParams.get('tab'), 'dispatchJobs');
  assert.equal(destination.searchParams.get('site'), 'КП-5');
  assert.equal(destination.searchParams.get('archive'), '1');
  const next = fixture(destination.search);
  await next.context.window.tvsWeb.startRoute();
  assert.equal(next.switched[0].options.workflowTab, 'dispatchJobs');
  assert.equal(next.switched[0].options.query, 'synthetic');
  assert.equal(next.switched[0].options.archive, true);
});

test('a palette section-plus-selection chain requests only the final typed record address', async () => {
  const f = fixture();
  f.context.switchSection('vehicles');
  f.context.selectVehicle(0);
  await flush();
  assert.equal(f.navigated.length, 1);
  const destination = new URL(f.navigated[0], 'http://localhost');
  assert.equal(destination.pathname, '/transport/vehicle');
  assert.equal(JSON.parse(destination.searchParams.get('asset')), 0);
});

test('chained workflow edit survives navigation while reopening the authoritative row', async () => {
  const f = fixture();
  f.context.switchSection('dispatch', { workflowTab: 'dispatchJobs' });
  f.context.wfEdit('dispatchJobs', 'job-0');
  await flush();
  assert.equal(f.edited.length, 0, 'old document must not open an editor immediately before leaving');
  const destination = new URL(f.navigated[0], 'http://localhost');
  const next = fixture(destination.search);
  await next.context.window.tvsWeb.startRoute();
  assert.equal(next.edited[0].section, 'dispatchJobs');
  assert.equal(next.edited[0].id, 'job-0');
});

test('new-job command reaches the jobs page and creates a fresh form there', async () => {
  const f = fixture();
  f.context.switchSection('dispatch', { workflowTab: 'dispatchJobs' });
  f.context.wfEdit('dispatchJobs', null, { id: 'discarded-transient-id' });
  await flush();
  const destination = new URL(f.navigated[0], 'http://localhost');
  assert.equal(destination.searchParams.get('newJob'), '1');
  const next = fixture(destination.search);
  await next.context.window.tvsWeb.startRoute();
  assert.equal(next.newJobs.length, 1);
});

test('diagnostic record source keeps its owning vehicle and journal view', async () => {
  const f = fixture();
  f.context.platformOpenSource('records', 'record-0');
  await flush();
  const destination = new URL(f.navigated[0], 'http://localhost');
  assert.equal(destination.pathname, '/transport/vehicle');
  assert.equal(destination.searchParams.get('view'), 'journal');
  assert.equal(JSON.parse(destination.searchParams.get('asset')), 0);
});

test('an open editor prevents document navigation', async () => {
  const f = fixture(); f.block(true);
  f.context.switchSection('vehicles');
  await flush();
  assert.equal(f.navigated.length, 0);
});
