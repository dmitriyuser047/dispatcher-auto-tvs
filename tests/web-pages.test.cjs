'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ROUTES, resolveRoute, renderDocument, escape} = require('../web/pages.cjs');
const user = {id:'web-pages-user', name:'Тестовый диспетчер', role:'dispatcher'};

test('web routes have individual document addresses and preserve the full section registry', () => {
  const paths = ROUTES.map(([url]) => url);
  assert.equal(new Set(paths).size, paths.length);
  for (const [url, title, section, view] of ROUTES) {
    assert.match(url, /^\/[a-z/-]+$/);
    const route = resolveRoute(url + '?period=2026-10');
    assert.deepEqual(route, {url, title, section, view:view || 'section'});
    const html = renderDocument({url, user, csrf:'synthetic-csrf'});
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes(`<title>${escape(title)} · Диспетчер ТВС</title>`));
    assert.ok(html.includes(`data-web-section="${section}"`));
    assert.ok(html.includes(`data-web-view="${view || 'section'}"`));
    assert.ok(html.includes('name="tvs-route"'));
    assert.ok(html.includes('&quot;url&quot;:&quot;' + url + '&quot;'));
  }
  for (const required of ['/objects','/transport','/transport/journal','/dispatch','/logistics','/maintenance','/repairs','/fuel','/parts','/inventory','/inventory/quantities','/people/drivers/timesheets','/people/operators/timesheets','/procurement','/documents/invoices','/documents/forms','/finance','/reports']) {
    assert.ok(paths.includes(required), required);
  }
});

test('web navigation uses ordinary document links with a current route', () => {
  const html = renderDocument({url:'/transport/journal?vehicle=0', user});
  const nav = /<aside class="tvs-web-nav"[\s\S]*?<\/aside>/.exec(html)?.[0];
  assert.ok(nav);
  assert.doesNotMatch(nav, /href="\/transport\/journal"/);
  assert.match(nav, /<a href="\/transport" aria-current="page">Транспорт<\/a>/);
  const hrefs = [...nav.matchAll(/<a[^>]+href="([^"]+)"/g)].map(match => match[1]);
  assert.ok(hrefs.length > 15);
  assert.ok(hrefs.every(href => href.startsWith('/') && !href.includes('#')));
  assert.ok(hrefs.every(href => resolveRoute(href)));
  assert.equal((nav.match(/aria-current="page"/g) || []).length, 1);
  assert.match(renderDocument({url:'/transport/vehicle?id=0',user}), /<a href="\/transport" aria-current="page">Транспорт<\/a>/);
});

test('web pages retain domain editors and load the browser bridge before application startup', () => {
  const html = renderDocument({url:'/objects', user});
  const bridge = html.indexOf('<script src="/web/public/bridge.js"></script>');
  const core = html.indexOf('<script src="assets/js/01-core.js"></script>');
  const navigation = html.indexOf('<script src="/web/public/navigation.js"></script>');
  const boot = html.indexOf('<script src="assets/js/26-boot.js"></script>');
  assert.ok(bridge >= 0 && core > bridge && navigation > core && boot > navigation);
  assert.equal((html.match(/src="\/web\/public\/navigation\.js"/g) || []).length, 1);
  assert.match(html, /<base href="\/">/);
  for (const id of ['mainContent','vehicleModal','recordModal']) assert.ok(html.includes(`id="${id}"`), id);
  for (const module of ['application-engine.js','platform-commands.js','generator-maintenance.js','asset-inventory.js']) {
    assert.ok(html.includes('assets/core/' + module), module);
  }
  const maintenance = renderDocument({url:'/maintenance', user});
  const maintenanceController = maintenance.indexOf('src="assets/js/68-generator-maintenance.js"');
  const maintenanceSetup = maintenance.indexOf('src="assets/js/68c-generator-maintenance-setup.js"');
  assert.ok(maintenanceController > 0 && maintenanceSetup > maintenanceController);
  assert.ok(maintenanceSetup < maintenance.indexOf('src="/web/public/navigation.js"'));
  assert.equal((maintenance.match(/src="assets\/js\/68c-generator-maintenance-setup\.js"/g) || []).length, 1);
  const registry=renderDocument({url:'/logistics',user});
  assert.match(registry,/data-web-view="logistics"/);
  assert.match(registry,/data-web-section="logistics"/);
  assert.match(registry,/href="\/logistics" aria-current="page">Логистика/);
  assert.doesNotMatch(registry,/href="\/documents\/invoices" aria-current="page"/);
  assert.match(renderDocument({url:'/documents/invoices/import',user}),/href="\/registries" aria-current="page">Реестры/);
  assert.match(registry,/src="\/web\/public\/logistics\.js"/);
  assert.match(registry,/src="\/assets\/core\/registry-import\.js"/);
  assert.match(registry,/src="\/assets\/core\/registry-accounting\.js"/);
  assert.match(registry,/src="\/web\/public\/registries\.js"/);
  const registryList=renderDocument({url:'/registries',user});
  assert.match(registryList,/data-web-section="registries"/);
  assert.match(registryList,/data-web-view="registries"/);
  assert.ok(registryList.indexOf('src="/assets/core/registry-import.js"')<registryList.indexOf('src="/web/public/registries.js"'));
  assert.doesNotMatch(registryList,/src="\/web\/public\/logistics\.js"/);
  assert.doesNotMatch(renderDocument({url:'/documents/invoices',user}),/src="\/web\/public\/(?:registry|registries|logistics)\.js"/);
});

test('names, CSRF metadata and errors are escaped without rendering arbitrary user fields', () => {
  const malicious = '\"><img src=x onerror=alert(1)></script>&\'';
  const html = renderDocument({url:'/objects', user:{...user,name:malicious,token:'never-render-this-credential'},csrf:malicious});
  assert.ok(html.includes(escape(malicious)));
  assert.ok(!html.includes(malicious));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('never-render-this-credential'));
  assert.ok(html.includes('<meta name="tvs-csrf" content="' + escape(malicious) + '">'));
  const login = renderDocument({url:'/login',user:null,csrf:malicious,error:malicious});
  assert.ok(login.includes('<p id="webLoginError" role="alert">' + escape(malicious) + '</p>'));
  assert.ok(!login.includes('<img src=x'));
});

test('anonymous visitors receive the login document and unknown authenticated routes are rejected', () => {
  const login = renderDocument({url:'/finance', user:null});
  assert.match(login, /id="webLoginForm"/);
  assert.match(login, /name="token"/);
  assert.match(login, /type="password"/);
  assert.ok(!login.includes('class="tvs-web-nav"'));
  assert.ok(!login.includes('assets/js/01-core.js'));
  assert.ok(!login.includes('Тестовая база · рабочие данные не подключены'));
  const demoLogin = renderDocument({url:'/login',user:null,demo:true});
  assert.match(demoLogin, /Тестовая база · рабочие данные не подключены/);
  for (const url of ['/missing','/index.html','/electron/server.js','/objects/','/transport/unknown']) {
    assert.equal(resolveRoute(url), null);
    assert.equal(renderDocument({url,user}), null);
  }
});
