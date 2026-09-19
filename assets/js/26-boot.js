// Первичный запуск приложения. Загружается последним: код обращается к функциям
// из всех остальных модулей, поэтому они должны быть определены к этому моменту.

// ─── INIT ────────────────────────────────────────────────
(async () => {
  data = await loadData();
  if (data.reestrRows && data.reestrRows.length) reestrRows = data.reestrRows;
  rebuildIndex();
  populateOrgSelect();
  updateFilterUI();
  switchSection('home');
  if (typeof syncStartPolling === 'function') syncStartPolling();
  // «Что нового» после обновления — чуть позже, чтобы не мешать отрисовке
  if (typeof clCheckOnStart === 'function') setTimeout(clCheckOnStart, 1500);
  if (window.electronAPI && window.electronAPI.getSettings) {
    _appSettings = await window.electronAPI.getSettings();
    updateSidebarDataPath();
  }
  if (window.electronAPI && window.electronAPI.onReestrRowsSaved) {
    window.electronAPI.onReestrRowsSaved((rows) => {
      reestrRows = rows;
      data.reestrRows = rows;
      saveData(data);
    });
  }
})();
