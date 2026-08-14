// KI-OS Hub — Gemeinsame Sidebar-Navigation
// Unterstuetzt zwei Tools: Newsletter + Shopify.
// Modus wird in localStorage (kios_modus) gespeichert.
// Logo-Link fuehrt immer zu /home.html.

(function () {
  var STORAGE_KEY = 'kios_kundenname';
  var MODUS_KEY   = 'kios_modus'; // 'newsletter' | 'shopify' | ''

  var NEWSLETTER_NAV_ITEMS = [
    { group: 'Teil 1 - einmalig' },
    { label: 'Neukundenanlage',               seite: 'index.html',                withKunde: false },
    { label: 'Klaviyo verbinden',             seite: 'klaviyo-verbinden.html',    withKunde: true  },
    { label: 'Template-Mapping',              seite: 'template-mapping.html',     withKunde: true  },
    { group: 'Teil 2 - pro Ausgabe' },
    { label: 'Redaktionsplan',                seite: 'redaktionsplan.html',       withKunde: true  },
    { label: 'Thema manuell anlegen',         seite: 'idee.html',                 withKunde: true,  sub: true },
    { label: 'Thema automatisch vorschlagen', seite: 'ideen-freigabe.html',       withKunde: true,  sub: true },
    { label: 'Testmail senden',               seite: 'test-mail-send.html',       withKunde: true  },
    { label: 'QA-Check',                      seite: 'qa-check.html',             withKunde: true  },
    { label: 'Kampagne anlegen',              seite: 'campaign-setup.html',       withKunde: true  },
    { label: 'Kundenvorschau senden',         seite: 'kunden-vorschau.html',      withKunde: true  },
    { label: 'Performance-Report',            seite: 'performance-reporter.html', withKunde: true  },
    { group: 'Optional' },
    { label: 'Segment-Mapper',                seite: 'segment-mapper.html',       withKunde: true  },
    { group: 'Verwaltung' },
    { label: 'Kundendatenbank',               seite: 'kunden-datenbank.html',     withKunde: false },
  ];

  var SHOPIFY_NAV_ITEMS = [
    { group: 'Shopify-Tool' },
    { label: 'Dashboard',                seite: 'shopify-dashboard.html', withKunde: false },
    { label: 'Produkt hochladen',        seite: 'shopify-upload.html',    withKunde: false },
    { label: 'Produkte synchronisieren', seite: 'shopify-sync.html',      withKunde: false },
    { group: 'Verwaltung' },
    { label: 'Kundendatenbank',           seite: 'kunden-datenbank.html', withKunde: false },
  ];

  var SHOPIFY_PAGES = {
    'shopify-dashboard.html': true,
    'shopify-upload.html':    true,
    'shopify-sync.html':      true,
    'kunden-datenbank.html':  true,
    'kunden-bearbeiten.html': true,
  };

  function getCurrentPage() {
    return (window.location.pathname.split('/').pop() || 'home.html');
  }
  function getLoggedInKunde() {
    try { return localStorage.getItem(STORAGE_KEY) || ''; } catch (e) { return ''; }
  }
  function setLoggedInKunde(name) {
    try { localStorage.setItem(STORAGE_KEY, name); } catch (e) {}
  }
  function getModus() {
    try { return localStorage.getItem(MODUS_KEY) || ''; } catch (e) { return ''; }
  }
  function setModus(m) {
    try { localStorage.setItem(MODUS_KEY, m); } catch (e) {}
  }

  function injectStyles() {
    var font = document.createElement('link');
    font.rel = 'stylesheet';
    font.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(font);

    var css = ''
      + '.kios-nav { position: fixed; top: 0; left: 0; bottom: 0; width: 240px; background: #202228; color: #E5E7EB; overflow-y: auto; z-index: 500; font-family: "Manrope", Arial, sans-serif; display: flex; flex-direction: column; }'
      + '.kios-nav a:not(.kios-nav-home), .kios-nav button.kios-link { display: block; width: 100%; text-align: left; background: none; border: none; color: #E5E7EB; font-family: inherit; cursor: pointer; }'
      + '.kios-nav-home { display: flex !important; flex-direction: row !important; align-items: center !important; }'
      + '.kios-nav-home { display: flex; flex-direction: row; align-items: center; gap: 11px; padding: 9px 18px; background: #252527; border-bottom: 1px solid rgba(255,255,255,0.06); text-decoration: none; }'
      + '.kios-nav-logo-crop { width: 40px; height: 40px; overflow: hidden; flex-shrink: 0; }'
      + '.kios-nav-logo-img { height: 40px; width: auto; display: block; }'
      + '.kios-nav-logo-text { font-size: 22px; font-weight: 700; color: #fff; line-height: 1; letter-spacing: -0.3px; }'
      + '.kios-modus-bar { display: flex; align-items: center; justify-content: space-between; padding: 7px 18px; background: rgba(0,0,0,0.15); border-bottom: 1px solid rgba(255,255,255,0.06); }'
      + '.kios-modus-badge { font-size: 11px; font-weight: 700; }'
      + '.kios-modus-badge.newsletter { color: #FA8700; }'
      + '.kios-modus-badge.shopify { color: #96BF48; }'
      + '.kios-modus-switch { font-size: 11px; color: rgba(255,255,255,0.4); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; padding: 0; background: none; border: none; font-family: inherit; }'
      + '.kios-nav-tool-btn { display: flex; align-items: center; gap: 12px; padding: 16px 18px; text-decoration: none; color: #fff; border-bottom: 1px solid rgba(255,255,255,0.06); transition: background 0.12s; }'
      + '.kios-nav-tool-btn:hover { background: rgba(255,255,255,0.06); }'
      + '.kios-tool-icon { font-size: 22px; flex-shrink: 0; }'
      + '.kios-tool-name { font-size: 14px; font-weight: 700; color: #fff; }'
      + '.kios-tool-desc { font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 2px; }'
      + '.kios-nav-kunde { padding: 12px 18px; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 12px; background: #252527; }'
      + '.kios-nav-kunde .lbl { color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: .08em; font-size: 10px; margin-bottom: 3px; font-weight: 700; }'
      + '.kios-nav-kunde .name { font-weight: bold; color: #fff; font-size: 13.5px; word-break: break-word; }'
      + '.kios-klaviyo-line { margin-top: 6px; font-size: 11.5px; color: rgba(255,255,255,0.4); }'
      + '.kios-klaviyo-status { font-weight: bold; }'
      + '.kios-klaviyo-status.ok { color: #34D399; }'
      + '.kios-klaviyo-status.missing { color: #F87171; }'
      + '.kios-klaviyo-status.pending { color: #9CA3AF; }'
      + '.kios-nav-kunde .switch { margin-top: 8px; font-size: 11.5px; color: #FA8700; background: none; border: none; cursor: pointer; padding: 0; text-decoration: underline; font-family: inherit; font-weight: 600; }'
      + '.kios-nav-group { padding: 14px 18px 4px 18px; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: rgba(255,255,255,0.25); font-weight: 700; }'
      + '.kios-nav-item { padding: 9px 18px; font-size: 13.5px; text-decoration: none; color: rgba(255,255,255,0.65); transition: background 0.12s, color 0.12s; }'
      + '.kios-nav-item.sub { padding-left: 30px; font-size: 12.5px; color: rgba(255,255,255,0.4); }'
      + '.kios-nav-item.sub.active { color: #fff; }'
      + '.kios-nav-item:hover { background: rgba(255,255,255,0.06); color: #fff; }'
      + '.kios-nav-item.active { background: #FA8700; color: #fff; font-weight: bold; }'
      + '.kios-nav-danger { padding: 10px 18px; font-size: 13px; text-decoration: none; color: #FCA5A5; }'
      + '.kios-nav-danger:hover { background: rgba(127,29,29,0.4); color: #fff; }'
      + '.kios-nav-footer { margin-top: auto; border-top: 1px solid rgba(255,255,255,0.06); }'
      + '.kios-nav-logout { display: block; width: 100%; text-align: left; background: none; border: none; padding: 10px 18px; font-size: 13px; color: rgba(255,255,255,0.35); cursor: pointer; font-family: inherit; }'
      + '.kios-nav-logout:hover { background: rgba(255,255,255,0.06); color: #fff; }'
      + '.kios-modal-overlay { position: fixed; inset: 0; background: rgba(25,25,25,0.5); z-index: 1000; display: flex; align-items: flex-start; justify-content: center; padding: 60px 16px; backdrop-filter: blur(4px); }'
      + '.kios-modal-box { background: #fff; border-radius: 14px; max-width: 420px; width: 100%; padding: 24px 26px; font-family: "Manrope", Arial, sans-serif; box-shadow: 0 20px 60px rgba(25,25,25,0.18); }'
      + '.kios-modal-box h3 { margin: 0 0 6px 0; font-size: 16px; color: #202228; }'
      + '.kios-modal-box p { margin: 0 0 14px 0; font-size: 13px; color: #6B7280; }'
      + '.kios-modal-box select { width: 100%; padding: 9px 10px; border: 1.5px solid #E5E7EB; border-radius: 8px; font-size: 14px; font-family: inherit; }'
      + '.kios-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }'
      + '.kios-modal-actions button { padding: 10px 20px; border-radius: 40px; font-size: 13.5px; font-weight: bold; cursor: pointer; border: none; font-family: inherit; }'
      + '.kios-modal-actions .cancel { background: #F3F4F6; color: #374151; }'
      + '.kios-modal-actions .ok { background: #FA8700; color: #fff; box-shadow: 0 6px 18px rgba(250,135,0,0.28); }'
      + '.kios-modal-actions .ok:disabled { background: rgba(250,135,0,0.4); box-shadow: none; cursor: not-allowed; }'
      + 'body.kios-has-nav { margin-left: 240px; }'
      + '@media (max-width: 780px) { .kios-nav { display: none; } body.kios-has-nav { margin-left: 0; } }';

    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildUrl(seite, withKunde) {
    var kunde = getLoggedInKunde();
    if (withKunde && kunde) {
      return '/' + seite + '?kundenname=' + encodeURIComponent(kunde);
    }
    return '/' + seite;
  }

  function openLoginModal(onChosen) {
    var overlay = document.createElement('div');
    overlay.className = 'kios-modal-overlay';
    overlay.innerHTML =
      '<div class="kios-modal-box">'
      + '<h3>Als welcher Kunde?</h3>'
      + '<p>Kunde auswaehlen, um fortzufahren. Bleibt gespeichert, bis du wechselst.</p>'
      + '<select id="kios-login-select"><option value="">Laedt Kundenliste ...</option></select>'
      + '<div class="kios-modal-actions">'
      + '<button type="button" class="cancel" id="kios-login-cancel">Abbrechen</button>'
      + '<button type="button" class="ok" id="kios-login-ok" disabled>Auswaehlen</button>'
      + '</div>'
      + '</div>';
    document.body.appendChild(overlay);

    var select = overlay.querySelector('#kios-login-select');
    var okBtn  = overlay.querySelector('#kios-login-ok');
    var cancelBtn = overlay.querySelector('#kios-login-cancel');

    fetch('/.netlify/functions/kunden-alle')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var kunden = data.kunden || [];
        if (!kunden.length) {
          select.innerHTML = '<option value="">(keine Kunden gefunden)</option>';
          return;
        }
        select.innerHTML = '<option value="">-- bitte waehlen --</option>' +
          kunden.map(function (k) {
            return '<option value="' + k.name.replace(/"/g, '&quot;') + '">' + k.name + '</option>';
          }).join('');
      })
      .catch(function () {
        select.innerHTML = '<option value="">(Fehler beim Laden)</option>';
      });

    select.addEventListener('change', function () { okBtn.disabled = !select.value; });
    cancelBtn.addEventListener('click', function () { document.body.removeChild(overlay); });
    okBtn.addEventListener('click', function () {
      var chosen = select.value;
      if (!chosen) return;
      setLoggedInKunde(chosen);
      document.body.removeChild(overlay);
      onChosen(chosen);
    });
  }

  function loadKlaviyoStatus(kunde) {
    var badge = document.getElementById('kios-klaviyo-status');
    if (!badge) { return; }
    fetch('/.netlify/functions/kunde-status?kundenname=' + encodeURIComponent(kunde))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var current = document.getElementById('kios-klaviyo-status');
        if (!current) { return; }
        if (data.klaviyoConnected) {
          current.className = 'kios-klaviyo-status ok';
          current.textContent = '✓ ' + (data.klaviyoAccountName || 'verbunden');
          current.title = data.klaviyoAccountName
            ? 'Verbunden mit Klaviyo-Account: ' + data.klaviyoAccountName
            : 'Klaviyo verbunden';
        } else {
          current.className = 'kios-klaviyo-status missing';
          current.textContent = '✗ Nein';
          current.title = 'Klaviyo noch nicht verbunden';
        }
      })
      .catch(function () {
        var current = document.getElementById('kios-klaviyo-status');
        if (current) {
          current.className = 'kios-klaviyo-status missing';
          current.textContent = '? unbekannt';
        }
      });
  }

  function buildNav() {
    document.body.classList.add('kios-has-nav');
    var nav = document.createElement('div');
    nav.className = 'kios-nav';

    var currentPage = getCurrentPage();
    var modus = getModus();
    var kunde = getLoggedInKunde();

    // Shopify-Seiten erzwingen Shopify-Modus
    if (SHOPIFY_PAGES[currentPage]) { modus = 'shopify'; setModus('shopify'); }

    // Logo → immer home.html
    var html = '<a class="kios-nav-home" href="/home.html">'
      + '<div class="kios-nav-logo-crop"><img class="kios-nav-logo-img" src="https://onecdn.io/media/9c5aadc5-b587-40cb-bc68-474e3b944ab9/md2x" alt="MH"></div>'
      + '<div class="kios-nav-logo-text">Cockpit</div>'
      + '</a>';

    if (currentPage === 'home.html') {
      // ── HOME: Tool-Auswahl ──────────────────────────
      html += '<div class="kios-nav-group">Tool wählen</div>';
      html += '<a class="kios-nav-tool-btn" href="#" id="kios-tool-newsletter">'
        + '<div class="kios-tool-icon">📧</div>'
        + '<div><div class="kios-tool-name">Newsletter-Tool</div><div class="kios-tool-desc">Klaviyo · Redaktion · Versand</div></div>'
        + '</a>';
      html += '<a class="kios-nav-tool-btn" href="#" id="kios-tool-shopify">'
        + '<div class="kios-tool-icon">🛍</div>'
        + '<div><div class="kios-tool-name">Shopify-Tool</div><div class="kios-tool-desc">Produkte · Upload · Sync</div></div>'
        + '</a>';

    } else if (modus === 'shopify') {
      // ── SHOPIFY MODE ────────────────────────────────
      html += '<div class="kios-modus-bar">'
        + '<span class="kios-modus-badge shopify">🛍 Shopify</span>'
        + '<a class="kios-modus-switch" href="/home.html">wechseln</a>'
        + '</div>';
      SHOPIFY_NAV_ITEMS.forEach(function (item) {
        if (item.group) {
          html += '<div class="kios-nav-group">' + item.group + '</div>';
        } else {
          var isActive = item.seite === currentPage;
          html += '<a class="kios-nav-item' + (isActive ? ' active' : '') + '" href="/' + item.seite + '">' + item.label + '</a>';
        }
      });

    } else {
      // ── NEWSLETTER MODE (Standard) ──────────────────
      html += '<div class="kios-modus-bar">'
        + '<span class="kios-modus-badge newsletter">📧 Newsletter</span>'
        + '<a class="kios-modus-switch" href="/home.html">wechseln</a>'
        + '</div>';

      html += '<div class="kios-nav-kunde">';
      if (kunde) {
        html += '<div class="lbl">Eingeloggt als</div>'
          + '<div class="name">' + kunde.replace(/</g, '&lt;') + '</div>'
          + '<div class="kios-klaviyo-line">Klaviyo-Account: <span id="kios-klaviyo-status" class="kios-klaviyo-status" title="Klaviyo-Status wird geprueft ...">&hellip;</span></div>'
          + '<button type="button" class="switch" id="kios-switch-kunde">Kunde wechseln</button>';
      } else {
        html += '<div class="lbl">Kein Kunde gewaehlt</div>'
          + '<button type="button" class="switch" id="kios-switch-kunde">Kunde waehlen</button>';
      }
      html += '</div>';

      NEWSLETTER_NAV_ITEMS.forEach(function (item) {
        if (item.group) {
          html += '<div class="kios-nav-group">' + item.group + '</div>';
        } else {
          var isActive = item.seite === currentPage;
          var cls = 'kios-nav-item' + (item.sub ? ' sub' : '') + (isActive ? ' active' : '');
          html += '<a class="' + cls + '" href="#" data-seite="' + item.seite + '" data-with-kunde="' + (item.withKunde ? '1' : '0') + '">' + item.label + '</a>';
        }
      });

      html += '<div class="kios-nav-footer">'
        + '<a class="kios-nav-danger" href="/kunde-loeschen.html">Kunde loeschen (intern)</a>'
        + '<button type="button" id="kios-logout-btn" class="kios-nav-logout">🔒 Ausloggen</button>'
        + '</div>';
    }

    if (currentPage === 'home.html' || modus === 'shopify') {
      html += '<div class="kios-nav-footer">'
        + '<button type="button" id="kios-logout-btn" class="kios-nav-logout">🔒 Ausloggen</button>'
        + '</div>';
    }

    nav.innerHTML = html;
    document.body.insertBefore(nav, document.body.firstChild);

    // Logout
    var logoutBtn = nav.querySelector('#kios-logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        try { localStorage.removeItem('mh_cockpit_pw'); } catch (e) {}
        window.location.href = '/';
      });
    }

    // ── EVENT HANDLER ────────────────────────────────

    if (currentPage === 'home.html') {
      var nlBtn = nav.querySelector('#kios-tool-newsletter');
      var shBtn = nav.querySelector('#kios-tool-shopify');
      if (nlBtn) nlBtn.addEventListener('click', function (ev) {
        ev.preventDefault(); setModus('newsletter'); window.location.href = '/index.html';
      });
      if (shBtn) shBtn.addEventListener('click', function (ev) {
        ev.preventDefault(); setModus('shopify'); window.location.href = '/shopify-dashboard.html';
      });
      return;
    }

    if (modus === 'shopify') { return; }

    // Newsletter: Klaviyo-Status + Nav-Klick + Kunde wechseln
    if (kunde) { loadKlaviyoStatus(kunde); }

    nav.querySelectorAll('.kios-nav-item').forEach(function (link) {
      link.addEventListener('click', function (ev) {
        ev.preventDefault();
        var seite = link.getAttribute('data-seite');
        var withKunde = link.getAttribute('data-with-kunde') === '1';
        if (withKunde && !getLoggedInKunde()) {
          openLoginModal(function () { window.location.href = buildUrl(seite, withKunde); });
        } else {
          window.location.href = buildUrl(seite, withKunde);
        }
      });
    });

    var switchBtn = nav.querySelector('#kios-switch-kunde');
    if (switchBtn) {
      switchBtn.addEventListener('click', function () {
        openLoginModal(function (chosen) {
          var isKnownPage = NEWSLETTER_NAV_ITEMS.some(function (item) {
            return !item.group && item.seite === currentPage;
          });
          if (currentPage === 'index.html') {
            window.location.reload();
          } else if (isKnownPage) {
            window.location.href = '/' + currentPage + '?kundenname=' + encodeURIComponent(chosen);
          } else {
            window.location.href = '/anleitung.html?kundenname=' + encodeURIComponent(chosen);
          }
        });
      });
    }
  }

  function syncFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get('kundenname');
    if (fromUrl) { setLoggedInKunde(fromUrl); }
  }

  function populateKundenFeld() {
    if (getCurrentPage() === 'index.html') { return; }
    var el = document.getElementById('kundenname');
    if (el && !el.value) {
      var kunde = getLoggedInKunde();
      if (kunde) {
        el.value = kunde;
        if (typeof window.loadThemen === 'function') { window.loadThemen(); }
      }
    }
  }

  var NO_KUNDE_PAGES = {
    'home.html':                              true,
    'index.html':                             true,
    'kunde-loeschen.html':                    true,
    'anleitung.html':                         true,
    'shopify-dashboard.html':                 true,
    'shopify-upload.html':                    true,
    'shopify-sync.html':                      true,
    'formular-masterartikel-optimierer.html': true,
    'kunden-datenbank.html':                  true,
    'kunden-bearbeiten.html':                 true,
  };

  function autoPromptIfNeeded() {
    var page = getCurrentPage();
    if (NO_KUNDE_PAGES[page] || SHOPIFY_PAGES[page]) { return; }
    if (getLoggedInKunde()) { return; }
    var needsKunde = NEWSLETTER_NAV_ITEMS.some(function (item) {
      return !item.group && item.seite === page && item.withKunde;
    });
    if (!needsKunde) { return; }
    openLoginModal(function (chosen) {
      window.location.href = '/' + page + '?kundenname=' + encodeURIComponent(chosen);
    });
  }

  function init() {
    syncFromUrl();
    injectStyles();
    buildNav();
    populateKundenFeld();
    autoPromptIfNeeded();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
