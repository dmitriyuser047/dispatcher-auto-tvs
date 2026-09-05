// Печатные формы
// Выделено из index.html

// ─── ПЕЧАТНЫЕ ФОРМЫ ──────────────────────────────────────
function renderPrintFormsSection() {
  const vehicles = data.vehicles || [];
  const vOptions = vehicles.map(v =>
    `<option value="${v.id}">${v.plate||''} ${v.make||''}</option>`
  ).join('');

  document.getElementById('mainContent').innerHTML = `
    <div style="padding:24px 28px;width:100%;box-sizing:border-box;max-width:900px;margin:0 auto">
      <h3 style="margin:0 0 24px;font-size:18px;font-weight:700">Печатные формы</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px">

        <div class="card" style="padding:24px;cursor:default">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
            <div style="width:44px;height:44px;border-radius:10px;background:#dbeafe;display:flex;align-items:center;justify-content:center">
              <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="#2563eb" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div><div style="font-weight:700;font-size:15px">Путевой лист</div><div style="font-size:12px;color:var(--text3)">Форма для выезда ТС</div></div>
          </div>
          <div style="margin-bottom:12px">
            <label style="font-size:12px;color:var(--text3);font-weight:600">Транспортное средство</label>
            <select id="pfVehicle" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--input-bg);color:var(--text);margin-top:4px">
              <option value="">— Выберите ТС —</option>${vOptions}
            </select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
            <div>
              <label style="font-size:12px;color:var(--text3);font-weight:600">Дата выезда</label>
              <input type="date" id="pfDate" value="${new Date().toISOString().slice(0,10)}" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--input-bg);color:var(--text);margin-top:4px;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:12px;color:var(--text3);font-weight:600">Маршрут</label>
              <input type="text" id="pfRoute" placeholder="откуда — куда" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--input-bg);color:var(--text);margin-top:4px;box-sizing:border-box">
            </div>
          </div>
          <button class="primary-btn" onclick="generateWaybill()" style="width:100%">Сформировать PDF</button>
        </div>

        <div class="card" style="padding:24px;cursor:default">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
            <div style="width:44px;height:44px;border-radius:10px;background:#fef3c7;display:flex;align-items:center;justify-content:center">
              <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="#d97706" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <div><div style="font-weight:700;font-size:15px">Заявка на ГСМ</div><div style="font-size:12px;color:var(--text3)">Заявка на получение топлива</div></div>
          </div>
          <div style="margin-bottom:12px">
            <label style="font-size:12px;color:var(--text3);font-weight:600">Транспортное средство</label>
            <select id="pfFuelVehicle" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--input-bg);color:var(--text);margin-top:4px">
              <option value="">— Выберите ТС —</option>${vOptions}
            </select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
            <div>
              <label style="font-size:12px;color:var(--text3);font-weight:600">Дата</label>
              <input type="date" id="pfFuelDate" value="${new Date().toISOString().slice(0,10)}" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--input-bg);color:var(--text);margin-top:4px;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:12px;color:var(--text3);font-weight:600">Объём (л)</label>
              <input type="number" id="pfFuelAmount" placeholder="100" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--input-bg);color:var(--text);margin-top:4px;box-sizing:border-box">
            </div>
          </div>
          <div style="margin-bottom:12px">
            <label style="font-size:12px;color:var(--text3);font-weight:600">Вид топлива</label>
            <select id="pfFuelType" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--input-bg);color:var(--text);margin-top:4px">
              <option value="Дизельное топливо">Дизельное топливо</option>
              <option value="Бензин АИ-92">Бензин АИ-92</option>
              <option value="Бензин АИ-95">Бензин АИ-95</option>
              <option value="Газ">Газ</option>
            </select>
          </div>
          <button class="primary-btn" onclick="generateFuelRequest()" style="width:100%">Сформировать PDF</button>
        </div>

        <div class="card" style="padding:24px;cursor:default">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
            <div style="width:44px;height:44px;border-radius:10px;background:#dcfce7;display:flex;align-items:center;justify-content:center">
              <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="#16a34a" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            </div>
            <div><div style="font-weight:700;font-size:15px">Акт выполненных работ</div><div style="font-size:12px;color:var(--text3)">По ремонту / ТО</div></div>
          </div>
          <div style="margin-bottom:12px">
            <label style="font-size:12px;color:var(--text3);font-weight:600">Транспортное средство</label>
            <select id="pfActVehicle" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--input-bg);color:var(--text);margin-top:4px">
              <option value="">— Выберите ТС —</option>${vOptions}
            </select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
            <div>
              <label style="font-size:12px;color:var(--text3);font-weight:600">Дата</label>
              <input type="date" id="pfActDate" value="${new Date().toISOString().slice(0,10)}" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--input-bg);color:var(--text);margin-top:4px;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:12px;color:var(--text3);font-weight:600">Номер акта</label>
              <input type="text" id="pfActNumber" placeholder="001" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--input-bg);color:var(--text);margin-top:4px;box-sizing:border-box">
            </div>
          </div>
          <div style="margin-bottom:12px">
            <label style="font-size:12px;color:var(--text3);font-weight:600">Описание работ</label>
            <textarea id="pfActDesc" rows="2" placeholder="Замена масла, фильтров..." style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--input-bg);color:var(--text);margin-top:4px;box-sizing:border-box;resize:vertical"></textarea>
          </div>
          <div style="margin-bottom:12px">
            <label style="font-size:12px;color:var(--text3);font-weight:600">Сумма ₽</label>
            <input type="number" id="pfActSum" placeholder="0" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--input-bg);color:var(--text);margin-top:4px;box-sizing:border-box">
          </div>
          <button class="primary-btn" onclick="generateActPdf()" style="width:100%">Сформировать PDF</button>
        </div>

      </div>
    </div>`;
}

function generateWaybill() {
  const vid = document.getElementById('pfVehicle').value;
  if (!vid) { alert('Выберите транспортное средство'); return; }
  const v = data.vehicles.find(x=>x.id===vid);
  if (!v) return;
  const date = document.getElementById('pfDate').value || new Date().toISOString().slice(0,10);
  const route = document.getElementById('pfRoute').value.trim() || '—';
  const fuelLabel = {diesel:'Дизельное',gasoline:'Бензин',gas:'Газ'}[v.fuel]||v.fuel||'—';
  const org = v.org || 'ООО «Технрайз Велл Сервис»';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Путевой лист</title>
  <style>body{font-family:'Times New Roman',serif;font-size:14px;padding:40px;color:#000}
  h1{text-align:center;font-size:18px;margin-bottom:24px}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  td,th{border:1px solid #000;padding:6px 10px;text-align:left}
  th{background:#f0f0f0;font-weight:700}
  .sig{margin-top:60px;display:flex;justify-content:space-between}
  .sig div{width:45%}.sig .line{border-bottom:1px solid #000;margin-top:30px;text-align:center;font-size:12px;color:#666}
  </style></head><body>
  <div style="text-align:center;font-size:12px;color:#666;margin-bottom:8px">${org}</div>
  <h1>ПУТЕВОЙ ЛИСТ № ___</h1>
  <table>
    <tr><th style="width:200px">Дата выезда</th><td>${fmtDate(date)}</td></tr>
    <tr><th>Организация</th><td>${org}</td></tr>
    <tr><th>Транспортное средство</th><td>${v.make||''} ${v.model||''}</td></tr>
    <tr><th>Гос. номер</th><td>${v.plate||'—'}</td></tr>
    <tr><th>Водитель</th><td>${v.driver||'—'}</td></tr>
    <tr><th>Вид топлива</th><td>${fuelLabel}</td></tr>
    <tr><th>Маршрут</th><td>${route}</td></tr>
  </table>
  <table>
    <tr><th>Показания одометра</th><th>Выезд</th><th>Возврат</th><th>Пробег</th></tr>
    <tr><td>км</td><td style="min-width:100px"></td><td style="min-width:100px"></td><td style="min-width:100px"></td></tr>
  </table>
  <table>
    <tr><th>Топливо</th><th>Остаток при выезде (л)</th><th>Выдано (л)</th><th>Остаток при возврате (л)</th><th>Расход (л)</th></tr>
    <tr><td>${fuelLabel}</td><td></td><td></td><td></td><td></td></tr>
  </table>
  <div class="sig">
    <div>Механик _______________<div class="line">подпись / ФИО</div></div>
    <div>Водитель _______________<div class="line">подпись / ${v.driver||'ФИО'}</div></div>
  </div>
  </body></html>`;

  if (window.electronAPI && window.electronAPI.exportPdf) {
    window.electronAPI.exportPdf(html, `Путевой_лист_${v.plate||'ТС'}_${date}.pdf`);
  } else {
    const w = window.open('','_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(()=>w.print(), 500);
  }
}

function generateFuelRequest() {
  const vid = document.getElementById('pfFuelVehicle').value;
  if (!vid) { alert('Выберите транспортное средство'); return; }
  const v = data.vehicles.find(x=>x.id===vid);
  if (!v) return;
  const date = document.getElementById('pfFuelDate').value || new Date().toISOString().slice(0,10);
  const amount = document.getElementById('pfFuelAmount').value || '___';
  const fuelType = document.getElementById('pfFuelType').value;
  const org = v.org || 'ООО «Технрайз Велл Сервис»';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Заявка на ГСМ</title>
  <style>body{font-family:'Times New Roman',serif;font-size:14px;padding:40px;color:#000}
  h1{text-align:center;font-size:18px;margin-bottom:24px}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  td,th{border:1px solid #000;padding:6px 10px;text-align:left}
  th{background:#f0f0f0;font-weight:700}
  .sig{margin-top:60px;display:flex;justify-content:space-between}
  .sig div{width:30%}.sig .line{border-bottom:1px solid #000;margin-top:30px;text-align:center;font-size:12px;color:#666}
  </style></head><body>
  <div style="text-align:right;margin-bottom:20px">Утверждаю _______________<br><span style="font-size:11px;color:#666">должность / ФИО</span></div>
  <div style="text-align:center;font-size:12px;color:#666;margin-bottom:8px">${org}</div>
  <h1>ЗАЯВКА НА ПОЛУЧЕНИЕ ГСМ</h1>
  <p>Дата: <b>${fmtDate(date)}</b></p>
  <table>
    <tr><th>№</th><th>Наименование ГСМ</th><th>Ед. изм.</th><th>Кол-во</th><th>Назначение</th></tr>
    <tr><td>1</td><td>${fuelType}</td><td>литр</td><td>${amount}</td><td>${v.make||''} ${v.plate||''}</td></tr>
  </table>
  <table>
    <tr><th style="width:200px">Транспортное средство</th><td>${v.make||''} ${v.model||''}, гос. № ${v.plate||'—'}</td></tr>
    <tr><th>Водитель</th><td>${v.driver||'—'}</td></tr>
    <tr><th>Объект</th><td>${v.object||'—'}</td></tr>
  </table>
  <div class="sig">
    <div>Заявитель ___________<div class="line">подпись / ФИО</div></div>
    <div>Согласовано __________<div class="line">подпись / ФИО</div></div>
    <div>Получил ______________<div class="line">подпись / ${v.driver||'ФИО'}</div></div>
  </div>
  </body></html>`;

  if (window.electronAPI && window.electronAPI.exportPdf) {
    window.electronAPI.exportPdf(html, `Заявка_ГСМ_${v.plate||'ТС'}_${date}.pdf`);
  } else {
    const w = window.open('','_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(()=>w.print(), 500);
  }
}

function generateActPdf() {
  const vid = document.getElementById('pfActVehicle').value;
  if (!vid) { alert('Выберите транспортное средство'); return; }
  const v = data.vehicles.find(x=>x.id===vid);
  if (!v) return;
  const date = document.getElementById('pfActDate').value || new Date().toISOString().slice(0,10);
  const actNum = document.getElementById('pfActNumber').value.trim() || '___';
  const desc = document.getElementById('pfActDesc').value.trim() || '—';
  const sum = document.getElementById('pfActSum').value || '0';
  const org = v.org || 'ООО «Технрайз Велл Сервис»';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Акт выполненных работ</title>
  <style>body{font-family:'Times New Roman',serif;font-size:14px;padding:40px;color:#000}
  h1{text-align:center;font-size:18px;margin-bottom:24px}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  td,th{border:1px solid #000;padding:6px 10px;text-align:left}
  th{background:#f0f0f0;font-weight:700}
  .sig{margin-top:60px;display:flex;justify-content:space-between}
  .sig div{width:45%}.sig .line{border-bottom:1px solid #000;margin-top:30px;text-align:center;font-size:12px;color:#666}
  </style></head><body>
  <div style="text-align:center;font-size:12px;color:#666;margin-bottom:8px">${org}</div>
  <h1>АКТ ВЫПОЛНЕННЫХ РАБОТ № ${actNum}</h1>
  <p>Дата: <b>${fmtDate(date)}</b></p>
  <table>
    <tr><th style="width:200px">Транспортное средство</th><td>${v.make||''} ${v.model||''}, гос. № ${v.plate||'—'}</td></tr>
    <tr><th>Ответственный</th><td>${v.responsible||v.driver||'—'}</td></tr>
    <tr><th>Организация</th><td>${org}</td></tr>
  </table>
  <table>
    <tr><th>№</th><th>Наименование работ</th><th>Сумма ₽</th></tr>
    <tr><td>1</td><td>${desc}</td><td style="text-align:right">${Number(sum).toLocaleString('ru-RU')}</td></tr>
    <tr style="font-weight:700"><td colspan="2" style="text-align:right">ИТОГО:</td><td style="text-align:right">${Number(sum).toLocaleString('ru-RU')} ₽</td></tr>
  </table>
  <p>Работы выполнены в полном объёме. Заказчик претензий по объёму, качеству и срокам оказания услуг не имеет.</p>
  <div class="sig">
    <div>Исполнитель _______________<div class="line">подпись / ФИО</div></div>
    <div>Заказчик _______________<div class="line">подпись / ФИО</div></div>
  </div>
  </body></html>`;

  if (window.electronAPI && window.electronAPI.exportPdf) {
    window.electronAPI.exportPdf(html, `Акт_${actNum}_${v.plate||'ТС'}_${date}.pdf`);
  } else {
    const w = window.open('','_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(()=>w.print(), 500);
  }
}

