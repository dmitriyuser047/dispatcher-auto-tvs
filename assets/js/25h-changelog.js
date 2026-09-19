// Список изменений: окно «Что нового» после обновления.
//
// Источник — assets/CHANGELOG.md (он же идёт в описание релиза на GitHub).
// После обновления окно показывает версии новее той, что пользователь видел
// в прошлый раз. Открывается и вручную — по нажатию на номер версии.

const CHANGELOG_SEEN_KEY = 'changelogSeenVersion';

function clParse(md) {
  const out = [];
  let cur = null;
  String(md || '').split(/\r?\n/).forEach(line => {
    const h = /^##\s+(\d+\.\d+\.\d+)\s*(?:—\s*(.*))?$/.exec(line.trim());
    if (h) { cur = { version: h[1], date: (h[2] || '').trim(), items: [] }; out.push(cur); return; }
    const li = /^[-*]\s+(.*)$/.exec(line.trim());
    if (li && cur) cur.items.push(li[1]);
  });
  return out;
}

function clCmp(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

async function clLoad() {
  if (!window.electronAPI || !window.electronAPI.getChangelog) return [];
  try { return clParse(await window.electronAPI.getChangelog()); } catch { return []; }
}

function clText(list) {
  return list.map(e => 'Версия ' + e.version + (e.date ? ' — ' + e.date : '') + '\r\n' +
    e.items.map(i => '  • ' + i).join('\r\n')).join('\r\n\r\n');
}

// Открыть в Блокноте: файл сохраняется через загрузку браузера,
// а программа открывает скачанное сразу после сохранения
function clSaveTxt(all) {
  const list = all ? _clAll : _clShown;
  const blob = new Blob(['﻿' + 'Диспетчеризация авто — список изменений\r\n\r\n' + clText(list)], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Список_изменений.txt';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

let _clAll = [], _clShown = [];

function clShow(list, title) {
  _clShown = list;
  const body = list.map(e => `
    <div style="margin-bottom:14px">
      <div style="font-weight:800;font-size:15px">Версия ${fpEsc(e.version)}${e.date ? ` <span style="font-weight:400;color:var(--text3);font-size:13px">— ${fpEsc(e.date)}</span>` : ''}</div>
      <ul style="margin:6px 0 0 18px;padding:0">${e.items.map(i => `<li style="margin:3px 0">${fpEsc(i)}</li>`).join('')}</ul>
    </div>`).join('') || '<div style="color:var(--text3)">Список изменений пуст.</div>';
  openGenericModal(title || 'Что нового', `
    <div style="max-height:60vh;overflow:auto;padding-right:6px">${body}</div>
    <div style="display:flex;justify-content:space-between;gap:8px;margin-top:12px;flex-wrap:wrap">
      <span>
        <button class="btn btn-ghost" onclick="clSaveTxt(false)">Открыть в Блокноте</button>
        ${list.length < _clAll.length ? '<button class="btn btn-ghost" onclick="clShowAll()">Все изменения</button>' : ''}
      </span>
      <button class="btn btn-primary" onclick="closeModal('genericModal')">Понятно</button>
    </div>`, 720);
}

async function clShowAll() {
  if (!_clAll.length) _clAll = await clLoad();
  clShow(_clAll, 'Список изменений');
}

// При запуске: показать, что изменилось с прошлого раза
async function clCheckOnStart() {
  if (!window.electronAPI || !window.electronAPI.getAppVersion) return;
  const current = await window.electronAPI.getAppVersion();
  _clAll = await clLoad();
  if (!_clAll.length || !current) return;
  let seen = null;
  try { seen = localStorage.getItem(CHANGELOG_SEEN_KEY); } catch {}
  try { localStorage.setItem(CHANGELOG_SEEN_KEY, current); } catch {}
  // Первый запуск с этой функцией — показываем последние изменения целиком
  const fresh = _clAll.filter(e => clCmp(e.version, current) <= 0 && (!seen || clCmp(e.version, seen) > 0));
  if (!fresh.length) return;
  clShow(fresh, 'Что нового в версии ' + current);
}
