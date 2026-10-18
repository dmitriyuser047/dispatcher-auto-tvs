function frEditDocumentTax() {
  const rows=(data.tankIncomes || []).filter(row => fqDate(row.date) && row.date.startsWith(fuelRepYear) && !row.linkId).sort((a,b) => b.date.localeCompare(a.date));
  if(!rows.length) { showToast('Нет приходных документов за выбранный год'); return; }
  wfShowDialog('Тип операции и налог документа',`<form id="frTaxForm" class="wf-form"><label class="wf-wide">Приход<select id="frTaxRow">${rows.map(row => `<option value="${htmlEsc(row.id)}">${htmlEsc([row.date,row.source,row.amount+' л',fqValue(row.sum) == null ? 'без суммы до налога' : row.sum+' ₽ без НДС'].join(' · '))}</option>`).join('')}</select></label><label>Операция<select id="frTaxKind"><option value="">Прежнее правило отчёта</option><option value="purchase">Закупка</option><option value="transfer">Перемещение</option><option value="return">Возврат</option><option value="other">Прочее</option></select></label><label>Ставка из документа, %<input id="frTaxRate" type="number" min="0" max="100" step="any"></label><label>Сумма НДС из документа, ₽<input id="frTaxAmount" type="number" min="0" step="any"></label><label>Итого с НДС из документа, ₽<input id="frTaxGross" type="number" min="0" step="any"></label><p class="wf-note wf-wide">Пустые поля означают отсутствие данных. Нулевая ставка или сумма задаётся явно. Сумма налога имеет приоритет перед ставкой. Итог документа проверяется отдельно; отсутствующая сумма без налога не считается нулём.</p><div id="frTaxError" role="alert" class="wf-error wf-wide"></div><button class="btn btn-primary">Сохранить</button></form>`);
  let before='';
  const fill=() => {
    const row=data.tankIncomes.find(item => item.id === document.getElementById('frTaxRow').value);
    if(!row) { document.getElementById('frTaxError').textContent='Документ удалён. Откройте форму заново.'; return; }
    before=JSON.stringify(row);
    for(const [id,key] of [['frTaxKind','operationType'],['frTaxRate','vatRate'],['frTaxAmount','vatAmount'],['frTaxGross','grossSum']]) document.getElementById(id).value=row[key] ?? '';
    document.getElementById('frTaxError').textContent='';
  };
  fill(); document.getElementById('frTaxRow').onchange=fill;
  document.getElementById('frTaxForm').onsubmit=async event => {
    event.preventDefault();
    try {
      const row=data.tankIncomes.find(item => item.id === document.getElementById('frTaxRow').value);
      if(!row || JSON.stringify(row) !== before) throw Error('Документ изменился. Откройте форму снова.');
      if(!fuelEditAllowed(row.date)) return;
      const number=(id,label,max) => {
        const raw=document.getElementById(id).value.trim(); if(raw === '') return null;
        const value=fqValue(raw); if(value == null || value < 0 || max != null && value > max) throw Error('Неверное значение: '+label);
        return value;
      };
      const rate=number('frTaxRate','ставка',100),vat=number('frTaxAmount','сумма НДС'),gross=number('frTaxGross','итог документа');
      const operationType=document.getElementById('frTaxKind').value;
      if(!['','purchase','transfer','return','other'].includes(operationType)) throw Error('Выберите тип операции');
      const values={operationType,vatRate:rate,vatAmount:vat,grossSum:gross,taxSource:'document'};
      if(frTax({...row,...values}).invalid) throw Error('Проверьте суммы: итог должен совпадать с суммой без налога и НДС. Ставка: от 0 до 100%.');
      Object.assign(row,values);
      if(await saveData(data,{noMerge:true})) { closeModal('wfModal'); renderFuelReport(); }
    } catch(error) { document.getElementById('frTaxError').textContent=error.message; }
  };
}