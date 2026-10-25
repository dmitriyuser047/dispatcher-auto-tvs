/* Monthly personnel timesheets. Workbook cells are data, never executable instructions. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PersonnelTimesheet = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000, CODES = ['МВ', 'Д', 'ЯС', 'Я'];
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = value => value === null || value === undefined ? '' : String(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  function fail(field, message) { const error = new Error(message); error.code = 'PERSONNEL_TIMESHEET_INVALID'; error.field = field; throw error; }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }
  function dateValue(value, date1904) {
    // Excel dates are civil dates. SheetJS represents them as local midnight;
    // converting that instant to UTC can move the first of a month backwards.
    if (value instanceof Date || Object.prototype.toString.call(value) === '[object Date]') return Number.isFinite(value.valueOf()) ? String(value.getFullYear()).padStart(4, '0') + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0') : '';
    if (typeof value === 'number' && Number.isFinite(value)) {
      const ms = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) + Math.floor(value) * DAY;
      return new Date(ms).toISOString().slice(0, 10);
    }
    const raw = text(value).trim();
    if (/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(raw)) return validDate(raw.slice(0, 10)) ? raw.slice(0, 10) : '';
    const match = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(raw);
    if (match) { const result = match[3] + '-' + match[2].padStart(2, '0') + '-' + match[1].padStart(2, '0'); return validDate(result) ? result : ''; }
    return '';
  }
  function col(index) { let result = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result; return result; }
  function cell(sheet, address) { const value = sheet && sheet[address]; return value && own(value, 'v') ? value.v : null; }
  function dateCell(sheet, address, date1904) {
    const source = sheet && sheet[address];
    // The bundled reader can apply historical time-zone seconds to Date cells.
    // Its formatted civil date retains the original Excel date in that case.
    if (source?.t === 'd' && typeof source.w === 'string') {
      const formatted = dateValue(source.w, false);
      if (formatted) return formatted;
    }
    return dateValue(cell(sheet, address), date1904);
  }
  function worksheetInfo(workbook, name) {
    const sheet = workbook && workbook.Sheets && workbook.Sheets[name], date1904 = !!workbook?.Workbook?.WBProps?.date1904;
    const from = dateCell(sheet, 'P7', date1904), to = dateCell(sheet, 'T7', date1904);
    const header = text(cell(sheet, 'C9')).toLocaleLowerCase('ru');
    let valid = !!sheet && header.includes('фио') && Number(cell(sheet, 'F9')) === 1 &&
      validDate(from) && validDate(to) && from <= to && from.slice(0, 7) === to.slice(0, 7);
    if (valid) for (let day = 1; day <= 31; day++) {
      const date = from.slice(0, 7) + '-' + String(day).padStart(2, '0'), value = cell(sheet, col(day + 4) + '9');
      if (validDate(date) ? Number(value) !== day : ![null, '', '*', day, text(day)].includes(value)) valid = false;
    }
    return { name, from, to, valid };
  }
  function listSheets(workbook) { return (workbook && Array.isArray(workbook.SheetNames) ? workbook.SheetNames : []).map(name => worksheetInfo(workbook, name)); }
  function activeSheet(workbook) {
    const sheets = listSheets(workbook), views = workbook?.Workbook?.WBView || workbook?.Workbook?.Views || [];
    const tab = Number(views[0]?.activeTab ?? workbook?.Workbook?.activeTab ?? workbook?.activeTab);
    const selected = Number.isInteger(tab) ? sheets[tab] : null;
    return (selected?.valid ? selected : sheets.find(item => item.valid))?.name || '';
  }
  function monthDays(model) {
    const month = model.from.slice(0, 7);
    return Array.from({ length: 31 }, (_, index) => {
      const day = index + 1, candidate = month + '-' + String(day).padStart(2, '0'), valid = validDate(candidate);
      return { day, date: valid ? candidate : null, valid, inPeriod: valid && candidate >= model.from && candidate <= model.to };
    });
  }
  function validate(model) {
    if (!object(model) || model.version !== 1) fail('version', 'Неизвестная версия табеля');
    if (!['operator', 'driver'].includes(model.kind)) fail('kind', 'Выберите табель машинистов ДЭС или водителей');
    if (!validDate(model.from) || !validDate(model.to) || model.from > model.to || model.from.slice(0, 7) !== model.to.slice(0, 7)) fail('period', 'Период табеля должен находиться в одном месяце, начало не позже окончания');
    for (const key of ['org', 'title', 'division', 'departmentLabel', 'signatureLabel', 'noteLabel', 'curator', 'documentNumber']) {
      if (own(model, key) && (typeof model[key] !== 'string' || model[key].length > 2000)) fail(key, 'Некорректное текстовое поле табеля: ' + key);
    }
    if (own(model, 'preparedAt') && (typeof model.preparedAt !== 'string' || model.preparedAt !== '' && !validDate(model.preparedAt))) fail('preparedAt', 'Проверьте дату составления');
    if (own(model, 'source') && !object(model.source)) fail('source', 'Некорректные сведения об источнике табеля');
    if (own(model, 'footer')) {
      if (!object(model.footer)) fail('footer', 'Некорректная подпись табеля');
      for (const value of Object.values(model.footer)) if (typeof value !== 'string' || value.length > 1000) fail('footer', 'Некорректная подпись табеля');
    }
    if (!Array.isArray(model.rows) || model.rows.length > 2000) fail('rows', 'Табель должен содержать не более 2000 строк');
    const ids = new Set();
    model.rows.forEach((row, index) => {
      const prefix = 'rows.' + index;
      if (!object(row) || !['string', 'number'].includes(typeof row.id) || typeof row.id === 'number' && !Number.isSafeInteger(row.id) || row.id === '') fail(prefix + '.id', 'У строки табеля должен быть идентификатор');
      const id = typeof row.id + ':' + row.id;
      if (ids.has(id)) fail(prefix + '.id', 'Повторяющийся идентификатор строки табеля');
      ids.add(id);
      for (const key of ['number', 'sourceRow']) if (own(row, key) && (!Number.isSafeInteger(row[key]) || row[key] < 1)) fail(prefix + '.' + key, 'Номер строки табеля должен быть положительным целым числом');
      if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 500) fail(prefix + '.name', 'Укажите ФИО сотрудника в строке ' + (index + 1));
      for (const key of ['position', 'personnelNumber', 'site', 'department', 'note', 'signature']) if (own(row, key) && (typeof row[key] !== 'string' || row[key].length > 4000)) fail(prefix + '.' + key, 'Некорректный текст в строке ' + (index + 1));
      if (!object(row.days)) fail(prefix + '.days', 'Не заданы отметки по дням в строке ' + (index + 1));
      for (const [date, value] of Object.entries(row.days)) {
        if (!validDate(date) || date.slice(0, 7) !== model.from.slice(0, 7)) fail(prefix + '.days.' + date, 'Дата отметки находится вне месяца табеля');
        if (typeof value === 'number') {
          if (!Number.isFinite(value) || value < 0 || value > 24) fail(prefix + '.days.' + date, 'Часы должны быть числом от 0 до 24');
        } else if (typeof value !== 'string' || value.length > 40) fail(prefix + '.days.' + date, 'Некорректная отметка дня');
        else if (numericMark(value) !== null && (numericMark(value) < 0 || numericMark(value) > 24)) fail(prefix + '.days.' + date, 'Часы должны быть числом от 0 до 24');
      }
      if (own(row, 'sourceTotals')) {
        if (!object(row.sourceTotals)) fail(prefix + '.sourceTotals', 'Некорректные исходные итоги');
        for (const value of Object.values(row.sourceTotals)) if (value !== null && typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) fail(prefix + '.sourceTotals', 'Некорректные исходные итоги');
      }
    });
    return model;
  }
  function create(options) {
    if (!object(options)) fail('model', 'Не заданы параметры табеля');
    const model = {
      version: 1, kind: options.kind, from: options.from, to: options.to,
      org: options.org || '', title: options.title || 'ТАБЕЛЬ УЧЕТА РАБОЧЕГО ВРЕМЕНИ', division: options.division || '',
      departmentLabel: options.departmentLabel || 'Юр лицо',
      signatureLabel: options.signatureLabel || 'Куратор', noteLabel: options.noteLabel || 'Комментарии',
      curator: options.curator || '', preparedAt: options.preparedAt || '', documentNumber: options.documentNumber || '',
      rows: clone(options.rows || [])
    };
    if (options.source) model.source = clone(options.source);
    if (options.footer) model.footer = clone(options.footer);
    return validate(model);
  }
  function numericMark(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const input = text(value).trim();
    return /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(input) ? Number(input.replace(',', '.')) : null;
  }
  function counts() { return { 'МВ': 0, 'Д': 0, 'ЯС': 0, 'Я': 0 }; }
  function summarize(model) {
    validate(model);
    const period = monthDays(model).filter(day => day.inPeriod), warnings = [];
    const totals = { counts: counts(), hours: 0, workedDays: 0, totalDays: 0, markedDays: 0, blankDays: 0, employees: model.rows.length, otherCodes: {} };
    const rows = model.rows.map((row, index) => {
      const result = { id: row.id, rowId: row.id, counts: counts(), hours: 0, workedDays: 0, totalDays: 0, markedDays: 0, blankDays: 0, otherCodes: {}, mismatches: [] };
      for (const { date } of period) {
        const value = row.days[date], raw = text(value).trim(), hours = numericMark(value);
        if (!raw) { result.blankDays++; continue; }
        result.markedDays++;
        if (hours !== null) {
          result.hours += hours;
          if (hours > 0) { result.counts['Я']++; result.workedDays++; }
        } else {
          const code = raw.toLocaleUpperCase('ru');
          if (CODES.includes(code)) result.counts[code]++;
          else result.otherCodes[code] = (result.otherCodes[code] || 0) + 1;
          if (code === 'Я' || code === 'ЯС') result.workedDays++;
        }
      }
      result.hours = Math.round(result.hours * 1000000) / 1000000;
      result.totalDays = result.counts['Д'] + result.counts['ЯС'] + result.counts['Я'];
      result.days = result.counts;
      result.other = result.otherCodes;
      if (row.sourceTotals) {
        result.sourceTotals = clone(row.sourceTotals);
        for (const code of [...CODES, 'totalDays']) {
          if (!own(row.sourceTotals, code)) continue;
          const source = row.sourceTotals[code], calculated = code === 'totalDays' ? result.totalDays : result.counts[code];
          const number = numericMark(source), missing = source === null || text(source).trim() === '';
          if (missing ? calculated !== 0 : number === null || number !== calculated) {
            result.mismatches.push({ code, source, calculated });
            warnings.push((row.sourceRow ? 'Строка Excel ' + row.sourceRow : 'Строка ' + (row.number ?? index + 1)) + ': ' + (code === 'totalDays' ? 'Итого Д, ЯС, Я' : code) + ' — в исходнике ' + (missing ? 'пусто' : text(source)) + ', по дням ' + calculated);
          }
        }
      }
      for (const code of CODES) totals.counts[code] += result.counts[code];
      for (const key of ['hours', 'workedDays', 'totalDays', 'markedDays', 'blankDays']) totals[key] += result[key];
      for (const [code, amount] of Object.entries(result.otherCodes)) totals.otherCodes[code] = (totals.otherCodes[code] || 0) + amount;
      return result;
    });
    totals.hours = Math.round(totals.hours * 1000000) / 1000000;
    totals.days = totals.counts;
    totals.other = totals.otherCodes;
    return { rows, totals, otherCodes: totals.otherCodes, blankDays: totals.blankDays, warnings };
  }
  function splitPerson(value) {
    const raw = text(value).trim(), newline = raw.indexOf('\n');
    if (newline > 0) return { name: raw.slice(0, newline).trim(), position: raw.slice(newline + 1).trim() };
    const match = /\s+((?:машинист|водитель|оператор|тракторист|механик)(?:\s|$)[\s\S]*)$/i.exec(raw);
    return match ? { name: raw.slice(0, match.index).trim(), position: match[1].trim() } : { name: raw, position: '' };
  }
  function fromWorkbook(workbook, options) {
    options = options || {};
    if (!['operator', 'driver'].includes(options.kind)) fail('kind', 'Выберите вид табеля перед загрузкой');
    const name = options.sheetName || activeSheet(workbook), info = worksheetInfo(workbook, name);
    if (!info.valid) fail('sheet', 'На выбранном листе не найден табель с ФИО, днями 1–31 и датами отчетного периода');
    const sheet = workbook.Sheets[name], date1904 = !!workbook?.Workbook?.WBProps?.date1904;
    const model = create({ kind: options.kind, from: info.from, to: info.to, org: text(cell(sheet, 'C2')).trim(),
      title: text(cell(sheet, 'C1')).trim() || undefined, division: text(cell(sheet, 'C3')).trim(),
      departmentLabel: text(cell(sheet, 'B9')).trim() || undefined, signatureLabel: text(cell(sheet, 'AP9')).trim() || undefined,
      noteLabel: text(cell(sheet, 'AQ9')).trim() || undefined, curator: text(cell(sheet, 'AP10')).trim(),
      preparedAt: dateCell(sheet, 'L7', date1904), documentNumber: text(cell(sheet, 'H7')).trim(), rows: [],
      source: { fileName: text(options.fileName), sheetName: name } });
    const ref = text(sheet['!ref']), match = /:?[A-Z]+(\d+)$/.exec(ref), lastRow = match ? Math.min(Number(match[1]), 10000) : 10000;
    for (let r = 11; r <= lastRow; r++) {
      const number = cell(sheet, 'A' + r), person = cell(sheet, 'C' + r);
      if (!Number.isInteger(Number(number)) || Number(number) <= 0 || !text(person).trim()) continue;
      if (model.rows.length >= 2000) fail('rows', 'В файле более 2000 сотрудников');
      const row = { id: 'xlsx-' + r, number: Number(number), sourceRow: r, ...splitPerson(person), department: text(cell(sheet, 'B' + r)).trim(), personnelNumber: text(cell(sheet, 'D' + r)).trim(),
        site: text(cell(sheet, 'E' + r)).trim(), days: {}, signature: text(cell(sheet, 'AP' + r)).trim(), note: text(cell(sheet, 'AQ' + r)).trim(), sourceTotals: {} };
      for (const day of monthDays(model)) {
        const value = cell(sheet, col(day.day + 4) + r);
        if (value !== null && value !== undefined && value !== '') {
          if (!day.valid) fail('days', 'В строке ' + r + ' заполнен несуществующий день месяца ' + day.day);
          if (!['number', 'string'].includes(typeof value)) fail('days', 'Некорректная отметка в строке ' + r + ', день ' + day.day);
          row.days[day.date] = value;
        }
      }
      for (let index = 0; index < CODES.length; index++) row.sourceTotals[CODES[index]] = cell(sheet, col(36 + index) + r);
      row.sourceTotals.totalDays = cell(sheet, 'AO' + r);
      model.rows.push(row);
    }
    if (!model.rows.length) fail('rows', 'На выбранном листе не найдены строки сотрудников');
    const footer = Number(model.rows.at(-1).id.slice(5)) + 2;
    model.footer = { label: text(cell(sheet, 'C' + footer)).trim(), position: text(cell(sheet, 'E' + footer)).trim(), name: text(cell(sheet, 'L' + footer)).trim(), positionLabel: text(cell(sheet, 'E' + (footer + 1))).trim(), nameLabel: text(cell(sheet, 'L' + (footer + 1))).trim() };
    return validate(model);
  }
  function excelDate(value) { return Math.round((Date.parse(value + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / DAY); }
  function toWorkbook(model, XLSX) {
    validate(model);
    if (!XLSX?.utils?.book_new || !XLSX?.utils?.book_append_sheet) fail('xlsx', 'Библиотека Excel недоступна');
    const summary = summarize(model), sheet = {}, last = Math.max(10, model.rows.length + 10), month = monthDays(model);
    const border = { top: { style: 'thin', color: { rgb: '000000' } }, bottom: { style: 'thin', color: { rgb: '000000' } }, left: { style: 'thin', color: { rgb: '000000' } }, right: { style: 'thin', color: { rgb: '000000' } } };
    const font = { name: 'Arial', sz: 10, color: { rgb: '000000' } };
    const base = { font, alignment: { vertical: 'center', wrapText: true }, border };
    const header = { ...base, font: { ...font, bold: true }, alignment: { ...base.alignment, horizontal: 'center' }, fill: { patternType: 'solid', fgColor: { rgb: 'FBE5D6' } } };
    const markStyle = { ...base, font: { ...font, sz: 9 }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
    function put(address, value, style, format) {
      const target = { t: typeof value === 'number' ? 'n' : 's', v: value == null ? '' : value, s: style || { font, alignment: { vertical: 'center', wrapText: true } } };
      if (format) target.z = format;
      sheet[address] = target; return target;
    }
    for (let r = 9; r <= last; r++) for (let c = 0; c < 43; c++) put(col(c) + r, '', r < 11 ? header : c >= 5 && c <= 40 ? markStyle : base);
    const titleStyle = { font: { ...font, bold: true }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
    put('C1', model.title || 'ТАБЕЛЬ УЧЕТА РАБОЧЕГО ВРЕМЕНИ', titleStyle); put('C2', model.org, { ...titleStyle, font: { ...titleStyle.font, color: { rgb: '0000CC' } } }); put('C3', model.division || 'Наименование подразделения', titleStyle);
    for (const [address, value] of [['H5', 'Номер документа'], ['L5', 'Дата составления'], ['P5', 'Отчетный период'], ['P6', 'с'], ['T6', 'по']]) put(address, value, { ...base, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } });
    put('H7', model.documentNumber || '', base); put('L7', model.preparedAt ? excelDate(model.preparedAt) : '', base, 'dd.mm.yyyy');
    put('P7', excelDate(model.from), base, 'dd.mm.yyyy'); put('T7', excelDate(model.to), base, 'dd.mm.yyyy');
    for (const [address, value] of [['A9', '№'], ['B9', model.departmentLabel || 'Юр лицо'], ['C9', 'ФИО работника\nдолжность'], ['D9', 'Табельный\nномер'], ['E9', 'Объект'], ['AK9', 'Итого дней:'], ['AO10', 'Итого Д, ЯС, Я'], ['AP9', model.signatureLabel || 'Куратор'], ['AQ9', model.noteLabel || 'Комментарии'], ['AP10', model.curator || '']]) put(address, value, header);
    month.forEach(day => put(col(day.day + 4) + '9', day.valid ? day.day : '*', header));
    CODES.forEach((code, index) => put(col(36 + index) + '10', code, header));
    model.rows.forEach((row, index) => {
      const r = index + 11, result = summary.rows[index];
      put('A' + r, row.number ?? index + 1, markStyle); put('B' + r, row.department || '', base);
      put('C' + r, [row.name, row.position].filter(Boolean).join('\n'), base); put('D' + r, row.personnelNumber || '', base); put('E' + r, row.site || '', base);
      for (const day of month) {
        const address = col(day.day + 4) + r, value = day.valid ? row.days[day.date] ?? '' : '';
        const style = day.inPeriod ? markStyle : { ...markStyle, fill: { patternType: 'solid', fgColor: { rgb: 'EFEFEF' } } };
        const numeric = numericMark(value);
        // Keep source types in the saved model; Excel hours must be numeric so
        // its editable COUNTIFS totals also work for imported text numbers.
        put(address, numeric === null ? value : numeric, style);
      }
      const period = month.filter(day => day.inPeriod), range = col(period[0].day + 4) + r + ':' + col(period.at(-1).day + 4) + r;
      CODES.forEach((code, i) => {
        const target = put(col(36 + i) + r, result.counts[code], markStyle, '0;-0;;@');
        target.f = 'COUNTIFS(' + range + ',"' + code + '")' + (code === 'Я' ? '+COUNTIFS(' + range + ',">0")' : '');
      });
      put('AO' + r, result.totalDays, markStyle).f = 'SUM(AL' + r + ':AN' + r + ')';
      put('AP' + r, row.signature || '', base); put('AQ' + r, row.note || '', base);
      for (const mismatch of result.mismatches) {
        const address = mismatch.code === 'totalDays' ? 'AO' + r : col(36 + CODES.indexOf(mismatch.code)) + r;
        sheet[address].c = [{ a: 'Диспетчер ТВС', t: 'В исходном файле: ' + (mismatch.source === null || mismatch.source === '' ? 'пусто' : text(mismatch.source)) + '. По отметкам отчетного периода: ' + mismatch.calculated + '.' }];
      }
    });
    const merges = [];
    function merge(r1, c1, r2, c2) { merges.push({ s: { r: r1 - 1, c: c1 }, e: { r: r2 - 1, c: c2 } }); }
    for (let r = 1; r <= 3; r++) merge(r, 2, r, model.kind === 'driver' ? 34 : 33);
    merge(5, 7, 6, 10); merge(5, 11, 6, 14); merge(5, 15, 5, 21); merge(6, 15, 6, 18); merge(6, 19, 6, 21);
    merge(7, 7, 7, 10); merge(7, 11, 7, 14); merge(7, 15, 7, 18); merge(7, 19, 7, 21); merge(8, 0, 8, 32);
    for (let c = 0; c <= 35; c++) merge(9, c, 10, c);
    merge(9, 36, 9, 39);
    const footer = last + 2;
    put('C' + footer, model.footer?.label || 'Ответственное лицо (куратор)', { font });
    put('E' + footer, model.footer?.position || '', { font }); put('L' + footer, model.footer?.name || '', { font });
    put('E' + (footer + 1), model.footer?.positionLabel || 'Должность', { font }); put('L' + (footer + 1), model.footer?.nameLabel || 'ФИО работника', { font });
    merge(footer, 4, footer, 7); merge(footer, 11, footer, 17); merge(footer + 1, 4, footer + 1, 7); merge(footer + 1, 11, footer + 1, 17);
    sheet['!ref'] = 'A1:AQ' + (footer + 1); sheet['!merges'] = merges;
    sheet['!cols'] = [4.85546875, 6.42578125, 19.28515625, 15.140625, 21.5703125, ...Array(31).fill(4.7109375), ...Array(4).fill(5.140625), 6.140625, 20.140625, 31.85546875].map(width => ({ width, customWidth: true }));
    sheet['!rows'] = Array.from({ length: footer + 1 }, (_, index) => ({ hpt: index === 8 ? 24.75 : index === 9 ? 38.25 : index >= 10 && index < last ? 38.25 : 18 }));
    sheet['!margins'] = { left: .118, right: .118, top: .748, bottom: .748, header: .315, footer: .315 };
    sheet['!pageSetup'] = { orientation: 'landscape', paperSize: 8, fitToWidth: 1, fitToHeight: 0 };
    sheet['!freeze'] = { xSplit: 5, ySplit: 10, topLeftCell: 'F11', activePane: 'bottomRight', state: 'frozen' };
    const workbook = XLSX.utils.book_new(), name = model.kind === 'operator' ? 'Машинисты ДЭС' : 'Водители';
    XLSX.utils.book_append_sheet(workbook, sheet, name);
    workbook.Workbook = { Names: [{ Name: '_xlnm.Print_Area', Sheet: 0, Ref: "'" + name + "'!$A$1:$AQ$" + (footer + 1) }, { Name: '_xlnm.Print_Titles', Sheet: 0, Ref: "'" + name + "'!$9:$10" }] };
    return workbook;
  }
  function toXlsx(model, XLSX) {
    const workbook = toWorkbook(model, XLSX);
    if (!XLSX.CFB?.read || !XLSX.CFB?.utils?.cfb_add || !XLSX.CFB?.write) fail('xlsx', 'Библиотека Excel не поддерживает настройку печатного табеля');
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true, compression: true });
    const archive = XLSX.CFB.read(new Uint8Array(bytes), { type: 'array' });
    const index = archive.FullPaths.findIndex(path => /(?:^|\/)xl\/worksheets\/sheet1\.xml$/.test(path));
    if (index < 0) fail('xlsx', 'Не удалось подготовить печатную страницу табеля');
    const path = archive.FullPaths[index], source = archive.FileIndex[index];
    let xml = new TextDecoder('utf-8').decode(new Uint8Array(source.content));
    const views = '<sheetViews><sheetView workbookViewId="0"><pane xSplit="5" ySplit="10" topLeftCell="F11" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="F11" sqref="F11"/></sheetView></sheetViews>';
    if (/<sheetViews[\s>]/.test(xml)) xml = xml.replace(/<sheetViews\b[^>]*>[\s\S]*?<\/sheetViews>/, views);
    else xml = xml.replace(/<(?:sheetFormatPr|cols|sheetData)\b/, views + '$&');
    const pageSetup = '<pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';
    if (/<pageSetup\b/.test(xml)) xml = xml.replace(/<pageSetup\b[^>]*\/>/, pageSetup);
    else xml = xml.replace(/<(?:headerFooter|rowBreaks|colBreaks|customProperties|cellWatches|ignoredErrors|smartTags|drawing|legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b|<\/worksheet>/, pageSetup + '$&');
    if (/<sheetPr\b[^>]*\/>/.test(xml)) xml = xml.replace(/<sheetPr\b([^>]*)\/>/, '<sheetPr$1><pageSetUpPr fitToPage="1"/></sheetPr>');
    else if (/<sheetPr\b/.test(xml)) xml = xml.replace(/<\/sheetPr>/, '<pageSetUpPr fitToPage="1"/></sheetPr>');
    else xml = xml.replace(/<dimension\b/, '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension');
    XLSX.CFB.utils.cfb_add(archive, path, new TextEncoder().encode(xml));
    return new Uint8Array(XLSX.CFB.write(archive, { fileType: 'zip', type: 'array', compression: true }));
  }
  function formatPeriod(model) { const display = value => value.slice(8, 10) + '.' + value.slice(5, 7) + '.' + value.slice(0, 4); return display(model.from) + '–' + display(model.to); }
  return Object.freeze({ apiVersion: 1, create, validate, fromWorkbook, summarize, toWorkbook, toXlsx, monthDays, listSheets, activeSheet, formatPeriod, numericMark });
});
