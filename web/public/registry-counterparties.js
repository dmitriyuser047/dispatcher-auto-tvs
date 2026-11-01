'use strict';
(() => {
  const web=window.tvsWeb ||= {},core=RegistryCounterparties;
  const readable=()=>_sync.access?.readable?.some(name=>name==='*'||name==='savedReestrs');
  let signature='',cached=new Map();
  function values(){const next=JSON.stringify([data.contragents||[],data.savedReestrs||[]]);if(next!==signature){signature=next;cached=core.statistics(data);}return cached;}
  web.registryCounterparties={headingsHtml:()=>readable()?'<th>Счетов из реестров</th><th>Сумма по реестрам</th>':'',summaryHtml:()=>readable()?' · счетов из реестров: '+[...values().values()].reduce((sum,item)=>sum+item.count,0):'',cellsHtml:id=>{if(!readable())return '';const result=values().get(id)||{count:0,sum:0};return `<td class="num">${result.count}</td><td class="num">${Number(result.sum).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})} ₽</td>`;}};
})();
