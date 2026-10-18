// Первичный запуск приложения. Загружается последним: код обращается к функциям
// из всех остальных модулей, поэтому они должны быть определены к этому моменту.

// ─── INIT ────────────────────────────────────────────────
// Repeated clicks while persistence is pending must not create another row.
['saveRecord', 'saveVehicle', 'saveGenerator', 'saveGenRecord', 'saveTank', 'saveTankIncome',
 'savePayment', 'saveContragent', 'saveRepair', 'saveVehicleTo', 'saveTankTransfer', 'addBudgetEntry', 'doRarMerge', 'doSvodkaImport',
 'reestrSaveCurrent', 'reestrOpenSaved', 'reestrDeleteSaved', 'tssSaveRecord', 'saveToRecord',
 'woSetStatus', 'woEnsurePayment', 'woSaveSettlement', 'importPaymentsFromJournals'].forEach(name => {
  if (typeof globalThis[name] === 'function') globalThis[name] = singleFlightAction(globalThis[name]);
});
(async () => {
  if (window.electronAPI?.getTheme) {
    try {
      const theme = await window.electronAPI.getTheme();
      if (theme) { localStorage.setItem('theme', theme); applyTheme(theme); }
      else if (window.electronAPI.setTheme) await window.electronAPI.setTheme(localStorage.getItem('theme') === 'dark' ? 'dark' : 'light');
      if (window.electronAPI.onThemeChanged) window.electronAPI.onThemeChanged(theme => { localStorage.setItem('theme', theme); applyTheme(theme); });
    } catch (error) { console.warn('[theme] ' + error.message); }
  }
  if (typeof workspaceMount === 'function') workspaceMount();
  data = await loadData();
  if(typeof productivityInitialize==='function')await productivityInitialize();
  if (data.reestrRows && data.reestrRows.length) reestrRows = data.reestrRows;
  rebuildIndex();
  populateOrgSelect();
  updateFilterUI();
  switchSection('home');
  if (typeof syncStartPolling === 'function') syncStartPolling();
  // «Что нового» после обновления — чуть позже, чтобы не мешать отрисовке
  if (typeof clCheckOnStart === 'function') setTimeout(clCheckOnStart, 1500);
  // Регламенты ТО и первичный график — один раз на базу
  if (typeof toAutoSetupOnce === 'function') setTimeout(() => toAutoSetupOnce().catch(e => console.warn('[ТО] ' + e.message)), 2500);
  if (window.electronAPI && window.electronAPI.getSettings) {
    _appSettings = await window.electronAPI.getSettings();
    updateSidebarDataPath();
    if (typeof workspaceRefresh === 'function') workspaceRefresh();
  }
  if (window.electronAPI && window.electronAPI.onReestrRowsSaved) {
    window.electronAPI.onReestrRowsSaved((payload) => {
      const rows = payload.rows;
      reestrRows = rows; data.reestrRows = rows;
      if (_sync.enabled) { _sync.synced.reestrRows = JSON.stringify(rows); _sync.revs.reestrRows = payload.revision; }
      const previous = JSON.parse(_lastPersisted || '{}'); previous.reestrRows = rows; _lastPersisted = JSON.stringify(previous);
      scheduleLocalBackup(_lastPersisted);
      if (activeSection === 'reestr') renderReestrSection();
    });
  }
})();
