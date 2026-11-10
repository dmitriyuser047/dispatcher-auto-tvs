'use strict';
(() => {
  const web=window.tvsWeb ||= {},core=RegistryImport,signatures=new WeakMap();
  const esc=value=>htmlEsc(String(value??''));
  const money=value=>Number(value).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  const labels=core.expenseLabels;
  web.driverInvoices={mount(driverId){
    const main=document.getElementById('mainContent'),workspace=main?.querySelector('.personnel-workspace');if(!workspace)return;
    let panel=workspace.querySelector('[data-driver-invoices]');const readable=typeof _sync==='undefined'?[]:_sync.access?.readable||[];
    if(!readable.includes('*')&&!readable.includes('savedReestrs')){panel?.remove();return;}
    const bills=core.driverInvoices(data,driverId),projection=RegistryAccounting.project(data),states=new Map(projection.invoices.map(invoice=>[invoice.key,invoice.state])),uncounted=new Set();for(const entry of data.savedReestrs||[])if(core.isImportedRegister(entry))for(const invoice of core.invoices(entry))if(invoice.allocations.some(part=>part.kind==='driver'&&part.assetId===driverId)&&states.get(RegistryAccounting.invoiceKey(entry.id,invoice.registryInvoiceId||invoice.id))!=='included')uncounted.add(RegistryAccounting.invoiceKey(entry.id,invoice.registryInvoiceId??invoice.id));const signature=JSON.stringify([typeof driverId,driverId,bills,[...uncounted]]);if(panel&&signatures.get(panel)===signature)return;
    if(!panel){panel=document.createElement('section');panel.className='personnel-panel';panel.dataset.driverInvoices='';workspace.append(panel);}signatures.set(panel,signature);
    panel.innerHTML=`<div class="personnel-list-heading"><h3>Учтённые счета · ${bills.length}</h3></div>${uncounted.size?`<p data-registry-accounting-notice>Счетов вне итогов: ${uncounted.size}. <a href="/registries">Проверить повторы и решения</a></p>`:''}${bills.length?`<div class="tvs-table-wrap"><table class="tvs-data-table"><thead><tr><th>Счёт / дата</th><th>Контрагент и назначение</th><th>Сумма</th><th>Реестр</th></tr></thead><tbody>${bills.map(bill=>`<tr><td><a href="${bill.workspace==='logistics'?'/logistics':'/registries'}?register=${encodeURIComponent(JSON.stringify(bill.registerId))}&amp;invoice=${encodeURIComponent(bill.invoiceId||'')}">${esc(bill.invoiceNo||'Без номера')}</a><p class="personnel-caption">${esc(bill.date||'Дата не указана')}</p></td><td>${esc(bill.supplier)}<p class="personnel-caption">${esc(bill.description)}</p><small>${esc(bill.types.map(type=>labels[type]||'').filter(Boolean).join(' · '))}</small></td><td>${money(bill.sum)}${bill.sum!==bill.invoiceSum?`<p class="personnel-caption">Часть счёта на ${money(bill.invoiceSum)}</p>`:''}</td><td>${esc(bill.registerNumber||'Без номера')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="personnel-empty-inline">Счета появятся здесь после распределения в разделе «Реестры».</p>'}`;
  }};
})();
