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
  reader.onload = async function(e) {
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
      const cVehicle = col(['тс', 'транспорт', 'авто']);

      if (cDate === -1 || cQty === -1) {
        alert('Не найдены обязательные столбцы: Дата транзакции, Количество.');
        return;
      }

      const plateChars = {
        A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н',
        O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х',
      };
      const normalizePlate = (s) => String(s || '')
        .toUpperCase()
        .replace(/[ABEKMHOPCTYX]/g, ch => plateChars[ch] || ch)
        .replace(/[^АВЕКМНОРСТУХ0-9]/g, '');
      const normalizeCard = (s) => String(s || '').replace(/\D/g, '');
      const normalizeText = (s) => String(s || '').trim().replace(/\s+/g, ' ');
      const normalizeLooseText = (s) => normalizeText(s)
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/э/g, 'е');
      const extractPlate = (text) => {
        const src = String(text || '').toUpperCase().replace(/[ABEKMHOPCTYX]/g, ch => plateChars[ch] || ch);
        const m = src.match(/[АВЕКМНОРСТУХ]\s*\d{3}\s*[АВЕКМНОРСТУХ]{2}\s*\d{0,3}|\d{3,5}\s*[АВЕКМНОРСТУХ]{1,3}\s*\d{0,3}/);
        return m ? normalizePlate(m[0]) : '';
      };
      const matchVehicleByLooseText = (text) => {
        const raw = normalizeText(text);
        if (!raw) return null;
        const low = normalizeLooseText(raw);
        const compact = normalizePlate(raw);
        const digitChunks = raw.match(/\d{3,6}/g) || [];

        return data.vehicles.find(v => {
          const vp = normalizePlate(v.plate);
          if (vp && compact.includes(vp)) return true;

          const vDigits = (vp.match(/\d+/g) || []).join('');
          const hasVehicleDigits = vDigits && digitChunks.includes(vDigits);
          if (!hasVehicleDigits) return false;

          const makeWords = normalizeLooseText(v.make)
            .split(/[^a-zа-я0-9]+/i)
            .filter(w => w.length >= 4);
          return vp.startsWith(vDigits) || makeWords.some(w => low.includes(w));
        }) || null;
      };
      const importKeyFor = (tx) => [
        tx.date,
        Math.round(tx.qty * 100) / 100,
        normalizeCard(tx.cardNo),
        normalizePlate(tx.plate),
        normalizeText(tx.comment).toLowerCase(),
      ].join('|');

      const transactions = [];
      for (let i = headerRow + 1; i < rows.length; i++) {
        const row = rows[i];
        const typeVal = cType !== -1 ? String(row[cType] || '').trim() : '';
        if (typeVal && !typeVal.toLowerCase().includes('покуп')) continue;

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
        const vehicleText = cVehicle !== -1 ? String(row[cVehicle] || '').trim() : '';
        const fuel    = cFuel !== -1 ? String(row[cFuel] || '').trim() : '';

        const plate = extractPlate(comment + ' ' + vehicleText);

        const tx = { sourceRow: i + 1, date: parsedDate, qty, plate, cardNo, fuel, comment, vehicleText };
        tx.importKey = importKeyFor(tx);
        transactions.push(tx);
      }

      if (!transactions.length) {
        alert('В файле не найдено транзакций типа «Покупка» с ненулевым количеством.');
        return;
      }

      function matchVehicle(tx) {
        if (tx.plate) {
          const p = normalizePlate(tx.plate);
          const v = data.vehicles.find(v => {
            const vp = normalizePlate(v.plate);
            return vp && (vp === p || vp.startsWith(p) || p.startsWith(vp));
          });
          if (v) return v;
        }
        if (tx.cardNo) {
          const cn = normalizeCard(tx.cardNo);
          const v = data.vehicles.find(v => normalizeCard(v.fuelcard) === cn);
          if (v) return v;
        }
        if (tx.vehicleText) {
          const v = matchVehicleByLooseText(tx.vehicleText);
          if (v) return v;
        }
        if (tx.comment) {
          const cPlate = extractPlate(tx.comment);
          if (cPlate) {
            const v = data.vehicles.find(v => {
              const vp = normalizePlate(v.plate);
              return vp && (vp === cPlate || vp.startsWith(cPlate) || cPlate.startsWith(vp));
            });
            if (v) return v;
          }
          const cLow = normalizeText(tx.comment).toLowerCase();
          const v = data.vehicles.find(v => {
            const p = normalizePlate(v.plate).toLowerCase();
            return p && cLow.includes(p);
          });
          if (v) return v;

          const looseMatch = matchVehicleByLooseText(tx.comment);
          if (looseMatch) return looseMatch;
        }
        return null;
      }

      let added = 0, updated = 0, skipped = 0, duplicates = 0, adjusted = 0;
      let addedLitres = 0, updatedLitres = 0, skippedLitres = 0, duplicateLitres = 0, adjustedLitres = 0;
      const unmatched = new Set();
      const reportRows = [];
      const unmatchedRows = [];

      const groupedByVehicleDate = {};
      transactions.forEach(tx => {
        const v = matchVehicle(tx);
        if (!v) {
          unmatched.add(tx.comment || tx.cardNo || 'неизвестно');
          unmatchedRows.push({
            sourceRow: tx.sourceRow,
            date: tx.date,
            qty: tx.qty,
            cardNo: tx.cardNo,
            vehicleText: tx.vehicleText,
            comment: tx.comment,
          });
          skippedLitres += tx.qty;
          skipped++;
          return;
        }
        const key = v.id + '|' + tx.date;
        if (!groupedByVehicleDate[key]) {
          groupedByVehicleDate[key] = { v, date: tx.date, totalQty: 0, fuels: [], importKeys: [], transactions: [] };
        }
        groupedByVehicleDate[key].totalQty += tx.qty;
        groupedByVehicleDate[key].fuels.push((tx.fuel || 'топливо') + ' ' + tx.qty + 'л');
        groupedByVehicleDate[key].importKeys.push(tx.importKey);
        groupedByVehicleDate[key].transactions.push(tx);
      });

      const groupedValues = Object.values(groupedByVehicleDate);
      const mergedTransactions = groupedValues.reduce((s, grp) => s + Math.max(0, grp.importKeys.length - 1), 0);

      groupedValues.forEach(grp => {
        const existing = (data.records || []).find(r =>
          r.vehicleId === grp.v.id && r.date === grp.date
        );
        const noteText = String(existing?.note || '');
        const hasImportedKey = grp.importKeys.some(k => noteText.includes(k));
        const importMarker = 'импорт заправок: ' + grp.importKeys.join(' | ');
        const fuelNote = 'заправка: ' + grp.fuels.join(', ');

        if (existing) {
          const existingIssued = +existing.fuelIssued || 0;
          const hasExistingIssued = existing.fuelIssued != null && existing.fuelIssued !== '' && existingIssued > 0;
          const sameRoundedIssue = hasExistingIssued && (
            Math.abs(existingIssued - grp.totalQty) < 0.01 ||
            Math.abs(existingIssued - grp.totalQty) <= 1 ||
            Math.round(existingIssued) === Math.round(grp.totalQty)
          );

          if (hasImportedKey) {
            duplicates++;
            duplicateLitres += grp.totalQty;
            reportRows.push(fuelImportReportRow(grp, 'duplicate', existingIssued, existingIssued, 'Уже загружено ранее'));
            return;
          }
          if (sameRoundedIssue) {
            let action = 'duplicate';
            let statusText = 'Уже было';
            if (Math.abs(existingIssued - grp.totalQty) >= 0.01) {
              existing.fuelIssued = grp.totalQty;
              adjusted++;
              adjustedLitres += grp.totalQty;
              action = 'adjusted';
              statusText = 'Уточнено округление';
            } else {
              duplicates++;
              duplicateLitres += grp.totalQty;
            }
            if (!existing.note) existing.note = fuelNote + '; ' + importMarker;
            else if (!existing.note.includes(importMarker)) existing.note += '; ' + fuelNote + '; ' + importMarker;
            reportRows.push(fuelImportReportRow(grp, action, existingIssued, existing.fuelIssued, statusText));
            return;
          }
          if (hasExistingIssued && existing.note && existing.note.includes('заправка')) {
            duplicates++;
            duplicateLitres += grp.totalQty;
            reportRows.push(fuelImportReportRow(grp, 'duplicate', existingIssued, existingIssued, 'Пропущено: в записи уже есть заправка'));
            return;
          }
          const beforeIssued = existingIssued;
          existing.fuelIssued = beforeIssued + grp.totalQty;
          if (!existing.note) existing.note = '';
          existing.note = (existing.note ? existing.note + '; ' : '') + fuelNote + '; ' + importMarker;
          updated++;
          updatedLitres += grp.totalQty;
          reportRows.push(fuelImportReportRow(grp, 'updated', beforeIssued, existing.fuelIssued, 'Добавлено к существующей дате'));
        } else {
          if (!data.records) data.records = [];
          data.records.push({
            id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            vehicleId: grp.v.id,
            date: grp.date,
            km: 0,
            fuelIssued: grp.totalQty,
            note: fuelNote + '; ' + importMarker,
          });
          added++;
          addedLitres += grp.totalQty;
          reportRows.push(fuelImportReportRow(grp, 'added', null, grp.totalQty, 'Создана новая дневная запись'));
        }
      });

      const saved = await saveData(data);
      if (!saved) {
        alert('Заправки обработаны, но сохранить изменения не удалось. Проверьте соединение с сервером и повторите импорт.');
        return;
      }
      const v = data.vehicles.find(x => x.id === selectedVehicleId);
      if (v) renderDetail(v);

      showFuelImportReport({
        fileName: file.name,
        transactionsCount: transactions.length,
        sourceLitres: transactions.reduce((s, tx) => s + tx.qty, 0),
        groupedCount: groupedValues.length,
        mergedTransactions,
        added, updated, adjusted, duplicates, skipped,
        addedLitres, updatedLitres, adjustedLitres, duplicateLitres, skippedLitres,
        reportRows,
        unmatchedRows,
        unmatched: [...unmatched],
      });
    } catch(err) {
      alert('Ошибка при чтении файла: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function fuelImportReportRow(grp, action, beforeIssued, afterIssued, statusText) {
  const vehicleTitle = [grp.v.plate, grp.v.make].filter(Boolean).join(' — ') || grp.v.id;
  const cards = [...new Set(grp.transactions.map(tx => tx.cardNo).filter(Boolean))];
  const comments = [...new Set(grp.transactions.map(tx => tx.comment).filter(Boolean))];
  return {
    action,
    statusText,
    date: grp.date,
    vehicle: vehicleTitle,
    qty: grp.totalQty,
    beforeIssued,
    afterIssued,
    sourceRows: grp.transactions.map(tx => tx.sourceRow),
    transactionCount: grp.transactions.length,
    cardNo: cards.join(', '),
    comment: comments.join('; '),
    transactions: grp.transactions.map(tx => ({
      sourceRow: tx.sourceRow,
      qty: tx.qty,
      fuel: tx.fuel,
      cardNo: tx.cardNo,
      vehicleText: tx.vehicleText,
      comment: tx.comment,
    })),
  };
}

function showFuelImportReport(report) {
  const body = document.getElementById('fuelImportReportBody');
  const modal = document.getElementById('fuelImportReportModal');
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const num = (v, dec = 2) => (+v || 0).toLocaleString('ru', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
  const signedNum = (v) => v == null ? '—' : num(v);
  const actionStyle = {
    added: 'background:#dcfce7;color:#15803d',
    updated: 'background:#dbeafe;color:#1d4ed8',
    adjusted: 'background:#fef3c7;color:#b45309',
    duplicate: 'background:var(--bg3);color:var(--text3)',
  };
  const actionOrder = { added: 1, adjusted: 2, updated: 3, duplicate: 4 };
  const changedRows = report.reportRows.filter(r => r.action !== 'duplicate');
  const loadedLitres = report.addedLitres + report.updatedLitres + report.adjustedLitres;
  const sortedRows = report.reportRows.slice().sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') ||
    (a.vehicle || '').localeCompare(b.vehicle || '') ||
    (actionOrder[a.action] || 9) - (actionOrder[b.action] || 9)
  );
  const sortedUnmatched = report.unmatchedRows.slice().sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') || (a.sourceRow || 0) - (b.sourceRow || 0)
  );
  const mergedRows = sortedRows.filter(r => r.transactionCount > 1);

  const card = (title, value, sub, color) => `
    <div style="flex:1;min-width:140px;background:var(--bg2);border:1px solid var(--border);border-left:4px solid ${color};border-radius:8px;padding:12px 14px">
      <div style="font-size:12px;color:var(--text3);margin-bottom:4px">${esc(title)}</div>
      <div style="font-size:20px;font-weight:800;color:var(--text1)">${esc(value)}</div>
      ${sub ? `<div style="font-size:12px;color:var(--text3);margin-top:3px">${esc(sub)}</div>` : ''}
    </div>`;

  const rowHtml = sortedRows.map(r => `
    <tr>
      <td>${esc(r.date)}</td>
      <td><span style="display:inline-block;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:700;${actionStyle[r.action] || actionStyle.duplicate}">${esc(r.statusText)}</span></td>
      <td>${esc(r.vehicle)}</td>
      <td style="text-align:right;font-weight:700">${num(r.qty)}</td>
      <td style="text-align:right">${signedNum(r.beforeIssued)}</td>
      <td style="text-align:right">${signedNum(r.afterIssued)}</td>
      <td style="text-align:center">${r.transactionCount}</td>
      <td>${esc(r.sourceRows.join(', '))}</td>
      <td>${esc(r.cardNo || '—')}</td>
      <td style="max-width:300px;white-space:normal">${esc(r.comment || '—')}</td>
    </tr>
  `).join('');

  const unmatchedHtml = sortedUnmatched.length ? `
    <div class="table-wrap" style="margin-top:14px">
      <div class="table-toolbar">
        <div class="table-toolbar-left">Не загрузилось: не найдено ТС</div>
      </div>
      <div class="table-scroll" style="max-height:220px;overflow:auto">
        <table class="data-table" style="width:100%">
          <thead><tr><th>Строка Excel</th><th>Дата</th><th style="text-align:right">Литры</th><th>Карта</th><th>ТС</th><th>Комментарий</th></tr></thead>
          <tbody>${sortedUnmatched.map(r => `
            <tr>
              <td>${esc(r.sourceRow)}</td>
              <td>${esc(r.date)}</td>
              <td style="text-align:right;font-weight:700">${num(r.qty)}</td>
              <td>${esc(r.cardNo || '—')}</td>
              <td>${esc(r.vehicleText || '—')}</td>
              <td style="max-width:360px;white-space:normal">${esc(r.comment || '—')}</td>
            </tr>
          `).join('')}</tbody>
        </table>
      </div>
    </div>
  ` : `
    <div style="margin-top:14px;background:#dcfce7;color:#166534;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;font-size:13px">
      Все строки сопоставлены с техникой. Ничего не вылетело по причине «ТС не найдено».
    </div>
  `;

  const mergedHtml = mergedRows.length ? `
    <div class="table-wrap" style="margin-top:14px">
      <div class="table-toolbar">
        <div class="table-toolbar-left">Объединённые покупки</div>
      </div>
      <div class="table-scroll" style="max-height:280px;overflow:auto">
        <table class="data-table" style="width:100%">
          <thead>
            <tr>
              <th>Дата</th><th>ТС</th><th>Строка Excel</th><th style="text-align:right">Литры</th><th>Товар</th><th>Карта</th><th>ТС из отчёта</th><th>Комментарий</th>
            </tr>
          </thead>
          <tbody>${mergedRows.map(group => {
            const rows = group.transactions.map((tx, idx) => `
              <tr>
                ${idx === 0 ? `<td rowspan="${group.transactions.length}">${esc(group.date)}</td><td rowspan="${group.transactions.length}">${esc(group.vehicle)}<div style="font-size:11px;color:var(--text3);margin-top:3px">Итого: ${num(group.qty)} л</div></td>` : ''}
                <td>${esc(tx.sourceRow)}</td>
                <td style="text-align:right;font-weight:700">${num(tx.qty)}</td>
                <td>${esc(tx.fuel || '—')}</td>
                <td>${esc(tx.cardNo || '—')}</td>
                <td>${esc(tx.vehicleText || '—')}</td>
                <td style="max-width:320px;white-space:normal">${esc(tx.comment || '—')}</td>
              </tr>
            `).join('');
            return rows;
          }).join('')}</tbody>
        </table>
      </div>
    </div>
  ` : `
    <div style="margin-top:14px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:13px;color:var(--text3)">
      Объединённых покупок нет: каждая строка Excel попала в отдельную дневную запись.
    </div>
  `;

  const html = `
    <div style="font-size:13px;color:var(--text3);margin-bottom:12px">
      Файл: <b style="color:var(--text1)">${esc(report.fileName || '—')}</b>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px">
      ${card('Транзакций в Excel', String(report.transactionsCount), num(report.sourceLitres) + ' л всего', '#64748b')}
      ${card('Дневных записей', String(report.groupedCount), report.mergedTransactions ? 'объединено покупок: ' + report.mergedTransactions : 'без объединений', '#2563eb')}
      ${card('Загружено/изменено', String(changedRows.length), num(loadedLitres) + ' л', '#16a34a')}
      ${card('Уже было', String(report.duplicates), num(report.duplicateLitres) + ' л', '#94a3b8')}
      ${card('Не загрузилось', String(report.skipped), num(report.skippedLitres) + ' л', report.skipped ? '#dc2626' : '#16a34a')}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;font-size:12px;color:var(--text3)">
      <span>Добавлено: <b style="color:var(--text1)">${report.added}</b> (${num(report.addedLitres)} л)</span>
      <span>Обновлено: <b style="color:var(--text1)">${report.updated}</b> (${num(report.updatedLitres)} л)</span>
      <span>Уточнено округлений: <b style="color:var(--text1)">${report.adjusted}</b> (${num(report.adjustedLitres)} л)</span>
    </div>
    <div class="table-wrap">
      <div class="table-toolbar">
        <div class="table-toolbar-left">Что произошло по датам</div>
      </div>
      <div class="table-scroll" style="max-height:360px;overflow:auto">
        <table class="data-table" style="width:100%">
          <thead>
            <tr>
              <th>Дата</th><th>Статус</th><th>ТС</th><th style="text-align:right">Литры из Excel</th>
              <th style="text-align:right">Было</th><th style="text-align:right">Стало</th>
              <th style="text-align:center">Покупок</th><th>Строки Excel</th><th>Карта</th><th>Комментарий</th>
            </tr>
          </thead>
          <tbody>${rowHtml || '<tr><td colspan="10" style="text-align:center;color:var(--text3);padding:16px">Нет обработанных строк</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    ${mergedHtml}
    ${unmatchedHtml}
  `;

  if (!body || !modal || typeof openModal !== 'function') {
    alert('Импорт заправок завершён.\nТранзакций: ' + report.transactionsCount +
      '\nДневных записей: ' + report.groupedCount +
      '\nНе найдено ТС: ' + report.skipped);
    return;
  }
  body.innerHTML = html;
  openModal('fuelImportReportModal');
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

