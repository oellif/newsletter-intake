// Passwort-Gate fuer alle Cockpit-Seiten.
// Prueft beim Laden, ob das gespeicherte Passwort zum hinterlegten Hash
// passt; sonst wird ein Eingabe-Overlay gezeigt. Das Passwort selbst
// bleibt im localStorage, damit es spaeter bei jedem Funktionsaufruf als
// Header mitgeschickt werden kann (serverseitige Pruefung).
(function () {
  var PW_HASH = '4d37e19217cab195189d033f6e939540f34e84740747be49af0eda6a88875caa';
  var STORAGE_KEY = 'mh_cockpit_pw';

  function sha256(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  // Jeden Aufruf der Netlify-Funktionen automatisch mit dem Passwort-Header
  // versehen - die Funktionen pruefen ihn serverseitig (lib/auth.js)
  var origFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    try {
      if (typeof url === 'string' && url.indexOf('/.netlify/functions/') !== -1) {
        opts = opts || {};
        opts.headers = Object.assign({}, opts.headers || {}, {
          'X-Cockpit-Pw': localStorage.getItem(STORAGE_KEY) || '',
        });
      }
    } catch (e) {}
    return origFetch(url, opts);
  };

  // Seite sofort verstecken, bis die Pruefung durch ist (kein Inhalts-Blitz)
  document.documentElement.style.visibility = 'hidden';

  function unlock() {
    document.documentElement.style.visibility = '';
    var ov = document.getElementById('mhPwGate');
    if (ov) ov.remove();
  }

  function showGate() {
    function render() {
      document.documentElement.style.visibility = '';
      if (document.getElementById('mhPwGate')) return;
      var ov = document.createElement('div');
      ov.id = 'mhPwGate';
      ov.innerHTML =
        '<div style="position:fixed;inset:0;background:#F7F6F3;z-index:99999;display:flex;align-items:center;justify-content:center;font-family:Manrope,Arial,sans-serif;">' +
        '<div style="background:#fff;border-radius:16px;padding:36px;max-width:360px;width:90%;box-shadow:0 4px 24px rgba(25,25,25,0.1);text-align:center;">' +
        '<div style="font-size:20px;font-weight:700;margin-bottom:6px;">MH Cockpit</div>' +
        '<div style="font-size:13px;color:#6B7280;margin-bottom:20px;">Bitte Passwort eingeben</div>' +
        '<input id="mhPwInput" type="password" autocomplete="current-password" style="width:100%;box-sizing:border-box;border:1.5px solid #E5E7EB;border-radius:8px;padding:11px 14px;font-size:14px;outline:none;text-align:center;">' +
        '<div id="mhPwErr" style="color:#B91C1C;font-size:12px;margin-top:8px;min-height:16px;"></div>' +
        '<button id="mhPwBtn" style="margin-top:10px;width:100%;background:#96BF48;color:#fff;border:none;border-radius:9px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;">Anmelden</button>' +
        '</div></div>';
      document.body.appendChild(ov);

      var input = document.getElementById('mhPwInput');
      var btn   = document.getElementById('mhPwBtn');
      var err   = document.getElementById('mhPwErr');

      function submit() {
        var val = input.value;
        if (!val) return;
        sha256(val).then(function (hash) {
          if (hash === PW_HASH) {
            localStorage.setItem(STORAGE_KEY, val);
            // Neu laden, damit alle Datenaufrufe der Seite mit Passwort
            // wiederholt werden (die ersten liefen ggf. schon auf 401)
            location.reload();
          } else {
            err.textContent = 'Falsches Passwort';
            input.value = '';
            input.focus();
          }
        });
      }
      btn.addEventListener('click', submit);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      input.focus();
    }

    if (document.body) render();
    else document.addEventListener('DOMContentLoaded', render);
  }

  var stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    showGate();
    return;
  }
  sha256(stored).then(function (hash) {
    if (hash === PW_HASH) unlock();
    else { localStorage.removeItem(STORAGE_KEY); showGate(); }
  });
})();
