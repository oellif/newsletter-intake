# MH Cockpit — Plattform-Dokumentation

Internes Agentur-Tool für Marktplatz Helden. Kein öffentliches Storefront.
Live-URL: **https://newsletter-nfy46.netlify.app**

---

## Was ist das MH Cockpit?

Ein zentrales internes Hub-Tool ("Intranet / Werkzeugkasten") für die Agentur.
Von der Home-Seite wählt man ein Tool — die Sidebar passt sich automatisch an.
Aktuell zwei Tools: Newsletter-Tool (fertig) + Shopify-Tool (in Entwicklung).
Künftig können beliebig viele weitere Tools ergänzt werden.

---

## Repository & Deployment

**GitHub:** `oellif/newsletter-intake` (Branch: `main`)
**Netlify:** Auto-Deploy bei jedem Push auf `main` (~20 Sekunden)

**Quelldateien (bearbeiten hier):**
```
C:\Users\offic\AppData\Roaming\Claude\local-agent-mode-sessions\
b1e18483-...\33da01d0-...\local_1934d231-...\outputs\newsletter-intake\
```

**Git-Repo (deployen von hier):**
```
/tmp/ni
```

**Deploy-Workflow (immer so):**
```bash
# 1. Quelldatei bearbeiten (langer AppData-Pfad)
# 2. In Git-Repo kopieren:
cp <quelldatei> /tmp/ni/public/<dateiname>
# 3. Commit + Push:
cd /tmp/ni && git add <datei> && git commit -m "Beschreibung" && git push origin master:main
# Netlify deployed automatisch.
```

---

## Verzeichnisstruktur

```
/tmp/ni/
├── CLAUDE.md                    ← diese Datei
├── public/
│   ├── home.html                ← Hub-Startseite (Tool-Auswahl)
│   ├── nav.js                   ← Sidebar für ALLE Seiten (zentral)
│   ├── mh-ci.css                ← Shared CI-Stylesheet für ALLE Seiten
│   │
│   ├── index.html               ← Newsletter: Neukundenanlage
│   ├── klaviyo-verbinden.html
│   ├── template-mapping.html
│   ├── redaktionsplan.html
│   ├── idee.html
│   ├── ideen-freigabe.html
│   ├── test-mail-send.html
│   ├── qa-check.html
│   ├── campaign-setup.html
│   ├── kunden-vorschau.html
│   ├── performance-reporter.html
│   ├── segment-mapper.html
│   │
│   ├── shopify-dashboard.html   ← Shopify: Platzhalter (In Entwicklung)
│   ├── shopify-upload.html      ← Shopify: Platzhalter (In Entwicklung)
│   └── shopify-sync.html        ← Shopify: Platzhalter (In Entwicklung)
│
└── netlify/functions/
    ├── intake.js
    ├── kunden-alle.js
    ├── kunde-status.js
    ├── template-mapping-analyse.js
    └── template-mapping-speichern.js
```

---

## nav.js — Sidebar-Architektur

`public/nav.js` wird auf **jeder Seite** per `<script src="nav.js"></script>` eingebunden.
Es injiziert die Sidebar dynamisch in den `<body>`.

### Modus-System

```javascript
localStorage.kios_modus  // 'newsletter' | 'shopify' | ''
localStorage.kios_kundenname  // aktiver Klaviyo-Kunde (nur Newsletter-Tool)
```

- `home.html` → zeigt Tool-Auswahl in der Sidebar, kein Modus
- Shopify-Seiten → setzen Modus automatisch auf `'shopify'`
- Newsletter-Seiten → Modus `'newsletter'` (muss vorher gesetzt sein)
- Logo (oben links) → führt immer zu `/home.html`

### Nav-Items erweitern

**Neues Shopify-Tool hinzufügen:**
1. In `SHOPIFY_NAV_ITEMS` Array eintragen:
```javascript
{ label: 'Mein neues Feature', seite: 'shopify-neu.html', withKunde: false }
```
2. In `SHOPIFY_PAGES` eintragen:
```javascript
'shopify-neu.html': true
```
3. In `NO_KUNDE_PAGES` eintragen (Shopify braucht kein Kunde-Popup)
4. HTML-Datei anlegen (Template siehe unten)
5. Deployen

**Neues Newsletter-Tool hinzufügen:**
1. In `NEWSLETTER_NAV_ITEMS` Array eintragen
2. HTML-Datei anlegen
3. Deployen — kein Eintrag in `SHOPIFY_PAGES` nötig

**Komplett neues Tool (drittes Tool) hinzufügen:**
1. Neues Nav-Items-Array anlegen (z.B. `ANALYTICS_NAV_ITEMS`)
2. Neues Modus-Literal definieren (z.B. `'analytics'`)
3. Neue Seiten in `SHOPIFY_PAGES`-Äquivalent + `NO_KUNDE_PAGES` eintragen
4. `buildNav()` um neuen `else if (modus === 'analytics')` Block erweitern
5. Tool-Button in home.html und in nav.js home-Sektion ergänzen

---

## HTML-Template für neue Seiten

```html
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MH Cockpit – Seitentitel</title>
<link rel="stylesheet" href="/mh-ci.css">
<style>
  :root { --dark:#202228; --accent:#FA8700; --bg:#F7F6F3; --border:#E5E7EB; }
  * { box-sizing: border-box; }
  body { font-family: 'Manrope', Arial, sans-serif; background: var(--bg); color: #191919; margin: 0; padding: 0 0 80px; }
  .container { max-width: 720px; margin: 0 auto; padding: 36px 28px; }
  .page-header h1 { font-family: 'Varela Round','Manrope',sans-serif; font-size: 28px; font-weight: 400; letter-spacing: -0.5px; margin: 0 0 6px; }
  .page-header p { font-size: 14px; color: #6B7280; margin: 0 0 28px; line-height: 1.55; }
</style>
</head>
<body>
<div class="container">
  <div class="page-header">
    <h1>Seitentitel</h1>
    <p>Kurze Beschreibung was diese Seite macht.</p>
  </div>

  <!-- Seiteninhalt hier -->

</div>
<script src="nav.js"></script>
</body>
</html>
```

**Für Shopify-Seiten:** `--accent:#96BF48` statt `#FA8700` setzen.

---

## MH Corporate Identity

| Token | Wert | Verwendung |
|---|---|---|
| Brand Orange | `#FA8700` | CTAs, aktiver Nav-Punkt, Newsletter-Akzent |
| Dark Navy | `#202228` | Sidebar-Hintergrund |
| Logo-BG | `#252527` | Sidebar-Logo-Bereich |
| Near Black | `#191919` | Body-Text |
| Off-White | `#F7F6F3` | Page-Hintergrund |
| Border | `#E5E7EB` | Trennlinien, Input-Rahmen |
| Shopify Green | `#96BF48` | Shopify-Tool-Akzent |
| Etsy Orange | `#F1641E` | (Reserve) |

**Fonts:**
- Headings: `Varela Round` (Google Fonts)
- Body / Nav: `Manrope` (Google Fonts, Gewichte 400–800)

**Buttons:** `border-radius: 40px` (Pill-Form), Orange-Glow-Shadow
**Cards:** `border-radius: 14px`, kein Border, subtiler Shadow
**Inputs on Focus:** Orange Border + `0 0 0 3px rgba(250,135,0,0.18)` Shadow

**Shared CSS:** `mh-ci.css` wird auf jeder Seite geladen und überschreibt CI-relevante Stile.

---

## MH Logo

**URL:** `https://onecdn.io/media/9c5aadc5-b587-40cb-bc68-474e3b944ab9/md2x`
Das Bild ist 1000×299px und enthält Icon + "MARKTPLATZ HELDEN" Text.

**Nur das Icon zeigen (40×40px Ausschnitt links):**
```css
.logo-crop { width: 40px; height: 40px; overflow: hidden; }
.logo-crop img { height: 40px; width: auto; display: block; }
```

**Hintergrundfarbe hinter dem Icon:** `#252527` (passt zum Bild-Hintergrund)

---

## Netlify Functions (Newsletter-Tool)

Alle unter `/.netlify/functions/`:

| Endpoint | Funktion |
|---|---|
| `intake` | Neukundenanlage: Drive-Ordner + Google Sheet anlegen |
| `kunden-alle` | Gibt alle Kunden als JSON zurück (für Sidebar-Login) |
| `kunde-status` | Klaviyo-Verbindungsstatus für einen Kunden |
| `template-mapping-analyse` | Liest Klaviyo-Template-Blöcke |
| `template-mapping-speichern` | Speichert Mapping im Kundenprofil-Sheet |

**Shopify-Functions:** Existieren bereits in einem separaten Chat/Projekt. Noch kein Frontend. Die Netlify Function-Namen müssen bei Integration hier ergänzt werden.

---

## Pflichtregeln für jede Änderung

1. **Deploy-Workflow verwenden** — nie direkt auf Netlify bearbeiten
2. **`<link rel="stylesheet" href="/mh-ci.css">`** vor `</head>` auf jeder Seite
3. **`<script src="nav.js"></script>`** direkt vor `</body>` auf jeder Seite
4. **Shopify-Seiten** in `SHOPIFY_PAGES` + `NO_KUNDE_PAGES` in nav.js eintragen
5. **MH CI Tokens** verwenden — keine eigenen Farben erfinden
6. **Alles in dasselbe Repo** `/tmp/ni` — keine separate Netlify-Site
7. **Neue Tools** immer über nav.js integrieren, nie eigene Sidebar bauen
