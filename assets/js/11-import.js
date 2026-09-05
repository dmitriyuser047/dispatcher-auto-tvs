// Импорт из XLS, топливных карт, RAR, JSON, PDF; экспорт данных ДЭС
// Выделено из index.html

// ─── IMPORT FROM XLS ────────────────────────────────────
function importVehiclesFromXls(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      // Ищем строку-заголовок (содержит "Марка" или "Гос")
      let headerRow = -1;
      for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const row = rows[i].map(c => String(c).toLowerCase());
        if (row.some(c => c.includes('марка') || c.includes('гос'))) {
          headerRow = i;
          break;
        }
      }
      if (headerRow === -1) {
        alert('Не удалось найти строку с заголовками. Убедитесь, что файл содержит колонки: Марка ТС, Гос. №, Ф.И.О. водителя...');
        return;
      }

      // Маппинг заголовков на поля
      const headers = rows[headerRow].map(c => String(c).trim().toLowerCase());
      function col(keywords) {
        const idx = headers.findIndex(h => keywords.some(k => h.includes(k)));
        return idx === -1 ? null : idx;
      }

      const colMap = {
        make:          col(['марка']),
        plate:         col(['гос']),
        driver:        col(['ф.и.о', 'фио', 'водител']),
        org:           col(['организац', 'исполнит']),
        object:        col(['объект']),
        justification: col(['обоснован']),
        responsible:   col(['ответствен']),
        status:        col(['состоян']),
        fuelcard:      col(['топливн', 'карт']),
      };

      let added = 0, skipped = 0;
      const dataRows = rows.slice(headerRow + 1);

      dataRows.forEach(row => {
        const get = (field) => {
          const i = colMap[field];
          return i !== null && i !== undefined ? String(row[i] ?? '').trim() : '';
        };

        const make  = get('make');
        const plate = get('plate');
        if (!make && !plate) return; // пустая строка

        // Проверяем дубликат по госномеру
        if (plate && data.vehicles.some(v => v.plate.toLowerCase() === plate.toLowerCase())) {
          skipped++;
          return;
        }

        data.vehicles.push({
          id:            'v_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          make,
          plate,
          driver:        get('driver'),
          org:           get('org'),
          object:        get('object'),
          justification: get('justification'),
          responsible:   get('responsible'),
          status:        get('status'),
          fuelcard:      get('fuelcard'),
          fuel:          'diesel',
          norm:          null,
          note:          '',
        });
        added++;
      });

      if (added === 0 && skipped === 0) {
        alert('В файле не найдено строк с данными.');
        return;
      }

      saveData(data);
      renderVehicleList();

      let msg = `Импорт завершён: добавлено ${added} ТС.`;
      if (skipped > 0) msg += `\nПропущено дубликатов (по госномеру): ${skipped}.`;
      alert(msg);
    } catch(err) {
      alert('Ошибка при чтении файла: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ─── ИМПОРТ ЗАПРАВОК ИЗ ОТЧЁТА ПО ТОПЛИВНЫМ КАРТАМ ──────
function importFuelFromXls(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });

      let headerRow = -1;
      for (let i = 0; i < Math.min(rows.length, 15); i++) {
        const row = rows[i].map(c => String(c).toLowerCase());
        if (row.some(c => c.includes('количество')) && row.some(c => c.includes('транзакци'))) {
          headerRow = i;
          break;
        }
      }
      if (headerRow === -1) {
        alert('Не удалось найти заголовки отчёта по топливным картам.\nОжидаются столбцы: Дата транзакции, Количество, Тип транзакции, Комментарий.');
        return;
      }

      const headers = rows[headerRow].map(c => String(c).trim().toLowerCase());
      function col(keywords) {
        return headers.findIndex(h => keywords.some(k => h.includes(k)));
      }
      const cDate    = col(['дата транзакц']);
      const cType    = col(['тип транзакц']);
      const cQty     = col(['количество']);
      const cFuel    = col(['товар']);
      const cComment = col(['комментар']);
      const cCard    = col(['номер карт']);

      if (cDate === -1 || cQty === -1) {
        alert('Не найдены обязательные столбцы: Дата транзакции, Количество.');
        return;
      }

      const transactions = [];
      for (let i = headerRow + 1; i < rows.length; i++) {
        const row = rows[i];
        const typeVal = cType !== -1 ? String(row[cType] || '').trim() : '';
        if (typeVal && typeVal.toLowerCase() !== 'покупка') continue;

        const qty = parseFloat(String(row[cQty] || '0').replace(',', '.'));
        if (!qty || qty <= 0) continue;

        let dateVal = row[cDate];
        if (!dateVal) continue;
        let parsedDate = null;
        if (dateVal instanceof Date) {
          const y = dateVal.getFullYear();
          const m = String(dateVal.getMonth() + 1).padStart(2, '0');
          const d = String(dateVal.getDate()).padStart(2, '0');
          parsedDate = y + '-' + m + '-' + d;
        } else if (typeof dateVal === 'number') {
          const dt = new Date(Math.round((dateVal - 25569) * 86400 * 1000));
          const y = dt.getFullYear();
          const m = String(dt.getMonth() + 1).padStart(2, '0');
          const d = String(dt.getDate()).padStart(2, '0');
          parsedDate = y + '-' + m + '-' + d;
        } else {
          const s = String(dateVal);
          const m1 = s.match(/(\d{4})-(\d{2})-(\d{2})/);
          if (m1) parsedDate = m1[1] + '-' + m1[2] + '-' + m1[3];
          else {
            const m2 = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
            if (m2) parsedDate = m2[3] + '-' + m2[2] + '-' + m2[1];
          }
        }
        if (!parsedDate) continue;

        const comment = cComment !== -1 ? String(row[cComment] || '').trim() : '';
        const cardNo  = cCard !== -1 ? String(row[cCard] || '').trim() : '';
        const fuel    = cFuel !== -1 ? String(row[cFuel] || '').trim() : '';

        let plate = '';
        if (comment) {
          const pm = comment.match(/^([А-ЯЁа-яё]\d{3}[А-ЯЁа-яё]{2})/);
          if (pm) plate = pm[1].toUpperCase();
        }

        transactions.push({ date: parsedDate, qty, plate, cardNo, fuel, comment });
      }

      if (!transactions.length) {
        alert('В файле не найдено транзакций типа «Покупка» с ненулевым количеством.');
        return;
      }

      function matchVehicle(tx) {
        if (tx.plate) {
          const p = tx.plate.toLowerCase();
          const v = data.vehicles.find(v => (v.plate || '').toLowerCase().replace(/\s/g, '').includes(p));
          if (v) return v;
        }
        if (tx.cardNo) {
          const cn = tx.cardNo.replace(/\s/g, '');
          const v = data.vehicles.find(v => (v.fuelcard || '').replace(/\s/g, '') === cn);
          if (v) return v;
        }
        if (tx.comment) {
          const cLow = tx.comment.toLowerCase();
          const v = data.vehicles.find(v => {
            const p = (v.plate || '').toLowerCase().replace(/\s/g, '');
            return p && cLow.includes(p);
          });
          if (v) return v;
        }
        return null;
      }

      let added = 0, updated = 0, skipped = 0, duplicates = 0;
      const unmatched = new Set();

      const groupedByVehicleDate = {};
      transactions.forEach(tx => {
        const v = matchVehicle(tx);
        if (!v) {
          unmatched.add(tx.comment || tx.cardNo || 'неизвестно');
          skipped++;
          return;
        }
        const key = v.id + '|' + tx.date;
        if (!groupedByVehicleDate[key]) groupedByVehicleDate[key] = { v, date: tx.date, totalQty: 0, fuels: [] };
        groupedByVehicleDate[key].totalQty += tx.qty;
        groupedByVehicleDate[key].fuels.push(tx.fuel + ' ' + tx.qty + 'л');
      });

      Object.values(groupedByVehicleDate).forEach(grp => {
        const existing = (data.records || []).find(r =>
          r.vehicleId === grp.v.id && r.date === grp.date
        );

        if (existing) {
          if (existing.fuelIssued && Math.abs(existing.fuelIssued - grp.totalQty) < 0.01) {
            duplicates++;
            return;
          }
          if (existing.fuelIssued && existing.note && existing.note.includes('заправка')) {
            duplicates++;
            return;
          }
          existing.fuelIssued = (existing.fuelIssued || 0) + grp.totalQty;
          if (!existing.note) existing.note = '';
          if (!existing.note.includes('заправка')) {
            existing.note = (existing.note ? existing.note + '; ' : '') + grp.fuels.join(', ');
          }
          updated++;
        } else {
          if (!data.records) data.records = [];
          data.records.push({
            id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            vehicleId: grp.v.id,
            date: grp.date,
            km: 0,
            fuelIssued: grp.totalQty,
            note: 'заправка: ' + grp.fuels.join(', '),
          });
          added++;
        }
      });

      saveData(data);
      const v = data.vehicles.find(x => x.id === selectedVehicleId);
      if (v) renderDetail(v);

      let msg = `Импорт заправок завершён.\n\nДобавлено записей: ${added}\nОбновлено записей: ${updated}`;
      if (duplicates > 0) msg += `\nУже загружено (пропущено): ${duplicates}`;
      if (skipped > 0) {
        msg += `\nНе найдено ТС: ${skipped}`;
        const unmArr = [...unmatched].slice(0, 5);
        msg += '\n\nНе удалось сопоставить:\n' + unmArr.join('\n');
        if (unmatched.size > 5) msg += '\n...и ещё ' + (unmatched.size - 5);
      }
      alert(msg);
    } catch(err) {
      alert('Ошибка при чтении файла: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ─── ИМПОРТ ИЗ RAR (пополнение данных) ───────────────────
const RAR_KEYS = ['vehicles', 'records', 'generators', 'genRecords', 'toRecords', 'tanks', 'tankIncomes'];
const RAR_LABELS = { vehicles:'ТС', records:'записей о поездках', generators:'ДЭС', genRecords:'записей ДЭС', toRecords:'записей ТО', tanks:'ёмкостей', tankIncomes:'записей прихода' };
let _rarImport = null;

async function importFromRar() {
  if (!window.electronAPI || !window.electronAPI.importRar) {
    alert('Импорт из RAR доступен только в установленном приложении.');
    return;
  }
  let res;
  try { res = await window.electronAPI.importRar(); }
  catch (e) { alert('Ошибка при чтении архива: ' + e.message); return; }
  if (!res || res.canceled) return;
  if (!res.ok) { alert('Не удалось прочитать архив: ' + (res.error || 'неизвестная ошибка')); return; }
  showImportPreview(res);
}

// Импорт «сырого» JSON-файла (например, экспорт ДЭС из другого приложения) —
// тот же предпросмотр и то же безопасное слияние по ID, что и для RAR.
async function importFromJsonFile() {
  if (!window.electronAPI || !window.electronAPI.importJsonFile) {
    alert('Импорт из файла доступен только в установленном приложении.');
    return;
  }
  let fileRes;
  try { fileRes = await window.electronAPI.importJsonFile(); }
  catch (e) { alert('Ошибка при чтении файла: ' + e.message); return; }
  if (!fileRes || fileRes.canceled) return;
  if (!fileRes.ok) { alert('Не удалось прочитать файл: ' + (fileRes.error || 'неизвестная ошибка')); return; }
  let obj;
  try { obj = JSON.parse(fileRes.content); }
  catch (e) { alert('Файл повреждён или это не JSON: ' + e.message); return; }
  const main = {};
  RAR_KEYS.forEach(k => { main[k] = Array.isArray(obj[k]) ? obj[k] : []; });
  showImportPreview({ ok: true, fileName: fileRes.fileName, backupCount: 0, main, backupExtra: {} });
}

// ─── ИМПОРТ ИЗ СВОДКИ (PDF) ──────────────────────────────
let _svodkaParsed = null;

async function importSvodkaPdf() {
  if (!window.electronAPI || !window.electronAPI.importSvodkaPdf) {
    alert('Импорт из PDF доступен только в установленном приложении.');
    return;
  }
  showToast('Загрузка PDF…');
  let res;
  try { res = await window.electronAPI.importSvodkaPdf(); }
  catch (e) { alert('Ошибка при чтении PDF: ' + e.message); return; }
  if (!res || !res.ok) {
    if (res && res.error) alert('Ошибка: ' + res.error);
    return;
  }

  const rows = parseSvodkaItems(res.items);
  if (!rows.length) {
    alert('Не удалось распознать данные в PDF. Убедитесь, что это файл Сводки по транспортным средствам.');
    return;
  }

  _svodkaParsed = rows;
  showSvodkaPreview(rows, res.fileName);
}

function parseSvodkaItems(items) {
  const sorted = items.slice().sort((a, b) => {
    const pageDiff = (a.page || 1) - (b.page || 1);
    if (pageDiff !== 0) return pageDiff;
    const dy = b.y - a.y;
    if (Math.abs(dy) > 3) return dy;
    return a.x - b.x;
  });

  const lines = [];
  let cur = null;
  for (const it of sorted) {
    const y = it.y;
    if (!cur || Math.abs(cur.y - y) > 3 || (it.page || 1) !== cur.page) {
      cur = { y, page: it.page || 1, parts: [it] };
      lines.push(cur);
    } else {
      cur.parts.push(it);
    }
  }
  for (const line of lines) {
    line.parts.sort((a, b) => a.x - b.x);
    line.text = line.parts.map(p => p.str).join(' ');
  }

  let headerLine = -1;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const t = lines[i].text.toLowerCase();
    if (t.includes('госномер') && (t.includes('марка') || t.includes('модель'))) {
      headerLine = i;
      break;
    }
  }
  if (headerLine === -1) return [];

  const hLine = lines[headerLine];
  const hParts = hLine.parts;
  const hAll = [];
  for (let li = headerLine; li < Math.min(headerLine + 3, lines.length); li++) {
    for (const p of lines[li].parts) hAll.push(p);
  }

  const colDefs = [
    { key: 'num',    words: ['№'] },
    { key: 'plate',  words: ['госномер'] },
    { key: 'make',   words: ['марка', 'модель'] },
    { key: 'driver', words: ['водител'] },
    { key: 'org',    words: ['организац'] },
    { key: 'object', words: ['объект'] },
    { key: 'fuel',   words: ['топлив'] },
    { key: 'status', words: ['состоян'] },
    { key: 'km',     words: ['пробег'] },
    { key: 'issued', words: ['выдано'] },
    { key: 'norm',   words: ['норм'] },
    { key: 'actual', words: ['факт'] },
    { key: 'avg',    words: ['ср.расх', 'средн', 'ср.'] },
    { key: 'route',  words: ['маршрут'] },
    { key: 'note',   words: ['примечан'] },
  ];

  const colBounds = [];
  for (const def of colDefs) {
    let found = null;
    for (const w of def.words) {
      found = hAll.find(p => p.str.toLowerCase().includes(w));
      if (found) break;
    }
    colBounds.push({ name: def.key, x: found ? found.x : -1 });
  }
  colBounds.sort((a, b) => a.x - b.x);

  let periodDate = null;
  for (let i = 0; i <= headerLine; i++) {
    const t = lines[i].text;
    const m = t.match(/(\d{2}\.\d{2}\.\d{4})/);
    if (m) {
      const parts = m[1].split('.');
      periodDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
      break;
    }
  }

  function getCellText(line, colIdx) {
    if (colBounds[colIdx].x === -1) return '';
    const xStart = colBounds[colIdx].x - 5;
    const xEnd = colIdx + 1 < colBounds.length && colBounds[colIdx + 1].x !== -1
      ? colBounds[colIdx + 1].x - 5
      : 99999;
    return line.parts
      .filter(p => p.x >= xStart && p.x < xEnd)
      .map(p => p.str).join(' ').trim();
  }

  function colIndex(name) {
    return colBounds.findIndex(c => c.name === name);
  }

  const rows = [];
  for (let i = headerLine + 1; i < lines.length; i++) {
    const line = lines[i];
    const txt = line.text.trim();
    if (!txt) continue;
    if (txt.startsWith('Объект:') || txt.startsWith('ИТОГО') || txt.includes('СВОДКА')) continue;
    if (txt.toLowerCase().includes('дата выпуска') || txt.toLowerCase().includes('период:')) continue;

    const numText = getCellText(line, colIndex('num'));
    const num = parseInt(numText);
    if (!num || num < 1 || num > 999) continue;

    const plate = getCellText(line, colIndex('plate')).replace(/\s+/g, '');
    if (!plate) continue;

    const make = getCellText(line, colIndex('make'));
    const driver = getCellText(line, colIndex('driver'));
    const org = getCellText(line, colIndex('org'));
    const object = getCellText(line, colIndex('object'));
    const fuelText = getCellText(line, colIndex('fuel'));
    const status = getCellText(line, colIndex('status'));
    const kmText = getCellText(line, colIndex('km'));
    const issuedText = getCellText(line, colIndex('issued'));
    const normText = getCellText(line, colIndex('norm'));
    const actualText = getCellText(line, colIndex('actual'));
    const avgText = getCellText(line, colIndex('avg'));
    const route = getCellText(line, colIndex('route'));
    const note = getCellText(line, colIndex('note'));

    const parseFl = (s) => { const v = parseFloat(String(s).replace(',', '.')); return isNaN(v) ? 0 : v; };
    let fuel = 'diesel';
    const ft = fuelText.toLowerCase();
    if (ft.includes('бензин') || ft.includes('аи')) fuel = 'gasoline';
    else if (ft.includes('газ') || ft.includes('пропан')) fuel = 'gas';

    rows.push({
      num, plate, make, driver, org, object, fuel, fuelText, status,
      km: parseFl(kmText), fuelIssued: parseFl(issuedText),
      fuelUsed: parseFl(normText), fuelActual: parseFl(actualText),
      avgConsumption: parseFl(avgText),
      route, note, date: periodDate,
    });
  }
  return rows;
}

function showSvodkaPreview(rows, fileName) {
  const existing = new Set(data.vehicles.map(v => normPlate(v.plate)));
  let newCount = 0, updateCount = 0;
  rows.forEach(r => {
    if (existing.has(normPlate(r.plate))) updateCount++;
    else newCount++;
  });

  document.getElementById('svodkaImportTitle').textContent = 'Импорт из Сводки (PDF)';
  let info = '<b>Файл:</b> ' + _pdfEsc(fileName) + '<br>';
  info += '<b>Дата:</b> ' + (rows[0] && rows[0].date ? fmtDate(rows[0].date) : '—') + '<br>';
  info += '<b>Найдено ТС:</b> ' + rows.length;
  if (newCount) info += ' (<span style="color:#16a34a;font-weight:600">+' + newCount + ' новых</span>)';
  if (updateCount) info += ' (<span style="color:#2563eb;font-weight:600">' + updateCount + ' обновление</span>)';
  document.getElementById('svodkaImportInfo').innerHTML = info;

  let html = '<thead><tr><th>✓</th><th>№</th><th>Госномер</th><th>Марка</th><th>Водитель</th><th>Объект</th><th>Топливо</th><th>Состояние</th><th>Пробег</th><th>Выдано</th><th>Расход</th><th>Маршрут</th><th>Статус</th></tr></thead><tbody>';
  rows.forEach((r, i) => {
    const isNew = !existing.has(normPlate(r.plate));
    const badge = isNew
      ? '<span style="color:#16a34a;font-weight:600">Новое ТС</span>'
      : '<span style="color:#2563eb">Обновление</span>';
    html += '<tr>';
    html += '<td><input type="checkbox" class="svodka-chk" data-idx="' + i + '" checked style="width:auto;accent-color:var(--accent)"></td>';
    html += '<td>' + r.num + '</td>';
    html += '<td><b>' + _pdfEsc(r.plate) + '</b></td>';
    html += '<td>' + _pdfEsc(r.make) + '</td>';
    html += '<td>' + _pdfEsc(r.driver) + '</td>';
    html += '<td>' + _pdfEsc(r.object) + '</td>';
    html += '<td>' + _pdfEsc(r.fuelText) + '</td>';
    html += '<td>' + _pdfEsc(r.status) + '</td>';
    html += '<td>' + r.km + '</td>';
    html += '<td>' + r.fuelIssued + '</td>';
    html += '<td>' + r.fuelActual + '</td>';
    html += '<td>' + _pdfEsc(r.route || '—') + '</td>';
    html += '<td>' + badge + '</td>';
    html += '</tr>';
  });
  html += '</tbody>';
  document.getElementById('svodkaPreviewTable').innerHTML = html;
  openModal('svodkaImportModal');
}

function normPlate(s) {
  return (s || '').replace(/[\s\-]/g, '').toUpperCase();
}

function doSvodkaImport() {
  if (!_svodkaParsed || !_svodkaParsed.length) return;
  const checked = new Set();
  document.querySelectorAll('.svodka-chk:checked').forEach(el => checked.add(+el.dataset.idx));
  if (!checked.size) { alert('Не выбрано ни одного ТС.'); return; }

  const plateMap = {};
  data.vehicles.forEach(v => { plateMap[normPlate(v.plate)] = v; });

  let addedV = 0, updatedV = 0, addedR = 0, skippedR = 0;
  const fuelLabelsRev = { 'бензин': 'gasoline', 'дизель': 'diesel', 'дизельное': 'diesel', 'газ': 'gas' };

  _svodkaParsed.forEach((r, idx) => {
    if (!checked.has(idx)) return;
    const np = normPlate(r.plate);
    let v = plateMap[np];

    if (!v) {
      v = {
        id: 'v_' + Date.now() + '_' + idx,
        plate: r.plate,
        make: r.make,
        driver: r.driver || '',
        org: r.org || '',
        object: r.object || '',
        fuel: r.fuel,
        status: r.status || '',
        norm: r.avgConsumption || null,
        note: r.note || '',
      };
      data.vehicles.push(v);
      plateMap[np] = v;
      addedV++;
    } else {
      if (r.driver && r.driver !== 'Без водителя') v.driver = r.driver;
      if (r.org) v.org = r.org;
      if (r.object) v.object = r.object;
      if (r.status) v.status = r.status;
      if (r.fuel) v.fuel = r.fuel;
      if (r.avgConsumption > 0) v.norm = r.avgConsumption;
      updatedV++;
    }

    if (r.date && (r.km > 0 || r.fuelIssued > 0 || r.fuelActual > 0)) {
      const alreadyExists = data.records.some(rec =>
        rec.vehicleId === v.id && rec.date === r.date && Math.abs((rec.km || 0) - r.km) < 0.1
      );
      if (!alreadyExists) {
        const routes = r.route ? r.route.replace(/^\d{2}\.\d{2}\.\d{4}:\s*/, '').split(/;\s*/).filter(Boolean) : [];
        data.records.push({
          id: 'r_' + Date.now() + '_' + idx,
          vehicleId: v.id,
          date: r.date,
          km: r.km,
          fuelIssued: r.fuelIssued || null,
          fuelUsed: r.fuelUsed || null,
          fuelActual: r.fuelActual || null,
          route: routes.length ? routes : null,
          note: r.note || '',
        });
        addedR++;
      } else {
        skippedR++;
      }
    }
  });

  saveData(data);
  closeModal('svodkaImportModal');
  populateOrgSelect();
  renderVehicleList();

  let msg = 'Импорт завершён.';
  if (addedV) msg += '\nНовых ТС: ' + addedV;
  if (updatedV) msg += '\nОбновлено ТС: ' + updatedV;
  if (addedR) msg += '\nДобавлено записей: ' + addedR;
  if (skippedR) msg += '\nПропущено (уже есть): ' + skippedR;
  alert(msg);
  _svodkaParsed = null;
}

// Экспорт данных ДЭС (генераторы, записи, ТО, ёмкости, приход) в JSON —
// для переноса на отдельный компьютер с приложением ДЭС.
const DES_KEYS = ['generators', 'genRecords', 'toRecords', 'tanks', 'tankIncomes'];
async function exportDesForOtherComputer() {
  if (!window.electronAPI || !window.electronAPI.exportJson) {
    alert('Экспорт доступен только в установленном приложении.');
    return;
  }
  const payload = {};
  DES_KEYS.forEach(k => { payload[k] = data[k] || []; });
  const d = new Date();
  const ds = `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getFullYear()}`;
  const res = await window.electronAPI.exportJson(JSON.stringify(payload), `ДЭС_экспорт_${ds}.json`);
  if (res && res.ok) showToast('Файл сохранён: ' + res.filePath);
}

function showImportPreview(res) {
  _rarImport = res;

  // Сколько новых / уже существующих элементов относительно текущей базы
  const curIds = {};
  RAR_KEYS.forEach(k => curIds[k] = new Set((data[k] || []).map(x => x && x.id).filter(Boolean)));
  const countSplit = (src) => {
    const n = {}, e = {};
    RAR_KEYS.forEach(k => {
      const items = (src[k] || []).filter(it => it && it.id);
      n[k] = items.filter(it => !curIds[k].has(it.id)).length;
      e[k] = items.filter(it => curIds[k].has(it.id)).length;
    });
    return { n, e };
  };
  const mainSplit = countSplit(res.main);
  const backSplit = countSplit(res.backupExtra || {});
  const mainNew = mainSplit.n, backNew = backSplit.n;
  const totalMainExisting = RAR_KEYS.reduce((s, k) => s + mainSplit.e[k], 0);

  let html = '<div style="margin-bottom:8px"><b>Файл:</b> ' + _pdfEsc(res.fileName) + '</div>';
  html += '<div style="margin-bottom:6px">Новых данных для добавления (из data.json):</div><ul style="margin:0 0 0 18px;padding:0">';
  let anyMain = false;
  RAR_KEYS.forEach(k => { if (mainNew[k] > 0) { html += '<li>' + RAR_LABELS[k] + ': <b>' + mainNew[k] + '</b></li>'; anyMain = true; } });
  if (!anyMain) html += '<li style="color:var(--text3)">нет новых записей — всё уже есть в базе</li>';
  html += '</ul>';
  if (totalMainExisting > 0) {
    html += '<div style="margin-top:6px;color:var(--text3)">Уже есть в базе (по ID): <b>' + totalMainExisting + '</b> — не изменятся.</div>';
  }
  document.getElementById('rarImportInfo').innerHTML = html;

  const totalBackNew = RAR_KEYS.reduce((s, k) => s + backNew[k], 0);
  const wrap = document.getElementById('rarBackupWrap');
  document.getElementById('rarIncludeBackups').checked = false;
  if (res.backupCount > 0 && totalBackNew > 0) {
    wrap.style.display = 'flex';
    document.getElementById('rarBackupLabel').textContent =
      'Также добавить записи из бэкапов (+' + totalBackNew + ' из ' + res.backupCount + ' файлов)';
  } else {
    wrap.style.display = 'none';
  }

  openModal('rarImportModal');
}

function doRarMerge() {
  if (!_rarImport) return;
  const includeBackups = document.getElementById('rarIncludeBackups').checked;
  RAR_KEYS.forEach(k => { if (!Array.isArray(data[k])) data[k] = []; });
  const byId = {};
  RAR_KEYS.forEach(k => { byId[k] = {}; data[k].forEach(x => { if (x && x.id) byId[k][x.id] = x; }); });
  const added = {}, updated = {};
  RAR_KEYS.forEach(k => { added[k] = 0; updated[k] = 0; });
  const mergeSrc = (src) => {
    RAR_KEYS.forEach(k => {
      (src[k] || []).forEach(item => {
        const id = item && item.id;
        if (!id) return;
        const existing = byId[k][id];
        if (existing) return;
        data[k].push(item);
        byId[k][id] = item;
        added[k]++;
      });
    });
  };
  // Бэкапы внутри архива — это более старые снимки данных. Они могут только
  // дополнять отсутствующие записи, но никогда не должны перезаписывать уже
  // существующие (иначе более свежие правки молча затираются старыми значениями).
  mergeSrc(_rarImport.main);
  if (includeBackups) mergeSrc(_rarImport.backupExtra);

  saveData(data);
  populateOrgSelect();
  updateFilterUI();
  renderVehicleList();
  if (typeof renderGeneratorList === 'function') renderGeneratorList();
  if (typeof renderTankList === 'function') renderTankList();
  closeModal('rarImportModal');

  const totalAdded = RAR_KEYS.reduce((s, k) => s + added[k], 0);
  const totalUpdated = RAR_KEYS.reduce((s, k) => s + updated[k], 0);
  let msg = '';
  if (totalAdded > 0) {
    msg += 'Добавлено:\n';
    RAR_KEYS.forEach(k => { if (added[k] > 0) msg += '• ' + RAR_LABELS[k] + ': ' + added[k] + '\n'; });
  }
  if (totalUpdated > 0) {
    msg += (msg ? '\n' : '') + 'Обновлено:\n';
    RAR_KEYS.forEach(k => { if (updated[k] > 0) msg += '• ' + RAR_LABELS[k] + ': ' + updated[k] + '\n'; });
  }
  if (!msg) msg = 'Новых данных не найдено — всё уже есть в базе.';
  _rarImport = null;
  alert(msg.trim());
}

