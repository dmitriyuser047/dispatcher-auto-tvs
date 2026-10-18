const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { trustedPage, canInvoke, staticFile } = require('../electron/security');
const { validateSettings, databaseIdentity } = require('../electron/settings');

const root = path.resolve(__dirname, '..');
test('native capabilities reject foreign pages and keep PDF studio separate from database settings', () => {
  assert.equal(trustedPage('http://127.0.0.1:1234/index.html', root, 1234), 'main');
  assert.equal(trustedPage('https://example.com/index.html', root, 1234), null);
  assert.equal(trustedPage('http://127.0.0.1:1235/index.html', root, 1234), null);
  assert.equal(trustedPage('http://127.0.0.1:1234/assets/other.html', root, 1234), null);
  assert.equal(trustedPage(pathToFileURL(path.join(root, 'pdf-editor.html')).href, root, 1234), 'pdf');
  assert.equal(canInvoke('pdf', 'pdf-studio-export'), true);
  assert.equal(canInvoke('pdf', 'save-settings'), false);
  assert.equal(canInvoke('pdf', 'write-data'), false);
  assert.equal(canInvoke('reestr', 'reestr-save-rows'), true);
  assert.equal(canInvoke('reestr', 'write-sections'), false);
  assert.equal(canInvoke('main', 'pdf-editor-save'), false);
  assert.equal(canInvoke(null, 'get-settings'), false);
  assert.equal(canInvoke('pdf', 'get-theme'), true);
});

test('HTTP assets exclude application code, database bundles and traversal', () => {
  assert.equal(staticFile(root, '/'), path.join(root, 'index.html'));
  assert.equal(staticFile(root, '/assets/js/01-core.js?v=1'), path.join(root, 'assets', 'js', '01-core.js'));
  for (const request of ['/electron/main.js', '/package.json', '/bundled-data/data-2.0.57.json', '/assets/../electron/main.js', '/assets/%2e%2e/electron/main.js', '/assets/%00.js', '/assets/%ZZ']) assert.equal(staticFile(root, request), null, request);
});

test('settings validate before persistence and connection identity includes TLS and access credentials', () => {
  const settings = { users:[{ name:'Test', dataDir:path.join(root, 'synthetic-only') }], activeUser:0, networkMode:'client', serverPort:3377, remotePort:3377, remoteHost:'127.0.0.1', networkKey:'synthetic-access-token-12345' };
  assert.equal(validateSettings(settings).remotePort, 3377);
  for (const next of [{ ...settings, remotePort:0 }, { ...settings, remoteHost:'https://example.com/' }, { ...settings, activeUser:5 }, { ...settings, networkKey:'short' }, { ...settings, remoteProtocol:'ftp:' }]) assert.throws(() => validateSettings(next));
  assert.notEqual(databaseIdentity(settings), databaseIdentity({ ...settings, remoteProtocol:'https:' }));
  assert.notEqual(databaseIdentity(settings), databaseIdentity({ ...settings, networkKey:'different-synthetic-key-12345' }));
});
