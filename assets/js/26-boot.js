// Первичный запуск приложения. Загружается последним: код обращается к функциям
// из всех остальных модулей, поэтому они должны быть определены к этому моменту.

// ─── INIT ────────────────────────────────────────────────
(async () => {
  if (window.electronAPI?.getTheme) {
    try {
      const theme = await window.electronAPI.getTheme();
      if (theme) { localStorage.setItem('theme', theme); applyTheme(theme); }
      else await window.electronAPI.setTheme(localStorage.getItem('theme') === 'dark' ? 'dark' : 'light');
      window.electronAPI.onThemeChanged(theme => { localStorage.setItem('theme', theme); applyTheme(theme); });
    } catch (e) { console.warn('[theme] ' + e.message); }
  }
  data = await loadData();
  if (data.reestrRows && data.reestrRows.length) reestrRows = data.reestrRows;
  rebuildIndex();
  populateOrgSelect();
  updateFilterUI();
  switchSection('home');
  if (typeof syncStartPolling === 'function') syncStartPolling();
  // «Что нового» после обновления — чуть позже, чтобы не мешать отрисовке
  if (typeof clCheckOnStart === 'function') setTimeout(clCheckOnStart, 1500);
  // Регламенты ТО и первичный график — один раз на базу
  // Регламенты и планы утверждаются из графика ТО. Запуск приложения не
  // назначает интервалы по предположению о марке и не создаёт работы в базе.
  if (window.electronAPI && window.electronAPI.getSettings) {
    _appSettings = await window.electronAPI.getSettings();
    updateSidebarDataPath();
  }
  if (window.electronAPI && window.electronAPI.onReestrRowsSaved) {
    window.electronAPI.onReestrRowsSaved((payload) => {
      if (!payload || !Array.isArray(payload.rows)) return;
      if (typeof _sync !== 'undefined' && _sync.databaseToken && payload.databaseToken !== _sync.databaseToken) return;
      const sections = { reestrRows:payload.rows, ...payload.canonicalSections };
      const previous = JSON.parse(_lastPersisted || '{}');
      for (const [name, rows] of Object.entries(sections)) {
        data[name] = rows; previous[name] = rows;
        if (typeof _sync !== 'undefined' && _sync.enabled) {
          _sync.synced[name] = JSON.stringify(rows);
          if (payload.revisions && name in payload.revisions) _sync.revs[name] = payload.revisions[name];
          else if (name === 'reestrRows') _sync.revs[name] = payload.revision;
        }
      }
      reestrRows = payload.rows;
      _lastPersisted = JSON.stringify(previous);
      scheduleLocalBackup(_lastPersisted);
      rebuildIndex();
      if (activeSection === 'reestr' && typeof renderReestrSection === 'function') renderReestrSection();
    });
  }
})();
