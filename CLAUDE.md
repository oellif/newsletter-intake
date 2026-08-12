# KI-OS Hub — Platform-Dokumentation

Internes Agentur-Tool (Marktplatz Helden). Kein öffentliches Frontend.
Deployed auf Netlify: `newsletter-nfy46.netlify.app`

---

## Architektur

Zwei Tools unter einem Dach:

| Tool | Einstieg | Modus-Key |
|---|---|---|
| Newsletter-Tool | `/index.html` | `newsletter` |
| Shopify-Tool | `/shopify-dashboard.html` | `shopify` |

Home/Hub: `/home.html` — zeigt Tool-Auswahl, kein eigener Inhalt.

---

## Deploy-Workflow

```
Quelldateien:
C:\Users\offic\AppData\Roaming\Claude\local-agent-mode-sessions\
b1e18483-...\33da01d0-...\local_1934d231-...\outputs\newsletter-intake\public\

Git-Repo (Netlify-Source):
/tmp/ni

Deploy:
1. Datei(en) in Quelldateien bearbeiten
2. cp <quelldatei> /tmp/ni/public/<datei>
3. cd /tmp/ni && git add ... && git commit -m "..." && git push origin master:main
4. Netlify deployed automatisch (~20s)
```

---

## nav.js — Sidebar-Logik

`public/nav.js` — wird per `<script src="nav.js"></script>` auf jeder Seite eingebunden.

**Wichtige Konzepte:**
- `kios_modus` (localStorage): `'newsletter'` | `'shopify'` | `''`
- `kios_kundenname` (localStorage): aktiver Klaviyo-Kunde (nur Newsletter-Tool)
- Logo-Link führt immer zu `/home.html`
- Shopify-Seiten setzen Modus automatisch auf `'shopify'`

**Nav-Items erweitern:**
- Newsletter: `NEWSLETTER_NAV_ITEMS` Array in nav.js
- Shopify: `SHOPIFY_NAV_ITEMS` Array in nav.js
- Shopify-Seiten auch in `SHOPIFY_PAGES` und `NO_KUNDE_PAGES` eintragen

**Neue Seite hinzufügen (Shopify-Tool):**
1. HTML-Datei in `public/shopify-<name>.html` anlegen (mit `<script src="nav.js"></script>`)
2. In `SHOPIFY_NAV_ITEMS` eintragen
3. In `SHOPIFY_PAGES` und `NO_KUNDE_PAGES` eintragen
4. `<link rel="stylesheet" href="/mh-ci.css">` im `<head>` nicht vergessen
5. Deploy

---

## MH Corporate Identity

| Token | Wert | Verwendung |
|---|---|---|
| Brand Orange | `#FA8700` | CTAs, aktiver Nav-Punkt, Highlights |
| Dark Navy | `#202228` | Sidebar-Hintergrund |
| Logo-BG | `#252527` | Sidebar-Logo-Bereich |
| Near Black | `#191919` | Body-Text |
| Off-White | `#F7F6F3` | Page-Hintergrund |
| Shopify Green | `#96BF48` | Shopify-Tool-Akzent |

**Fonts:** Manrope (Body/Nav), Varela Round (Headings)
**Buttons:** Pill-Form (border-radius: 40px), Orange-Glow-Shadow
**Cards:** border-radius 14px, kein Border, subtiler Shadow

**Shared CSS:** `public/mh-ci.css` — wird auf jeder Seite nach dem eigenen `<style>`-Block geladen. Überschreibt CI-relevante Stile via `!important`.

---

## Netlify Functions

Alle unter `netlify/functions/`. Relevant für Newsletter-Tool:
- `intake` — Neukundenanlage (Drive-Ordner + Sheet)
- `kunden-alle` — Kundenliste für Sidebar-Login
- `kunde-status` — Klaviyo-Verbindungsstatus
- `template-mapping-analyse` — Klaviyo-Template-Blöcke lesen
- `template-mapping-speichern` — Mapping in Kundenprofil-Sheet speichern

Shopify-Functions: separat, noch kein Frontend.

---

## Regeln für neue Chats

1. **Immer Deploy-Workflow verwenden** — nie direkt auf Netlify hochladen
2. **mh-ci.css einbinden** — `<link rel="stylesheet" href="/mh-ci.css">` vor `</head>`
3. **nav.js einbinden** — `<script src="nav.js"></script>` vor `</body>`
4. **Shopify-Seiten** in `SHOPIFY_PAGES` + `NO_KUNDE_PAGES` in nav.js eintragen
5. **Keine neuen CSS-Farben** — immer MH CI Tokens verwenden
6. **Keine separate Netlify-Site** — alles in dasselbe Repo `/tmp/ni`
