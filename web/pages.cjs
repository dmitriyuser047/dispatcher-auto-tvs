'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

// These are document routes. Every navigation requests a new HTML document;
// the existing domain editors and calculation engine are shared by the pages.
const ROUTES = Object.freeze([
  ['/objects', 'ДЭС', 'generators', 'objects'],
  ['/generators', 'Все ДЭС', 'generators'],
  ['/generators/card', 'Карточка ДЭС', 'generators', 'generator'],
  ['/transport', 'Транспорт', 'vehicles', 'fleet'],
  ['/transport/journal', 'Журнал пробега', 'vehicles', 'mileage'],
  ['/transport/vehicle', 'Карточка транспорта', 'vehicles', 'vehicle'],
  ['/dispatch', 'Диспетчерская', 'dispatch'],
  ['/logistics', 'Логистика', 'logistics', 'logistics'],
  ['/registries', 'Реестры', 'registries', 'registries'],
  ['/workflows', 'Рабочие процессы', 'workflows'],
  ['/maintenance', 'ТО и обслуживание', 'toSchedule'],
  ['/repairs', 'Журнал ремонта', 'repairs'],
  ['/fuel', 'ГСМ', 'fuelPurchases'],
  ['/fuel/tanks', 'Ёмкости', 'tanks'],
  ['/fuel/reports', 'Топливная аналитика', 'fuelReport'],
  ['/parts', 'ЗИП ДЭС', 'generatorSpares'],
  ['/people/drivers', 'Водители', 'drivers'],
  ['/people/operators', 'Операторы ДЭС', 'operators'],
  ['/people/drivers/timesheets', 'Загрузка водителей', 'driverTimesheets'],
  ['/people/operators/timesheets', 'Загрузка машинистов ДЭС', 'operatorTimesheets'],
  ['/inventory', 'Инвентаризация ОС', 'assetInventory'],
  ['/inventory/quantities', 'Количественный учёт', 'objectQuantity'],
  ['/procurement', 'Закупки', 'procurement'],
  ['/documents/invoices', 'Распознавание счетов', 'reestr'],
  ['/documents/invoices/import', 'Реестры', 'registries', 'registries'],
  ['/documents/forms', 'Печатные формы', 'printForms'],
  ['/finance', 'Финансы', 'finances'],
  ['/finance/costs', 'Стоимость работы', 'costs'],
  ['/finance/counterparties', 'Контрагенты', 'contragents'],
  ['/reports', 'Отчёты', 'reports'],
  ['/settings', 'Настройки', 'system', 'settings'],
  ['/settings/users', 'Сотрудники и доступ', 'system', 'users'],
  ['/system', 'Состояние программы', 'system'],
]);
const GROUPS = [
  ['Работа', ['/objects','/transport','/dispatch','/logistics','/maintenance','/repairs','/fuel','/fuel/tanks','/parts']],
  ['Сотрудники', ['/people/drivers','/people/operators','/people/drivers/timesheets','/people/operators/timesheets']],
  ['Учёт', ['/inventory','/inventory/quantities','/procurement','/workflows','/registries','/documents/invoices','/documents/forms','/finance','/finance/costs','/finance/counterparties','/fuel/reports','/reports']],
  ['Программа', ['/settings','/system']],
];
const byPath = new Map(ROUTES.map(([url,title,section,view]) => [url,{url,title,section,view:view || 'section'}]));
function resolveRoute(input) {
  const url = new URL(String(input || '/objects'), 'http://localhost');
  return byPath.get(url.pathname) || null;
}
function nav(route, user, demo, csrf, principal=user) {
  const groups = GROUPS.map(([label,urls]) => `<div class="tvs-web-nav-group"><div class="tvs-web-nav-label">${escape(label)}</div>${urls.map(url => {
    const item = byPath.get(url);
    const active = item.url === route.url || ['vehicle','mileage'].includes(route.view) && url === '/transport' || route.view === 'generator' && url === '/objects' || route.section === 'logistics' && url === '/logistics' || route.section === 'registries' && url === '/registries';
    return `<a href="${item.url}"${active ? ' aria-current="page"' : ''}>${escape(item.title)}</a>`;
  }).join('')}</div>`).join('');
  const users=require('./users.cjs').canManageUsers(principal)?'<div class="tvs-web-nav-group"><a href="/settings/users"'+(route.view==='users'?' aria-current="page"':'')+'>Сотрудники и доступ</a></div>':'';
  return `<aside class="tvs-web-nav" aria-label="Разделы диспетчера"><a class="tvs-web-brand" href="/objects"><span class="tvs-web-brand-mark">ТВС</span><span><strong>Диспетчер</strong><small>Технрайз Велл Сервис</small></span></a><nav class="tvs-web-nav-links">${groups}${users}</nav><div class="tvs-web-account"><strong>${escape(user?.name || 'Сотрудник')}</strong><small>${escape(demo ? 'Тестовая база' : 'Общая база компании')}</small><form action="/web-api/logout" method="post" data-web-logout><input type="hidden" name="csrf" value="${escape(csrf)}"><button class="tvs-button" type="submit">Выйти</button></form></div></aside>`;
}
function loginDocument({csrf, error, demo}) {
  return `<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="tvs-csrf" content="${escape(csrf)}"><title>Вход · Диспетчер ТВС</title><link rel="stylesheet" href="/web/public/glass.css"><script src="/web/public/login.js" defer></script></head><body class="tvs-web tvs-login"><main class="tvs-login-card"><div class="tvs-web-brand"><span class="tvs-web-brand-mark">ТВС</span><span><strong>Диспетчер</strong><small>Технрайз Велл Сервис</small></span></div><h1>Рабочее пространство</h1><p>Вход для сотрудников компании</p><form id="webLoginForm" action="/web-api/login" method="post"><label class="tvs-field">Персональный ключ доступа<input type="password" name="token" required autocomplete="current-password" maxlength="4096" autofocus></label><p id="webLoginError" role="alert">${escape(error || '')}</p><button class="tvs-button tvs-button-primary" type="submit">Войти</button></form>${demo ? '<button class="tvs-button" type="button" data-demo-login>Открыть тестовую базу</button><p>Тестовая база · рабочие данные не подключены</p>' : ''}</main></body></html>`;
}
function renderDocument({url='/objects', csrf='', user=null, principal=user, demo=false, error=''}) {
  if (!user) return loginDocument({csrf,error,demo});
  const route = resolveRoute(url);
  if (!route) return null;
  if(route.view==='users')return `<!DOCTYPE html><html lang="ru" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="tvs-csrf" content="${escape(csrf)}"><meta name="tvs-route" content="${escape(JSON.stringify(route))}"><title>Сотрудники и доступ · Диспетчер ТВС</title><link rel="stylesheet" href="/web/public/glass.css"><link rel="stylesheet" href="/web/public/users.css"><script src="/web/public/crypto.js"></script><script src="/web/public/users.js" defer></script><script src="/web/public/session.js" defer></script></head><body class="tvs-web" data-web-section="system" data-web-view="users">${nav(route,user,demo,csrf,principal)}<main class="tvs-users" data-tvs-users></main></body></html>`;
  const template = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  let sectionAssets='';
  const registryAssets='<link rel="stylesheet" href="/web/public/registries.css"><script src="/assets/core/registry-import.js"></script><script src="/assets/core/registry-counterparties.js"></script><script src="/web/public/registries.js"></script>';
  if(['registries','finances','logistics'].includes(route.section)){
    const articles=JSON.parse(fs.readFileSync(path.join(ROOT,'ReestrBuilder/statyi.json'),'utf8')).map(({code,name,label,vid})=>({code,name,label,vid}));
    const json=JSON.stringify(articles).replace(/[<>&]/g,char=>({'<':'\\u003c','>':'\\u003e','&':'\\u0026'}[char]));
    sectionAssets='<script type="application/json" id="tvs-bdds-articles">'+json+'</script><script src="/web/public/bdds.js"></script>';
  }
  if(route.section==='registries')sectionAssets+=registryAssets;
  else if(route.section==='finances')sectionAssets+='<link rel="stylesheet" href="/web/public/finance-registry.css"><script src="/assets/core/registry-import.js"></script><script src="/assets/core/registry-statistics.js"></script><script src="/web/public/finance-registry.js"></script>';
  else if(route.section==='logistics')sectionAssets+=registryAssets+'<script src="/web/public/logistics.js"></script>';
  else if(route.section==='contragents')sectionAssets='<script src="/assets/core/registry-import.js"></script><script src="/assets/core/registry-counterparties.js"></script><script src="/web/public/registry-counterparties.js"></script>';
  else if(route.section==='drivers')sectionAssets='<script src="/assets/core/registry-import.js"></script><script src="/web/public/driver-invoices.js"></script>';
  else if(['vehicles','repairs','toSchedule'].includes(route.section)||route.view==='generator')sectionAssets='<link rel="stylesheet" href="/web/public/vehicle-invoices.css"><script src="/assets/core/registry-import.js"></script><script src="/web/public/vehicle-invoices.js"></script>';
  return template
    .replace('<html lang="ru">', '<html lang="ru" data-theme="dark">')
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(route.title)} · Диспетчер ТВС</title><base href="/"><meta name="tvs-csrf" content="${escape(csrf)}"><meta name="tvs-route" content="${escape(JSON.stringify(route))}">`)
    .replace('</head>', '<link rel="stylesheet" href="/web/public/glass.css"><script src="/web/public/crypto.js"></script><script src="/web/public/bridge.js"></script>'+sectionAssets+'</head>')
    .replace('<body>', `<body class="tvs-web" data-web-section="${escape(route.section)}" data-web-view="${escape(route.view)}">${nav(route,user,demo,csrf,principal)}`)
    .replace('<h2>Выберите транспортное средство</h2>', '<h2>Подключение к общей базе</h2>')
    .replace('<p>Выберите ТС из списка слева или добавьте новое</p>', '<p role="status">Загружаем данные и проверяем доступ…</p>')
    .replace('<script src="assets/js/26-boot.js"></script>', '<script src="/web/public/navigation.js"></script><script src="assets/js/26-boot.js"></script>');
}
module.exports = {ROUTES,resolveRoute,renderDocument,escape};
