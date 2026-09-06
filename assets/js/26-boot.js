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
