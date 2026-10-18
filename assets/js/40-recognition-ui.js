// Source evidence is read-only. Imported document text is always inserted as text.
(function () {
  'use strict';
  const fieldLabels = { supplier: 'Поставщик', supplierInn: 'ИНН поставщика', number: 'Номер документа', date: 'Дата документа', total: 'Сумма к оплате' };
  const methods = { text: 'Текст документа', ocr: 'Распознавание скана', mixed: 'Текст и распознавание скана' };
  const node = (tag, className, value) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value != null) element.textContent = String(value);
    return element;
  };
  const present = value => value != null && String(value).trim() !== '';
  const pagesLabel = pages => Array.isArray(pages) ? [...new Set(pages.filter(present).map(String))].join(', ') : '';

  globalThis.rxShowSource = function rxShowSource(row) {
    if (!row || typeof row !== 'object') return;
    const previousFocus = document.activeElement;
    document.getElementById('rxSourceDialog')?.close();
    const evidence = row.recognition && typeof row.recognition === 'object' ? row.recognition : null;
    const fields = evidence?.fields && typeof evidence.fields === 'object' ? evidence.fields : null;
    const dialog = node('dialog', 'rx-source-dialog');
    dialog.id = 'rxSourceDialog';
    dialog.setAttribute('aria-labelledby', 'rxSourceTitle');
    const head = node('div', 'rx-source-head');
    const title = node('div');
    title.append(node('span', 'rx-source-eyebrow', 'Проверка документа'));
    const heading = node('h2', '', 'Источник реквизитов');
    heading.id = 'rxSourceTitle';
    title.append(heading);
    const close = node('button', 'rx-source-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Закрыть источник документа');
    close.addEventListener('click', () => dialog.close());
    head.append(title, close);
    const body = node('div', 'rx-source-body');

    const meta = node('dl', 'rx-source-meta');
    const addMeta = (label, value) => {
      if (!present(value)) return;
      const item = node('div');
      item.append(node('dt', '', label), node('dd', '', value));
      meta.append(item);
    };
    addMeta('Файл / источник', evidence?.sourceFile || row.sourceFolder || 'Не сохранён');
    addMeta('Способ чтения', evidence ? methods[evidence.method] || 'Не указан' : 'Не сохранён');
    addMeta('Страницы', pagesLabel(evidence?.sourcePages));
    const confidence = evidence?.confidence;
    if (typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= 0 && confidence <= 100) {
      addMeta('Оценка движка OCR', confidence.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%');
    }
    body.append(meta);

    if (!fields) {
      const empty = node('div', 'rx-source-unavailable');
      empty.append(node('h3', '', 'Исходные строки для этой записи не сохранены'),
        node('p', '', 'Ранее добавленные и введённые вручную строки могут не содержать историю распознавания. Реквизиты можно проверить по оригиналу документа.'));
      body.append(empty);
    } else {
      body.append(node('p', 'rx-source-note', 'Ниже — значения, полученные при чтении документа, и строки, из которых они были извлечены. Правки в реестре сохраняются отдельно. Сверьте реквизиты с оригиналом.'));
      if (typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= 0 && confidence <= 100) {
        body.append(node('p', 'rx-source-confidence-note', 'Процент — оценка движка распознавания текста. Он не подтверждает правильность суммы, номера, даты или ИНН.'));
      }

      const warnings = Array.isArray(evidence.warnings) ? evidence.warnings.map(item => typeof item === 'string' ? item : item?.message).filter(present) : [];
      if (warnings.length) {
        const warning = node('section', 'rx-source-warnings');
        warning.append(node('h3', '', 'Проверьте перед сохранением'));
        const list = node('ul');
        [...new Set(warnings.map(String))].forEach(message => list.append(node('li', '', message)));
        warning.append(list);
        body.append(warning);
      }

      const list = node('div', 'rx-source-fields');
      Object.entries(fieldLabels).forEach(([key, label]) => {
        const field = fields[key] && typeof fields[key] === 'object' ? fields[key] : {};
        const found = field.found === true && present(field.value);
        const item = node('section', 'rx-source-field' + (found ? '' : ' is-missing'));
        const fieldHead = node('div', 'rx-source-field-head');
        fieldHead.append(node('h3', '', label), node('span', 'rx-source-field-state', found ? 'Извлечено' : 'Не найдено'));
        item.append(fieldHead, node('p', 'rx-source-field-value', found ? field.value : 'Нужно проверить по оригиналу'));
        const source = present(field.sourceText) ? String(field.sourceText) : '';
        item.append(node('div', 'rx-source-line-label', source ? 'Исходная строка документа' : 'Исходная строка не определена'));
        if (source) item.append(node('blockquote', 'rx-source-line', source));
        const fieldPages = pagesLabel(field.pages);
        if (fieldPages) item.append(node('p', 'rx-source-field-pages', 'Страницы: ' + fieldPages));
        list.append(item);
      });
      body.append(list);
    }

    if (present(evidence?.rawText)) {
      const raw = node('details', 'rx-source-raw');
      raw.append(node('summary', '', 'Весь прочитанный текст'), node('pre', '', evidence.rawText));
      body.append(raw);
    }
    const foot = node('div', 'rx-source-foot');
    foot.append(node('span', '', 'Просмотр источника не изменяет строку реестра.'));
    const done = node('button', 'btn btn-primary', 'Готово');
    done.type = 'button';
    done.addEventListener('click', () => dialog.close());
    foot.append(done);
    dialog.append(head, body, foot);
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
    }, { once: true });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    document.body.append(dialog);
    dialog.showModal();
    close.focus();
  };
})();
