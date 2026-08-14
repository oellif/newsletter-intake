// Formulare-Sidebar — eigene Nav für den Formulare-Bereich
// Ersetzt nav.js auf formulare.html und formular-*.html Seiten.
(function () {
  var FORMULARE = [
    {
      label: 'Masterartikel-Optimierer',
      seite: 'formular-masterartikel-optimierer.html',
      desc:  'SEO · Descriptions · Metafelder',
    },
    // Weitere Formulare hier ergänzen
  ];

  function getCurrentPage() {
    return (window.location.pathname.split('/').pop() || 'formulare.html');
  }

  function logout() {
    try { localStorage.removeItem('mh_cockpit_pw'); } catch (e) {}
    window.location.href = '/';
  }

  function injectStyles() {
    var css = ''
      + '.fnav { position: fixed; top: 0; left: 0; bottom: 0; width: 240px; background: #202228; color: #E5E7EB; overflow-y: auto; z-index: 500; font-family: "Manrope", Arial, sans-serif; display: flex; flex-direction: column; }'
      + '.fnav-home { display: flex; align-items: center; gap: 11px; padding: 9px 18px; background: #252527; border-bottom: 1px solid rgba(255,255,255,0.06); text-decoration: none; }'
      + '.fnav-logo-crop { width: 40px; height: 40px; overflow: hidden; flex-shrink: 0; }'
      + '.fnav-logo-img { height: 40px; width: auto; display: block; }'
      + '.fnav-logo-text { font-size: 22px; font-weight: 700; color: #fff; line-height: 1; }'
      + '.fnav-group { padding: 14px 18px 4px 18px; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: rgba(255,255,255,0.25); font-weight: 700; }'
      + '.fnav-item { display: block; padding: 10px 18px; font-size: 13.5px; text-decoration: none; color: rgba(255,255,255,0.65); transition: background 0.12s, color 0.12s; border-left: 3px solid transparent; }'
      + '.fnav-item:hover { background: rgba(255,255,255,0.06); color: #fff; }'
      + '.fnav-item.active { background: rgba(250,135,0,0.12); color: #fff; border-left-color: #FA8700; font-weight: 700; }'
      + '.fnav-item-desc { font-size: 11px; color: rgba(255,255,255,0.35); margin-top: 2px; }'
      + '.fnav-footer { margin-top: auto; border-top: 1px solid rgba(255,255,255,0.06); }'
      + '.fnav-back { display: block; padding: 10px 18px; font-size: 13px; color: rgba(255,255,255,0.4); text-decoration: none; }'
      + '.fnav-back:hover { color: #fff; background: rgba(255,255,255,0.06); }'
      + '.fnav-logout { display: block; width: 100%; text-align: left; background: none; border: none; padding: 10px 18px; font-size: 13px; color: rgba(255,255,255,0.35); cursor: pointer; font-family: inherit; }'
      + '.fnav-logout:hover { background: rgba(255,255,255,0.06); color: #fff; }'
      + 'body.fhas-nav { margin-left: 240px; }'
      + '@media (max-width: 780px) { .fnav { display: none; } body.fhas-nav { margin-left: 0; } }';
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildNav() {
    document.body.classList.add('fhas-nav');
    var currentPage = getCurrentPage();
    var nav = document.createElement('div');
    nav.className = 'fnav';

    var html = '<a class="fnav-home" href="/home.html">'
      + '<div class="fnav-logo-crop"><img class="fnav-logo-img" src="https://onecdn.io/media/9c5aadc5-b587-40cb-bc68-474e3b944ab9/md2x" alt="MH"></div>'
      + '<div class="fnav-logo-text">Cockpit</div>'
      + '</a>';

    html += '<div class="fnav-group">Formulare</div>';

    FORMULARE.forEach(function (f) {
      var isActive = f.seite === currentPage || ('/' + f.seite) === window.location.pathname + '.html';
      html += '<a class="fnav-item' + (isActive ? ' active' : '') + '" href="/' + f.seite + '">'
        + f.label
        + (f.desc ? '<div class="fnav-item-desc">' + f.desc + '</div>' : '')
        + '</a>';
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
