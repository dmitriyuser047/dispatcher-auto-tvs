// Реестр-билдер (встроенный)
// Выделено из index.html

// ═══════════════════════════════════════════════════════════════
//  РЕЕСТР-БИЛДЕР (встроенный)
// ═══════════════════════════════════════════════════════════════
let reestrFiles = [];
let reestrRows = [];
let reestrStatyi = [];
let reestrContracts = [];
let reestrLastResult = null;
let reestrStatyiLoaded = false;
let reestrContractsLoaded = false;
let reestrDuplicates = [];

async function loadReestrStatyi() {
  if (reestrStatyiLoaded) return;
  if (window.reestrAPI) {
    reestrStatyi = await window.reestrAPI.loadStatyi();
    reestrStatyiLoaded = true;
  }
}

async function loadReestrContracts() {
  if (reestrContractsLoaded) return;
  if (window.reestrAPI) {
    reestrContracts = await window.reestrAPI.loadContracts();
    reestrContractsLoaded = true;
  }
}

