'use strict';
(() => {
  const web=window.tvsWeb ||= {},core=RegistryImport,esc=value=>htmlEsc(String(value??'')),signatures=new WeakMap();
  const money=value=>value===null||value===undefined?'Не указана':Number(value).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  const readable=()=>_sync.access?.readable?.some(name=>name==='*'||name==='savedReestrs');
  const url=bill=>(bill.workspace==='logistics'?'/logistics':'/registries')+'?register='+encodeURIComponent(JSON.stringify(bill.registerId))+'&invoice='+encodeURIComponent(bill.invoiceId);
  function assetBills(kind,assetId){
    const result=[];for(const entry of data.savedReestrs||[]){if(!core.isImportedRegister(entry))continue;for(const invoice of core.invoices(entry)){const parts=invoice.allocations.filter(part=>part.kind===kind&&part.assetId===assetId);if(!parts.length)continue;result.push({registerId:entry.id,workspace:core.workspaceOf(entry),types:[...new Set(parts.map(part=>part.expenseType||'other'))],registerNumber:entry.number,invoiceId:invoice.registryInvoiceId,invoiceNo:invoice.invoiceNo||invoice.osn||'',date:invoice.date||'',supplier:invoice.supplier||'',description:invoice.description||'',sum:core.total(parts.map(part=>part.sum)),invoiceSum:invoice.sum});}}return result;
  }
  function invoiceTable(bills){
    if(!bills.length)return '<p class="tvs-vehicle-invoices-empty">Счета появятся здесь после распределения в разделе «Реестры».</p>';
    return `<div class="tvs-table-wrap"><table class="tvs-data-table"><thead><tr><th>Счёт / дата</th><th>Контрагент и назначение</th><th>Сумма</th><th>Реестр</th></tr></thead><tbody>${bills.map(bill=>`<tr><td><a href="${esc(url(bill))}">${esc(bill.invoiceNo||'Без номера')}</a><small>${esc(bill.date)}</small></td><td>${esc(bill.supplier)}<small>${esc(bill.description)}</small><small>${esc((bill.types||[]).map(type=>core.expenseLabels[type]||'').filter(Boolean).join(' · '))}</small></td><td class="tvs-num">${money(bill.sum)}${bill.sum!==bill.invoiceSum?`<small>Часть счёта на ${money(bill.invoiceSum)}</small>`:''}</td><td>${esc(bill.registerNumber||'Без номера')}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function vehicleHtml(vehicleId){
    if(!(data.vehicles||[]).some(vehicle=>vehicle.id===vehicleId))return '';
    const bills=readable()?assetBills('vehicle',vehicleId):[],base='/transport/vehicle?asset='+encodeURIComponent(JSON.stringify(vehicleId));
    return `<div class="tvs-vehicle-invoices-heading"><div><h3>Счета и расходы по автомобилю</h3>${readable()?`<p>Счета · ${bills.length}${bills.length?' · '+money(core.total(bills.map(bill=>bill.sum))):''}</p>`:''}</div><div class="tvs-service-links"><a class="btn btn-ghost btn-sm" href="${esc(base+'&view=repairs')}">Журнал ремонта</a><a class="btn btn-ghost btn-sm" href="${esc(base+'&view=to')}">График ТО</a></div></div>${readable()?invoiceTable(bills):''}`;
  }
  function generatorHtml(generatorId){
    if(!readable()||!(data.generators||[]).some(generator=>generator.id===generatorId))return '';
    const bills=assetBills('generator',generatorId);return `<div class="tvs-vehicle-invoices-heading"><div><h3>Счета по ДЭС <span>· ${bills.length}</span></h3><p>Распределены из реестров${bills.length?' · '+money(core.total(bills.map(bill=>bill.sum))):''}</p></div></div>${invoiceTable(bills)}`;
  }
  function mountPanel(kind,id){
    const main=document.getElementById('mainContent');if(!main)return;const marker=kind==='vehicle'?'data-vehicle-invoices':'data-generator-invoices';let panel=main.querySelector('['+marker+']');
    const html=kind==='vehicle'?vehicleHtml(id):generatorHtml(id);if(!html){panel?.remove();return;}
    const grid=kind==='vehicle'?main.querySelector('.vd-journals-grid'):null;
    if(!panel){panel=document.createElement('section');panel.className='tvs-vehicle-invoices';panel.setAttribute(marker,'');if(grid)grid.append(panel);else{const destination=main.querySelector('.table-wrap');if(destination)destination.before(panel);else main.append(panel);}}
    if(grid){grid.classList.add('tvs-service-journals');grid.querySelector('[onclick="openVehicleJournal(\'to\')"]')?.remove();grid.querySelector('[onclick="openVehicleJournal(\'repairs\')"]')?.remove();}
    if(signatures.get(panel)===html)return;signatures.set(panel,html);panel.innerHTML=html;
  }
  function headingHtml(){return readable()?'<th>Счета</th>':'';}
  function cellHtml(section,row){
    if(!readable())return '';let bills;try{bills=core.serviceInvoices(data,{section,id:row.id});}catch{return '<td class="tvs-service-invoices">—</td>';}
    return `<td class="tvs-service-invoices">${bills.map(bill=>`<a href="${esc(url(bill))}">${esc(bill.invoiceNo||'Счёт без номера')} · ${money(bill.sum)}</a><small>${esc(bill.supplier)} · реестр ${esc(bill.registerNumber)}${bill.sum!==bill.invoiceSum?' · часть счёта на '+money(bill.invoiceSum):''}</small>`).join('')||(row.invoiceNo?`<span>${esc(row.invoiceNo)}</span><small>Номер в записи</small>`:'<small>—</small>')}</td>`;
  }
  web.vehicleInvoices={headingHtml,cellHtml,vehicleHtml,generatorHtml,mount:vehicleId=>mountPanel('vehicle',vehicleId),mountGenerator:generatorId=>mountPanel('generator',generatorId)};
})();
