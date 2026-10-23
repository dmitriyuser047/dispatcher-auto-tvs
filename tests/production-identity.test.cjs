const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const metadata = require('../package.json');
const mainSource = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
const windowsPath = path.win32;
const roaming = 'C:\\Synthetic\\AppData\\Roaming';
const home = 'C:\\Synthetic\\Home';
const stableProfile = windowsPath.join(roaming, 'dispetcherizaciya-avto');
const stableDatabase = windowsPath.join(home, 'Documents', 'ДиспетчеризацияАвто_ТВС');

// Run only synchronous identity/settings setup. All filesystem, Electron,
// database and server objects are fake; the ready callback is never executed.
function inspectStartup({ requestedProfile = '', savedSettings = null } = {}) {
  const writes = [], reads = [], subscriptions = [], readyCallbacks = [], diagnosticObservers = [];
  const paths = { appData: roaming, userData: 'C:\\Synthetic\\UnrelatedElectronDefault' };
  let appUserModelId;
  const forbidden = () => { throw new Error('Application/database startup is forbidden in the identity test'); };
  const app = {
    commandLine: { hasSwitch: () => false, getSwitchValue: name => name === 'user-data-dir' ? requestedProfile : '' },
    setAppUserModelId: value => { appUserModelId = value; },
    setPath: (name, value) => { paths[name] = value; },
    getPath: name => { assert.ok(name in paths, name); return paths[name]; },
    requestSingleInstanceLock: () => true,
    on: (name, callback) => { subscriptions.push({ name, callback }); },
    whenReady: () => ({ then: callback => { readyCallbacks.push(callback); return { catch() {} }; } }),
    exit: forbidden, quit: forbidden,
  };
  const fakeFs = {
    existsSync: file => file === windowsPath.join(paths.userData, 'settings.json') && savedSettings !== null,
    readFileSync: file => { assert.equal(file, windowsPath.join(paths.userData, 'settings.json')); reads.push(file); return JSON.stringify(savedSettings); },
    mkdirSync: () => {},
  };
  const configuredKeys = [];
  const fakeServer = { configureKey: key => configuredKeys.push(key), configureTransport() {}, start: forbidden };
  const fakeModules = {
    electron: { app, BrowserWindow: forbidden, ipcMain: { handle: forbidden }, shell: {}, dialog: { showErrorBox: forbidden }, session: {}, Notification: forbidden },
    path: windowsPath, fs: fakeFs, os: { homedir: () => home }, http: {},
    './updater': {}, './server': fakeServer, 'node-unrar-js': {}, './storage': new Proxy({}, { get: forbidden }),
    './storage-format.cjs': require('../electron/storage-format.cjs'),
    './diagnostic-boundary.cjs': {
      configure: observer => { assert.equal(typeof observer, 'function'); diagnosticObservers.push(observer); return () => {}; },
      record: forbidden,
    },
    './settings': { writeAtomic: (file, value) => writes.push({ file, value: JSON.parse(value) }), validateSettings: value => structuredClone(value), databaseIdentity: () => 'synthetic-identity' },
    './security': {}, 'node:url': {}, './notifications': {},
    crypto: { randomBytes: () => Buffer.alloc(24, 1) },
  };
  const context = vm.createContext({
    require: name => { assert.ok(Object.hasOwn(fakeModules, name), 'Unexpected startup import: ' + name); return fakeModules[name]; },
    __dirname: 'C:\\Synthetic\\Application\\electron', console: { log() {}, warn() {}, error: forbidden },
    process: { platform: 'win32' },
  });
  vm.runInContext(mainSource + '\nglobalThis.__identity = { defaultDataDir:DEFAULT_DATA_DIR, settingsFile:SETTINGS_FILE, settings };', context);
  assert.equal(readyCallbacks.length, 1);
  assert.equal(diagnosticObservers.length, 1);
  assert.ok(subscriptions.some(row => row.name === 'window-all-closed'));
  return { ...JSON.parse(JSON.stringify(context.__identity)), paths, appUserModelId, writes, reads, configuredKeys };
}

test('production installer preserves the identity and uninstall contract of 2.0.104', () => {
  assert.equal(metadata.name, 'dispetcherizaciya-avto');
  assert.equal(metadata.build.appId, 'com.tvs.dispetcherizaciya-avto');
  assert.equal(metadata.build.productName, 'Диспетчеризация авто ООО Технрайз Велл Сервис');
  assert.equal(metadata.build.artifactName, 'Dispatcher-Setup-${version}.${ext}');
  assert.equal(metadata.build.nsis.guid, '4286bdd0-2cff-53b2-b57c-c2a89b587631');
  assert.equal(metadata.build.nsis.deleteAppDataOnUninstall, false);
  assert.match(metadata.version, /^\d+\.\d+\.\d+$/);
  assert.equal(Object.hasOwn(metadata, 'prototype'), false);
  assert.equal(metadata.build.files.some(pattern => pattern.includes('bundled-data')), false);
});

test('production startup explicitly selects the original profile, database and notification identity', () => {
  const result = inspectStartup();
  assert.equal(result.paths.userData, stableProfile);
  assert.equal(result.settingsFile, windowsPath.join(stableProfile, 'settings.json'));
  assert.equal(result.defaultDataDir, stableDatabase);
  assert.equal(result.settings.users[0].dataDir, stableDatabase);
  assert.equal(result.appUserModelId, 'com.tvs.dispetcherizaciya-avto');
});

test('an explicit user-data-dir override is honored without changing the production database default', () => {
  const override = 'C:\\Synthetic\\IsolatedTestProfile';
  const result = inspectStartup({ requestedProfile: override });
  assert.equal(result.paths.userData, override);
  assert.equal(result.settingsFile, windowsPath.join(override, 'settings.json'));
  assert.equal(result.defaultDataDir, stableDatabase);
  assert.ok(result.writes.every(write => write.file === windowsPath.join(override, 'settings.json')));
});

test('an upgrade keeps existing database profiles, the selected profile and network key', () => {
  const savedSettings = {
    users: [{ name: 'Synthetic first', dataDir: 'D:\\Synthetic\\FirstDatabase' }, { name: 'Synthetic selected', dataDir: 'D:\\Synthetic\\WorkingDatabase' }],
    activeUser: 1, networkMode: 'server', serverPort: 4401, remotePort: 3377,
    remoteHost: '', networkKey: 'synthetic-preserved-network-key', uiTheme: 'dark',
  };
  const result = inspectStartup({ savedSettings });
  assert.deepEqual(result.settings, savedSettings);
  assert.deepEqual(result.reads, [windowsPath.join(stableProfile, 'settings.json')]);
  assert.deepEqual(result.writes, []);
  assert.ok(result.configuredKeys.every(key => key === savedSettings.networkKey));
});

test('a new production profile stores defaults only through the isolated settings stub', () => {
  const result = inspectStartup();
  assert.deepEqual(result.reads, []);
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0].file, windowsPath.join(stableProfile, 'settings.json'));
  assert.equal(result.writes[0].value.networkMode, 'local');
  assert.equal(result.writes[0].value.users[0].dataDir, stableDatabase);
  assert.equal(result.writes[0].value.networkKey.length, 48);
});
