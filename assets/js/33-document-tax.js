function frEditDocumentTax() {
  const database=data,contextStamp=wfCommandContextStamp();
  const rows=frTankIncomeRows().filter(row => fqDate(row.date) && row.date.startsWith(fuelRepYear) && !frIncomeIsPhysicalPair(row)).sort((a,b) => b.date.localeCompare(a.date));
  if(!rows.length) { showToast('Нет приходных документов за выбранный год'); return; }
  wfShowDialog('Тип операции и налог документа',`<form id="frTaxForm" class="wf-form"><label class="wf-wide">Приход<select id="frTaxRow">${rows.map((row,index) => `<option value="${index}">${htmlEsc([row.date,row.source,row.amount+' л',fqValue(row.sum) == null ? 'без суммы до налога' : row.sum+' ₽ без НДС'].join(' · '))}</option>`).join('')}</select></label><label>Операция<select id="frTaxKind"><option value="">Прежнее правило отчёта</option><option value="purchase">Закупка</option><option value="transfer">Перемещение</option><option value="return">Возврат</option><option value="other">Прочее</option></select></label><label>Ставка из документа, %<input id="frTaxRate" type="number" min="0" max="100" step="any"></label><label>Сумма НДС из документа, ₽<input id="frTaxAmount" type="number" min="0" step="any"></label><label>Итого с НДС из документа, ₽<input id="frTaxGross" type="number" min="0" step="any"></label><p class="wf-note wf-wide">Пустые поля означают отсутствие данных. Нулевая ставка или сумма задаётся явно. Сумма налога имеет приоритет перед ставкой. Итог документа проверяется отдельно; отсутствующая сумма без налога не считается нулём.</p><div id="frTaxError" role="alert" class="wf-error wf-wide"></div><button class="btn btn-primary">Подготовить исправление документа</button></form>`);
  let before='';
  const fill=() => {
    const selected=rows[Number(document.getElementById('frTaxRow').value)],row=selected&&frTankIncomeRows().find(item=>item.id===selected.id);
    if(!row) { document.getElementById('frTaxError').textContent='Документ удалён. Откройте форму заново.'; return; }
    before=JSON.stringify(row);
    for(const [id,key] of [['frTaxKind','operationType'],['frTaxRate','vatRate'],['frTaxAmount','vatAmount'],['frTaxGross','grossSum']]) document.getElementById(id).value=row[key] ?? '';
    document.getElementById('frTaxError').textContent='';precisionRemember(document.getElementById('frTaxForm'));
  };
  fill(); document.getElementById('frTaxRow').onchange=fill;
  document.getElementById('frTaxForm').onsubmit=async event => {
    event.preventDefault();
    try {
      if(database!==data||contextStamp!==wfCommandContextStamp()||!document.getElementById('frTaxForm')?.closest('#wfModal.open'))throw Error('База, пользователь, права или форма изменились. Откройте документ заново.');
      const selected=rows[Number(document.getElementById('frTaxRow').value)],row=selected&&frTankIncomeRows().find(item=>item.id===selected.id);
      if(!row || JSON.stringify(row) !== before) throw Error('Документ изменился. Откройте форму снова.');
      if(!fuelEditAllowed(row.date)) return;
      const rate=precisionInput('frTaxRate',{scale:6,blank:'null',max:100,previous:row.vatRate}),vat=precisionInput('frTaxAmount',{scale:2,blank:'null',previous:row.vatAmount}),gross=precisionInput('frTaxGross',{scale:2,blank:'null',previous:row.grossSum});
      const operationType=document.getElementById('frTaxKind').value;
      if(!['','purchase','transfer','return','other'].includes(operationType)) throw Error('Выберите тип операции');
      const values=Object.fromEntries(Object.entries({operationType:operationType===''&&!Object.hasOwn(row,'operationType')?undefined:operationType,vatRate:rate,vatAmount:vat,grossSum:gross,taxSource:'document'}).filter(([,value])=>value!==undefined));
      for(const [key,value]of Object.entries(values))if(JSON.stringify(row[key])!==JSON.stringify(value)&&!lifecycleFieldWritable('tankIncomes',key))throw Error('Нет права менять поле документа: '+key);
      if(frTax({...row,...values}).invalid) throw Error('Проверьте суммы: итог должен совпадать с суммой без налога и НДС. Ставка: от 0 до 100%.');
      return lifecycleEditor({section:'tankIncomes',payload:lifecycleEditable('tankIncomes',{...row,...values}),correctionOf:{section:'tankIncomes',id:row.id},actions:[['saveDraft','Сохранить черновик исправления']]});
    } catch(error) { document.getElementById('frTaxError').textContent=error.message; }
  };
}
