/* ===== GBi Kostenermittlung – iPhone-Version =====
   Eigenstaendige Web-App. Datenaustausch mit der Desktop-Version ausschliesslich
   ueber deren JSON-Formate:
     - Projekt:     "JSON exportieren" / "Import"   -> {version, level, fields, rows, variants, activeVariantId, ...}
     - Preisstamm:  "Preisstamm exportieren"        -> {version:1, prices:[...]}
   Unbekannte Felder eines importierten Projekts (Wappen, Unterschrift, Pruefdaten ...)
   bleiben unveraendert erhalten und gehen beim Export wieder mit zurueck. */
(function () {
  'use strict';

  const APP_VERSION = '1.1';
  const KEYS = { project: 'gbiM.project', catalog: 'gbiM.catalog', settings: 'gbiM.settings', stamp: 'gbiM.stamp', central: 'gbiM.central', ai: 'gbiM.ai' };
  const UNITS = ['Stk.', 'm²', 'm', 'm³', 'to', 'psch', 'Std.'];
  const LEVELS = ['Kostenhochrechnung', 'Kostenschätzung', 'Kostenberechnung'];
  const LEVEL_SHORT = { Kostenhochrechnung: 'Hochrechnung', Kostenschätzung: 'Schätzung', Kostenberechnung: 'Berechnung' };
  const LEVEL_HELP = {
    Kostenhochrechnung: 'Grobdetail (vergleichbar Kostenrahmen nach DIN 276, frühe Projektphase): Kostenblöcke und Kennwerte, übliche Schwankungsbreite ca. ±30–40 %.',
    Kostenschätzung: 'Mittlerer Detailgrad (DIN 276, Vorplanung / HOAI LPH 2): Kosten nach Gewerken bzw. Kostengruppen mit Mengen und Einheitspreisen, übliche Schwankungsbreite ca. ±20–30 %.',
    Kostenberechnung: 'Hoher Detailgrad (DIN 276, Entwurfsplanung / HOAI LPH 3): gegliederte Einzelpositionen auf Basis von Entwurfszeichnungen und Massenermittlungen, übliche Schwankungsbreite ca. ±10–20 %.'
  };
  /* Verbindliche Gliederungstiefe je Ermittlungsstufe fuer die KI (lang) und als Hinweis im Blatt (kurz) */
  const LEVEL_RULES = {
    Kostenhochrechnung: 'Grobe Gliederung in wenige Kostenblöcke (etwa 3–8 Kostengruppen) mit je 1–3 zusammengefassten Positionen nach Kennwerten, '
      + 'z. B. „Kanal DN 300 komplett inkl. Erdarbeiten und Oberfläche“ je m, „Straße Vollausbau“ je m² oder pauschal. Keine Einzelleistungen, Zulagen oder Nebenleistungen als eigene Positionen.',
    Kostenschätzung: 'Gliederung nach Gewerken bzw. Kostengruppen (DIN 276) mit zusammengefassten Leistungspositionen (etwa 3–10 je Kostengruppe) als Menge × Einheitspreis, '
      + 'z. B. Oberflächenaufbruch, Erdarbeiten, Kanal DN 300, Hausanschlüsse, Oberflächenwiederherstellung. Keine Zulagen und Kleinstpositionen.',
    Kostenberechnung: 'Detaillierte, LV-nahe Einzelpositionen je Gewerk auf Basis der Entwurfsplanung, z. B. Aufbruch nach Schichten, Aushub nach Homogenbereichen, Verbau, '
      + 'Wasserhaltung, Rohrbettung und -umhüllung, Formstücke, Schächte, Anschlüsse, Zulagen, Prüfungen und Dokumentation.'
  };
  const LEVEL_RULES_SHORT = {
    Kostenhochrechnung: 'Wenige Kostenblöcke mit zusammengefassten Kennwert- oder Pauschalpositionen.',
    Kostenschätzung: 'Kostengruppen nach Gewerken mit zusammengefassten Leistungspositionen (Menge × EP).',
    Kostenberechnung: 'Detaillierte, LV-nahe Einzelpositionen inkl. Zulagen, Nebenleistungen und Prüfungen.'
  };
  const SITES = {
    'gbi-hz': {
      label: 'GBi Herzogenaurach', company: 'GBi Kommunale Infrastruktur GmbH & Co. KG',
      address: 'Werner-Heisenberg-Straße 9, 91074 Herzogenaurach', phone: 'Tel. 09132-766-0 · Fax 09132-766-150',
      web: 'www.gbi-info.de', brand: '#9E0C14', logo: 'assets/logo-gbi.png', stamp: true
    },
    'gbi-kig': {
      label: 'GBi-KIG Montabaur', company: 'GBI-KIG Kommunale Infrastruktur GmbH',
      address: 'Wilhelm-Mangels-Str. 17, 56410 Montabaur', phone: 'Tel. 02602 / 9529950',
      web: 'www.gbi-info.de', brand: '#9E0C14', logo: 'assets/logo-gbi.png', stamp: false
    },
    'ibbi': {
      label: 'IB-BI Ansbach', company: 'Ing.-Büro für Tiefbau Biedermann GmbH',
      address: 'Technologiepark 9 (Turm 3), 91522 Ansbach', phone: 'Tel. 0981 / 75 57 0 - 300',
      web: 'www.ib-bi.de', brand: '#09493F', logo: 'assets/logo-ibbi.png', stamp: false
    }
  };

  /* ---------- Hilfsfunktionen ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    let t = String(v == null ? '' : v).trim().replace(/[^\d,.-]/g, '');
    if (!t) return 0;
    if (t.indexOf(',') > -1) t = t.replace(/\./g, '').replace(',', '.');
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }
  const isBlank = v => v === '' || v == null;
  const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
  const dec2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const qtyFmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 });
  const clone = o => JSON.parse(JSON.stringify(o));
  const uid = () => 'var-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const todayISO = () => new Date().toISOString().slice(0, 10);
  function dateDE(iso) { const p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : String(iso || ''); }
  const chev = '<svg class="chev" viewBox="0 0 8 13" aria-hidden="true"><path d="M1.5 1.5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function loadJSON(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { toast('Speichern auf dem iPhone fehlgeschlagen'); return false; }
  }

  /* ---------- Zustand ---------- */
  let settings = Object.assign({ site: 'gbi-hz', vat: 19, author: '', coverPage: true, allVariants: true }, loadJSON(KEYS.settings, {}));
  if (!SITES[settings.site]) settings.site = 'gbi-hz';
  let catalog = loadJSON(KEYS.catalog, []);
  /* KI-Zugang: API-Schluessel nur auf diesem Geraet, nie im Projekt-Export */
  let ai = Object.assign({ key: '', model: '', consent: false }, loadJSON(KEYS.ai, {}));
  /* Firmenstempel als Bild (data-URL); wird nicht mit der Web-App ausgeliefert, sondern je iPhone importiert */
  let stamp = '';
  try { stamp = localStorage.getItem(KEYS.stamp) || ''; } catch (e) { stamp = ''; }
  if (!Array.isArray(catalog)) catalog = [];
  /* Stammdaten der Desktop-Version (Zentrale Verwaltung), siehe takeMasterData() */
  let central = loadJSON(KEYS.central, null);
  if (!central || typeof central !== 'object' || Array.isArray(central)) central = null;
  let project;
  try { project = normalizeProject(loadJSON(KEYS.project, null) || newProjectObject()); }
  catch (e) { project = normalizeProject(newProjectObject()); }
  /* Aeltere Staende hatten Preisstamm und Zentrale Verwaltung im Projekt mitgespeichert */
  {
    const legacy = takeMasterData(project);
    try {
      if (legacy.central && !central) { central = legacy.central; localStorage.setItem(KEYS.central, JSON.stringify(central)); }
      if (legacy.prices.length && !catalog.length) { catalog = legacy.prices; localStorage.setItem(KEYS.catalog, JSON.stringify(catalog)); }
      if (legacy.central || legacy.prices.length) localStorage.setItem(KEYS.project, JSON.stringify(project));
    } catch (e) { /* Speicher voll: Stand bleibt fuer diese Sitzung im Arbeitsspeicher */ }
  }
  const ui = { tab: 'projekt', selected: -1, search: '', reorder: false };

  function site() { return SITES[settings.site] || SITES['gbi-hz']; }
  function variant() { return project.variants.find(v => v.id === project.activeVariantId) || project.variants[0]; }
  function rows() { return variant().rows; }
  function levelTitle() { return (project.levelHeadings && project.levelHeadings[project.level]) || project.level; }

  function newProjectObject() {
    const s = site();
    const level = 'Kostenschätzung';
    return {
      version: 2, level,
      fields: {
        projectNo: '', projectName: '', bauvorhaben: '', date: todayISO(), client: '', clientAddress: '',
        company: s.company, author: settings.author || '', companyAddress: s.address, variant: level,
        vat: String(settings.vat || 19), notes: ''
      },
      variants: [{ id: uid(), name: level, rows: [
        { type: 'group', oz: '1', text: 'Neue Kostengruppe' },
        { type: 'item', oz: '1.1', text: 'Neue Kostenposition', qty: '', unit: '', price: '' }
      ] }],
      activeVariantId: null
    };
  }

  function normalizeProject(o) {
    if (!o || typeof o !== 'object') throw new Error('Ungültige Projektdatei.');
    const p = clone(o);
    p.fields = Object.assign({
      projectNo: '', projectName: '', bauvorhaben: '', date: todayISO(), client: '', clientAddress: '',
      company: '', author: '', companyAddress: '', variant: '', vat: '19', notes: ''
    }, p.fields || {});
    if (typeof p.bauvorhaben === 'string' && !p.fields.bauvorhaben) p.fields.bauvorhaben = p.bauvorhaben;
    if (LEVELS.indexOf(p.level) < 0) p.level = 'Kostenschätzung';
    if (!Array.isArray(p.variants) || !p.variants.length) {
      if (!Array.isArray(p.rows)) throw new Error('Ungültige Projektdatei: keine Positionen gefunden.');
      p.variants = [{ id: uid(), name: p.fields.variant || p.level, rows: p.rows }];
    }
    p.variants.forEach(v => {
      if (!v.id) v.id = uid();
      if (!v.name) v.name = 'Variante';
      if (!Array.isArray(v.rows)) v.rows = [];
      v.rows = v.rows.filter(r => r && typeof r === 'object').map(r => { if (r.type !== 'group') r.type = 'item'; return r; });
    });
    if (!p.variants.some(v => v.id === p.activeVariantId)) p.activeVariantId = p.variants[0].id;
    p.version = Math.max(2, Number(p.version) || 2);
    return p;
  }

  /* Exportform wie die Desktop-Funktion pack(): rows = aktive Variante,
     fields.variant = deren Name, bauvorhaben zusaetzlich auf oberster Ebene. */
  function exportObject() {
    const p = clone(project);
    const v = p.variants.find(x => x.id === p.activeVariantId) || p.variants[0];
    p.rows = v.rows;
    p.fields.variant = v.name;
    p.bauvorhaben = p.fields.bauvorhaben;
    p.version = 2;
    /* Stammdaten wie beim Desktop-Export beilegen */
    p.priceCatalog = clone(catalog);
    if (central) p.gbiCentralDB = Object.assign(clone(central), { priceCatalog: clone(catalog) });
    return p;
  }

  let persistTimer = null;
  function persist() {
    clearTimeout(persistTimer);
    project.rows = rows();
    project.fields.variant = variant().name;
    project.bauvorhaben = project.fields.bauvorhaben;
    saveJSON(KEYS.project, project);
  }
  function persistSoon() { clearTimeout(persistTimer); persistTimer = setTimeout(persist, 300); }
  function saveSettings() { saveJSON(KEYS.settings, settings); }

  /* ---------- Berechnung ---------- */
  const amount = r => num(r.qty) * num(r.price);
  const netOf = list => list.reduce((s, r) => (r && r.type !== 'group' ? s + amount(r) : s), 0);
  const vatPercent = () => num(project.fields.vat);
  function groupsOf(list) {
    const out = []; let cur = null;
    list.forEach((r, i) => {
      if (r.type === 'group') { cur = { index: i, row: r, items: [], sum: 0 }; out.push(cur); }
      else {
        if (!cur) { cur = { index: -1, row: null, items: [], sum: 0 }; out.push(cur); }
        cur.items.push({ index: i, row: r }); cur.sum += amount(r);
      }
    });
    return out;
  }
  function groupEnd(list, i) { let end = i + 1; while (end < list.length && list[end].type !== 'group') end++; return end; }
  function groupOrdinal(list, at) { let n = 0; for (let i = 0; i < at; i++) if (list[i] && list[i].type === 'group') n++; return n + 1; }
  function itemOz(list, at) {
    let gi = -1;
    for (let i = at - 1; i >= 0; i--) if (list[i] && list[i].type === 'group') { gi = i; break; }
    const base = gi >= 0 ? (list[gi].oz || String(groupOrdinal(list, gi))) : '1';
    let n = 0;
    for (let j = gi + 1; j < at; j++) { if (list[j].type === 'group') break; n++; }
    return base + '.' + (n + 1);
  }

  /* ---------- Zeilen bearbeiten (Einfuegelogik wie Desktop) ---------- */
  function validSelection() { return ui.selected >= 0 && ui.selected < rows().length; }
  function addGroup() {
    const list = rows();
    const at = validSelection() ? ui.selected : list.length;   // oberhalb der markierten Zeile
    list.splice(at, 0, { type: 'group', oz: String(groupOrdinal(list, at)), text: 'Neue Kostengruppe' });
    ui.selected = at; commit(); openRowSheet(at);
  }
  function addItem(at) {
    const list = rows();
    if (typeof at !== 'number') at = validSelection() ? ui.selected + 1 : list.length;   // unterhalb der markierten Zeile
    list.splice(at, 0, { type: 'item', oz: itemOz(list, at), text: 'Neue Kostenposition', qty: '', unit: '', price: '' });
    ui.selected = at; commit(); openRowSheet(at);
  }
  function duplicateRow(i) {
    const list = rows(); if (!list[i]) return;
    list.splice(i + 1, 0, clone(list[i]));
    ui.selected = i + 1; commit(); toast('Kopie eingefügt');
  }
  function deleteRow(i) {
    const list = rows(); const r = list[i]; if (!r) return false;
    const end = r.type === 'group' ? groupEnd(list, i) : i + 1;
    const n = end - i - 1;
    const msg = r.type === 'group' && n > 0
      ? 'Kostengruppe „' + (r.text || r.oz || '') + '“ mit ' + n + ' Position' + (n === 1 ? '' : 'en') + ' löschen?'
      : (r.type === 'group' ? 'Kostengruppe löschen?' : 'Position „' + (r.text || r.oz || '') + '“ löschen?');
    if (!confirm(msg)) return false;
    list.splice(i, end - i);
    ui.selected = -1; commit(); return true;
  }
  function renumber() {
    let g = 0, p = 0;
    rows().forEach(r => { if (r.type === 'group') { g++; p = 0; r.oz = String(g); } else { p++; r.oz = String(g || 1) + '.' + p; } });
    commit(); toast('Ordnungszahlen neu vergeben');
  }
  /* ---------- Verschieben ----------
     Eine Kostengruppe wandert immer mit ihren Positionen. Die OZ bleiben wie am Desktop
     unveraendert; "OZ neu nummerieren" ist ein eigener Schritt. */
  function blockEnd(list, i) { return list[i] && list[i].type === 'group' ? groupEnd(list, i) : i + 1; }
  /* Block ab "from" vor die Zeile "to" setzen (Index bezogen auf die Liste vor dem Verschieben) */
  function moveBlock(from, to) {
    const list = rows(); if (!list[from]) return false;
    const end = blockEnd(list, from), len = end - from;
    to = Math.max(0, Math.min(list.length, to));
    if (to >= from && to <= end) return false;
    const block = list.splice(from, len);
    const dest = to > from ? to - len : to;
    list.splice(dest, 0, ...block);
    ui.selected = dest; commit();
    return true;
  }
  function moveUp(i) {
    const list = rows(); const r = list[i]; if (!r || i === 0) return false;
    if (r.type !== 'group') return moveBlock(i, i - 1);
    let p = i - 1; while (p > 0 && list[p].type !== 'group') p--;   // Beginn der vorherigen Kostengruppe
    return moveBlock(i, p);
  }
  function moveDown(i) {
    const list = rows(); const r = list[i]; if (!r) return false;
    const end = blockEnd(list, i); if (end >= list.length) return false;
    return moveBlock(i, r.type === 'group' ? blockEnd(list, end) : i + 2);
  }
  function moveMenu(i) {
    const list = rows(); const r = list[i]; if (!r) return;
    const isGroup = r.type === 'group', items = [];
    if (i > 0) items.push({ label: 'Nach oben', action: () => moveUp(i) });
    if (blockEnd(list, i) < list.length) items.push({ label: 'Nach unten', action: () => moveDown(i) });
    if (!isGroup) {
      groupsOf(list).filter(g => g.row).forEach(g => {
        const inside = g.items.some(it => it.index === i);
        items.push({
          label: 'In ' + [g.row.oz, g.row.text || 'Kostengruppe'].filter(Boolean).join(' · '), checked: inside,
          action: () => { if (!inside) moveBlock(i, groupEnd(rows(), g.index)); }
        });
      });
    }
    items.push({ label: 'Frei anordnen (Griffe einblenden)', action: () => setReorder(true) });
    actionSheet((isGroup ? 'Kostengruppe' : 'Position') + ' „' + [r.oz, r.text].filter(Boolean).join(' ') + '“ verschieben', items);
  }
  function setReorder(on) {
    ui.reorder = !!on;
    if (ui.reorder) { ui.search = ''; closeAllSwipes(); }
    renderKosten(); renderChrome();
  }

  function updateLinkedPrices() {
    let n = 0;
    rows().forEach(r => {
      if (!r.catalogId) return;
      const p = catalog.find(x => x.id === r.catalogId);
      if (p) { r.price = num(p.price); r.unit = p.unit || r.unit; n++; }
    });
    commit(); toast(n ? n + ' verknüpfte Preise aktualisiert' : 'Keine verknüpften Preise im Preisstamm gefunden');
  }

  /* ---------- Rendering ---------- */
  function commit() { persist(); renderAll(); }
  function renderAll() {
    const active = document.activeElement;
    if (!(active && active.closest && active.closest('#screen-projekt'))) renderProjekt();
    renderKosten(); renderExport();
    if (!(active && active.closest && active.closest('#screen-mehr'))) renderMehr();
    renderChrome();
  }

  function renderChrome() {
    document.querySelectorAll('.screen').forEach(s => { s.hidden = s.dataset.tab !== ui.tab; });
    document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
    document.documentElement.style.setProperty('--accent', site().brand);
    const costs = ui.tab === 'kosten';
    $('#sumbar').hidden = !costs; $('#fab').hidden = !costs || ui.reorder;
    if (costs) {
      const net = netOf(rows()), tax = net * vatPercent() / 100;
      $('#sumbar').innerHTML = '<div><small>Summe netto</small><span class="n">' + eur.format(net) + '</span></div>'
        + '<div class="r"><small>Gesamtsumme brutto</small><span class="b">' + eur.format(net + tax) + '</span></div>';
    }
  }

  const FIELD_GROUPS = [
    { title: 'Projekt', fields: [['projectNo', 'Projektnummer'], ['projectName', 'Projekt'], ['bauvorhaben', 'Bauvorhaben'], ['date', 'Stand', 'date']] },
    { title: 'Auftraggeber', fields: [['client', 'Name'], ['clientAddress', 'Anschrift']] },
    { title: 'Bearbeitung', fields: [['company', 'Büro'], ['companyAddress', 'Anschrift Büro'], ['author', 'Bearbeiter/in']] },
    { title: 'Berechnung', fields: [['vat', 'Umsatzsteuer', 'percent']] }
  ];

  function renderProjekt() {
    const f = project.fields, s = site(), lists = centralLists();
    let h = '<header class="nav"><div class="logo-chip"><img src="' + esc(s.logo) + '" alt="' + esc(s.label) + '"></div>'
      + '<div class="nav-actions"><button class="glass-btn" type="button" data-action="new-project">Neu</button>'
      + '<button class="glass-btn accent" type="button" data-action="goto-export" aria-label="Export">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M8 7l4-4 4 4M5 13v7h14v-7"/></svg></button></div></header>'
      + '<h1 class="large-title">Projekt</h1>'
      + '<p class="subtitle">' + esc(levelTitle()) + (f.date ? ' · Stand ' + esc(dateDE(f.date)) : '') + '</p>';
    FIELD_GROUPS.forEach(g => {
      h += '<div class="sec-head"><span>' + esc(g.title) + '</span></div><div class="group">';
      g.fields.forEach(([key, label, kind]) => {
        const val = f[key] == null ? '' : f[key];
        const type = kind === 'date' ? 'date' : 'text';
        const extra = kind === 'percent' ? ' inputmode="decimal"' : ' autocapitalize="sentences"';
        h += '<label class="row"><span class="k">' + esc(label) + '</span>'
          + '<input class="v" type="' + type + '" data-field="' + key + '" value="' + esc(val) + '" placeholder="—" autocomplete="off"' + extra + '>'
          + (kind === 'percent' ? '<span class="suffix">%</span>' : '') + '</label>';
      });
      if (g.title === 'Auftraggeber' && lists.clients.length) {
        h += '<button type="button" class="row wide" data-action="pick-client"><span class="k accent-text">Aus Auftraggeberliste wählen</span>'
          + '<span class="v-text">' + lists.clients.length + '</span>' + chev + '</button>';
      }
      h += '</div>';
    });
    h += '<div class="sec-head"><span>Anmerkungen</span></div><div class="group">'
      + '<textarea class="notes" data-field="notes" placeholder="Anmerkungen, Grundlagen, Abgrenzungen">' + esc(f.notes || '') + '</textarea>'
      + (lists.notices.length ? '<button type="button" class="row wide" data-action="pick-notice"><span class="k accent-text">Textbaustein einfügen</span>'
        + '<span class="v-text">' + lists.notices.length + '</span>' + chev + '</button>' : '')
      + '</div>';
    const wappen = project.municipalityLogo, sig = project.signatureImage;
    h += '<div class="sec-head"><span>Bilder aus der Desktop-Version</span></div><div class="group">'
      + '<div class="row"><span class="k">Wappen / Logo</span>' + (wappen ? '<img class="thumb" src="' + esc(wappen) + '" alt="">' : '<span class="v-text">keins</span>') + '</div>'
      + '<div class="row"><span class="k">Unterschrift</span>' + (sig ? '<img class="thumb" src="' + esc(sig) + '" alt="">' : '<span class="v-text">keine</span>') + '</div></div>'
      + '<p class="hint-text">Wappen und Unterschrift werden am Desktop hinterlegt, mit dem Projekt übertragen und im PDF verwendet.</p>';
    $('#screen-projekt').innerHTML = h;
  }

  function renderKosten() {
    const v = variant();
    const searchFocused = document.activeElement && document.activeElement.id === 'cost-search';
    if (!searchFocused) {
      $('#kosten-head').innerHTML =
        '<header class="nav"><button class="glass-btn" type="button" data-action="variant-menu"><span class="lbl">' + esc(v.name) + '</span>'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M6 9l6 6 6-6"/></svg></button>'
        + '<div class="nav-actions"><button class="glass-btn' + (ui.reorder ? ' accent' : '') + '" type="button" data-action="reorder">' + (ui.reorder ? 'Fertig' : 'Bearbeiten') + '</button>'
        + '<button class="glass-btn" type="button" data-action="cost-menu" aria-label="Weitere Aktionen">'
        + '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button></div></header>'
        + '<h1 class="large-title">Kostenansätze</h1>'
        + '<div class="seg" role="tablist">' + LEVELS.map(l => '<button type="button" role="tab" data-action="set-level" data-level="' + esc(l) + '" class="' + (l === project.level ? 'on' : '') + '">' + esc(LEVEL_SHORT[l]) + '</button>').join('') + '</div>'
        + '<p class="level-help">' + esc(LEVEL_HELP[project.level]) + '</p>'
        + (ui.reorder
          ? '<div class="reorder-bar"><span>Zeilen am Griff ≡ ziehen. Eine Kostengruppe wandert mit ihren Positionen.</span>'
            + '<button class="glass-btn" type="button" data-action="renumber">OZ neu nummerieren</button></div>'
          : '<label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
            + '<input id="cost-search" type="search" placeholder="Positionen durchsuchen" value="' + esc(ui.search) + '" autocomplete="off"></label>');
    }
    renderCostList();
  }

  function detailText(r) {
    const unit = r.unit || '';
    const price = isBlank(r.price) ? '' : dec2.format(num(r.price)) + ' €';
    const cat = r.catalogId ? ' · ' + r.catalogId : '';
    if (isBlank(r.qty)) {
      if (!price && !unit) return '';
      return 'Menge fehlt' + (price ? ' · ' + price + (unit ? ' je ' + unit : '') : ' · ' + unit) + cat;
    }
    const left = [qtyFmt.format(num(r.qty)), unit].filter(Boolean).join(' ');
    return (price ? left + ' × ' + price : left) + cat;
  }

  function renderCostList() {
    const list = rows();
    const q = ui.reorder ? '' : ui.search.trim().toLowerCase();
    const match = r => !q || [r.oz, r.text, r.catalogId, r.unit].some(x => String(x || '').toLowerCase().indexOf(q) > -1);
    let h = '';
    if (!list.length) {
      h = '<div class="sec-head"><span>Variante „' + esc(variant().name) + '“</span></div><div class="group"><div class="empty">Noch keine Kostengruppen oder Positionen.</div></div>'
        + '<div class="btn-row"><button class="pill" type="button" data-action="add-group">+ Kostengruppe</button><button class="pill primary" type="button" data-action="add-item">+ Position</button></div>';
    }
    let shown = 0;
    groupsOf(list).forEach(g => {
      const items = g.items.filter(it => match(it.row));
      const gMatch = g.row && match(g.row);
      if (q && !items.length && !gMatch) return;
      shown++;
      const title = g.row ? (g.row.oz ? g.row.oz + ' · ' : '') + (g.row.text || 'Kostengruppe') : 'Ohne Kostengruppe';
      h += '<div class="sec-head"><span>' + esc(title) + '</span><b>' + dec2.format(g.sum) + ' €</b></div><div class="group">';
      if (g.row) {
        h += '<button type="button" class="grp-row' + (ui.selected === g.index ? ' sel' : '') + '" data-action="edit-row" data-index="' + g.index + '">'
          + '<span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg></span>'
          + '<span class="t"><b>' + esc(g.row.text || 'Kostengruppe') + '</b><span>Kostengruppe ' + esc(g.row.oz || '') + ' · ' + g.items.length + ' Position' + (g.items.length === 1 ? '' : 'en') + '</span></span>' + (ui.reorder ? dragHandle(g.index) : chev) + '</button>';
      }
      (q ? items : g.items).forEach(it => { h += itemRowHtml(it.index, it.row); });
      if (g.row && !g.items.length && !q && !ui.reorder) {
        h += '<button type="button" class="row add-inline" data-action="add-item-in" data-index="' + g.index + '"><span class="k accent-text">+ Position hinzufügen</span></button>';
      }
      h += '</div>';
    });
    if (q && !shown) h = '<div class="group" style="margin-top:16px"><div class="empty">Keine Positionen zu „' + esc(ui.search) + '“.</div></div>';
    $('#cost-list').innerHTML = h;
  }

  function itemRowHtml(i, r) {
    const detail = detailText(r);
    /* Im Bearbeiten-Modus Griff statt Wisch-Aktionen */
    const actions = ui.reorder ? '' : '<div class="swipe-actions">'
      + '<button type="button" class="dup" data-action="dup-row" data-index="' + i + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/></svg>Kopie</button>'
      + '<button type="button" class="del" data-action="del-row" data-index="' + i + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>Löschen</button></div>';
    return '<div class="swipe" data-index="' + i + '">' + actions
      + '<button type="button" class="pos' + (ui.selected === i ? ' sel' : '') + '" data-action="edit-row" data-index="' + i + '">'
      + '<span class="oz">' + esc(r.oz || '') + '</span>'
      + '<span class="t"><b>' + esc(r.text || 'Ohne Bezeichnung') + '</b>'
      + (detail ? '<span>' + esc(detail) + '</span>' : '<span class="missing">Menge und Preis fehlen</span>') + '</span>'
      + '<span class="sum">' + dec2.format(amount(r)) + '</span>' + (ui.reorder ? dragHandle(i) : '') + '</button></div>';
  }
  function dragHandle(i) {
    return '<span class="handle" data-drag="' + i + '" aria-label="Verschieben"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8h16M4 12h16M4 16h16"/></svg></span>';
  }

  function renderExport() {
    const f = project.fields, nV = project.variants.length;
    const printed = settings.allVariants ? project.variants : [variant()];
    const nPos = printed.reduce((s, v) => s + v.rows.filter(r => r.type !== 'group').length, 0);
    const scope = settings.allVariants && nV > 1 ? nV + ' Varianten' : 'Variante „' + variant().name + '“';
    $('#screen-export').innerHTML =
      '<header class="nav"></header><h1 class="large-title">Export</h1>'
      + '<p class="subtitle">' + esc(levelTitle()) + (f.projectNo ? ' · ' + esc(f.projectNo) : '') + '</p>'
      + '<div class="sec-head"><span>PDF</span></div><div class="group"><div class="docprev"><div class="mini"><i class="r"></i><i></i><i class="s"></i><i></i><i></i><i class="s"></i><i></i><i></i></div>'
      + '<div><b>PDF · DIN A4</b><span>' + (settings.coverPage ? 'Deckblatt · ' : '') + esc(scope) + ' · ' + nPos + ' Position' + (nPos === 1 ? '' : 'en') + '</span></div></div></div>'
      + '<div class="btn-row"><button class="pill primary" type="button" data-action="print-pdf"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/></svg>PDF erstellen</button></div>'
      + '<p class="hint-text">Das PDF wird direkt erzeugt und zum Teilen angeboten – z. B. „In Dateien sichern“, Mail oder AirDrop.</p>'
      + '<div class="sec-head"><span>Druckoptionen</span></div><div class="group">'
      + '<label class="row wide"><span class="k">Deckblatt</span><input type="checkbox" class="switch" data-setting="coverPage"' + (settings.coverPage ? ' checked' : '') + '></label>'
      + '<label class="row wide' + (nV < 2 ? ' dis' : '') + '"><span class="k">Alle Varianten<small>' + (nV < 2 ? 'Nur eine Variante vorhanden' : 'Sonst nur die aktive Variante') + '</small></span>'
      + '<input type="checkbox" class="switch" data-setting="allVariants"' + (settings.allVariants ? ' checked' : '') + (nV < 2 ? ' disabled' : '') + '></label></div>'
      + '<div class="sec-head"><span>Datenaustausch mit der Desktop-Version</span></div><div class="group">'
      + '<button type="button" class="row wide" data-action="export-json"><span class="k">Projekt als JSON teilen<small>Am Desktop über „Import“ öffnen</small></span>' + chev + '</button>'
      + '<button type="button" class="row wide" data-action="import"><span class="k">Projekt importieren<small>Datei aus „JSON exportieren“ am Desktop</small></span>' + chev + '</button></div>';
  }

  function renderMehr() {
    const latest = catalog.reduce((m, p) => (p && p.date && p.date > m ? p.date : m), '');
    let h = '<header class="nav"></header><h1 class="large-title">Mehr</h1>'
      + '<div class="sec-head"><span>Einheitspreisstamm</span></div><div class="group">'
      + '<div class="row"><span class="k">Einheitspreise</span><span class="v-text">' + catalog.length + '</span></div>'
      + (latest ? '<div class="row"><span class="k">Jüngster Preisstand</span><span class="v-text">' + esc(dateDE(latest)) + '</span></div>' : '')
      + '<button type="button" class="row wide" data-action="import"><span class="k">Preisstamm importieren<small>Datei aus „Preisstamm exportieren“ am Desktop</small></span>' + chev + '</button>'
      + (catalog.length ? '<button type="button" class="row wide" data-action="browse-catalog"><span class="k">Preisstamm durchsuchen</span>' + chev + '</button>' : '')
      + '</div>';
    const lists = centralLists();
    h += '<div class="sec-head"><span>Stammdaten aus der Desktop-Version</span></div><div class="group">'
      + '<div class="row"><span class="k">Projektvorlagen</span><span class="v-text">' + lists.templates.length + '</span></div>'
      + '<div class="row"><span class="k">Auftraggeber</span><span class="v-text">' + lists.clients.length + '</span></div>'
      + '<div class="row"><span class="k">Textbausteine</span><span class="v-text">' + lists.notices.length + '</span></div></div>'
      + '<p class="hint-text">Kommen mit jedem Projekt-Import aus der Desktop-Version (Zentrale Verwaltung) und werden dabei aktualisiert.</p>';
    h += '<div class="sec-head"><span>Standort</span></div><div class="group">';
    Object.keys(SITES).forEach(key => {
      h += '<button type="button" class="row wide" data-action="set-site" data-site="' + key + '"><span class="k">' + esc(SITES[key].label) + '<small>' + esc(SITES[key].address) + '</small></span>'
        + (settings.site === key ? '<span class="check">✓</span>' : '') + '</button>';
    });
    h += '<button type="button" class="row wide" data-action="apply-site"><span class="k accent-text">Firmendaten ins Projekt übernehmen</span></button></div>'
      + '<p class="hint-text">Der Standort bestimmt Logo, Absender, Farbe und Stempel im PDF sowie die Auswahl im Preisstamm.</p>';
    h += '<div class="sec-head"><span>Vorgaben für neue Projekte</span></div><div class="group">'
      + '<label class="row"><span class="k">Umsatzsteuer</span><input class="v" data-setting-input="vat" inputmode="decimal" value="' + esc(settings.vat) + '"><span class="suffix">%</span></label>'
      + '<label class="row"><span class="k">Bearbeiter/in</span><input class="v" data-setting-input="author" value="' + esc(settings.author) + '" placeholder="—" autocomplete="off"></label></div>';
    h += '<div class="sec-head"><span>Firmenstempel</span></div><div class="group">'
      + '<div class="row"><span class="k">Stempel</span>' + (stamp ? '<img class="thumb" src="' + esc(stamp) + '" alt="">' : '<span class="v-text">keiner</span>') + '</div>'
      + '<button type="button" class="row wide" data-action="import-stamp"><span class="k">' + (stamp ? 'Stempel ersetzen' : 'Stempel importieren') + '<small>PNG oder JPG, z. B. aus OneDrive</small></span>' + chev + '</button>'
      + (stamp ? '<button type="button" class="row wide" data-action="remove-stamp"><span class="k danger-text">Stempel entfernen</span></button>' : '')
      + '</div><p class="hint-text">Der Stempel wird nur auf diesem iPhone gespeichert und im PDF für GBi Herzogenaurach eingesetzt. Er ist nicht Teil der Web-App.</p>';
    h += '<div class="sec-head"><span>Projekt</span></div><div class="group">'
      + '<button type="button" class="row wide" data-action="import"><span class="k">Projekt importieren</span>' + chev + '</button>'
      + '<button type="button" class="row wide" data-action="new-project"><span class="k danger-text">Neues Projekt beginnen</span></button></div>';
    const prov = aiProvider();
    h += '<div class="sec-head"><span>KI-Assistent</span></div><div class="group">'
      + '<label class="row"><span class="k">API-Schlüssel</span><input class="v" type="password" data-ai-input="key" value="' + esc(ai.key) + '" placeholder="ambrs-…, sk-ant-… oder sk-…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>'
      + '<div class="row"><span class="k">Anbieter</span><span class="v-text">' + esc(prov ? aiProviderName() : '—') + '</span></div>'
      + (prov === 'amber' ? '<label class="row"><span class="k">amber-Adresse</span><input class="v" type="url" data-ai-input="amberUrl" value="' + esc(ai.amberUrl || 'https://gbi.ambersearch.de') + '" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>' : '')
      + (prov ? '<label class="row"><span class="k">Modell</span><select class="v" data-ai-input="model">'
        + aiModelList().map(([id, label]) => '<option value="' + esc(id) + '"' + (id === aiModel() ? ' selected' : '') + '>' + esc(label) + '</option>').join('') + '</select></label>' : '')
      + '<button type="button" class="row wide" data-action="ai-test"><span class="k accent-text">' + (prov === 'amber' ? 'Verbindung testen und Modelle laden' : 'Verbindung testen') + '</span></button></div>'
      + '<p class="hint-text">Schlüssel aus eurem amber-Zugang (ambrs-…), von console.anthropic.com oder platform.openai.com. Er bleibt nur auf diesem iPhone und wird nicht exportiert. '
      + 'Die KI-Funktionen unter Kosten (Plus-Knopf und •••) übertragen Projektdaten, einen Auszug des Preisstamms und Fotos an den Anbieter – nur mit Freigabe der Firma nutzen.</p>';
    h += '<div class="sec-head"><span>Info</span></div><div class="group">'
      + '<div class="row"><span class="k">iPhone-Version</span><span class="v-text">' + APP_VERSION + '</span></div></div>'
      + '<p class="hint-text">Alle Daten liegen nur auf diesem iPhone. Zum Sichern und für die Weiterarbeit am Desktop das Projekt regelmäßig unter „Export“ als JSON teilen.</p>';
    $('#screen-mehr').innerHTML = h;
  }

  /* ---------- Blaetter (Sheets) ---------- */
  function openSheet(html, opts) {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = '<div class="sheet-backdrop" data-close></div><div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div>' + html + '</div>';
    wrap._onClose = opts && opts.onClose;
    $('#sheet-root').appendChild(wrap);
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
    wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(wrap); });
    return wrap;
  }
  function closeSheet(wrap) {
    if (!wrap || wrap._closed) return;
    wrap._closed = true;
    if (document.activeElement && wrap.contains(document.activeElement)) document.activeElement.blur();
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 320);
    if (typeof wrap._onClose === 'function') wrap._onClose();
  }

  function actionSheet(title, items) {
    const html = (title ? '<div class="as-title">' + esc(title) + '</div>' : '')
      + '<div class="group">' + items.map((it, i) =>
        '<button type="button" class="row wide as-item" data-i="' + i + '"><span class="k' + (it.destructive ? ' danger-text' : '') + '">' + esc(it.label) + '</span>'
        + (it.checked ? '<span class="check">✓</span>' : '') + '</button>').join('') + '</div>'
      + '<button type="button" class="pill cancel" data-close>Abbrechen</button>';
    const wrap = openSheet(html);
    wrap.querySelectorAll('.as-item').forEach(b => b.addEventListener('click', () => {
      const it = items[Number(b.dataset.i)];
      closeSheet(wrap);
      setTimeout(() => it.action(), 60);
    }));
  }

  function askText(title, value, label) {
    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } };
      const wrap = openSheet('<div class="sheet-head"><button type="button" class="link" data-close>Abbrechen</button><b>' + esc(title) + '</b>'
        + '<button type="button" class="link strong" data-ok>Fertig</button></div>'
        + '<div class="group"><label class="field-block"><span>' + esc(label || 'Bezeichnung') + '</span><input type="text" value="' + esc(value || '') + '" autocomplete="off"></label></div>',
        { onClose: () => finish(null) });
      const input = wrap.querySelector('input');
      const ok = () => { const v = input.value.trim(); finish(v || null); closeSheet(wrap); };
      wrap.querySelector('[data-ok]').addEventListener('click', ok);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
      setTimeout(() => { input.focus(); input.select(); }, 350);
    });
  }

  function unitOptions(current) {
    const list = UNITS.slice();
    if (current && list.indexOf(current) < 0) list.push(current);
    return '<option value="">–</option>' + list.map(u => '<option value="' + esc(u) + '"' + (u === current ? ' selected' : '') + '>' + esc(u) + '</option>').join('');
  }
  function catalogLabel(r) {
    if (!r.catalogId) return 'Kein Einheitspreis verknüpft (manueller Preis)';
    const p = catalog.find(x => x.id === r.catalogId);
    return p ? p.text + ' · ' + dec2.format(num(p.price)) + ' € / ' + (p.unit || '–') : 'Nicht im Preisstamm dieses iPhones';
  }

  function openRowSheet(i) {
    const list = rows(); const r = list[i]; if (!r) return;
    ui.selected = i; renderCostList();
    if (r.type === 'group') openGroupSheet(r); else openItemSheet(r);
  }

  function restoreRow(r, snapshot) {
    const list = rows(); const idx = list.indexOf(r);
    if (idx >= 0) list[idx] = JSON.parse(snapshot);
  }

  function openItemSheet(r) {
    const snapshot = JSON.stringify(r);
    const html = '<div class="sheet-head"><button type="button" class="link" data-cancel>Abbrechen</button><b>Position ' + esc(r.oz || '') + '</b>'
      + '<button type="button" class="link strong" data-done>Fertig</button></div>'
      + '<div class="group"><label class="field-block"><span>Leistungsbereich / Kostenposition</span><textarea data-e="text" rows="2">' + esc(r.text || '') + '</textarea></label></div>'
      + '<div class="sec-head"><span>Menge &amp; Preis</span></div><div class="group">'
      + '<div class="pair"><label class="field-block"><span>Menge</span><input data-e="qty" inputmode="decimal" autocomplete="off" placeholder="0" value="' + esc(isBlank(r.qty) ? '' : qtyFmt.format(num(r.qty))) + '"></label>'
      + '<label class="field-block"><span>Einheit</span><select data-e="unit">' + unitOptions(r.unit) + '</select></label></div>'
      + '<button type="button" class="row wide" data-catalog><span class="k">EP-Quelle<small data-catlabel>' + esc(catalogLabel(r)) + '</small></span>'
      + '<span class="v-text" data-catid>' + esc(r.catalogId || 'manuell') + '</span>' + chev + '</button>'
      + '<label class="row"><span class="k">EP netto</span><input class="v" data-e="price" inputmode="decimal" autocomplete="off" placeholder="0,00" value="' + esc(isBlank(r.price) ? '' : dec2.format(num(r.price))) + '"><span class="suffix">€</span></label>'
      + '<label class="row"><span class="k">KG / OZ</span><input class="v" data-e="oz" autocomplete="off" value="' + esc(r.oz || '') + '"></label></div>'
      + '<div class="group" style="margin-top:14px"><div class="total-row"><span>Gesamt netto</span><b data-total>' + eur.format(amount(r)) + '</b></div></div>'
      + '<div class="btn-row"><button type="button" class="pill" data-dup>Kopie</button><button type="button" class="pill" data-move>Verschieben</button><button type="button" class="pill danger" data-delete>Löschen</button></div>';
    const wrap = openSheet(html, { onClose: () => commit() });
    const q = s => wrap.querySelector(s);
    const refreshTotal = () => { q('[data-total]').textContent = eur.format(amount(r)); };
    const refreshCatalog = () => { q('[data-catlabel]').textContent = catalogLabel(r); q('[data-catid]').textContent = r.catalogId || 'manuell'; };

    q('[data-e="text"]').addEventListener('input', e => { r.text = e.target.value; });
    q('[data-e="oz"]').addEventListener('input', e => { r.oz = e.target.value; });
    q('[data-e="qty"]').addEventListener('input', e => { r.qty = e.target.value.trim() === '' ? '' : num(e.target.value); refreshTotal(); });
    q('[data-e="unit"]').addEventListener('change', e => { r.unit = e.target.value; });
    q('[data-e="price"]').addEventListener('input', e => {
      r.price = e.target.value.trim() === '' ? '' : num(e.target.value);
      r.catalogId = '';   // wie am Desktop: manueller Preis loest die Verknuepfung
      refreshCatalog(); refreshTotal();
    });
    q('[data-catalog]').addEventListener('click', () => openCatalogPicker(r, p => {
      if (p) {
        r.catalogId = p.id; r.price = num(p.price); r.unit = p.unit || r.unit;
        if (!r.text || r.text === 'Neue Kostenposition') { r.text = p.text || r.text; q('[data-e="text"]').value = r.text; }
        q('[data-e="price"]').value = dec2.format(r.price);
        q('[data-e="unit"]').innerHTML = unitOptions(r.unit);
      } else {
        r.catalogId = '';
      }
      refreshCatalog(); refreshTotal();
    }));
    q('[data-cancel]').addEventListener('click', () => { restoreRow(r, snapshot); closeSheet(wrap); });
    q('[data-done]').addEventListener('click', () => closeSheet(wrap));
    q('[data-dup]').addEventListener('click', () => { const idx = rows().indexOf(r); closeSheet(wrap); if (idx >= 0) duplicateRow(idx); });
    q('[data-move]').addEventListener('click', () => { const idx = rows().indexOf(r); closeSheet(wrap); if (idx >= 0) setTimeout(() => moveMenu(idx), 60); });
    q('[data-delete]').addEventListener('click', () => { const idx = rows().indexOf(r); if (idx >= 0 && deleteRow(idx)) closeSheet(wrap); });
  }

  function openGroupSheet(r) {
    const snapshot = JSON.stringify(r);
    const list = rows(); const gi = list.indexOf(r);
    const g = groupsOf(list).find(x => x.index === gi) || { items: [], sum: 0 };
    const html = '<div class="sheet-head"><button type="button" class="link" data-cancel>Abbrechen</button><b>Kostengruppe</b>'
      + '<button type="button" class="link strong" data-done>Fertig</button></div>'
      + '<div class="group"><div class="pair"><label class="field-block"><span>KG / OZ</span><input data-e="oz" autocomplete="off" value="' + esc(r.oz || '') + '"></label>'
      + '<div class="field-block"><span>Positionen</span><div class="static">' + g.items.length + '</div></div></div>'
      + '<label class="field-block"><span>Bezeichnung</span><textarea data-e="text" rows="2">' + esc(r.text || '') + '</textarea></label></div>'
      + '<div class="group" style="margin-top:14px"><div class="total-row"><span>Summe netto</span><b>' + eur.format(g.sum) + '</b></div></div>'
      + '<div class="btn-row"><button type="button" class="pill" data-add>+ Position in dieser Gruppe</button><button type="button" class="pill" data-move>Verschieben</button></div>'
      + '<div class="btn-row"><button type="button" class="pill" data-ai-refine>Mit KI verfeinern</button></div>'
      + '<div class="btn-row"><button type="button" class="pill danger" data-delete>Kostengruppe löschen</button></div>';
    const wrap = openSheet(html, { onClose: () => commit() });
    const q = s => wrap.querySelector(s);
    q('[data-e="oz"]').addEventListener('input', e => { r.oz = e.target.value; });
    q('[data-e="text"]').addEventListener('input', e => { r.text = e.target.value; });
    q('[data-cancel]').addEventListener('click', () => { restoreRow(r, snapshot); closeSheet(wrap); });
    q('[data-done]').addEventListener('click', () => closeSheet(wrap));
    q('[data-move]').addEventListener('click', () => { const idx = rows().indexOf(r); closeSheet(wrap); if (idx >= 0) setTimeout(() => moveMenu(idx), 60); });
    q('[data-ai-refine]').addEventListener('click', () => { closeSheet(wrap); setTimeout(() => openAiRefine({ row: r }), 60); });
    q('[data-add]').addEventListener('click', () => {
      const idx = rows().indexOf(r); closeSheet(wrap);
      if (idx >= 0) setTimeout(() => addItem(groupEnd(rows(), idx)), 60);
    });
    q('[data-delete]').addEventListener('click', () => { const idx = rows().indexOf(r); if (idx >= 0 && deleteRow(idx)) closeSheet(wrap); });
  }

  function openCatalogPicker(r, onPick) {
    const browse = typeof onPick !== 'function';
    let query = '', all = false;
    const html = '<div class="sheet-head"><button type="button" class="link" data-close>' + (browse ? 'Schließen' : 'Abbrechen') + '</button><b>Einheitspreise</b><span class="link"></span></div>'
      + '<label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
      + '<input type="search" data-q placeholder="Nummer, Bezeichnung oder Gewerk" autocomplete="off"></label>'
      + '<div class="seg small"><button type="button" data-scope="level" class="on">' + esc(LEVEL_SHORT[project.level]) + ' · Standort</button><button type="button" data-scope="all">Alle</button></div>'
      + (browse ? '' : '<div class="group" style="margin-top:10px"><button type="button" class="row wide" data-none><span class="k">Kein Einheitspreis (manueller Preis)</span></button></div>')
      + '<div data-list></div>';
    const wrap = openSheet(html);
    const listEl = wrap.querySelector('[data-list]');
    const draw = () => {
      if (!catalog.length) {
        listEl.innerHTML = '<div class="group" style="margin-top:14px"><div class="empty">Auf diesem iPhone ist noch kein Preisstamm vorhanden.<br>Am Desktop „Preisstamm exportieren“ und hier unter <b>Mehr</b> importieren.</div></div>';
        return;
      }
      const qq = query.trim().toLowerCase();
      let res = catalog.filter(p => p && (all || ((!p.stage || p.stage === project.level) && (!p.site || p.site === settings.site))));
      if (qq) res = res.filter(p => [p.id, p.text, p.trade, p.unit].some(x => String(x || '').toLowerCase().indexOf(qq) > -1));
      const total = res.length;
      res = res.slice(0, 150);
      listEl.innerHTML = res.length
        ? '<div class="sec-head"><span>' + total + ' Treffer' + (total > 150 ? ' · die ersten 150' : '') + '</span></div><div class="group">'
          + res.map(p => '<button type="button" class="row cat-row' + (r && r.catalogId === p.id ? ' sel' : '') + '" data-id="' + esc(p.id) + '">'
            + '<span class="cat-main"><b>' + esc(p.id) + ' · ' + esc(p.text || '') + '</b><span class="meta">' + esc([p.trade, p.stage || 'alle Stufen', p.date ? dateDE(p.date) : ''].filter(Boolean).join(' · ')) + '</span></span>'
            + '<span class="cat-price">' + dec2.format(num(p.price)) + ' €<small>' + esc(p.unit || '') + '</small></span></button>').join('') + '</div>'
        : '<div class="group" style="margin-top:14px"><div class="empty">Keine Treffer.</div></div>';
    };
    draw();
    wrap.querySelector('[data-q]').addEventListener('input', e => { query = e.target.value; draw(); });
    wrap.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
      all = b.dataset.scope === 'all';
      wrap.querySelectorAll('[data-scope]').forEach(x => x.classList.toggle('on', x === b));
      draw();
    }));
    if (!browse) {
      wrap.querySelector('[data-none]').addEventListener('click', () => { onPick(null); closeSheet(wrap); });
      listEl.addEventListener('click', e => {
        const b = e.target.closest('[data-id]'); if (!b) return;
        const p = catalog.find(x => x.id === b.dataset.id);
        if (p) { onPick(p); closeSheet(wrap); }
      });
    }
  }

  /* ---------- Stammdaten aus der Desktop-Version ---------- */
  /* Preisstamm und Zentrale Verwaltung aus einer Projektdatei herausloesen. Beides sind
     Stammdaten, kein Projektinhalt: Sie werden getrennt gespeichert und beim Export wieder
     beigelegt, damit nicht jede Eingabe den ganzen Datenbestand (rund 1 MB) neu schreibt. */
  function takeMasterData(p) {
    const res = { prices: Array.isArray(p.priceCatalog) ? p.priceCatalog : [], central: null };
    if (p.gbiCentralDB && typeof p.gbiCentralDB === 'object' && !Array.isArray(p.gbiCentralDB)) {
      res.central = Object.assign({}, p.gbiCentralDB);
      if (!res.prices.length && Array.isArray(res.central.priceCatalog)) res.prices = res.central.priceCatalog;
      delete res.central.priceCatalog;
    }
    delete p.priceCatalog; delete p.gbiCentralDB;
    return res;
  }
  function centralLists() {
    const c = central || {};
    const arr = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []);
    return {
      templates: arr(c.projectTemplates).filter(t => Array.isArray(t.rows)),
      clients: arr(c.clients).filter(x => x.name),
      notices: arr(c.notices).filter(n => n.text)
    };
  }
  function importSummary(nPrices) {
    const c = centralLists(), parts = ['Projekt'];
    if (nPrices) parts.push(nPrices + ' Einheitspreise');
    if (c.templates.length) parts.push(c.templates.length + ' Vorlagen');
    if (c.clients.length) parts.push(c.clients.length + ' Auftraggeber');
    return parts.join(' · ') + ' importiert';
  }

  /* Auswahlblatt mit Suche und Umschalter eigener Bereich / Alle */
  function openPicker(opts) {
    let query = '', all = !opts.items.some(opts.own);
    const wrap = openSheet('<div class="sheet-head"><button type="button" class="link" data-close>Abbrechen</button><b>' + esc(opts.title) + '</b><span class="link"></span></div>'
      + '<label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
      + '<input type="search" data-q placeholder="' + esc(opts.placeholder) + '" autocomplete="off"></label>'
      + '<div class="seg small"><button type="button" data-scope="own"' + (all ? '' : ' class="on"') + '>' + esc(opts.ownLabel) + '</button>'
      + '<button type="button" data-scope="all"' + (all ? ' class="on"' : '') + '>Alle</button></div>'
      + '<div data-list></div>');
    const listEl = wrap.querySelector('[data-list]');
    const draw = () => {
      const qq = query.trim().toLowerCase();
      let res = opts.items.map((it, i) => ({ it, i })).filter(({ it }) => all || opts.own(it));
      if (qq) res = res.filter(({ it }) => opts.text(it).toLowerCase().indexOf(qq) > -1);
      listEl.innerHTML = res.length
        ? '<div class="sec-head"><span>' + res.length + ' Treffer</span></div><div class="group">'
          + res.map(({ it, i }) => '<button type="button" class="row cat-row" data-i="' + i + '"><span class="cat-main"><b>' + esc(opts.main(it)) + '</b>'
            + '<span class="meta">' + esc(opts.meta(it)) + '</span></span></button>').join('') + '</div>'
        : '<div class="group" style="margin-top:14px"><div class="empty">Keine Treffer' + (all ? '' : ' – „Alle“ zeigt weitere Einträge') + '.</div></div>';
    };
    draw();
    wrap.querySelector('[data-q]').addEventListener('input', e => { query = e.target.value; draw(); });
    wrap.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
      all = b.dataset.scope === 'all';
      wrap.querySelectorAll('[data-scope]').forEach(x => x.classList.toggle('on', x === b));
      draw();
    }));
    listEl.addEventListener('click', e => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      const it = opts.items[Number(b.dataset.i)];
      closeSheet(wrap);
      setTimeout(() => opts.pick(it), 60);
    });
  }

  function pickClient() {
    openPicker({
      title: 'Auftraggeber', placeholder: 'Name oder Anschrift', ownLabel: site().label,
      items: centralLists().clients,
      own: c => !c.site || c.site === settings.site,
      text: c => [c.name, c.address, c.contact].join(' '),
      main: c => c.name, meta: c => c.address || '',
      pick: c => { project.fields.client = c.name || ''; project.fields.clientAddress = c.address || ''; commit(); toast('Auftraggeber übernommen'); }
    });
  }
  function pickNotice() {
    actionSheet('Textbaustein einfügen', centralLists().notices.map(n => ({
      label: n.text.length > 90 ? n.text.slice(0, 88) + ' …' : n.text,
      action: () => {
        const cur = String(project.fields.notes || '').replace(/\s+$/, '');
        project.fields.notes = (cur ? cur + '\n' : '') + n.text;
        commit(); toast('Textbaustein eingefügt');
      }
    })));
  }

  function templateRows(t) {
    return clone(t.rows).filter(r => r && typeof r === 'object').map(r => { if (r.type !== 'group') r.type = 'item'; return r; });
  }
  function pickTemplate(title, onPick, byLevel) {
    openPicker({
      title, placeholder: 'Projektart oder Stufe',
      ownLabel: byLevel ? LEVEL_SHORT[project.level] + ' · Standort' : site().label,
      items: centralLists().templates,
      own: t => (!t.site || t.site === settings.site) && (!byLevel || !t.stage || t.stage === project.level),
      text: t => [t.name, t.projectType, t.stage].join(' '),
      main: t => t.name || 'Vorlage',
      meta: t => { const n = t.rows.filter(r => r && r.type !== 'group').length; return [t.stage, n + ' Position' + (n === 1 ? '' : 'en')].filter(Boolean).join(' · '); },
      pick: onPick
    });
  }
  function insertTemplate(t) {
    const add = templateRows(t);
    if (!add.length) { toast('Die Vorlage enthält keine Positionen'); return; }
    rows().push(...add); ui.selected = -1; commit();
    toast(add.length + ' Zeilen aus „' + (t.name || 'Vorlage') + '“ angefügt');
  }
  function newProjectFromTemplate(t) {
    const p = newProjectObject();
    if (LEVELS.indexOf(t.stage) > -1) p.level = t.stage;
    p.fields.variant = p.level;
    p.variants[0].name = p.level;
    p.variants[0].rows = templateRows(t);
    project = normalizeProject(p); ui.selected = -1; ui.search = '';
    commit(); switchTab('kosten'); toast('Projekt aus „' + (t.name || 'Vorlage') + '“ angelegt');
  }

  function variantMenu() {
    const items = project.variants.map(v => ({
      label: v.name, checked: v.id === project.activeVariantId,
      action: () => { project.activeVariantId = v.id; ui.selected = -1; commit(); }
    }));
    items.push({ label: 'Neue Variante (Kopie der aktuellen)', action: async () => {
      const name = await askText('Neue Variante', variant().name + ' (Kopie)', 'Bezeichnung');
      if (!name) return;
      const nv = { id: uid(), name, rows: clone(rows()) };
      project.variants.push(nv); project.activeVariantId = nv.id; ui.selected = -1; commit(); toast('Variante angelegt');
    } });
    items.push({ label: 'Variante umbenennen', action: async () => {
      const name = await askText('Variante umbenennen', variant().name, 'Bezeichnung');
      if (!name) return;
      variant().name = name; commit();
    } });
    if (project.variants.length > 1) {
      items.push({ label: 'Variante löschen', destructive: true, action: () => {
        if (!confirm('Variante „' + variant().name + '“ mit allen Positionen löschen?')) return;
        project.variants = project.variants.filter(v => v.id !== project.activeVariantId);
        project.activeVariantId = project.variants[0].id; ui.selected = -1; commit();
      } });
    }
    actionSheet('Varianten', items);
  }

  function addMenu() {
    const list = rows(); const sel = validSelection() ? list[ui.selected] : null;
    const title = sel
      ? 'Einfügen bei „' + [sel.oz, sel.text].filter(Boolean).join(' ') + '“: Position darunter, Kostengruppe darüber'
      : 'Einfügen am Ende der Liste';
    const items = [
      { label: 'Neue Position', action: () => addItem() },
      { label: 'Neue Kostengruppe', action: addGroup }
    ];
    if (centralLists().templates.length) {
      items.push({ label: 'Positionen aus Projektvorlage anfügen', action: () => pickTemplate('Vorlage anfügen', insertTemplate, true) });
    }
    items.push({ label: 'KI: Maßnahme beschreiben …', action: openAiSuggest });
    actionSheet(title, items);
  }

  function costMenu() {
    const items = [
      { label: ui.reorder ? 'Verschieben beenden' : 'Zeilen verschieben', action: () => setReorder(!ui.reorder) },
      { label: 'OZ neu nummerieren', action: renumber },
      { label: 'Verknüpfte Einheitspreise aktualisieren', action: updateLinkedPrices },
      { label: 'KI: Kostenansätze verfeinern …', action: () => openAiRefine({}) },
      { label: 'KI-Plausibilitätsprüfung …', action: runAiCheck }
    ];
    if (validSelection()) items.push({ label: 'Markierung aufheben', action: () => { ui.selected = -1; renderCostList(); } });
    actionSheet('Kostenansätze', items);
  }

  /* ---------- KI-Assistent ----------
     Direkter Aufruf der KI-Schnittstelle von Anthropic (Claude) oder OpenAI mit dem
     Schluessel des Nutzers. Antworten kommen strukturiert ueber ein erzwungenes Werkzeug;
     Preise werden nie von der KI uebernommen, sondern nur ueber IDs aus dem Preisstamm. */
  const AI_MODELS = {
    anthropic: [['claude-opus-5', 'Claude Opus 5 · beste Qualität'], ['claude-sonnet-5', 'Claude Sonnet 5 · schneller, günstiger']],
    openai: [['gpt-6-astra', 'GPT-6 Astra · beste Qualität'], ['gpt-5.6-terra', 'GPT-5.6 Terra · schneller, günstiger']],
    /* amberSearch (OpenAI-kompatibel): Vorbelegung laut Doku, ersetzt durch die Liste des eigenen amber-Zugangs */
    amber: ['vertex/claude-opus-4-8', 'telekom/claude-opus-4.6', 'azure/gpt-5.5', 'azure/gpt-5.4', 'telekom/claude-sonnet-4.6', 'mistral/mistral-large-2512']
  };
  const AMBER_PREFERRED = ['vertex/claude-opus-4-8', 'telekom/claude-opus-4.6', 'azure/gpt-5.5', 'azure/gpt-5.4', 'telekom/claude-sonnet-4.6'];
  const AI_SYSTEM = 'Du unterstützt ein Ingenieurbüro für kommunale Infrastruktur (Tiefbau, Kanal, Wasserleitung, Straßen- und Wegebau, Fernwärme) bei Kostenermittlungen nach DIN 276. '
    + 'Antworte ausschließlich über das bereitgestellte Werkzeug, auf Deutsch und fachlich knapp. '
    + 'Gliederungstiefe und Detailgrad strikt nach der angegebenen Ermittlungsstufe: Kostenhochrechnung grob, Kostenschätzung mittel, Kostenberechnung detailliert. '
    + 'Positionen vorwiegend aus dem mitgelieferten Einheitspreisstamm bzw. Positionskatalog wählen und dessen Bezeichnung und Einheit übernehmen; eigene Positionen nur, wenn kein passender Eintrag existiert. '
    + 'Preise strikt nach der Preisvorgabe der Aufgabe: catalogId nur mit IDs aus der mitgelieferten Preisliste; Schätzpreise (price) nur, wenn die Aufgabe sie ausdrücklich erlaubt, dann stets mit Grundlage in priceBasis. '
    + 'Mengen nur übernehmen, wenn sie in der Beschreibung oder auf den Fotos angegeben sind oder sich direkt daraus berechnen lassen '
    + '(z. B. 120 m Länge × 3 m Breite = 360 m²; Rechenweg im Hinweis nennen). Keine Mengen schätzen – sonst qty null.';
  const AI_SUGGEST_TOOL = {
    name: 'kostenvorschlag',
    description: 'Gegliederter Vorschlag für Kostengruppen und Positionen einer Kostenermittlung.',
    input_schema: {
      type: 'object',
      properties: {
        groups: {
          type: 'array', description: 'Kostengruppen in sinnvoller Reihenfolge des Bauablaufs',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Bezeichnung der Kostengruppe' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    text: { type: 'string', description: 'Positionstext, fachlich knapp' },
                    qty: { type: ['number', 'null'], description: 'Menge nur, wenn angegeben oder direkt aus Angaben berechenbar; sonst null' },
                    unit: { type: 'string', description: 'Einheit, z. B. Stk., m, m², m³, to, psch, Std.' },
                    catalogId: { type: ['string', 'null'], description: 'ID eines passenden Einheitspreises aus der Preisliste, sonst null' },
                    price: { type: ['number', 'null'], description: 'Schätzpreis EP netto in EUR, nur wenn laut Preisvorgabe erlaubt; sonst null' },
                    priceBasis: { type: 'string', description: 'Grundlage des Schätzpreises, kurz' },
                    origin: { type: 'string', enum: ['genannt', 'ergaenzt'], description: 'genannt = in Beschreibung/Fotos enthalten, ergaenzt = fachlich notwendig hinzugefügt' },
                    hint: { type: 'string', description: 'Rechenweg der Menge; bei ergänzten Positionen kurze Begründung' }
                  },
                  required: ['text', 'qty', 'unit', 'catalogId', 'price', 'origin']
                }
              }
            },
            required: ['text', 'items']
          }
        },
        notes: { type: 'string', description: 'Getroffene Annahmen und offene Punkte, kurz' }
      },
      required: ['groups']
    }
  };
  const AI_CHECK_TOOL = {
    name: 'pruefbericht',
    description: 'Ergebnis der Plausibilitätsprüfung einer Kostenermittlung.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Gesamteinschätzung in 1 bis 3 Sätzen' },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              severity: { type: 'string', enum: ['fehler', 'warnung', 'hinweis'] },
              oz: { type: ['string', 'null'], description: 'OZ der betroffenen Zeile, sonst null' },
              title: { type: 'string', description: 'Kurzer Befund' },
              detail: { type: 'string', description: 'Erläuterung und Empfehlung' }
            },
            required: ['severity', 'oz', 'title', 'detail']
          }
        }
      },
      required: ['summary', 'findings']
    }
  };
  let aiDraft = { task: '', photos: [], region: '' };

  function aiProvider() {
    const k = String(ai.key || '');
    if (/^sk-ant-/.test(k)) return 'anthropic';
    if (/^ambrs-/.test(k)) return 'amber';
    return /^sk-/.test(k) ? 'openai' : '';
  }
  function aiProviderName() {
    return { anthropic: 'Anthropic · Claude', openai: 'OpenAI · GPT', amber: 'amber (amberSearch)' }[aiProvider()] || '';
  }
  function amberBase() {
    return String(ai.amberUrl || 'https://gbi.ambersearch.de').trim().replace(/\/+$/, '') + '/api/beta/openai/v1';
  }
  function amberLabel(id) {
    const parts = String(id).split('/');
    const hosts = { vertex: 'Google Vertex', azure: 'Microsoft Azure', telekom: 'Telekom', mistral: 'Mistral' };
    return parts.length > 1 ? parts.slice(1).join('/') + ' · ' + (hosts[parts[0]] || parts[0]) : String(id);
  }
  function aiModelList() {
    const p = aiProvider();
    if (p === 'amber') return (Array.isArray(ai.amberModels) && ai.amberModels.length ? ai.amberModels : AI_MODELS.amber).map(id => [id, amberLabel(id)]);
    return AI_MODELS[p] || [];
  }
  function aiModel() {
    const list = aiModelList();
    if (list.some(m => m[0] === ai.model)) return ai.model;
    const preferred = AMBER_PREFERRED.find(id => list.some(m => m[0] === id));
    return preferred || (list[0] ? list[0][0] : '');
  }
  /* Modelle des eigenen amber-Zugangs abrufen (Bild-, Audio- und Embedding-Modelle ausgenommen) */
  async function loadAmberModels(signal) {
    let res;
    try { res = await fetch(amberBase() + '/models', { headers: { authorization: 'Bearer ' + ai.key }, signal }); }
    catch (e) { if (e && e.name === 'AbortError') throw e; throw new Error('amber ist unter ' + amberBase() + ' nicht erreichbar. Bitte die amber-Adresse prüfen.'); }
    if (res.status === 401 || res.status === 403) throw new Error('Der amber-Schlüssel wurde abgelehnt. Bitte unter Mehr → KI-Assistent prüfen.');
    if (!res.ok) throw new Error('amber meldet beim Laden der Modelle einen Fehler (HTTP ' + res.status + ').');
    const data = await res.json().catch(() => null);
    const ids = (data && Array.isArray(data.data) ? data.data : []).map(m => m && m.id)
      .filter(id => id && !/image|embed|whisper|tts|audio|dall-e|transcri/i.test(id));
    const rank = id => { const i = AMBER_PREFERRED.indexOf(id); return i < 0 ? 99 : i; };
    ids.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    if (ids.length) { ai.amberModels = ids; saveJSON(KEYS.ai, ai); }
    return ids;
  }

  async function callAi(opts) {
    const provider = aiProvider();
    if (!provider) throw new Error('Kein gültiger API-Schlüssel hinterlegt (Mehr → KI-Assistent).');
    if (!navigator.onLine) throw new Error('Keine Internetverbindung – die KI-Funktionen brauchen Netz.');
    const images = opts.images || [], tool = opts.tool, maxTokens = opts.maxTokens || 4000;
    let url, headers, body;
    if (provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      headers = { 'content-type': 'application/json', 'x-api-key': ai.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
      const content = images.map(d => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d } }));
      content.push({ type: 'text', text: opts.text });
      body = { model: aiModel(), max_tokens: maxTokens, system: opts.system, messages: [{ role: 'user', content }] };
      if (tool) { body.tools = [tool]; body.tool_choice = { type: 'tool', name: tool.name }; }
    } else {
      url = provider === 'amber' ? amberBase() + '/chat/completions' : 'https://api.openai.com/v1/chat/completions';
      headers = { 'content-type': 'application/json', authorization: 'Bearer ' + ai.key };
      const content = images.map(d => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + d } }));
      content.push({ type: 'text', text: opts.text });
      body = { model: aiModel(), messages: [{ role: 'system', content: opts.system }, { role: 'user', content }] };
      body[provider === 'amber' ? 'max_tokens' : 'max_completion_tokens'] = maxTokens;   // amber erwartet laut Doku max_tokens
      if (tool) {
        body.tools = [{ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }];
        body.tool_choice = { type: 'function', function: { name: tool.name } };
      }
    }
    let res;
    try { res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: opts.signal }); }
    catch (e) { if (e && e.name === 'AbortError') throw e; throw new Error('Die KI ist nicht erreichbar. Bitte die Internetverbindung prüfen.'); }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const msg = data && data.error && (data.error.message || data.error.type) ? (data.error.message || data.error.type) : 'HTTP ' + res.status;
      if (res.status === 401 || res.status === 403) throw new Error('Der API-Schlüssel wurde abgelehnt (' + msg + '). Bitte unter Mehr → KI-Assistent prüfen.');
      if (res.status === 429 || res.status === 529) throw new Error('Die KI ist ausgelastet oder das Guthaben ist aufgebraucht. (' + msg + ')');
      throw new Error('Die KI meldet einen Fehler: ' + msg);
    }
    if (provider === 'anthropic') {
      if (data.stop_reason === 'max_tokens') throw new Error('Die KI-Antwort wurde zu lang. Bitte die Aufgabe in kleinere Teile aufteilen.');
      if (!tool) return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      const block = (data.content || []).find(b => b.type === 'tool_use');
      if (!block) throw new Error('Die KI hat keine auswertbare Antwort geliefert.');
      return block.input;
    }
    const choice = data.choices && data.choices[0];
    if (!choice) throw new Error('Die KI hat keine Antwort geliefert.');
    if (choice.finish_reason === 'length') throw new Error('Die KI-Antwort wurde zu lang. Bitte die Aufgabe in kleinere Teile aufteilen.');
    if (!tool) return choice.message && choice.message.content || '';
    const call = choice.message && choice.message.tool_calls && choice.message.tool_calls[0];
    try { return JSON.parse(call.function.arguments); }
    catch (e) { throw new Error('Die KI hat keine auswertbare Antwort geliefert.'); }
  }

  /* Vor jeder KI-Nutzung: Schluessel vorhanden, Datenschutzhinweis einmal bestaetigt */
  function requireAi() {
    if (!aiProvider()) {
      if (ai.key) { alert('Der hinterlegte Schlüssel wird nicht erkannt. Erwartet wird ein amber-Schlüssel (ambrs-…), ein Anthropic-Schlüssel (sk-ant-…) oder ein OpenAI-Schlüssel (sk-…).'); return false; }
      if (confirm('Für die KI-Funktionen wird ein API-Schlüssel von amber, Anthropic (Claude) oder OpenAI benötigt. Jetzt unter „Mehr“ eintragen?')) {
        switchTab('mehr');
        setTimeout(() => { const el = document.querySelector('[data-ai-input="key"]'); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } }, 150);
      }
      return false;
    }
    if (!ai.consent) {
      if (!confirm('Die KI-Funktionen übertragen Projektdaten, einen Auszug des Preisstamms und ggf. Fotos an ' + (aiProvider() === 'amber' ? 'amberSearch und den dort gewählten Modellanbieter' : aiProviderName()) + '. Nur mit Freigabe der Firma nutzen. Fortfahren?')) return false;
      ai.consent = true; saveJSON(KEYS.ai, ai);
    }
    return true;
  }

  function busySheet(text) {
    const ctrl = new AbortController();
    const wrap = openSheet('<div class="ai-busy"><div class="spinner"></div><b>' + esc(text) + '</b><span>Das kann ein bis zwei Minuten dauern.</span></div>'
      + '<button type="button" class="pill cancel" data-close>Abbrechen</button>', { onClose: () => ctrl.abort() });
    return { signal: ctrl.signal, close: () => { wrap._onClose = null; closeSheet(wrap); } };
  }

  function aiCatalogLines(withPrice) {
    const ok = p => p && p.id;
    let list = catalog.filter(p => ok(p) && (!p.site || p.site === settings.site) && (!p.stage || p.stage === project.level));
    if (!list.length) list = catalog.filter(ok);
    if (!list.length) return '(kein Preisstamm auf diesem Gerät – catalogId immer null)';
    return list.slice(0, 900).map(p => (withPrice === false ? [p.id, p.text, p.unit, p.trade] : [p.id, p.text, p.unit, dec2.format(num(p.price)), p.trade])
      .map(x => String(x == null ? '' : x).replace(/[|\r\n]+/g, ' ')).join(' | ')).join('\n');
  }
  /* Bei "Nur Region" dient der Preisstamm als Positionskatalog ohne Preise */
  function aiCatalogBlock(mode) {
    return mode === 'region'
      ? '\n\nPositionskatalog aus dem Einheitspreisstamm (ID | Bezeichnung | Einheit | Gewerk) – Bezeichnungen und Einheiten verwenden, Preise sind hier bewusst nicht enthalten:\n' + aiCatalogLines(false)
      : '\n\nPreisliste aus dem Einheitspreisstamm (ID | Bezeichnung | Einheit | EP netto EUR | Gewerk):\n' + aiCatalogLines(true);
  }
  function aiSuggestPrompt(task, nPhotos, price) {
    const groups = rows().filter(r => r.type === 'group').map(r => [r.oz, r.text].filter(Boolean).join(' ')).join('; ');
    return aiContext()
      + (groups ? 'Bereits vorhandene Kostengruppen: ' + groups + '\n' : '')
      + '\nAufgabe: Analysiere die Beschreibung' + (nPhotos ? ' und die ' + nPhotos + ' beigefügten Fotos (z. B. Aufmaß, Skizze, LV-Auszug)' : '')
      + ' fachlich und erstelle eine vollständige, sinnvoll nach Bauablauf gegliederte Kostenermittlung für die Maßnahme.\n'
      + '- Übernimm alle genannten Leistungen (origin genannt).\n'
      + '- Ergänze alle weiteren Positionen, die für eine fachgerechte und vollständige Ausführung notwendig sind (origin ergaenzt), soweit sie zur Maßnahme passen, jeweils in der Gliederungstiefe der Ermittlungsstufe – '
      + 'z. B. Baustelleneinrichtung, Verkehrssicherung, Aufbruch und Wiederherstellung von Oberflächen, Erdarbeiten und Bodenentsorgung, Verbau, Wasserhaltung, '
      + 'Leitungs- und Schachtbau mit Anschlüssen und Formstücken, Umverlegung oder Sicherung vorhandener Leitungen, Prüfungen, Vermessung und Dokumentation.\n'
      + '- ' + aiLevelRule() + '\n'
      + '- Keine Doppelungen mit bereits vorhandenen Kostengruppen.\n'
      + '- Mengen ergänzter Positionen nur, wenn sie sich aus den Angaben berechnen lassen (z. B. Oberfläche aus Länge × Breite), sonst null; im Hinweis kurz begründen, warum die Position nötig ist.\n'
      + 'Beschreibung: ' + (task || '(keine – nur Fotos)') + '\n\n'
      + '- Positionen vorwiegend aus dem Einheitspreisstamm wählen: passenden Eintrag verwenden (catalogId, Bezeichnung und Einheit übernehmen). '
      + 'Eigene Positionen nur, wenn für eine notwendige Leistung kein passender Eintrag existiert.\n'
      + aiTemplateExample() + '\n'
      + aiPriceRules(price.mode, price.region)
      + aiCatalogBlock(price.mode);
  }
  function aiCheckPrompt() {
    const f = project.fields, v = variant(), byId = new Map(catalog.map(p => [p.id, p]));
    const lines = v.rows.map(r => {
      if (r.type === 'group') return '[Kostengruppe ' + (r.oz || '') + '] ' + (r.text || '');
      const p = r.catalogId ? byId.get(r.catalogId) : null;
      const source = r.catalogId ? r.catalogId + (p ? ' (Preisstamm ' + dec2.format(num(p.price)) + ' € je ' + (p.unit || '–') + ')' : ' (nicht im Preisstamm)') : 'manueller Preis';
      return [r.oz || '', r.text || '', isBlank(r.qty) ? 'Menge fehlt' : qtyFmt.format(num(r.qty)) + ' ' + (r.unit || ''),
        isBlank(r.price) ? 'EP fehlt' : 'EP ' + dec2.format(num(r.price)), 'Gesamt ' + dec2.format(amount(r)), source].join(' | ');
    });
    return 'Prüfe diese Kostenermittlung auf Plausibilität: fehlende oder doppelte Positionen, unübliche Mengen oder Mengenverhältnisse, '
      + 'auffällige Einheitspreise, unpassende Einheiten, fehlende typische Nebenleistungen (z. B. Baustelleneinrichtung, Verkehrssicherung, '
      + 'Wasserhaltung, Entsorgung), Gliederungsfehler sowie eine für die ' + project.level + ' unpassende Gliederungstiefe (Maßstab: ' + LEVEL_RULES[project.level] + '). Nenne je Befund die OZ. Keine Befunde erfinden – wenn alles plausibel ist, bleibt die Liste leer.\n\n'
      + 'Ermittlungsstufe: ' + project.level + '\nProjekt: ' + [f.projectNo, f.projectName].filter(Boolean).join(' ') + '\nBauvorhaben: ' + (f.bauvorhaben || '–')
      + '\nVariante: ' + v.name + '\nUmsatzsteuer: ' + vatPercent() + ' %\nSumme netto: ' + dec2.format(netOf(v.rows)) + ' EUR\n'
      + (f.notes ? 'Anmerkungen: ' + f.notes + '\n' : '')
      + '\nZeilen (OZ | Text | Menge | EP | Gesamt | Preisquelle):\n' + lines.join('\n');
  }

  function photoData(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const sc = Math.min(1, 1568 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * sc)); c.height = Math.max(1, Math.round(img.naturalHeight * sc));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82).split(',')[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Das Foto „' + file.name + '“ konnte nicht gelesen werden.')); };
      img.src = url;
    });
  }

  function openAiSuggest() {
    if (!requireAi()) return;
    const photos = aiDraft.photos.slice();
    const priceState = { mode: ai.priceMode || 'catalog', region: aiDraft.region || regionGuess(), web: ai.webResearch !== false };
    const wrap = openSheet('<div class="sheet-head"><button type="button" class="link" data-close>Abbrechen</button><b>KI-Vorschlag</b><button type="button" class="link strong" data-go>Vorschlagen</button></div>'
      + levelControlsHtml()
      + '<div class="group" style="margin-top:12px"><label class="field-block"><span>Maßnahme beschreiben –die KI analysiert den Text und ergänzt alle notwendigen Positionen. Mengen angeben, soweit bekannt (Tipp: Diktat über das Mikrofon der Tastatur)</span>'
      + '<textarea class="ai-task" data-e="task" rows="7" placeholder="z. B. Erneuerung Kanal DN 300 auf 120 m in der Hauptstraße, Asphalt 10 cm, Grabenbreite 1,2 m, 6 Hausanschlüsse, Wasserhaltung erforderlich">' + esc(aiDraft.task) + '</textarea></label></div>'
      + '<div class="sec-head"><span>Fotos (optional) · Aufmaß, Skizze, LV-Seite</span></div><div class="group"><div class="ai-photos" data-photos></div>'
      + '<button type="button" class="row wide" data-add-photo><span class="k accent-text">Foto aufnehmen oder auswählen</span>' + chev + '</button></div>'
      + '<input type="file" accept="image/*" multiple hidden data-file>'
      + priceControlsHtml(priceState)
      + '<p class="hint-text">Den Vorschlag vor dem Übernehmen prüfen.</p>');
    const q = s => wrap.querySelector(s);
    wirePriceControls(wrap, priceState);
    wireLevelControls(wrap);
    const drawPhotos = () => {
      q('[data-photos]').innerHTML = photos.map((d, i) => '<div class="ai-photo"><img src="data:image/jpeg;base64,' + d + '" alt=""><button type="button" data-rm="' + i + '" aria-label="Foto entfernen">×</button></div>').join('');
    };
    drawPhotos();
    q('[data-e="task"]').addEventListener('input', e => { aiDraft.task = e.target.value; });
    q('[data-add-photo]').addEventListener('click', () => q('[data-file]').click());
    q('[data-file]').addEventListener('change', async e => {
      const files = Array.from(e.target.files || []); e.target.value = '';
      for (const file of files) {
        if (photos.length >= 5) { toast('Höchstens 5 Fotos je Vorschlag'); break; }
        try { photos.push(await photoData(file)); } catch (err) { alert(err.message); }
      }
      aiDraft.photos = photos.slice(); drawPhotos();
    });
    q('[data-photos]').addEventListener('click', e => {
      const b = e.target.closest('[data-rm]'); if (!b) return;
      photos.splice(Number(b.dataset.rm), 1); aiDraft.photos = photos.slice(); drawPhotos();
    });
    q('[data-go]').addEventListener('click', async () => {
      const task = q('[data-e="task"]').value.trim();
      if (!task && !photos.length) { toast('Bitte eine Beschreibung eingeben oder ein Foto hinzufügen'); return; }
      if (priceState.mode !== 'catalog' && !String(priceState.region || '').trim()) { toast('Bitte die Region für die Preisschätzung angeben'); return; }
      aiDraft.region = priceState.region;
      closeSheet(wrap);
      const busy = busySheet('KI erstellt einen Vorschlag …');
      try {
        const res = await callAi({ system: AI_SYSTEM, text: aiSuggestPrompt(task, photos.length, priceState), images: photos, tool: AI_SUGGEST_TOOL, maxTokens: 16000, signal: busy.signal });
        busy.close();
        const groups = normalizeSuggestion(res, priceState.mode);
        if (!groups.length) { alert('Die KI hat keine Positionen vorgeschlagen. Bitte die Beschreibung genauer fassen.'); return; }
        if (priceState.mode !== 'catalog' && priceState.web) {
          await runWebResearch(groups.flatMap(g => g.items).filter(x => !x.catalogId), priceState.region);
        }
        openAiPreview(groups, res && res.notes);
      } catch (e) {
        busy.close();
        if (!e || e.name !== 'AbortError') alert(e && e.message ? e.message : String(e));
      }
    });
  }

  function normalizeSuggestion(res, mode) {
    const byId = new Map(catalog.map(p => [String(p.id), p]));
    return (res && Array.isArray(res.groups) ? res.groups : []).map(g => ({
      text: String(g && g.text || 'Kostengruppe').trim(),
      items: (g && Array.isArray(g.items) ? g.items : []).filter(it => it && typeof it === 'object')
        .map(it => Object.assign({ on: true }, normalizeAiItem(it, mode || 'catalog', byId)))
    })).filter(g => g.items.length);
  }

  function openAiPreview(groups, notes) {
    const count = () => groups.reduce((s, g) => s + g.items.filter(x => x.on).length, 0);
    const draw = () => groups.map((g, gi) => '<div class="sec-head"><span>' + esc(g.text) + '</span></div><div class="group">'
      + g.items.map((it, ii) => '<button type="button" class="row cat-row ai-item' + (it.on ? ' on' : '') + '" data-g="' + gi + '" data-i="' + ii + '">'
        + '<span class="ai-check">' + (it.on ? '✓' : '') + '</span><span class="cat-main">' + (it.added ? '<span class="ai-badge new">Ergänzt</span>' : '') + '<b>' + esc(it.text) + '</b><span class="meta">'
        + esc([qtyText(it), priceInfo(it), it.hint].filter(Boolean).join(' · '))
        + '</span></span></button>').join('') + '</div>').join('');
    const wrap = openSheet('<div class="sheet-head"><button type="button" class="link" data-close>Verwerfen</button><b>Vorschlag prüfen</b><button type="button" class="link strong" data-apply>Übernehmen</button></div>'
      + (notes ? '<div class="group"><div class="ai-summary">' + esc(notes) + '</div></div>' : '')
      + (() => {
        const all = groups.flatMap(g => g.items), fromCat = all.filter(x => x.fromCatalog).length, added = all.filter(x => x.added).length;
        return '<p class="hint-text">' + fromCat + ' von ' + all.length + ' Positionen aus dem Einheitspreisstamm'
          + (added ? ' · ' + added + ' von der KI ergänzt' : '') + '</p>';
      })()
      + '<div data-list></div><div class="btn-row"><button type="button" class="pill primary" data-apply></button></div>'
      + webSourcesHtml(groups.flatMap(g => g.items)));
    const list = wrap.querySelector('[data-list]'), btn = wrap.querySelector('.pill[data-apply]');
    const refresh = () => { list.innerHTML = draw(); btn.textContent = count() + ' Positionen übernehmen'; };
    refresh();
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-g]'); if (!b) return;
      const it = groups[Number(b.dataset.g)].items[Number(b.dataset.i)];
      it.on = !it.on; refresh();
    });
    wrap.querySelectorAll('[data-apply]').forEach(b => b.addEventListener('click', () => {
      if (!count()) { toast('Keine Position ausgewählt'); return; }
      const n = applySuggestion(groups);
      aiDraft = { task: '', photos: [] };
      closeSheet(wrap);
      switchTab('kosten');
      const nKi = groups.reduce((s, g) => s + g.items.filter(x => x.on && (x.source === 'ki' || x.source === 'web')).length, 0);
      toast(n + ' Positionen aus dem KI-Vorschlag angefügt' + (nKi ? ' · ' + nKi + ' mit Schätz- oder Internetpreis, bitte prüfen' : ''));
    }));
  }

  /* Ausgewaehlte Vorschlaege als neue Kostengruppen am Ende anfuegen */
  function applySuggestion(groups) {
    const list = rows();
    let gNo = list.filter(r => r.type === 'group').length, n = 0;
    groups.forEach(g => {
      const items = g.items.filter(x => x.on); if (!items.length) return;
      gNo++;
      list.push({ type: 'group', oz: String(gNo), text: g.text });
      items.forEach((it, k) => {
        list.push({ type: 'item', oz: gNo + '.' + (k + 1), text: it.text, qty: it.qty, unit: it.unit, price: it.price, catalogId: it.catalogId });
        n++;
      });
    });
    ui.selected = -1; commit();
    return n;
  }

  /* ---------- KI: Preisvorgabe ---------- */
  const PRICE_MODES = [
    ['catalog', 'Einheitspreise', 'Nur Einheitspreise aus dem Preisstamm. Positionen ohne Treffer bleiben ohne Preis.'],
    ['mixed', 'EP + Region', 'Einheitspreise aus dem Preisstamm; wo keiner passt, schätzt die KI den Preis anhand vergleichbarer Projekte aus der Region.'],
    ['region', 'Nur Region', 'Alle Preise schätzt die KI anhand vergleichbarer Projekte aus der Region, ohne Preisstamm.']
  ];
  /* Region aus PLZ und Ort des Auftraggebers, sonst des Bauvorhabens oder Bueros */
  function regionGuess() {
    const f = project.fields;
    const pick = s => { const m = String(s || '').match(/(\d{5})\s+([^,\n]+)/); return m ? m[1] + ' ' + m[2].trim() : ''; };
    return pick(f.clientAddress) || pick(f.bauvorhaben) || pick(f.companyAddress) || pick(site().address);
  }
  /* ---------- KI: Ermittlungsstufe ---------- */
  function aiLevelRule() {
    return 'Gliederungstiefe der ' + project.level + ' einhalten: ' + LEVEL_RULES[project.level];
  }
  /* Eigene Projektvorlagen derselben Stufe als Massstab fuer Gliederung und Detailgrad */
  function aiTemplateExample() {
    const tpls = centralLists().templates.filter(t => t.stage === project.level && (!t.site || t.site === settings.site)).slice(0, 2);
    if (!tpls.length) return '';
    return '\nGliederungsbeispiele aus den Projektvorlagen dieser Stufe (Gliederungstiefe und Detailgrad als Maßstab; Inhalte nur übernehmen, wenn sie zur Maßnahme passen):\n'
      + tpls.map(t => '„' + (t.name || 'Vorlage') + '“: ' + t.rows.filter(r => r && r.text).slice(0, 40)
        .map(r => (r.type === 'group' ? '[' + r.text + ']' : r.text + (r.unit ? ' (' + r.unit + ')' : ''))).join('; ')).join('\n') + '\n';
  }
  function levelControlsHtml() {
    return '<div class="sec-head"><span>Ermittlungsstufe · bestimmt die Gliederungstiefe</span></div>'
      + '<div class="seg small ai-price-seg">' + LEVELS.map(l => '<button type="button" data-ai-level="' + esc(l) + '"' + (l === project.level ? ' class="on"' : '') + '>' + esc(LEVEL_SHORT[l]) + '</button>').join('') + '</div>'
      + '<p class="hint-text" data-level-help>' + esc(LEVEL_RULES_SHORT[project.level]) + '</p>';
  }
  function wireLevelControls(wrap) {
    wrap.querySelectorAll('[data-ai-level]').forEach(b => b.addEventListener('click', () => {
      project.level = b.dataset.aiLevel; commit();
      wrap.querySelectorAll('[data-ai-level]').forEach(x => x.classList.toggle('on', x === b));
      wrap.querySelector('[data-level-help]').textContent = LEVEL_RULES_SHORT[project.level];
    }));
  }

  function priceControlsHtml(state) {
    return '<div class="sec-head"><span>Preise</span></div>'
      + '<div class="seg small ai-price-seg">' + PRICE_MODES.map(([k, label]) => '<button type="button" data-price-mode="' + k + '">' + esc(label) + '</button>').join('') + '</div>'
      + '<p class="hint-text" data-price-help></p>'
      + '<div class="group" data-region-wrap style="margin-top:10px"><label class="row"><span class="k">Region</span>'
      + '<input class="v" data-e="region" value="' + esc(state.region) + '" placeholder="PLZ Ort oder Landkreis" autocomplete="off"></label>'
      + '<label class="row"><span class="k">Preise im Internet recherchieren<small>Vergleichspositionen mit Preisen und Quellen suchen (zusätzliche Suchkosten beim Anbieter)</small></span>'
      + '<input type="checkbox" class="switch" data-web' + (state.web ? ' checked' : '') + '></label></div>';
  }
  function wirePriceControls(wrap, state) {
    const help = wrap.querySelector('[data-price-help]'), regionWrap = wrap.querySelector('[data-region-wrap]');
    const sync = () => {
      wrap.querySelectorAll('[data-price-mode]').forEach(b => b.classList.toggle('on', b.dataset.priceMode === state.mode));
      const m = PRICE_MODES.find(x => x[0] === state.mode) || PRICE_MODES[0];
      help.textContent = m[2] + (state.mode === 'catalog' ? '' : ' KI-Schätzpreise beruhen auf dem Wissen des Modells, nicht auf einer Preisdatenbank – vor der Verwendung prüfen.');
      regionWrap.hidden = state.mode === 'catalog';
    };
    wrap.querySelectorAll('[data-price-mode]').forEach(b => b.addEventListener('click', () => {
      state.mode = b.dataset.priceMode; ai.priceMode = state.mode; saveJSON(KEYS.ai, ai); sync();
    }));
    wrap.querySelector('[data-e="region"]').addEventListener('input', e => { state.region = e.target.value; });
    wrap.querySelector('[data-web]').addEventListener('change', e => { state.web = e.target.checked; ai.webResearch = state.web; saveJSON(KEYS.ai, ai); });
    sync();
  }
  function aiPriceRules(mode, region) {
    const year = new Date().getFullYear();
    if (mode !== 'mixed' && mode !== 'region') return 'Preisvorgabe: Nur Einheitspreise aus der Preisliste (catalogId). price immer null.';
    const est = 'Schätzpreis (price, EP netto in EUR) als marktüblicher Einheitspreis vergleichbarer kommunaler Tiefbauprojekte in der Region ' + region
      + ', Preisstand ' + year + '; in priceBasis kurz die Grundlage nennen. Ist keine seriöse Schätzung möglich, price null.';
    return mode === 'mixed'
      ? 'Preisvorgabe: Vorrangig passende Einheitspreise aus der Preisliste (catalogId, price null). Nur wenn keiner passt: catalogId null und ' + est
      : 'Preisvorgabe: Positionen aus dem Positionskatalog (catalogId) verwenden, Preise aber nicht aus dem Einheitspreisstamm. ' + est;
  }
  function aiContext() {
    const f = project.fields;
    return 'Ermittlungsstufe: ' + project.level + ' – ' + LEVEL_HELP[project.level] + '\n'
      + 'Büro: ' + site().label + '\n'
      + (f.projectName ? 'Projekt: ' + f.projectName + '\n' : '')
      + (f.bauvorhaben ? 'Bauvorhaben: ' + f.bauvorhaben + '\n' : '')
      + (f.client ? 'Auftraggeber: ' + [f.client, f.clientAddress].filter(Boolean).join(', ') + '\n' : '');
  }
  function qtyText(r) { return isBlank(r.qty) ? 'Menge offen' : qtyFmt.format(num(r.qty)) + ' ' + (r.unit || ''); }
  function priceInfo(r) {
    const unit = r.unit ? ' je ' + r.unit : '';
    const noWeb = r.web && !r.web.found ? ' · kein Internetbeleg' : '';
    if (r.catalogId) return r.catalogId + ' · ' + dec2.format(num(r.price)) + ' €' + unit;
    if (r.source === 'web') return 'Internet ' + dec2.format(num(r.price)) + ' €' + unit + (r.basis ? ' (' + r.basis + ')' : '');
    if (r.source === 'ki') return 'KI-Schätzung ' + dec2.format(num(r.price)) + ' €' + unit + (r.basis ? ' (' + r.basis + ')' : '') + noWeb;
    return (isBlank(r.price) ? 'ohne Preis' : 'EP ' + dec2.format(num(r.price)) + ' €' + unit) + noWeb;
  }
  /* Eine Position aus der KI-Antwort pruefen: Preise nur aus dem Preisstamm oder – falls erlaubt – als markierte Schaetzung */
  function normalizeAiItem(it, mode, byId) {
    /* Preisstamm-Eintrag bestimmt Bezeichnung und Einheit; der Preis wird bei "Nur Region" nicht uebernommen */
    const entry = it.catalogId ? byId.get(String(it.catalogId).trim()) : null;
    const p = mode !== 'region' ? entry : null;
    const qty = typeof it.qty === 'number' && Number.isFinite(it.qty) ? it.qty : (it.qty != null && String(it.qty).trim() !== '' ? num(it.qty) : '');
    const plainUnit = u => String(u || '').toLowerCase().replace(/[.\s]/g, '');
    const unitClash = entry && entry.unit && it.unit && plainUnit(entry.unit) !== plainUnit(it.unit);
    const ownText = String(it.text || '').trim();
    const rawPrice = typeof it.price === 'number' ? it.price : (it.price != null && String(it.price).trim() !== '' ? num(it.price) : NaN);
    const est = !p && mode !== 'catalog' && Number.isFinite(rawPrice) && rawPrice > 0;
    return {
      text: String((entry && entry.text) || ownText).trim() || 'Position', qty,
      added: /ergaenzt|ergänzt/i.test(String(it.origin || '')),
      fromCatalog: !!entry,
      unit: (entry && entry.unit) || String(it.unit || ''),
      catalogId: p ? p.id : '',
      price: p ? num(p.price) : (est ? Math.round(rawPrice * 100) / 100 : ''),
      source: p ? 'ep' : (est ? 'ki' : ''),
      basis: est ? String(it.priceBasis || '').trim() : '',
      hint: [unitClash ? '⚠ Einheit laut Preisstamm ' + entry.unit + ', KI nannte ' + it.unit + ' – Menge prüfen' : '',
        entry && ownText && ownText !== String(entry.text || '').trim() ? 'KI-Bezeichnung: ' + ownText : '',
        String(it.hint || '').trim()].filter(Boolean).join(' · ')
    };
  }

  /* ---------- KI: bestehende Kostengruppen und Positionen verfeinern ---------- */
  const AI_REFINE_TOOL = {
    name: 'verfeinerung',
    description: 'Überarbeitete Kostengruppen und Positionen mit Änderungsangabe je Zeile.',
    input_schema: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ref: { type: ['string', 'null'], description: 'OZ der bestehenden Kostengruppe, null für eine neue' },
              text: { type: 'string', description: 'Bezeichnung der Kostengruppe' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    ref: { type: ['string', 'null'], description: 'OZ der bestehenden Position, null für eine neue' },
                    action: { type: 'string', enum: ['behalten', 'aendern', 'neu', 'entfernen'] },
                    text: { type: 'string' },
                    qty: { type: ['number', 'null'], description: 'Menge nur, wenn angegeben oder berechenbar; sonst null' },
                    unit: { type: 'string' },
                    catalogId: { type: ['string', 'null'], description: 'ID aus der Preisliste oder null' },
                    price: { type: ['number', 'null'], description: 'Schätzpreis EP netto in EUR, nur wenn laut Preisvorgabe erlaubt; sonst null' },
                    priceBasis: { type: 'string', description: 'Grundlage des Schätzpreises, kurz' },
                    hint: { type: 'string', description: 'Kurze Begründung der Änderung oder Rechenweg' }
                  },
                  required: ['ref', 'action', 'text', 'qty', 'unit', 'catalogId', 'price']
                }
              }
            },
            required: ['ref', 'text', 'items']
          }
        },
        notes: { type: 'string', description: 'Kurze Zusammenfassung der Überarbeitung' }
      },
      required: ['groups']
    }
  };
  function refineRange(scope) {
    const list = rows();
    if (scope && scope.row) { const s = list.indexOf(scope.row); return s < 0 ? null : { start: s, end: groupEnd(list, s) }; }
    return { start: 0, end: list.length };
  }
  function aiRefinePrompt(scope, instruction, price) {
    const range = refineRange(scope);
    const lines = rows().slice(range.start, range.end).map(r => (r.type === 'group'
      ? ['KG', r.oz || '', r.text || '']
      : ['POS', r.oz || '', r.text || '', isBlank(r.qty) ? '' : qtyFmt.format(num(r.qty)), r.unit || '', isBlank(r.price) ? '' : dec2.format(num(r.price)), r.catalogId || '']
    ).map(x => String(x).replace(/[|\r\n]+/g, ' ')).join(' | '));
    return aiContext()
      + '\nAufgabe: Verfeinere ' + (scope.row ? 'die Positionen der Kostengruppe ' + [scope.row.oz, scope.row.text].filter(Boolean).join(' ') : 'alle Kostengruppen und Positionen der Variante „' + variant().name + '“') + '.\n'
      + 'Anweisung: ' + (instruction || 'Positionen fachlich präzisieren, die Gliederungstiefe an die Ermittlungsstufe anpassen, fehlende notwendige Positionen ergänzen, Mengen aus vorhandenen Angaben berechnen.') + '\n\n'
      + 'Regeln:\n'
      + '- Jede bestehende Zeile mit ihrer OZ in ref aufführen und action setzen: behalten, aendern (mit den neuen Werten) oder entfernen (nur wenn doppelt oder fachlich überflüssig).\n'
      + '- Neue Zeilen: ref null und action neu. Die Reihenfolge der Liste ist die gewünschte Reihenfolge.\n'
      + (scope.row ? '- Genau eine Kostengruppe zurückgeben (ref = ' + (scope.row.oz || '') + ').\n' : '- Bestehende Kostengruppen mit ihrer OZ in ref, neue Kostengruppen mit ref null.\n')
      + '- ' + aiLevelRule() + ' Zeilen, die für diese Stufe zu fein oder zu grob sind, entsprechend zusammenfassen (entfernen und neu) bzw. aufgliedern.\n'
      + '- Bestehende Mengen nur ändern, wenn die Anweisung neue Angaben enthält oder sie sich daraus berechnen lassen.\n'
      + '- Positionen vorwiegend aus dem Einheitspreisstamm wählen (catalogId, Bezeichnung und Einheit übernehmen); eigene Positionen nur, wenn kein passender Eintrag existiert.\n'
      + '- Bestehende Positionen ohne Preis-ID nach Möglichkeit einem passenden Eintrag des Einheitspreisstamms zuordnen (action aendern mit catalogId).\n'
      + '- ' + aiPriceRules(price.mode, price.region) + '\n\n'
      + 'Bestehende Zeilen (Art | OZ | Text | Menge | Einheit | EP netto | Preis-ID):\n' + lines.join('\n') + '\n'
      + aiTemplateExample()
      + aiCatalogBlock(price.mode);
  }

  function openAiRefine(scope) {
    if (!requireAi()) return;
    const range = refineRange(scope);
    if (!range || range.end <= range.start) { toast('Keine Kostenansätze zum Verfeinern'); return; }
    const title = scope.row ? 'Kostengruppe ' + [scope.row.oz, scope.row.text].filter(Boolean).join(' · ') : 'Alle Kostenansätze · Variante „' + variant().name + '“';
    const price = { mode: ai.priceMode || 'catalog', region: regionGuess(), web: ai.webResearch !== false };
    const wrap = openSheet('<div class="sheet-head"><button type="button" class="link" data-close>Abbrechen</button><b>Mit KI verfeinern</b><button type="button" class="link strong" data-go>Starten</button></div>'
      + '<div class="as-title">' + esc(title) + '</div>'
      + levelControlsHtml()
      + '<div class="group" style="margin-top:12px"><label class="field-block"><span>Was soll verfeinert werden? (optional)</span>'
      + '<textarea class="ai-task" data-e="task" rows="5" placeholder="z. B. Erdarbeiten nach Bodenklassen aufgliedern, fehlende Nebenleistungen ergänzen, Mengen aus 120 m Länge × 1,2 m Grabenbreite berechnen"></textarea></label></div>'
      + priceControlsHtml(price)
      + '<p class="hint-text">Die Vorschau zeigt geänderte, neue und zu entfernende Positionen zur Auswahl. Nicht erwähnte Zeilen bleiben erhalten; die OZ '
      + (scope.row ? 'dieser Kostengruppe' : 'der Variante') + ' werden danach neu vergeben.</p>');
    wirePriceControls(wrap, price);
    wireLevelControls(wrap);
    wrap.querySelector('[data-go]').addEventListener('click', async () => {
      if (price.mode !== 'catalog' && !String(price.region || '').trim()) { toast('Bitte die Region für die Preisschätzung angeben'); return; }
      const instruction = wrap.querySelector('[data-e="task"]').value.trim();
      closeSheet(wrap);
      const busy = busySheet('KI verfeinert die Kostenansätze …');
      try {
        const res = await callAi({ system: AI_SYSTEM, text: aiRefinePrompt(scope, instruction, price), tool: AI_REFINE_TOOL, maxTokens: 16000, signal: busy.signal });
        busy.close();
        const model = buildRefineModel(res, scope, price.mode);
        if (!model) return;
        if (!model.actions) { alert('Die KI hat keine Änderungen vorgeschlagen.'); return; }
        if (price.mode !== 'catalog' && price.web) {
          /* Recherchiert werden neue Positionen ohne Preisstamm-Treffer und von der KI geschaetzte Preise */
          const targets = model.groups.flatMap(g => g.items)
            .filter(x => (x.kind === 'new' && !x.next.catalogId) || (x.kind === 'change' && x.merged.source === 'ki'))
            .map(x => (x.kind === 'new' ? x.next : x.merged));
          await runWebResearch(targets, price.region);
          model.groups.forEach(g => g.items.forEach(x => { if (x.kind === 'change') x.diff = rowDiff(x.row, x.merged); }));
        }
        openAiRefinePreview(model, scope, res && res.notes);
      } catch (e) {
        busy.close();
        if (!e || e.name !== 'AbortError') alert(e && e.message ? e.message : String(e));
      }
    });
  }

  /* Neue Werte auf eine bestehende Zeile anwenden; fehlende Angaben der KI lassen Bestehendes stehen */
  function mergeRowChange(r, n) {
    const m = { text: n.text || r.text || '', qty: n.qty !== '' ? n.qty : (r.qty == null ? '' : r.qty), unit: r.unit || '', price: r.price == null ? '' : r.price, catalogId: r.catalogId || '', source: '', basis: '' };
    if (n.catalogId) { m.catalogId = n.catalogId; m.price = n.price; m.unit = n.unit || m.unit; m.source = 'ep'; }
    else if (n.source === 'ki') { m.catalogId = ''; m.price = n.price; m.unit = n.unit || m.unit; m.source = 'ki'; m.basis = n.basis; }
    else if (n.unit && !m.unit) m.unit = n.unit;
    return m;
  }
  function rowDiff(r, m) {
    const d = [], q = v => (isBlank(v) ? '–' : qtyFmt.format(num(v))), pr = x => (isBlank(x.price) ? '–' : dec2.format(num(x.price)) + ' €');
    if (String(m.text) !== String(r.text || '')) d.push('Text „' + (r.text || '–') + '“');
    if (String(isBlank(m.qty) ? '' : num(m.qty)) !== String(isBlank(r.qty) ? '' : num(r.qty))) d.push('Menge ' + q(r.qty));
    if (String(m.unit || '') !== String(r.unit || '')) d.push('Einheit ' + (r.unit || '–'));
    if (num(m.price) !== num(r.price) || isBlank(m.price) !== isBlank(r.price) || String(m.catalogId || '') !== String(r.catalogId || '')) d.push('EP ' + pr(r) + (r.catalogId ? ' (' + r.catalogId + ')' : ''));
    return d;
  }
  function buildRefineModel(res, scope, mode) {
    const range = refineRange(scope); if (!range) return null;
    const old = rows().slice(range.start, range.end);
    const byOz = new Map();
    old.forEach(r => { const k = String(r.oz || '').trim(); if (k && !byOz.has(k)) byOz.set(k, r); });
    const byId = new Map(catalog.map(p => [String(p.id), p]));
    const used = new Set();
    let groupsIn = res && Array.isArray(res.groups) ? res.groups.filter(g => g && typeof g === 'object') : [];
    if (scope.row) groupsIn = [{ ref: scope.row.oz, text: scope.row.text, items: groupsIn.flatMap(g => (Array.isArray(g.items) ? g.items : [])) }];
    const groups = [];
    groupsIn.forEach(g => {
      let row = scope.row || null;
      if (!row && g.ref != null) {
        const ex = byOz.get(String(g.ref).trim());
        if (ex && ex.type === 'group' && !used.has(ex)) row = ex;
      }
      if (row) used.add(row);
      const items = [];
      (Array.isArray(g.items) ? g.items : []).forEach(it => {
        if (!it || typeof it !== 'object') return;
        const action = String(it.action || '').toLowerCase();
        const ex = it.ref != null ? byOz.get(String(it.ref).trim()) : null;
        const next = normalizeAiItem(it, mode, byId);
        if (ex && ex.type !== 'group' && !used.has(ex)) {
          used.add(ex);
          if (action === 'entfernen') { items.push({ kind: 'remove', row: ex, on: true }); return; }
          const merged = mergeRowChange(ex, next), diff = rowDiff(ex, merged);
          items.push(action !== 'behalten' && diff.length ? { kind: 'change', row: ex, merged, diff, next, on: true } : { kind: 'keep', row: ex, on: true });
        } else if (action === 'neu' || action === 'aendern') {
          items.push({ kind: 'new', next, on: true });
        }
      });
      if (!row && !items.some(x => x.kind === 'new')) return;
      groups.push({ row, text: String(g.text || 'Kostengruppe').trim(), items });
    });
    const actions = groups.reduce((s, g) => s + g.items.filter(x => x.kind !== 'keep').length, 0);
    return { groups, actions };
  }

  function openAiRefinePreview(model, scope, notes) {
    const BADGE = { new: 'Neu', change: 'Geändert', remove: 'Entfernen' };
    const selected = () => model.groups.reduce((s, g) => s + g.items.filter(x => x.kind !== 'keep' && x.on).length, 0);
    const keeps = model.groups.reduce((s, g) => s + g.items.filter(x => x.kind === 'keep').length, 0);
    const draw = () => model.groups.map((g, gi) => {
      const shown = g.items.map((it, ii) => ({ it, ii })).filter(x => x.it.kind !== 'keep');
      if (!shown.length) return '';
      return '<div class="sec-head"><span>' + esc(g.row ? [g.row.oz, g.row.text].filter(Boolean).join(' · ') : 'Neue Kostengruppe · ' + g.text) + '</span></div><div class="group">'
        + shown.map(({ it, ii }) => {
          const r = it.kind === 'new' ? it.next : (it.kind === 'change' ? it.merged : it.row);
          const meta = it.kind === 'change'
            ? [qtyText(r), priceInfo(r), 'vorher: ' + it.diff.join(', '), it.next.hint]
            : [qtyText(r), priceInfo(r), it.kind === 'new' ? it.next.hint : ''];
          return '<button type="button" class="row cat-row ai-item ai-' + it.kind + (it.on ? ' on' : '') + '" data-g="' + gi + '" data-i="' + ii + '">'
            + '<span class="ai-check">' + (it.on ? '✓' : '') + '</span><span class="cat-main"><span class="ai-badge ' + it.kind + '">' + BADGE[it.kind] + '</span>'
            + '<b>' + esc((it.row && it.row.oz ? it.row.oz + ' · ' : '') + (r.text || '')) + '</b>'
            + '<span class="meta">' + esc(meta.filter(Boolean).join(' · ')) + '</span></span></button>';
        }).join('') + '</div>';
    }).join('');
    const wrap = openSheet('<div class="sheet-head"><button type="button" class="link" data-close>Verwerfen</button><b>Änderungen prüfen</b><button type="button" class="link strong" data-apply>Übernehmen</button></div>'
      + (notes ? '<div class="group"><div class="ai-summary">' + esc(notes) + '</div></div>' : '')
      + (keeps ? '<p class="hint-text">' + keeps + ' Zeile' + (keeps === 1 ? ' bleibt' : 'n bleiben') + ' unverändert.</p>' : '')
      + '<div data-list></div><div class="btn-row"><button type="button" class="pill primary" data-apply></button></div>'
      + webSourcesHtml(model.groups.flatMap(g => g.items.filter(x => x.kind === 'new' || x.kind === 'change').map(x => (x.kind === 'new' ? x.next : x.merged)))));
    const list = wrap.querySelector('[data-list]'), btn = wrap.querySelector('.pill[data-apply]');
    const refresh = () => { list.innerHTML = draw(); const n = selected(); btn.textContent = n + ' Änderung' + (n === 1 ? '' : 'en') + ' übernehmen'; };
    refresh();
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-g]'); if (!b) return;
      const it = model.groups[Number(b.dataset.g)].items[Number(b.dataset.i)];
      it.on = !it.on; refresh();
    });
    wrap.querySelectorAll('[data-apply]').forEach(b => b.addEventListener('click', () => {
      if (!selected()) { toast('Keine Änderung ausgewählt'); return; }
      const estimated = o => o.source === 'ki' || o.source === 'web';
      const nKi = model.groups.reduce((s, g) => s + g.items.filter(x => x.on && ((x.kind === 'new' && estimated(x.next)) || (x.kind === 'change' && estimated(x.merged)))).length, 0);
      const n = applyRefinement(model, scope);
      closeSheet(wrap);
      switchTab('kosten');
      toast(n + ' Änderung' + (n === 1 ? '' : 'en') + ' übernommen' + (nKi ? ' · ' + nKi + ' mit Schätz- oder Internetpreis, bitte prüfen' : ''));
    }));
  }

  /* Ausgewaehlte Aenderungen einbauen; nicht erwaehnte Zeilen bleiben an ihrer Kostengruppe erhalten */
  function applyRefinement(model, scope) {
    const list = rows(), range = refineRange(scope);
    if (!range) return 0;
    const old = list.slice(range.start, range.end);
    const block = [], used = new Set();
    let n = 0;
    model.groups.forEach(g => {
      const items = [];
      g.items.forEach(it => {
        if (it.kind === 'new') {
          if (it.on) { items.push({ type: 'item', oz: '', text: it.next.text, qty: it.next.qty, unit: it.next.unit, price: it.next.price, catalogId: it.next.catalogId }); n++; }
          return;
        }
        used.add(it.row);
        if (it.kind === 'remove' && it.on) { n++; return; }
        if (it.kind === 'change' && it.on) {
          Object.assign(it.row, { text: it.merged.text, qty: it.merged.qty, unit: it.merged.unit, price: it.merged.price, catalogId: it.merged.catalogId });
          n++;
        }
        items.push(it.row);
      });
      if (!g.row && !items.length) return;
      if (g.row) used.add(g.row);
      block.push(g.row || { type: 'group', oz: '', text: g.text }, ...items);
    });
    /* Von der KI nicht genannte Zeilen an ihrem bisherigen Platz halten: direkt hinter dem
       zuletzt platzierten Vorgaenger derselben Kostengruppe bzw. hinter dessen Gruppenblock */
    const origGroup = new Map();
    let cur = null, lead = 0, prev = null;
    old.forEach(r => { if (r.type === 'group') cur = r; else origGroup.set(r, cur); });
    const groupOf = r => (r.type === 'group' ? r : origGroup.get(r));
    old.forEach(r => {
      if (used.has(r)) { if (block.indexOf(r) >= 0) prev = r; return; }
      used.add(r);
      let at;
      if (r.type === 'group') {
        const pg = prev ? groupOf(prev) : null, pi = pg ? block.indexOf(pg) : -1;
        at = pi >= 0 ? groupEnd(block, pi) : (prev ? block.length : lead);
      } else {
        const gr = origGroup.get(r), pi = prev ? block.indexOf(prev) : -1;
        if (pi >= 0 && groupOf(prev) === gr) at = pi + 1;
        else { const gi = gr ? block.indexOf(gr) : -1; at = gi >= 0 ? groupEnd(block, gi) : (gr ? block.length : lead++); }
      }
      block.splice(at, 0, r);
      prev = r;
    });
    list.splice(range.start, range.end - range.start, ...block);
    if (scope.row) {
      const gOz = scope.row.oz || String(groupOrdinal(list, range.start));
      let p = 0;
      for (let i = range.start + 1; i < list.length && list[i].type !== 'group'; i++) { p++; list[i].oz = gOz + '.' + p; }
    } else {
      let g = 0, p = 0;
      list.forEach(r => { if (r.type === 'group') { g++; p = 0; r.oz = String(g); } else { p++; r.oz = String(g || 1) + '.' + p; } });
    }
    ui.selected = -1; commit();
    return n;
  }

  /* ---------- KI: Internetrecherche fuer Schaetzpreise ----------
     Anthropic: Websuche des Anbieters + Ergebnis-Werkzeug in einer Anfrage (pause_turn wird fortgesetzt).
     OpenAI:    Responses-Schnittstelle mit web_search + Funktion.
     amber:     Websuche ueber /api/beta/web_search, Auswertung der Rohergebnisse durch das gewaehlte Modell.
     Quellen werden nur behalten, wenn ihre Domain in den tatsaechlichen Suchergebnissen vorkommt. */
  const AI_RESEARCH_TOOL = {
    name: 'preisrecherche',
    description: 'Im Internet gefundene Vergleichspreise je Position.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nr: { type: 'integer', description: 'Nummer der Position aus der Liste' },
              found: { type: 'boolean', description: 'true nur bei belastbarem Fund mit Quelle' },
              price: { type: ['number', 'null'], description: 'Typischer Einheitspreis netto in EUR je Einheit der Position, aus den Funden abgeleitet' },
              priceMin: { type: ['number', 'null'], description: 'Niedrigster gefundener Wert (netto, je Einheit)' },
              priceMax: { type: ['number', 'null'], description: 'Höchster gefundener Wert (netto, je Einheit)' },
              sources: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    url: { type: 'string', description: 'Echte URL der Fundstelle' },
                    price: { type: ['number', 'null'], description: 'Dort genannter Preis, umgerechnet auf netto je Einheit' },
                    year: { type: ['string', 'null'], description: 'Preisstand' },
                    note: { type: 'string' }
                  },
                  required: ['url']
                }
              },
              note: { type: 'string', description: 'Einordnung: Region, Preisstand, Umrechnung, Unsicherheit' }
            },
            required: ['nr', 'found', 'price', 'sources']
          }
        }
      },
      required: ['items']
    }
  };
  function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } }
  function hostsIn(text) {
    const out = new Set();
    (String(text || '').match(/https?:\/\/[^\s"'<>\\)\]]+/g) || []).forEach(u => { const h = hostOf(u); if (h) out.add(h); });
    return out;
  }
  function regionCity(region) {
    const m = String(region || '').match(/\d{5}\s+([^,]+)/);
    return m ? m[1].trim() : String(region || '').trim();
  }
  function researchPrompt(list, region) {
    const lines = list.map((o, i) => [i + 1, String(o.text || '').replace(/[|\r\n]+/g, ' '), o.unit || '',
      isBlank(o.qty) ? '' : qtyFmt.format(num(o.qty)), isBlank(o.price) ? '' : dec2.format(num(o.price)) + ' €'].join(' | '));
    return 'Ermittle für die folgenden Positionen einer kommunalen Tiefbau-Kostenermittlung (' + project.level + ') vergleichbare Positionen mit Preisen aus dem Internet. Region: ' + region + '.\n'
      + 'Geeignete Quellen: veröffentlichte Submissions- und Vergabeergebnisse, Kostenkennwerte und Preisspiegel von Kommunen, Zweckverbänden, Landesämtern und Fachportalen. '
      + 'Bevorzuge Deutschland, die Region und die letzten drei Jahre.\n'
      + 'Rechne Funde auf den Einheitspreis netto je angegebener Einheit um (Bruttopreise durch 1,19 teilen) und nenne Preisstand und Umrechnung in note.\n'
      + 'Nur tatsächlich gefundene Preise mit der echten Quellen-URL angeben, keine URLs erfinden. Ohne belastbaren Fund: found false und price null.\n'
      + 'Gib das Ergebnis über das Werkzeug preisrecherche zurück; nr ist die Nummer aus der Liste.\n\n'
      + 'Positionen (Nr | Text | Einheit | Menge | bisheriger Schätzpreis):\n' + lines.join('\n');
  }
  async function aiPost(url, headers, body, signal) {
    let res;
    try { res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal }); }
    catch (e) { if (e && e.name === 'AbortError') throw e; throw new Error('Die Internetrecherche ist nicht erreichbar. Bitte die Internetverbindung prüfen.'); }
    const text = await res.text().catch(() => '');
    let data = text;
    try { data = JSON.parse(text); } catch (e) { /* manche Suchdienste antworten mit Text */ }
    if (!res.ok) {
      const obj = data && typeof data === 'object' ? data : null;
      const msg = (obj && obj.error && (obj.error.message || obj.error.type))
        || (obj && obj.detail && (typeof obj.detail === 'string' ? obj.detail : JSON.stringify(obj.detail)))
        || 'HTTP ' + res.status;
      if (res.status === 401) throw new Error('Der API-Schlüssel wurde für die Recherche abgelehnt (' + msg + ').');
      if (res.status === 403 || res.status === 404) throw new Error('Die Websuche ist für diesen Zugang nicht verfügbar oder nicht freigeschaltet (' + msg + ').');
      if (res.status === 429 || res.status === 529) throw new Error('Die Recherche ist ausgelastet oder das Guthaben ist aufgebraucht (' + msg + ').');
      throw new Error('Die Internetrecherche meldet einen Fehler: ' + msg);
    }
    return data;
  }
  async function researchPrices(list, region, signal) {
    const provider = aiProvider(), prompt = researchPrompt(list, region), city = regionCity(region);
    const system = 'Du recherchierst Baupreise für ein Ingenieurbüro für kommunale Infrastruktur. Antworte auf Deutsch. '
      + 'Gib das Ergebnis ausschließlich über das Werkzeug preisrecherche zurück und nenne nur Quellen, die du tatsächlich gefunden hast.';
    const location = Object.assign({ type: 'approximate', country: 'DE' }, city ? { city } : {});
    if (provider === 'anthropic') {
      const headers = { 'content-type': 'application/json', 'x-api-key': ai.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
      const messages = [{ role: 'user', content: prompt }];
      const tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: Math.min(20, list.length * 2 + 2), user_location: location }, AI_RESEARCH_TOOL];
      const known = new Set();
      let forced = false;
      for (let round = 0; round < 6; round++) {
        const body = { model: aiModel(), max_tokens: 8000, system, messages, tools, tool_choice: forced ? { type: 'tool', name: AI_RESEARCH_TOOL.name } : { type: 'auto' } };
        const data = await aiPost('https://api.anthropic.com/v1/messages', headers, body, signal);
        const content = data && Array.isArray(data.content) ? data.content : [];
        content.forEach(b => { if (b.type !== 'tool_use') hostsIn(JSON.stringify(b)).forEach(h => known.add(h)); });
        const call = content.find(b => b.type === 'tool_use' && b.name === AI_RESEARCH_TOOL.name);
        if (call) return { result: call.input, known };
        if (data && data.stop_reason === 'max_tokens') throw new Error('Die Recherche-Antwort wurde zu lang. Bitte weniger Positionen auf einmal recherchieren.');
        messages.push({ role: 'assistant', content });
        if (data && data.stop_reason === 'pause_turn') continue;   // lange Suche: unveraendert fortsetzen
        messages.push({ role: 'user', content: 'Gib das Ergebnis jetzt über das Werkzeug preisrecherche zurück.' });
        forced = true;
      }
      throw new Error('Die Internetrecherche hat kein auswertbares Ergebnis geliefert.');
    }
    if (provider === 'openai') {
      const body = {
        model: aiModel(), instructions: system, input: prompt, max_output_tokens: 8000, tool_choice: 'auto',
        tools: [{ type: 'web_search', user_location: location },
          { type: 'function', name: AI_RESEARCH_TOOL.name, description: AI_RESEARCH_TOOL.description, parameters: AI_RESEARCH_TOOL.input_schema }]
      };
      const data = await aiPost('https://api.openai.com/v1/responses', { 'content-type': 'application/json', authorization: 'Bearer ' + ai.key }, body, signal);
      const output = data && Array.isArray(data.output) ? data.output : [];
      const known = new Set();
      output.forEach(o => { if (o.type !== 'function_call') hostsIn(JSON.stringify(o)).forEach(h => known.add(h)); });
      const call = output.find(o => o.type === 'function_call' && o.name === AI_RESEARCH_TOOL.name);
      if (!call) throw new Error('Die Internetrecherche hat kein auswertbares Ergebnis geliefert.');
      try { return { result: JSON.parse(call.arguments), known }; }
      catch (e) { throw new Error('Die Internetrecherche hat kein auswertbares Ergebnis geliefert.'); }
    }
    /* amber: erst suchen, dann die Rohergebnisse vom gewaehlten Modell auswerten lassen */
    const where = city || region;
    const queries = [];
    list.forEach(o => {
      const t = String(o.text || '').slice(0, 90), u = o.unit || 'Einheit';
      queries.push(t + ' Einheitspreis je ' + u + ' ' + where, t + ' Preis je ' + u + ' Submissionsergebnis Tiefbau');
    });
    const root = String(ai.amberUrl || 'https://gbi.ambersearch.de').trim().replace(/\/+$/, '');
    const found = await aiPost(root + '/api/beta/web_search', { 'content-type': 'application/json', authorization: 'Bearer ' + ai.key },
      { queries: queries.slice(0, 24), count: 5, mode: 'context', timeout: 30 }, signal);
    const raw = typeof found === 'string' ? found : JSON.stringify(found);
    if (!raw || raw.length < 30) throw new Error('Die Websuche von amber hat keine Ergebnisse geliefert.');
    const result = await callAi({
      system, maxTokens: 8000, signal, tool: AI_RESEARCH_TOOL,
      text: prompt + '\n\nSuchergebnisse der Websuche (nur diese Fundstellen und URLs verwenden):\n' + raw.slice(0, 80000)
    });
    return { result, known: hostsIn(raw) };
  }
  /* Positionen (Objekte mit text, unit, qty, price) recherchieren und Treffer eintragen */
  async function runWebResearch(targets, region) {
    const list = targets.slice(0, 15);
    if (!list.length) return;
    const busy = busySheet('Preise werden im Internet recherchiert …');
    try {
      const out = await researchPrices(list, region, busy.signal);
      busy.close();
      const byNr = new Map((out.result && Array.isArray(out.result.items) ? out.result.items : []).filter(Boolean).map(x => [Number(x.nr), x]));
      let hits = 0;
      list.forEach((o, i) => {
        const r = byNr.get(i + 1);
        o.web = { found: false };
        if (!r || !r.found) return;
        const sources = (Array.isArray(r.sources) ? r.sources : [])
          .filter(s => s && /^https?:\/\//i.test(String(s.url || '')) && (!out.known.size || out.known.has(hostOf(s.url))))
          .slice(0, 5)
          .map(s => ({ url: String(s.url), title: String(s.title || '').trim(), price: s.price != null && Number.isFinite(Number(s.price)) ? Number(s.price) : null, year: s.year ? String(s.year) : '' }));
        const price = Number(r.price), min = Number(r.priceMin), max = Number(r.priceMax);
        if (!sources.length || r.price == null || !Number.isFinite(price) || price <= 0) return;
        o.price = Math.round(price * 100) / 100;
        o.catalogId = '';
        o.source = 'web';
        o.basis = sources.length + ' Quelle' + (sources.length === 1 ? '' : 'n')
          + (r.priceMin != null && r.priceMax != null && min > 0 && max >= min ? ', Spanne ' + dec2.format(min) + '–' + dec2.format(max) + ' €' : '');
        o.sources = sources;
        o.webNote = String(r.note || '').trim();
        o.web = { found: true };
        hits++;
      });
      toast(hits ? hits + ' von ' + list.length + ' Preisen im Internet belegt' : 'Keine belastbaren Internetpreise gefunden');
    } catch (e) {
      busy.close();
      if (e && e.name === 'AbortError') return;
      alert((e && e.message ? e.message : String(e)) + '\n\nDer Vorschlag wird ohne Internetpreise angezeigt.');
    }
  }
  function webSourcesHtml(objs) {
    const list = objs.filter(Boolean);
    const withSrc = list.filter(o => Array.isArray(o.sources) && o.sources.length);
    const missing = list.filter(o => o.web && !o.web.found).length;
    if (!withSrc.length && !missing) return '';
    return '<div class="sec-head"><span>Internetrecherche</span></div>'
      + (withSrc.length ? '<div class="group">' + withSrc.map(o => '<div class="row ai-src"><span class="k">' + esc(o.text)
        + (o.webNote ? '<small>' + esc(o.webNote) + '</small>' : '')
        + o.sources.map(s => '<small><a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.title || hostOf(s.url)) + '</a>'
          + (s.price != null ? ' · ' + dec2.format(s.price) + ' €' : '') + (s.year ? ' · ' + esc(s.year) : '') + '</small>').join('')
        + '</span></div>').join('') + '</div>' : '')
      + '<p class="hint-text">' + (missing ? missing + ' Position' + (missing === 1 ? '' : 'en') + ' ohne belastbaren Internetfund – dort bleibt der Schätzpreis bzw. kein Preis. ' : '')
      + 'Gefundene Preise und Quellen vor der Verwendung prüfen.</p>';
  }

  async function runAiCheck() {
    if (!requireAi()) return;
    if (!rows().some(r => r.type !== 'group')) { toast('Noch keine Positionen zum Prüfen'); return; }
    const busy = busySheet('KI prüft die Kostenermittlung …');
    try {
      const res = await callAi({ system: AI_SYSTEM, text: aiCheckPrompt(), tool: AI_CHECK_TOOL, maxTokens: 6000, signal: busy.signal });
      busy.close();
      openAiFindings(res);
    } catch (e) {
      busy.close();
      if (!e || e.name !== 'AbortError') alert(e && e.message ? e.message : String(e));
    }
  }

  function openAiFindings(res) {
    const order = { fehler: 0, warnung: 1, hinweis: 2 }, label = { fehler: 'Fehler', warnung: 'Warnung', hinweis: 'Hinweis' };
    const list = (res && Array.isArray(res.findings) ? res.findings : []).filter(x => x && (x.title || x.detail))
      .sort((a, b) => (order[a.severity] ?? 2) - (order[b.severity] ?? 2));
    const wrap = openSheet('<div class="sheet-head"><span class="link"></span><b>KI-Prüfung</b><button type="button" class="link strong" data-close>Fertig</button></div>'
      + (res && res.summary ? '<div class="group"><div class="ai-summary">' + esc(res.summary) + '</div></div>' : '')
      + (list.length
        ? '<div class="sec-head"><span>' + list.length + ' Befund' + (list.length === 1 ? '' : 'e') + '</span></div><div class="group">'
          + list.map((x, i) => '<button type="button" class="row cat-row ai-finding" data-i="' + i + '">'
            + '<span class="ai-sev ' + esc(label[x.severity] ? x.severity : 'hinweis') + '">' + esc(label[x.severity] || 'Hinweis') + '</span>'
            + '<span class="cat-main"><b>' + esc((x.oz ? x.oz + ' · ' : '') + (x.title || '')) + '</b><span class="meta">' + esc(x.detail || '') + '</span></span>'
            + (x.oz ? chev : '') + '</button>').join('') + '</div>'
        : '<div class="group" style="margin-top:14px"><div class="empty">Keine Auffälligkeiten gefunden.</div></div>')
      + '<p class="hint-text">KI-Hinweise sind eine Prüfhilfe und ersetzen die fachliche Durchsicht nicht.</p>');
    wrap.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => {
      const x = list[Number(b.dataset.i)]; if (!x || !x.oz) return;
      const idx = rows().findIndex(r => String(r.oz || '').trim() === String(x.oz).trim());
      if (idx < 0) { toast('Zeile ' + x.oz + ' nicht gefunden'); return; }
      closeSheet(wrap); switchTab('kosten');
      setTimeout(() => openRowSheet(idx), 120);
    }));
  }

  async function testAi() {
    if (!aiProvider()) { alert('Bitte zuerst einen Schlüssel von amber (ambrs-…), Anthropic (sk-ant-…) oder OpenAI (sk-…) eintragen.'); return; }
    const busy = busySheet('Verbindung wird geprüft …');
    try {
      let info = '';
      if (aiProvider() === 'amber') {
        const ids = await loadAmberModels(busy.signal);
        info = ' · ' + ids.length + ' Modelle verfügbar';
      }
      await callAi({ system: 'Antworte nur mit OK.', text: 'Verbindungstest', maxTokens: 256, signal: busy.signal });
      busy.close(); renderMehr(); toast('KI-Verbindung funktioniert' + info);
    } catch (e) {
      busy.close(); renderMehr();
      if (!e || e.name !== 'AbortError') alert(e && e.message ? e.message : String(e));
    }
  }

  /* ---------- Import / Export ---------- */
  function openImport() { $('#file-input').click(); }

  async function handleImportFile(file) {
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (e) { alert('Die Datei „' + file.name + '“ ist keine gültige JSON-Datei.'); return; }
    if (data && Array.isArray(data.prices)) { importCatalog(data.prices); return; }
    if (data && (Array.isArray(data.rows) || Array.isArray(data.variants))) {
      const name = (data.fields && (data.fields.projectName || data.fields.projectNo)) || file.name;
      if (!confirm('Das Projekt auf diesem iPhone durch „' + name + '“ ersetzen?')) return;
      try {
        const master = takeMasterData(data);
        project = normalizeProject(data); ui.selected = -1; ui.search = '';
        /* Der Desktop-Export traegt Standort, Preisstamm und Zentrale Verwaltung mit. */
        if (SITES[data.siteKey]) { settings.site = data.siteKey; saveSettings(); }
        const failed = [];
        if (master.prices.length && !mergeCatalog(master.prices).saved) failed.push('die Einheitspreise');
        if (master.central) { central = master.central; if (!saveJSON(KEYS.central, central)) failed.push('Vorlagen und Auftraggeber'); }
        commit(); switchTab('projekt');
        if (failed.length) {
          alert('Das Projekt ist geladen, aber ' + failed.join(' und ') + ' konnten auf diesem iPhone nicht dauerhaft gespeichert werden (Browser-Speicher voll). Bitte den Import einmal wiederholen.');
        } else {
          toast(importSummary(master.prices.length));
        }
      } catch (e) { alert(e.message); }
      return;
    }
    alert('Unbekanntes Dateiformat. Erwartet wird ein Projekt aus „JSON exportieren“ oder ein Preisstamm aus „Preisstamm exportieren“ der Desktop-Version.');
  }

  function mergeCatalog(prices) {
    const map = new Map(catalog.map(p => [p.id, p]));
    let added = 0, updated = 0;
    prices.forEach(p => {
      if (!p || !p.id) return;
      if (map.has(p.id)) updated++; else added++;
      map.set(p.id, p);
    });
    catalog = Array.from(map.values());
    const saved = saveJSON(KEYS.catalog, catalog);
    return { added, updated, saved };
  }
  function importCatalog(prices) {
    const res = mergeCatalog(prices);
    renderAll();
    if (!res.saved) alert('Der Preisstamm konnte auf diesem iPhone nicht dauerhaft gespeichert werden (Browser-Speicher voll).');
    toast('Preisstamm: ' + res.added + ' neu, ' + res.updated + ' aktualisiert');
  }

  async function shareProject() {
    persist();
    const name = (project.fields.projectNo || 'GBi').replace(/[\\/:*?"<>|]/g, '') + '_Kostenermittlung.json';
    const file = new File([JSON.stringify(exportObject(), null, 2)], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* ---------- PDF (jsPDF, DIN A4) – Layout wie die Desktop-Vorlage ----------
     Die Datei wird in der App selbst erzeugt statt ueber den Druckdialog: Safari auf dem
     iPhone haelt CSS-Seitenumbrueche beim Drucken nicht zuverlaessig ein. */
  const PDF = { W: 210, H: 297, L: 12, R: 198, T: 12, BOTTOM: 276, FOOT: 281 };
  function pctText(v) { return v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 2 }); }
  function addressParts(text) { return String(text || '').split(/\s*,\s*/).filter(Boolean); }
  function fitBox(img, maxW, maxH) { const k = Math.min(maxW / img.w, maxH / img.h); return { w: img.w * k, h: img.h * k }; }
  function pdfFileName() {
    return ([project.fields.projectNo, levelTitle(), project.fields.projectName].filter(Boolean).join(' - ')
      .replace(/[\\/:*?"<>|]/g, '') || 'GBi Kostenermittlung') + '.pdf';
  }

  /* Bilder (Logo, Wappen, Unterschrift, Stempel) als PNG-Daten mit Pixelmassen vorbereiten */
  function loadImageData(src) {
    return new Promise(resolve => {
      if (!src) { resolve(null); return; }
      const img = new Image();
      img.onload = () => {
        try {
          const sc = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * sc));
          c.height = Math.max(1, Math.round(img.naturalHeight * sc));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve({ data: c.toDataURL('image/png'), w: c.width, h: c.height });
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  let pdfAssetCache = { key: '', promise: null };
  function pdfAssets() {
    const key = [site().logo, String(project.municipalityLogo || '').length, String(project.signatureImage || '').length, stamp.length].join('|');
    if (pdfAssetCache.key !== key || !pdfAssetCache.promise) {
      pdfAssetCache = {
        key,
        promise: Promise.all([loadImageData(site().logo), loadImageData(project.municipalityLogo), loadImageData(project.signatureImage), loadImageData(stamp)])
          .then(([logo, wappen, sig, st]) => ({ logo, wappen, sig, stamp: st }))
      };
    }
    return pdfAssetCache.promise;
  }

  function buildPdf(assets) {
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const s = site(), f = project.fields, vat = vatPercent(), brand = s.brand;
    const printed = settings.allVariants ? project.variants : [variant()];
    const pt = v => v * 0.3528;   // Punkt -> Millimeter
    const font = (size, style) => { doc.setFont('helvetica', style || 'normal'); doc.setFontSize(size); };
    const ink = c => doc.setTextColor(c || '#000000');
    const stroke = (c, w) => { doc.setDrawColor(c); doc.setLineWidth(w); };
    const GREY = [240, 240, 240];

    /* Kopf mit Logo und Absender */
    const brandLines = [s.company, s.address, s.phone, s.web];
    const brandLh = pt(8.5) * 1.45;
    const logoDim = assets.logo ? fitBox(assets.logo, 62, 20) : { w: 0, h: 0 };
    const brandBlockH = Math.max(logoDim.h, brandLines.length * brandLh);
    const brandLineY = PDF.T + brandBlockH + 3;
    const contTop = brandLineY + 5;
    function drawBrand() {
      if (assets.logo) doc.addImage(assets.logo.data, 'PNG', PDF.L, PDF.T + (brandBlockH - logoDim.h) / 2, logoDim.w, logoDim.h, 'logo');
      let y = PDF.T + (brandBlockH - brandLines.length * brandLh) / 2 + brandLh * 0.72;
      brandLines.forEach((t, i) => { font(8.5, i === 0 ? 'bold' : 'normal'); ink(); doc.text(String(t || ''), PDF.R, y, { align: 'right' }); y += brandLh; });
      stroke(brand, pt(1.2)); doc.line(PDF.L, brandLineY, PDF.R, brandLineY);
      return brandLineY + 8;
    }

    /* Kasten mit Ueberschrift und fett gesetzten Werten */
    function textBox(x, y, w, cap, values) {
      const lh = pt(10.5) * 1.4;
      const vals = values.filter(v => v != null && String(v).trim() !== '');
      if (!vals.length) vals.push('—');
      font(10.5, 'bold');
      const lines = [];
      vals.forEach(v => doc.splitTextToSize(String(v), w - 6).forEach(l => lines.push(l)));
      const h = 2 + pt(8) + 1.2 + lines.length * lh + 2.2;
      stroke('#000000', pt(0.75)); doc.rect(x, y, w, h);
      font(8, 'normal'); ink(); doc.text(cap, x + 3, y + 2 + pt(8) * 0.8);
      font(10.5, 'bold');
      let by = y + 2 + pt(8) + 1.2 + lh * 0.75;
      lines.forEach(l => { doc.text(l, x + 3, by); by += lh; });
      return y + h + 4;
    }

    function costBox(x, y, w) {
      const top = y, single = project.variants.length < 2;
      font(8, 'normal'); ink(); doc.text(single ? 'Kostenaufstellung' : 'Variantenübersicht', x + 3, y + 2 + pt(8) * 0.8);
      let cy = y + 2 + pt(8) + 2;
      font(10, 'normal');
      const ilh = pt(10) * 1.35;
      doc.splitTextToSize('Wir bitten Sie, diese Kostenaufstellung zur Kenntnis zu nehmen.', w - 6).forEach(l => { doc.text(l, x + 3, cy + ilh * 0.75); cy += ilh; });
      cy += 2;
      if (single) {
        const net = netOf(rows()), tax = net * vat / 100;
        const lines = [
          ['- Gesamt, Netto:', dec2.format(net) + ' EUR', 'bold', '#000000', false],
          ['- zzgl. MwSt. ' + pctText(vat) + ' %:', dec2.format(tax) + ' EUR', 'normal', '#000000', false],
          ['- Gesamt, Brutto:', dec2.format(net + tax) + ' EUR', 'bold', brand, true]
        ];
        const rh = pt(10) * 1.25 + 1.6;
        lines.forEach(([a, b, st, col, underline]) => {
          font(10, st); ink(col);
          const by = cy + 0.8 + pt(10) * 0.8;
          doc.text(a, x + 3, by); doc.text(b, x + w - 3, by, { align: 'right' });
          if (underline) {
            stroke(col, 0.2);
            doc.line(x + 3, by + 0.7, x + 3 + doc.getTextWidth(a), by + 0.7);
            doc.line(x + w - 3 - doc.getTextWidth(b), by + 0.7, x + w - 3, by + 0.7);
          }
          cy += rh;
        });
        ink(); cy += 1;
      } else {
        doc.autoTable({
          startY: cy, margin: { left: x + 3, right: PDF.W - (x + w - 3) }, tableWidth: w - 6,
          head: [['Nr.', 'Variante', 'Netto EUR', 'USt. EUR', 'Brutto EUR']],
          body: project.variants.map((v, i) => { const n = netOf(v.rows), t = n * vat / 100; return [String(i + 1), v.name, dec2.format(n), dec2.format(t), dec2.format(n + t)]; }),
          theme: 'grid',
          styles: { font: 'helvetica', fontSize: 8.5, textColor: 0, lineColor: 0, lineWidth: pt(0.35), cellPadding: { top: 1, bottom: 1, left: 1.2, right: 1.2 }, valign: 'middle' },
          headStyles: { fillColor: GREY, fontStyle: 'normal', halign: 'center' },
          columnStyles: { 0: { cellWidth: 'wrap' }, 2: { cellWidth: 'wrap', halign: 'right' }, 3: { cellWidth: 'wrap', halign: 'right' }, 4: { cellWidth: 'wrap', halign: 'right', fontStyle: 'bold' } },
          didParseCell: d => { if (d.section === 'head') { d.cell.styles.halign = 'center'; d.cell.styles.fontStyle = 'normal'; } }
        });
        cy = doc.lastAutoTable.finalY + 1;
      }
      const h = cy + 2 - top;
      stroke('#000000', pt(0.75)); doc.rect(x, top, w, h);
      return top + h + 4;
    }

    function signBox(x, y, w) {
      const h = 2 + pt(8) + 1.2 + 22 + 3;
      stroke('#000000', pt(0.75)); doc.rect(x, y, w, h);
      font(8, 'normal'); ink(); doc.text('Gezeichnet', x + 3, y + 2 + pt(8) * 0.8);
      const bottom = y + h - 3;
      font(10, 'bold'); doc.text('i.A.', x + 3, bottom - 0.5);
      if (s.stamp && assets.stamp) { const d = fitBox(assets.stamp, 60, 20); doc.addImage(assets.stamp.data, 'PNG', x + 3 + 28, bottom - d.h, d.w, d.h, 'stamp'); }
      if (assets.sig) { const d = fitBox(assets.sig, 60, 16); doc.addImage(assets.sig.data, 'PNG', x + 3 + 14, bottom - 1 - d.h, d.w, d.h, 'sig'); }
      return y + h + 4;
    }

    function drawCover() {
      let y = drawBrand();
      const tx = PDF.L + 0.45 * (PDF.R - PDF.L);
      font(17, 'bold'); ink();
      doc.text(levelTitle(), (tx + PDF.R) / 2, y + pt(17) * 0.8, { align: 'center' });
      const ul = y + pt(17) + 2;
      stroke('#000000', pt(0.7)); doc.line(tx, ul, PDF.R, ul);
      y = ul + 7;
      const leftW = 0.4 * (PDF.R - PDF.L), rx = PDF.L + leftW + 6, rw = PDF.R - rx;

      let yl = y;
      if (assets.wappen) { const d = fitBox(assets.wappen, 32, 32); doc.addImage(assets.wappen.data, 'PNG', PDF.L, yl, d.w, d.h, 'wappen'); yl += d.h + 6; }
      font(8, 'normal'); ink(); doc.text('Bauherr', PDF.L, yl + pt(8) * 0.8); yl += pt(8) + 1.2;
      font(10.5, 'bold');
      const lh = pt(10.5) * 1.4;
      [f.client || '—'].concat(addressParts(f.clientAddress)).forEach(t => {
        doc.splitTextToSize(t, leftW).forEach(l => { doc.text(l, PDF.L, yl + lh * 0.75); yl += lh; });
      });

      let yr = y;
      yr = textBox(rx, yr, rw, 'Projekt', [f.projectNo, f.projectName]);
      yr = textBox(rx, yr, rw, 'Bauvorhaben', [f.bauvorhaben || f.projectName]);
      yr = textBox(rx, yr, rw, 'Bauleitung', [f.company || s.company, f.companyAddress || s.address]);
      yr = costBox(rx, yr, rw);
      yr = textBox(rx, yr, rw, 'Erstellt von', [f.author]);
      yr = signBox(rx, yr, rw);
      font(8.5, 'normal'); ink();
      const sy = yr - 4 + 3 + pt(8.5) * 0.8;
      doc.text('................................................................', rx, sy);
      doc.text('(Kostenaufstellung erstellt von – Unterschrift) · ' + dateDE(f.date), rx, sy + pt(8.5) * 1.4);
    }

    function drawVariant(v, first) {
      if (!first) doc.addPage();
      let y = drawBrand();
      font(16, 'bold'); ink();
      const title = levelTitle();
      doc.text(title, PDF.L, y + pt(16) * 0.8);
      const titleW = doc.getTextWidth(title);
      font(9.5, 'bold');
      const right = (f.projectName || '') + (f.projectNo ? ' (' + f.projectNo + ')' : '');
      const rl = right ? doc.splitTextToSize(right, Math.max(40, PDF.R - PDF.L - titleW - 6)) : [];
      rl.forEach((l, i) => doc.text(l, PDF.R, y + pt(16) * 0.8 + i * pt(9.5) * 1.3, { align: 'right' }));
      y += Math.max(pt(16), rl.length * pt(9.5) * 1.3) + 5;
      font(12, 'bold');
      doc.splitTextToSize('Variante: ' + v.name, PDF.R - PDF.L).forEach(l => { doc.text(l, PDF.L, y + pt(12) * 0.8); y += pt(12) * 1.25; });
      y += 3 - pt(12) * 0.25;

      const body = [];
      groupsOf(v.rows).forEach(g => {
        if (g.row) {
          const groupStyle = { fillColor: GREY, fontStyle: 'bold', fontSize: 9, lineWidth: { top: pt(0.7), bottom: pt(0.7), left: pt(0.4), right: pt(0.4) } };
          body.push([g.row.oz || '', g.row.text || '', '', dec2.format(g.sum), dec2.format(g.sum)].map(c => ({ content: c, styles: groupStyle })));
          if (g.sum) {
            body.push([
              { content: 'Gesamt (inkl. MwSt. ' + pctText(vat) + ' %), Brutto:', colSpan: 4, styles: { fillColor: GREY, halign: 'left' } },
              { content: dec2.format(g.sum * (1 + vat / 100)), styles: { fillColor: GREY } }
            ]);
          }
        }
        g.items.forEach(({ row: r }) => {
          const qty = isBlank(r.qty) ? '' : qtyFmt.format(num(r.qty));
          body.push([r.oz || '', r.text || '', [qty, r.unit || ''].filter(Boolean).join(' '), isBlank(r.price) ? '' : dec2.format(num(r.price)), dec2.format(amount(r))]);
        });
      });
      if (!body.length) body.push([{ content: 'Keine Positionen.', colSpan: 5 }]);

      doc.autoTable({
        startY: y,
        margin: { left: PDF.L, right: PDF.W - PDF.R, top: contTop, bottom: PDF.H - PDF.BOTTOM },
        head: [['KG / OZ', project.level + ' / Quelleinträge', 'Menge/Einheit', 'Teilbetrag / EP', 'Gesamt EUR']],
        body, theme: 'grid', showHead: 'everyPage', rowPageBreak: 'avoid',
        styles: { font: 'helvetica', fontSize: 8, textColor: 0, lineColor: [68, 68, 68], lineWidth: pt(0.4), cellPadding: { top: 1, bottom: 1, left: 1.4, right: 1.4 }, valign: 'middle', overflow: 'linebreak' },
        headStyles: { fillColor: [255, 255, 255], fontStyle: 'normal', halign: 'center' },
        columnStyles: { 0: { cellWidth: 17, halign: 'center' }, 2: { cellWidth: 24, halign: 'right' }, 3: { cellWidth: 26, halign: 'right' }, 4: { cellWidth: 26, halign: 'right' } },
        didParseCell: d => { if (d.section === 'head') { d.cell.styles.halign = 'center'; d.cell.styles.fontStyle = d.column.index === 4 ? 'bold' : 'normal'; } },
        didDrawPage: d => { if (d.pageNumber > 1) drawBrand(); }
      });

      /* Gesamtsumme – Ueberschrift und Kasten bleiben zusammen */
      y = doc.lastAutoTable.finalY + 6;
      const rh = 7;
      if (y + pt(12) + 3 + rh * 3 > PDF.BOTTOM) { doc.addPage(); y = drawBrand(); }
      font(12, 'bold'); ink(); doc.text('Gesamtsumme', PDF.L, y + pt(12) * 0.8);
      y += pt(12) + 3;
      const net = netOf(v.rows), tax = net * vat / 100;
      const bw = 95, bx = PDF.R - bw;
      stroke('#BBBBBB', pt(0.75)); doc.rect(bx, y, bw, rh * 3);
      stroke('#DDDDDD', pt(0.4)); doc.line(bx, y + rh, bx + bw, y + rh); doc.line(bx, y + 2 * rh, bx + bw, y + 2 * rh);
      stroke(brand, pt(2)); doc.line(bx, y, bx + bw, y);
      [['Gesamt, Netto:', dec2.format(net) + ' EUR'], ['zzgl. MwSt. ' + pctText(vat) + ' %:', dec2.format(tax) + ' EUR'], ['Gesamt, Brutto:', dec2.format(net + tax) + ' EUR']]
        .forEach(([a, b], i) => {
          const last = i === 2, size = last ? 11 : 9.5;
          const by = y + i * rh + rh / 2 + pt(size) * 0.36;
          font(size, last ? 'bold' : 'normal'); ink(last ? brand : '#000000');
          doc.text(a, bx + 3, by); doc.text(b, bx + bw - 3, by, { align: 'right' });
          if (last) {
            stroke(brand, 0.25);
            doc.line(bx + 3, by + 0.8, bx + 3 + doc.getTextWidth(a), by + 0.8);
            doc.line(bx + bw - 3 - doc.getTextWidth(b), by + 0.8, bx + bw - 3, by + 0.8);
          }
        });
      ink();
      y += rh * 3;

      if (f.notes) {
        y += 6;
        const lh = pt(9) * 1.35;
        font(9, 'normal');
        const nl = doc.splitTextToSize(String(f.notes), PDF.R - PDF.L);
        if (y + lh * Math.min(nl.length + 1, 4) > PDF.BOTTOM) { doc.addPage(); y = drawBrand(); }
        font(9, 'bold'); doc.text('Anmerkungen / Grundlagen / Abgrenzungen', PDF.L, y + lh * 0.75); y += lh;
        font(9, 'normal');
        nl.forEach(l => {
          if (y + lh > PDF.BOTTOM) { doc.addPage(); y = drawBrand(); font(9, 'normal'); }
          doc.text(l, PDF.L, y + lh * 0.75); y += lh;
        });
      }
    }

    let first = true;
    if (settings.coverPage) { drawCover(); first = false; }
    printed.forEach(v => { drawVariant(v, first); first = false; });

    /* Fusszeile mit Seitenzahl auf jeder Seite */
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      stroke(brand, pt(1)); doc.line(PDF.L, PDF.FOOT, PDF.R, PDF.FOOT);
      font(8, 'normal'); ink();
      const by = PDF.FOOT + 1.5 + pt(8) * 0.8;
      doc.text('Alle Einzelbeträge Netto in EUR', PDF.L, by);
      doc.text('Seite ' + i + ' von ' + pages, (PDF.L + PDF.R) / 2, by, { align: 'center' });
      doc.text(dateDE(f.date), PDF.R, by, { align: 'right' });
    }
    doc.setProperties({ title: pdfFileName().replace(/\.pdf$/, ''), creator: 'GBi Kostenermittlung iPhone ' + APP_VERSION });
    return doc;
  }

  async function printPdf() {
    persist();
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('Die PDF-Funktion ist noch nicht geladen. Bitte die App einmal mit Internetverbindung neu öffnen.');
      return;
    }
    let file;
    try {
      const doc = buildPdf(await pdfAssets());
      file = new File([doc.output('blob')], pdfFileName(), { type: 'application/pdf' });
    } catch (e) {
      alert('Das PDF konnte nicht erstellt werden: ' + (e && e.message ? e.message : e));
      return;
    }
    sharePdf(file, true);
  }

  /* Teilen-Dialog (In Dateien sichern, Mail, AirDrop ...). Laeuft die Erzeugung zu lange,
     verlangt iOS eine neue Beruehrung – dann erscheint ein Knopf zum Teilen. */
  async function sharePdf(file, firstTry) {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: file.name }); return; }
      catch (e) {
        if (e && e.name === 'AbortError') return;
        if (e && e.name === 'NotAllowedError' && firstTry) {
          actionSheet('PDF ist fertig', [{ label: 'Teilen oder in Dateien sichern', action: () => sharePdf(file, false) }]);
          return;
        }
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 60000);
  }

  /* ---------- Hinweis ---------- */
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast'); if (!el) return;
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  /* ---------- Navigation ---------- */
  function switchTab(tab) {
    ui.tab = tab; closeAllSwipes();
    if (ui.reorder) { ui.reorder = false; renderKosten(); }
    renderChrome();
    window.scrollTo(0, 0);
  }

  /* ---------- Wischen nach links (Kopie / Loeschen) ---------- */
  let swipe = null, suppressClickUntil = 0;
  function closeAllSwipes(except) {
    document.querySelectorAll('.swipe.open').forEach(w => { if (w !== except) w.classList.remove('open'); });
  }
  function wireSwipe() {
    const list = $('#cost-list');
    list.addEventListener('touchstart', e => {
      if (ui.reorder || drag) return;
      const pos = e.target.closest('.pos'); if (!pos) return;
      const wrap = pos.parentElement; closeAllSwipes(wrap);
      const t = e.touches[0];
      swipe = { wrap, pos, x: t.clientX, y: t.clientY, dx: 0, axis: null, open: wrap.classList.contains('open') };
    }, { passive: true });
    list.addEventListener('touchmove', e => {
      if (!swipe) return;
      const t = e.touches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
      if (!swipe.axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) swipe.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (swipe.axis !== 'x') return;
      e.preventDefault();
      swipe.wrap.classList.add('swiping');
      swipe.dx = dx;
      const x = Math.max(-170, Math.min(0, (swipe.open ? -150 : 0) + dx));
      swipe.pos.style.transition = 'none';
      swipe.pos.style.transform = 'translateX(' + x + 'px)';
    }, { passive: false });
    const end = () => {
      if (!swipe) return;
      const s = swipe; swipe = null;
      s.pos.style.transition = ''; s.pos.style.transform = '';
      s.wrap.classList.remove('swiping');
      if (s.axis === 'x') {
        s.wrap.classList.toggle('open', s.open ? s.dx < 40 : s.dx < -50);
        suppressClickUntil = Date.now() + 400;
      }
    };
    list.addEventListener('touchend', end);
    list.addEventListener('touchcancel', end);
  }

  /* ---------- Bearbeiten-Modus: Zeilen am Griff ziehen ----------
     Pointer-Events (Finger und Maus). Waehrend des Ziehens folgt eine Kopie der Zeile dem
     Finger, eine Linie zeigt die Ablagestelle; am oberen/unteren Rand scrollt die Liste. */
  let drag = null;
  function rowEl(i) { return $('#cost-list').querySelector('.swipe[data-index="' + i + '"], .grp-row[data-index="' + i + '"]'); }
  function rowGeometry() {
    const list = rows(), out = [];
    list.forEach((r, i) => {
      const el = rowEl(i); if (!el) return;
      const rect = el.getBoundingClientRect();
      const head = r.type === 'group' && el.parentElement ? el.parentElement.previousElementSibling : null;
      out.push({ i, group: r.type === 'group', top: head ? head.getBoundingClientRect().top : rect.top, rowTop: rect.top, bottom: rect.bottom, mid: (rect.top + rect.bottom) / 2 });
    });
    return out;
  }
  function dropTarget(y) {
    const n = rows().length, d = drag;
    const geo = rowGeometry().filter(g => g.i < d.from || g.i >= d.end);
    if (!geo.length) return null;
    const last = geo[geo.length - 1];
    if (d.isGroup) {
      /* Kostengruppen nur an Gruppengrenzen ablegen: vor einer anderen Gruppe oder ans Ende */
      const cands = geo.filter(g => g.group).map(g => ({ to: g.i, y: g.top - 4 }));
      cands.push({ to: n, y: last.bottom + 6 });
      return cands.reduce((best, c) => (Math.abs(c.y - y) < Math.abs(best.y - y) ? c : best));
    }
    let prev = null;
    for (const g of geo) {
      if (y < g.mid) return { to: g.i, y: g.group && prev ? prev.bottom : g.rowTop };
      prev = g;
    }
    return { to: n, y: last.bottom };
  }
  function dragTick() {
    if (!drag) return;
    const y = drag.y, vh = window.innerHeight;
    if (y < 110) window.scrollBy(0, -Math.ceil((110 - y) / 6));
    else if (y > vh - 200) window.scrollBy(0, Math.ceil((y - (vh - 200)) / 6));
    drag.ghost.style.top = (y - drag.dy) + 'px';
    const t = dropTarget(y);
    const noop = !t || (t.to >= drag.from && t.to <= drag.end);
    drag.target = noop ? null : t.to;
    if (noop) {
      drag.line.hidden = true;
    } else {
      const card = $('#cost-list .group').getBoundingClientRect();
      Object.assign(drag.line.style, { top: (t.y - 1.5) + 'px', left: (card.left + 10) + 'px', width: (card.width - 20) + 'px' });
      drag.line.hidden = false;
    }
    drag.raf = requestAnimationFrame(dragTick);
  }
  function finishDrag(apply) {
    const d = drag; if (!d) return;
    drag = null;
    cancelAnimationFrame(d.raf);
    d.ghost.remove(); d.line.remove();
    document.querySelectorAll('#cost-list .drag-src').forEach(el => el.classList.remove('drag-src'));
    suppressClickUntil = Date.now() + 400;
    if (apply && d.target != null) moveBlock(d.from, d.target);
  }
  function wireReorder() {
    const list = $('#cost-list');
    list.addEventListener('pointerdown', e => {
      const h = e.target.closest('.handle');
      if (!h || !ui.reorder || drag) return;
      const from = Number(h.dataset.drag), l = rows(), src = rowEl(from);
      if (!l[from] || !src) return;
      e.preventDefault();
      const rect = src.getBoundingClientRect();
      const ghost = src.cloneNode(true);
      ghost.classList.add('drag-ghost');
      ghost.querySelectorAll('.sel').forEach(x => x.classList.remove('sel'));
      ghost.classList.remove('sel');
      Object.assign(ghost.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px' });
      document.body.appendChild(ghost);
      const line = document.createElement('div');
      line.className = 'drop-line'; line.hidden = true;
      document.body.appendChild(line);
      const end = blockEnd(l, from);
      for (let k = from; k < end; k++) { const el = rowEl(k); if (el) el.classList.add('drag-src'); }
      drag = { from, end, isGroup: l[from].type === 'group', ghost, line, dy: e.clientY - rect.top, y: e.clientY, target: null, pointerId: e.pointerId };
      try { h.setPointerCapture(e.pointerId); } catch (err) { /* ohne Capture laufen die Ereignisse ueber die Liste */ }
      drag.raf = requestAnimationFrame(dragTick);
    });
    const move = e => { if (drag && e.pointerId === drag.pointerId) { e.preventDefault(); drag.y = e.clientY; } };
    const up = e => { if (drag && e.pointerId === drag.pointerId) finishDrag(e.type === 'pointerup'); };
    list.addEventListener('pointermove', move);
    list.addEventListener('pointerup', up);
    list.addEventListener('pointercancel', up);
  }

  /* ---------- Ereignisse ---------- */
  document.addEventListener('click', e => {
    const tabBtn = e.target.closest('#tabbar [data-tab]');
    if (tabBtn) { switchTab(tabBtn.dataset.tab); return; }
    const t = e.target.closest('[data-action]');
    if (!t || !t.closest('#app')) { if (!e.target.closest('.swipe')) closeAllSwipes(); return; }
    const i = t.dataset.index != null ? Number(t.dataset.index) : -1;
    switch (t.dataset.action) {
      case 'edit-row': {
        if (Date.now() < suppressClickUntil || e.target.closest('.handle')) return;
        const wrap = t.closest('.swipe');
        if (wrap && wrap.classList.contains('open')) { wrap.classList.remove('open'); return; }
        closeAllSwipes(); openRowSheet(i); break;
      }
      case 'dup-row': closeAllSwipes(); duplicateRow(i); break;
      case 'del-row': closeAllSwipes(); deleteRow(i); break;
      case 'add-menu': addMenu(); break;
      case 'reorder': setReorder(!ui.reorder); break;
      case 'renumber': renumber(); break;
      case 'ai-test': testAi(); break;
      case 'add-group': addGroup(); break;
      case 'add-item': addItem(); break;
      case 'add-item-in': addItem(groupEnd(rows(), i)); break;
      case 'variant-menu': variantMenu(); break;
      case 'cost-menu': costMenu(); break;
      case 'set-level': project.level = t.dataset.level; commit(); break;
      case 'goto-export': switchTab('export'); break;
      case 'print-pdf': printPdf(); break;
      case 'export-json': shareProject(); break;
      case 'import': openImport(); break;
      case 'browse-catalog': openCatalogPicker(null); break;
      case 'set-site': settings.site = t.dataset.site; saveSettings(); renderAll(); break;
      case 'apply-site': {
        const s = site();
        project.fields.company = s.company; project.fields.companyAddress = s.address;
        commit(); toast('Firmendaten übernommen'); break;
      }
      case 'import-stamp': $('#stamp-input').click(); break;
      case 'remove-stamp':
        if (confirm('Firmenstempel von diesem iPhone entfernen?')) {
          try { localStorage.removeItem(KEYS.stamp); } catch (e) { /* Speicher nicht verfuegbar */ }
          stamp = ''; renderMehr();
        }
        break;
      case 'pick-client': pickClient(); break;
      case 'pick-notice': pickNotice(); break;
      case 'new-project': {
        if (!confirm('Neues Projekt beginnen? Das aktuelle Projekt auf diesem iPhone wird ersetzt. Vorher unter „Export“ als JSON teilen, wenn es noch gebraucht wird.')) return;
        const startBlank = () => {
          project = normalizeProject(newProjectObject()); ui.selected = -1; ui.search = '';
          commit(); switchTab('projekt');
        };
        if (!centralLists().templates.length) { startBlank(); break; }
        actionSheet('Neues Projekt', [
          { label: 'Leeres Projekt', action: startBlank },
          { label: 'Aus Projektvorlage …', action: () => pickTemplate('Projektvorlage', newProjectFromTemplate, false) }
        ]);
        break;
      }
    }
  });

  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset && el.dataset.field) {
      project.fields[el.dataset.field] = el.value;
      persistSoon();
      if (el.dataset.field === 'vat') renderChrome();
    } else if (el.id === 'cost-search') {
      ui.search = el.value; renderCostList();
    } else if (el.dataset && el.dataset.aiInput) {
      ai[el.dataset.aiInput] = el.value.trim();
      saveJSON(KEYS.ai, ai);
    } else if (el.dataset && el.dataset.settingInput) {
      const key = el.dataset.settingInput;
      settings[key] = key === 'vat' ? num(el.value) : el.value;
      saveSettings();
    }
  });

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.classList && el.classList.contains('switch') && el.dataset.setting) {
      settings[el.dataset.setting] = el.checked; saveSettings(); renderExport();
    } else if (el.dataset && el.dataset.aiInput) {
      renderMehr();   // Anbieter und Modellauswahl zum neuen Schluessel anzeigen
    } else if (el.dataset && el.dataset.field) {
      renderProjekt(); renderExport();
    }
  });

  $('#file-input').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) handleImportFile(file);
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persist(); });
  window.addEventListener('pagehide', persist);

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }

  /* Stempelbild auf hoechstens 800 px verkleinern und als PNG lokal ablegen */
  function importStamp(file) {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const data = c.toDataURL('image/png');
      try { localStorage.setItem(KEYS.stamp, data); }
      catch (e) { alert('Der Stempel konnte nicht gespeichert werden (Speicher voll).'); return; }
      stamp = data; renderMehr(); toast('Firmenstempel importiert');
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('Die Datei „' + file.name + '“ ist kein lesbares Bild.'); };
    img.src = url;
  }
  $('#stamp-input').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) importStamp(file);
  });

  wireSwipe();
  wireReorder();
  renderAll();
  pdfAssets();   // Bilder fuer das PDF vorab laden, damit der Teilen-Dialog sofort erscheint

  /* Fuer Tests in der Browser-Konsole */
  window.gbiMobile = { get project() { return project; }, get catalog() { return catalog; }, get settings() { return settings; }, exportObject, importCatalog, normalizeProject, buildPdf, pdfAssets, pdfFileName, get central() { return central; } };
})();
