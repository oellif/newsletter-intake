// Ablage- & Versionsregel v1 aktiv - umgestellt am 20260804
//
// Gemeinsames globales Navigationsmenue (linke Sidebar) fuer alle Seiten
// der Newsletter-Skill-Pipeline. Wird per <script src="nav.js"></script>
// auf jeder Seite eingebunden.
//
// Konzept "eingeloggter Kunde" (nur agenturintern, kein echter Zugriffs-
// schutz - das kommt spaeter fuer die Kunden-Selbstbedienung):
// - Der zuletzt gewaehlte Kundenname wird in localStorage gespeichert und
//   bleibt ueber Neuladen/Schliessen hinweg erhalten.
// - Klick auf einen Menuepunkt haengt automatisch ?kundenname=... an, wenn
//   ein Kunde "eingeloggt" ist.
// - Ist noch kein Kunde gewaehlt, oeffnet ein Klick auf einen Menuepunkt
//   zuerst ein Auswahl-Dropdown mit ALLEN existierenden Kunden (kein
//   Freitext - man soll sehen, welche es schon gibt).
// - "Kunde wechseln" oeffnet dasselbe Dropdown bewusst erneut.
// - "Kunde loeschen" ist bewusst ausgenommen: dieser Link bekommt NIE den
//   eingeloggten Kundennamen automatisch mit, damit man nicht aus
//   Versehen den falschen (naemlich den gerade aktiven) Kunden loescht -
//   die Seite hat ihre eigene Suche.

(function () {
  var STORAGE_KEY = 'kios_kundenname';

  var NAV_ITEMS = [
    { group: 'Teil 1 - einmalig' },
    { label: 'Neukundenanlage', seite: 'index.html', withKunde: false },
    { label: 'Klaviyo verbinden', seite: 'klaviyo-verbinden.html', withKunde: true },
    { label: 'Template-Mapping', seite: 'template-mapping.html', withKunde: true },
    { group: 'Teil 2 - pro Ausgabe' },
    { label: 'Redaktionsplan', seite: 'redaktionsplan.html', withKunde: true },
    // Diese beiden sind bewusst als Unterpunkte von Redaktionsplan
    // eingerueckt (sub: true) - beide bestimmen ein neues Thema fuer den
    // Redaktionsplan, nur auf unterschiedlichem Weg (manuell vs. KI), und
    // sollen deshalb auf einen Blick als zusammengehoerendes Paar erkennbar
    // sein. Einheitliche Namenskonvention: "Thema " + Herkunft.
    { label: 'Thema manuell anlegen', seite: 'idee.html', withKunde: true, sub: true },
    { label: 'Thema automatisch vorschlagen', seite: 'ideen-freigabe.html', withKunde: true, sub: true },
    { label: 'Testmail senden', seite: 'test-mail-send.html', withKunde: true },
    { label: 'QA-Check', seite: 'qa-check.html', withKunde: true },
    { label: 'Kampagne anlegen', seite: 'campaign-setup.html', withKunde: true },
    { label: 'Kundenvorschau senden', seite: 'kunden-vorschau.html', withKunde: true },
    { label: 'Performance-Report', seite: 'performance-reporter.html', withKunde: true },
    { group: 'Optional' },
    { label: 'Segment-Mapper', seite: 'segment-mapper.html', withKunde: true },
  ];

  function getCurrentPage() {
    return (window.location.pathname.split('/').pop() || 'anleitung.html');
  }

  function getLoggedInKunde() {
    try { return localStorage.getItem(STORAGE_KEY) || ''; } catch (e) { return ''; }
  }
  function setLoggedInKunde(name) {
    try { localStorage.setItem(STORAGE_KEY, name); } catch (e) {}
  }
  function clearLoggedInKunde() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  function injectStyles() {
    // Google Fonts
    var font = document.createElement('link');
    font.rel = 'stylesheet';
    font.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(font);

    var css = ''
      + '.kios-nav { position: fixed; top: 0; left: 0; bottom: 0; width: 240px; background: #202228; color: #E5E7EB; overflow-y: auto; z-index: 500; font-family: "Manrope", Arial, sans-serif; display: flex; flex-direction: column; }'
      + '.kios-nav a, .kios-nav button.kios-link { display: block; width: 100%; text-align: left; background: none; border: none; color: #E5E7EB; font-family: inherit; cursor: pointer; }'
      + '.kios-nav-home { display: flex; align-items: center; gap: 11px; padding: 9px 18px; background: #252527; border-bottom: 1px solid rgba(255,255,255,0.06); text-decoration: none; }'
      + '.kios-nav-logo-crop { width: 40px; height: 40px; overflow: hidden; flex-shrink: 0; }'
      + '.kios-nav-logo-img { height: 40px; width: auto; display: block; }'
      + '.kios-nav-logo-text { font-size: 13px; font-weight: 800; color: #fff; line-height: 1.3; }'
      + '.kios-nav-logo-text span { color: #FA8700; }'
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
      + '.kios-nav-danger { margin-top: auto; padding: 10px 18px; font-size: 13px; text-decoration: none; color: #FCA5A5; border-top: 1px solid rgba(255,255,255,0.06); }'
      + '.kios-nav-danger:hover { background: rgba(127,29,29,0.4); color: #fff; }'
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
    var url = '/' + seite;
    if (withKunde && kunde) {
      return url + '?kundenname=' + encodeURIComponent(kunde);
    }
    return url;
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
    var okBtn = overlay.querySelector('#kios-login-ok');
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

    select.addEventListener('change', function () {
      okBtn.disabled = !select.value;
    });
    cancelBtn.addEventListener('click', function () {
      document.body.removeChild(overlay);
    });
    okBtn.addEventListener('click', function () {
      var chosen = select.value;
      if (!chosen) return;
      setLoggedInKunde(chosen);
      document.body.removeChild(overlay);
      onChosen(chosen);
    });
  }

  // Fragt den Klaviyo-Verbindungsstatus des eingeloggten Kunden ab und
  // zeigt einen Haken/X direkt neben dem Namen in der Sidebar - so sieht
  // man auf einen Blick, ob "Klaviyo verbinden" fuer diesen Kunden noch
  // aussteht, ohne extra auf die Seite zu wechseln.
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
            : 'Klaviyo verbunden (Accountname konnte nicht ermittelt werden)';
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
          current.title = 'Klaviyo-Status konnte nicht geprueft werden';
        }
      });
  }

  function buildNav() {
    document.body.classList.add('kios-has-nav');
    var nav = document.createElement('div');
    nav.className = 'kios-nav';

    var currentPage = getCurrentPage();
    var kunde = getLoggedInKunde();

    var html = '<a class="kios-nav-home" href="/anleitung.html">'
      + '<div class="kios-nav-logo-crop"><img class="kios-nav-logo-img" src="https://onecdn.io/media/9c5aadc5-b587-40cb-bc68-474e3b944ab9/md2x" alt="MH"></div>'
      + '<div class="kios-nav-logo-text">KI<span>-</span>OS<br>Newsletter Suite</div>'
      + '</a>';

    html += '<div class="kios-nav-kunde">';
    if (kunde) {
      html += '<div class="lbl">Eingeloggt als</div>'
        + '<div class="name">' + kunde.replace(/</g, '&lt;') + '</div>'
        + '<div class="kios-klaviyo-line">Klaviyo-Account: <span id="kios-klaviyo-status" class="kios-klaviyo-status" title="Klaviyo-Status wird geprueft ...">&hellip;</span></div>';
      html += '<button type="button" class="switch" id="kios-switch-kunde">Kunde wechseln</button>';
    } else {
      html += '<div class="lbl">Kein Kunde gewaehlt</div>';
      html += '<button type="button" class="switch" id="kios-switch-kunde">Kunde waehlen</button>';
    }
    html += '</div>';

    NAV_ITEMS.forEach(function (item) {
      if (item.group) {
        html += '<div class="kios-nav-group">' + item.group + '</div>';
      } else {
        var isActive = item.seite === currentPage;
        var cls = 'kios-nav-item' + (item.sub ? ' sub' : '') + (isActive ? ' active' : '');
        html += '<a class="' + cls + '" href="#" data-seite="' + item.seite + '" data-with-kunde="' + (item.withKunde ? '1' : '0') + '">' + item.label + '</a>';
      }
    });

    html += '<a class="kios-nav-danger" href="/kunde-loeschen.html">Kunde loeschen (intern)</a>';

    nav.innerHTML = html;
    document.body.insertBefore(nav, document.body.firstChild);

    if (kunde) { loadKlaviyoStatus(kunde); }

    nav.querySelectorAll('.kios-nav-item').forEach(function (link) {
      link.addEventListener('click', function (ev) {
        ev.preventDefault();
        var seite = link.getAttribute('data-seite');
        var withKunde = link.getAttribute('data-with-kunde') === '1';
        if (withKunde && !getLoggedInKunde()) {
          openLoginModal(function () {
            window.location.href = buildUrl(seite, withKunde);
          });
        } else {
          window.location.href = buildUrl(seite, withKunde);
        }
      });
    });

    var switchBtn = nav.querySelector('#kios-switch-kunde');
    if (switchBtn) {
      switchBtn.addEventListener('click', function () {
        openLoginModal(function (chosen) {
          // Aktuelle Seite mit dem neu gewaehlten Kunden neu aufrufen
          // (statt nur reload), damit URL und Kundenname-Feld sofort
          // konsistent sind - auf der Neukundenanlage bewusst ohne Param.
          // Auf Seiten ausserhalb der normalen public/-Root (z.B. die
          // Klaviyo-Erfolgsseite unter /.netlify/functions/...) gibt es
          // keine sinnvolle "gleiche Seite" zum Neuladen - dort geht es
          // stattdessen zur Anleitung mit dem neu gewaehlten Kunden.
          var isKnownPage = NAV_ITEMS.some(function (item) { return !item.group && item.seite === currentPage; });
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

  // Falls die Seite ueber ?kundenname=... aufgerufen wird (z.B. Klick von
  // einer anderen Seite mit bereits eingeloggtem Kunden, oder Redirect aus
  // einem Skill-Erfolg), diesen Namen ebenfalls als "eingeloggt" merken,
  // damit der Zustand konsistent bleibt.
  function syncFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get('kundenname');
    if (fromUrl) { setLoggedInKunde(fromUrl); }
  }

  // Fuellt das Kundenname-Feld der aktuellen Seite aus dem eingeloggten
  // Kunden, falls es noch leer ist (z.B. nach "Kunde wechseln" + Reload,
  // wenn die URL selbst keinen ?kundenname=-Parameter hat). Auf der
  // Neukundenanlage bewusst NICHT automatisch befuellen, damit dort nicht
  // aus Versehen ein bestehender Kundenname in ein neues Formular rutscht.
  function populateKundenFeld() {
    if (getCurrentPage() === 'index.html') { return; }
    var el = document.getElementById('kundenname');
    if (el && !el.value) {
      var kunde = getLoggedInKunde();
      if (kunde) {
        el.value = kunde;
        // Seiten mit Themen-Auswahlfeld (idee.html, qa-check.html usw.)
        // laden die offenen Themen beim eigenen Seiten-Laden nur, wenn das
        // Kundenname-Feld zu diesem Zeitpunkt schon gefuellt war. Da wir
        // erst hier (nach nav.js) befuellen, holen wir das jetzt nach.
        if (typeof window.loadThemen === 'function') {
          window.loadThemen();
        }
      }
    }
  }

  // Seiten, auf denen kein Kunde noetig/moeglich ist.
  var NO_KUNDE_PAGES = { 'index.html': true, 'kunde-loeschen.html': true, 'anleitung.html': true };

  // Seit das Kundenname-Feld auf den Seiten nicht mehr sichtbar/editierbar
  // ist (nur noch via Sidebar "Kunde wechseln" bzw. Login), muss beim
  // Laden einer kunde-pflichtigen Seite ohne aufloesbaren Kunden (kein
  // ?kundenname=-Param, kein localStorage-Wert) automatisch das
  // Login-Auswahlfeld erscheinen - sonst gibt es keine Moeglichkeit mehr,
  // ueberhaupt einen Kunden zu waehlen.
  function autoPromptIfNeeded() {
    var page = getCurrentPage();
    if (NO_KUNDE_PAGES[page]) { return; }
    if (getLoggedInKunde()) { return; }
    var needsKunde = NAV_ITEMS.some(function (item) {
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
