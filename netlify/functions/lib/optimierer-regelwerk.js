// Regelwerk des Masterartikel-Optimierers - 1:1 uebernommen aus
// ~/.claude/skills/masterartikel-optimierer/references/regelwerk.md
// (Stand 18.08.2026, Konzept v2). Wird als Prompt-Baustein der Function
// masterartikel-optimieren verwendet. Aenderungen am Regelwerk bitte
// zuerst in der Skill-Datei machen, dann hier nachziehen.
const REGELWERK = `# Regelwerk pro Feld — Shopify-Standard-Importvorlage

## Texte & SEO

| Feld | Regel | Limit / Format |
|---|---|---|
| **Title** | Vorhandener Title = Basis; nur bereinigen/neu aufbauen wenn schlecht/kaputt. Dann: Keyword vorn, Produktart + Material + Besonderheit, kein Keyword-Stuffing | <= 70 Zeichen |
| **URL handle** | NUR neue Artikel: Kleinbuchstaben, Bindestriche, Umlaute umschreiben (ae, oe, ue, ss), Hauptkeyword, kurz. Bestehende Artikel: Handle NIE aendern | z.B. armband-holz-nuss |
| **Description** | HTML-Struktur: Hook -> Nutzen/Emotion -> Fakten (Material, Masse, Pflege) -> Lieferumfang. Nur belegte Fakten, Brand Voice aus Kundenprofil, Du/Sie beachten | 150-300 Woerter, <p>/<strong>/Listen |
| **SEO title** | Hauptkeyword + USP, CTR-Trigger (Zahl, Nutzen), conversion-orientiert. Eher kurz; Brand NUR anhaengen wenn die Marke Suchrelevanz hat | <= 60 Zeichen |
| **SEO description** | Nutzenversprechen + Keyword, aktives Verb, CTA — kein Abschneiden in den SERPs | <= 155 Zeichen |
| **Tags** | Festes Schema aus Kundenprofil: Produktart, Material, Zielgruppe, Anlass — shopweit konsistent, gleiche Schreibweise | 5-10 Tags, kommagetrennt |
| **Image alt text** | Bildanalyse Pflicht: echten Bildinhalt beschreiben + Keyword; pro Bildposition unterschiedlich; kein "Bild von..."; Variantenbilder mit Optionswert (z.B. "...aus Nussholz") | <= 125 Zeichen |

## Kategorien & Struktur

| Feld | Regel |
|---|---|
| **Product category** | Offizielle Shopify-Taxonomie exakt treffen (z.B. Apparel & Accessories > Jewelry > Bracelets). Im Zweifel als unsicher markieren, nie frei erfinden |
| **Google Shopping / Google product category** | Google-Produkt-Taxonomie passend zur Shopify-Kategorie |
| **Type** | Einheitliche Schreibweise ueber den ganzen Shop (aus Kundenprofil oder Bestand ableiten). Falls der Bestandswert ein Funktionskennzeichen ist (z.B. "Master"), NICHT aendern |
| **Vendor** | Aus Kundenprofil; einheitlich |
| **Metafelder** (Spalten "Metafield: custom.*") | Aus Optionswerten und Description ableiten (z.B. custom.holzart aus Option "Holz"). Definitionen und erlaubte Werte stehen im Kundenprofil. Nur Hauptzeile befuellen |
| **Option1/2/3 name + value** | Nicht umbenennen — sie definieren die Varianten |

## Nicht anfassen (nur validieren, NIEMALS in "felder" zurueckgeben)

SKU, Barcode, Price, Compare-at price, Cost per item, Steuer-Felder, Inventory,
Gewicht, Versand-Felder, Fulfillment service, Gift card, Status, Published,
Optionsnamen und Optionswerte.

## Validierungs-Checkliste (vor der Antwort selbst pruefen)

1. Alle Limits eingehalten (Title 70, SEO Title 60, SEO Description 155, Alt 125)
2. Handle nur bei neuen Artikeln (ist_live=false) vorschlagen; bei ist_live=true das Feld "URL handle" komplett weglassen
3. Health-Claims-Check ueber ALLE Texte: keine Heil-/Gesundheits-/Wirkversprechen (AMG/HWG/HCVO) — verdaechtige Formulierungen ("heilt", "lindert", "gegen Schmerzen", "entzuendungshemmend", Chakra-/Energie-Wirkversprechen) umformulieren zu Emotion/Symbolik ("steht fuer ...")
4. Verbotene Begriffe aus dem Kundenprofil nirgends verwendet
5. NIE Fakten erfinden — fehlende Infos in die "offen"-Liste, unsichere Felder in die "unsicher"-Liste`;

module.exports = { REGELWERK };
