// ProjektHub — Sidebar-Navigation
// Zeigt immer den vollständigen Baum: alle Ordner, Punkte nur beim aktiven/aufgeklappten Ordner.
// Ordnernamen = Chat-Namen (Regel: bei neuen Einträgen immer nach dem Chat benennen).
(function () {

  var STRUKTUR = [
    {
      sektion: 'Entscheidungs-Workflow',
      icon: '⚖️',
      anker: 'workflow',
      ordner: [
        {
          id: 'masterartikel-optimierer',
          label: 'Masterartikel-Optimierer',
          items: [
            { label: 'Konzept',    seite: 'formular-masterartikel-optimierer.html',   desc: 'SEO · Descriptions · Metafelder' },
            { label: 'Auswertung', seite: 'auswertung-masterartikel-optimierer.html', desc: 'Kommentar-Runde 1 · 17.08.2026' },
          ],
        },
        {
          id: 'seo',
          label: 'SEO',
          items: [
            { label: 'Ahrefs oder Seobility', seite: 'entscheidung-seo-tool-ahrefs-seobility.html', desc: 'Tool-Vergleich · Runde 1' },
          ],
        },
        {
          id: 'server-infrastruktur',
          label: 'Server & Infrastruktur',
          items: [
            { label: 'Hetzner VPS', seite: 'entscheidung-hetzner-vps-automation.html', desc: 'Setup & Automation' },
          ],
        },
        {
          id: 'mh-zukunftsstrategie',
          label: 'MH Zukunftsstrategie',
          items: [
            { label: 'Zukunftsstrategie 2026', seite: 'entscheidung-mh-zukunftsstrategie-2026.html', desc: 'KI-Analyse · 2026' },
            { label: '⭐ Gesamtanalyse — Entscheidung', seite: 'entscheidung-mh-gesamtanalyse-2026.html', desc: '5 Kapitel · Runde 1 · 19.08.2026' },
          ],
        },
        {
          id: 'claude-infinity',
          label: 'Claude Infinity',
          items: [
            { label: 'Cockpit Roadmap 2026', seite: 'entscheidung-claude-infinity-roadmap-2026.html', desc: 'Stand 18.08.2026 · Runde 1' },
          ],
        },
      ],
    },
    {
      sektion: 'Info Hub',
      icon: '📚',
      anker: 'infohub',
      ordner: [
        {
          id: 'ih-claude-infinity',
          label: 'Claude Infinity',
          items: [
            { label: 'Claude Code & VPS — Anwendungsfälle', seite: 'info-claude-vps-usecases.html', desc: 'Stand 17.08.2026 · Claude Code' },
            { label: 'Ahrefs vs. Seobility', seite: 'info-ahrefs-vs-seobility.html', desc: 'Stand 17.08.2026 · Preise netto' },
          ],
        },
        {
          id: 'ih-mh-zukunftsstrategie',
          label: 'MH Zukunftsstrategie',
          items: [
            { label: '⭐ Gesamtanalyse', seite: 'info-mh-gesamtanalyse-2026.html', desc: 'Alles in einer Seite · 5 Kapitel' },
            { label: 'Analyse-Konzept v1.0', seite: 'info-mh-zukunftsstrategie-konzept-2026.html', desc: 'Stand 17.08.2026 · Konzept v1.0' },
            { label: 'Vollständige Analyse', seite: 'info-mh-zukunftsstrategie-analyse-2026.html', desc: 'Stand 17.08.2026 · KI-Analyse' },
            { label: 'Kundenstamm Tiefenanalyse', seite: 'info-mh-kundenstamm-analyse-2026.html', desc: 'Stand 19.08.2026 · Neuaufbereitung' },
          ],
        },
              {
          id: 'ih-eydl',
          label: 'eydl',
          items: [
            { label: 'Shop-Check eydl.at', seite: 'info-shop-check-eydl-2026.html', desc: 'Stand 19.08.2026 · 16 Befunde · Lighthouse + Recht AT' },
          ],
        },
],
    },
  ];

  var OPEN_KEY = 'projekthub_open_ordner';
  var NAME_KEY = 'projekthub_folder_name_';
  var ITEM_KEY = 'projekthub_item_name_';

  function getCurrentPage() {
    return window.location.pathname.split('/').pop() || 'formulare.html';
  }

  function findActiveOrdner(currentPage) {
    for (var s = 0; s < STRUKTUR.length; s++) {
      var sek = STRUKTUR[s];
      for (var o = 0; o < sek.ordner.length; o++) {
        var ordner = sek.ordner[o];
        for (var i = 0; i < ordner.items.length; i++) {
          if (ordner.items[i].seite === currentPage) return ordner.id;
        }
      }
    }
    return null;
  }

  function getOpenSet() {
    try {
      var v = sessionStorage.getItem(OPEN_KEY);
      return v ? JSON.parse(v) : {};
    } catch (e) { return {}; }
  }

  function saveOpenSet(set) {
    try { sessionStorage.setItem(OPEN_KEY, JSON.stringify(set)); } catch (e) {}
  }

  function getFolderName(id, defaultLabel) {
    try { return localStorage.getItem(NAME_KEY + id) || defaultLabel; } catch (e) { return defaultLabel; }
  }

  function saveFolderName(id, name) {
    try { localStorage.setItem(NAME_KEY + id, name); } catch (e) {}
  }

  function startRename(id, currentName) {
    var labelEl = document.querySelector('[data-ordner-label="' + id + '"]');
    if (!labelEl) return;
    var input = document.createElement('input');
    input.value = currentName;
    input.style.cssText = 'background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:5px;padding:2px 6px;font-size:12.5px;font-family:inherit;font-weight:700;width:140px;outline:none;';
    labelEl.replaceWith(input);
    input.focus();
    input.select();
    function commit() {
      var newName = input.value.trim() || currentName;
      saveFolderName(id, newName);
      // Auch im Hauptinhalt aktualisieren
      var mainLabel = document.querySelector('[data-ordner-id="' + id + '"] .ordner-kopf-left');
      if (mainLabel) mainLabel.textContent = '📁 ' + newName;
      var span = document.createElement('span');
      span.setAttribute('data-ordner-label', id);
      span.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      span.textContent = newName;
      input.replaceWith(span);
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } if (e.key === 'Escape') { input.value = currentName; input.blur(); } });
  }

  function toggleOrdner(id) {
    var set = getOpenSet();
    if (set[id]) { delete set[id]; } else { set[id] = true; }
    saveOpenSet(set);
    // Items-Liste togglen
    var itemsList = document.querySelector('[data-ordner-nav="' + id + '"]');
    var arrow = document.querySelector('[data-ordner-arrow="' + id + '"]');
    if (itemsList) itemsList.style.display = set[id] ? 'block' : 'none';
    if (arrow) arrow.textContent = set[id] ? '▾' : '▸';
  }

  function logout() {
    try { localStorage.removeItem('mh_cockpit_pw'); } catch (e) {}
    window.location.href = '/';
  }

  function injectStyles() {
    var css = ''
      + '.fnav{position:fixed;top:0;left:0;bottom:0;width:240px;background:#202228;color:#E5E7EB;overflow-y:auto;z-index:500;font-family:"Manrope",Arial,sans-serif;display:flex;flex-direction:column}'
      + '.fnav-home{display:flex;align-items:center;gap:11px;padding:9px 18px;background:#252527;border-bottom:1px solid rgba(255,255,255,.06);text-decoration:none}'
      + '.fnav-logo-crop{width:40px;height:40px;overflow:hidden;flex-shrink:0}'
      + '.fnav-logo-img{height:40px;width:auto;display:block}'
      + '.fnav-logo-text{font-size:22px;font-weight:700;color:#fff;line-height:1}'
      + '.fnav-section-head{display:flex;align-items:center;gap:8px;padding:16px 18px 8px 18px;font-size:16px;color:rgba(255,255,255,.85);font-weight:700;text-decoration:none;cursor:pointer;transition:color .12s,background .12s;letter-spacing:-.1px}'
      + '.fnav-section-head:hover{color:#fff;background:rgba(255,255,255,.05)}'
      + '.fnav-group-head{display:flex;align-items:center;justify-content:space-between;padding:7px 18px 7px 18px;cursor:pointer;transition:background .12s;user-select:none}'
      + '.fnav-group-head:hover{background:rgba(255,255,255,.05)}'
      + '.fnav-group-label{font-size:12.5px;font-weight:700;color:rgba(255,255,255,.75);display:flex;align-items:center;gap:6px}'
      + '.fnav-group-arrow{font-size:11px;color:rgba(255,255,255,.3)}'
      + '.fnav-items{display:none}'
      + '.fnav-item{display:block;padding:7px 18px 7px 36px;font-size:13px;text-decoration:none;color:rgba(255,255,255,.55);transition:background .12s,color .12s;border-left:3px solid transparent}'
      + '.fnav-item:hover{background:rgba(255,255,255,.06);color:#fff}'
      + '.fnav-item.active{color:#fff;font-weight:700;border-left-color:#FA8700;background:rgba(250,135,0,.1)}'
      + '.fnav-item-desc{font-size:10px;color:rgba(255,255,255,.28);margin-top:2px}'
      + '.fnav-item-overview{display:block;padding:7px 18px 7px 18px;font-size:13px;text-decoration:none;color:rgba(255,255,255,.55);transition:background .12s,color .12s;border-left:3px solid transparent}'
      + '.fnav-item-overview:hover{background:rgba(255,255,255,.06);color:#fff}'
      + '.fnav-item-overview.active{color:#fff;font-weight:700;border-left-color:#FA8700;background:rgba(250,135,0,.1)}'
      + '.fnav-section-empty{padding:6px 18px 10px 22px;font-size:11.5px;color:rgba(255,255,255,.2);font-style:italic}'
      + '.fnav-footer{margin-top:auto;border-top:1px solid rgba(255,255,255,.06)}'
      + '.fnav-back{display:block;padding:10px 18px;font-size:13px;color:rgba(255,255,255,.4);text-decoration:none}'
      + '.fnav-back:hover{color:#fff;background:rgba(255,255,255,.06)}'
      + '.fnav-logout{display:block;width:100%;text-align:left;background:none;border:none;padding:10px 18px;font-size:13px;color:rgba(255,255,255,.3);cursor:pointer;font-family:inherit}'
      + '.fnav-logout:hover{background:rgba(255,255,255,.06);color:#fff}'
      + 'body.fhas-nav{margin-left:240px}'
      + '@media(max-width:780px){.fnav{display:none}body.fhas-nav{margin-left:0}}';
    var s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  function buildNav() {
    document.body.classList.add('fhas-nav');
    var currentPage = getCurrentPage();
    var activeOrdnerId = findActiveOrdner(currentPage);
    var openSet = getOpenSet();

    // Auto-öffne den aktiven Ordner
    if (activeOrdnerId && !openSet[activeOrdnerId]) {
      openSet[activeOrdnerId] = true;
      saveOpenSet(openSet);
    }

    var nav = document.createElement('div');
    nav.className = 'fnav';

    var html = '<a class="fnav-home" href="/home.html">'
      + '<div class="fnav-logo-crop"><img class="fnav-logo-img" src="https://onecdn.io/media/9c5aadc5-b587-40cb-bc68-474e3b944ab9/md2x" alt="MH"></div>'
      + '<div class="fnav-logo-text">Cockpit</div>'
      + '</a>';

    var isOverview = (currentPage === 'formulare.html');

    // Übersicht-Link
    html += '<a class="fnav-item-overview' + (isOverview ? ' active' : '') + '" href="/formulare.html">🗂 ProjektHub</a>';

    STRUKTUR.forEach(function (sek) {
      var sUrl = sek.anker ? '/formulare.html#' + sek.anker : '/formulare.html';
      html += '<a class="fnav-section-head" href="' + sUrl + '">' + sek.icon + ' ' + sek.sektion + '</a>';

      if (sek.ordner.length === 0) {
        html += '<div class="fnav-section-empty">Noch keine Einträge</div>';
        return;
      }

      sek.ordner.forEach(function (o) {
        var isOpen = !!openSet[o.id];
        var hasActive = o.items.some(function (it) { return it.seite === currentPage; });
        if (hasActive) isOpen = true;

        var displayName = getFolderName(o.id, o.label);
        html += '<div class="fnav-group-head">'
          + '<div class="fnav-group-label" onclick="window.__fnavToggle(\'' + o.id + '\')" style="flex:1;min-width:0;gap:5px;">📁 '
          + '<span data-ordner-label="' + o.id + '" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + displayName + '</span>'
          + '</div>'
          + '<button onclick="event.stopPropagation();window.__fnavRename(\'' + o.id + '\',\'' + displayName.replace(/'/g,"\\'") + '\')" style="background:none;border:none;cursor:pointer;font-size:11px;color:rgba(255,255,255,.25);padding:2px 4px;border-radius:4px;flex-shrink:0;" title="Umbenennen">✏️</button>'
          + '<span class="fnav-group-arrow" data-ordner-arrow="' + o.id + '" onclick="window.__fnavToggle(\'' + o.id + '\')" style="cursor:pointer;padding:0 4px;">' + (isOpen ? '▾' : '▸') + '</span>'
          + '</div>';

        html += '<div class="fnav-items" data-ordner-nav="' + o.id + '" style="display:' + (isOpen ? 'block' : 'none') + '">';
        o.items.forEach(function (it) {
          var isActive = it.seite === currentPage;
          var displayLabel = getItemName(it.seite, it.label);
          html += '<div class="fnav-item-row" style="display:flex;align-items:center;gap:2px;">'
            + '<a class="fnav-item' + (isActive ? ' active' : '') + '" href="/' + it.seite + '" style="flex:1;min-width:0;">'
            + '<span data-item-label="' + it.seite + '">' + displayLabel + '</span>'
            + (it.desc ? '<div class="fnav-item-desc">' + it.desc + '</div>' : '')
            + '</a>'
            + '<button onclick="event.stopPropagation();window.__fnavRenameItem(\'' + it.seite + '\',\'' + displayLabel.replace(/'/g,"\\'") + '\')" style="background:none;border:none;cursor:pointer;font-size:10px;color:rgba(255,255,255,.2);padding:2px 4px;border-radius:4px;flex-shrink:0;" title="Umbenennen">✏️</button>'
            + '</div>';
        });
        html += '</div>';
      });
    });

    html += '<div class="fnav-footer">'
      + '<a class="fnav-back" href="/home.html">← Zurück zum Cockpit</a>'
      + '<button type="button" class="fnav-logout" id="fnav-logout-btn">🔒 Ausloggen</button>'
      + '</div>';

    nav.innerHTML = html;
    document.body.insertBefore(nav, document.body.firstChild);

    var logoutBtn = nav.querySelector('#fnav-logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
  }

  function getItemName(seite, defaultLabel) {
    try { return localStorage.getItem(ITEM_KEY + seite) || defaultLabel; } catch (e) { return defaultLabel; }
  }

  function startItemRename(seite, currentName) {
    var labelEl = document.querySelector('[data-item-label="' + seite + '"]');
    if (!labelEl) return;
    var input = document.createElement('input');
    input.value = currentName;
    input.style.cssText = 'background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:5px;padding:2px 6px;font-size:12px;font-family:inherit;font-weight:600;width:130px;outline:none;';
    labelEl.replaceWith(input);
    input.focus();
    input.select();
    function commit() {
      var newName = input.value.trim() || currentName;
      try { localStorage.setItem(ITEM_KEY + seite, newName); } catch(e) {}
      // Hauptinhalt-Karte aktualisieren
      var card = document.querySelector('a.form-card[href="/' + seite + '"] .form-name');
      if (card) card.textContent = newName;
      var span = document.createElement('span');
      span.setAttribute('data-item-label', seite);
      span.textContent = newName;
      input.replaceWith(span);
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = currentName; input.blur(); }
    });
  }

  window.__fnavToggle = toggleOrdner;
  window.__fnavRename = startRename;
  window.__fnavRenameItem = startItemRename;

  function init() {
    injectStyles();
    buildNav();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
