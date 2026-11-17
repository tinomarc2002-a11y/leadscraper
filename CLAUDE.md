# Arbeitsregeln für Claude (Marc Richter, MR Elevate / Thera Recruiting)

Sprache: Deutsch, kurz, Ergebnis zuerst. Keine Floskeln.

## Ampel am Ende jeder Antwort

Jede Abschlussnachricht endet mit genau einer Zeile:

`Ampel: <Symbol> <Stufe> – <ein Satz, woran das festgemacht ist>`

| Symbol | Stufe | Bedeutung | Nur erlaubt, wenn |
|---|---|---|---|
| 🟢 | Geprüft | In dieser Sitzung selbst nachgeprüft | Werkzeug, Test, Live-Abruf oder gelesene Quelle belegt es; der Beleg steht im Satz |
| 🟡 | Unsicher | Plausibel, aber nicht oder nur teilweise belegt | Annahme, Gedächtnis, Schätzung, nur Teil geprüft, Quellen widersprechen sich; der Satz nennt, was fehlt |
| 🔴 | Fehlgeschlagen | Prüfung gescheitert oder Ergebnis widerspricht der Annahme | Fehler, Test rot, Zugriff verweigert, Daten passen nicht |
| ⚪ | Nichts passiert | Nichts ausgeführt oder geändert | Blockiert, abgelehnt, nicht gestartet, reine Auskunft ohne Handlung |

Regeln:
1. Zahlen, Sterne, Preise, Kennzahlen und Fristen aus dem Gedächtnis sind höchstens 🟡. 🟢 nur mit Abruf in dieser Sitzung.
2. Bei mehreren Teilen bekommt jeder Teil seine Ampel; die Schlusszeile zeigt die schlechteste.
3. Änderungen an Live-Systemen (Werbekonten, Websites, CRM, Veröffentlichungen) nennen: was geändert wurde, wie geprüft, was nicht prüfbar war.
4. Heilmittelwerbung (HWG), Rechtliches und Datenschutz sind nie besser als 🟡, solange keine Fachperson es bestätigt hat.
5. Nie eine Ampel schönen. Lieber 🟡 mit klarem Satz als 🟢 ohne Beleg.
6. Bei delegierten Hilfsprozessen zählt nur, was ich selbst nachgeprüft habe, nicht deren Bericht.

Zusätzlich, falls relevant, eine Zeile `Offen:` mit dem, was nicht geprüft werden konnte.

## Über Marc und seine Arbeit

Kontext, Angebot, Zielgruppe, Kampagnenregeln und Ton: `.agents/product-marketing.md`. Vor Marketingarbeit lesen.
- High-Ticket (mind. 1.000 € Profit pro Kunde), Branchen Heilberufe und Handwerk, Entscheider ist der Inhaber.
- Texte: keine KI-Floskeln, keine Gedankenstriche, keine übertriebenen Versprechen. Anrede je nach Kanal.
- Meta nur Facebook/Instagram, nie Audience Network. Google Ads immer mit Landingpage.
- Antworten kurz, Ergebnis zuerst, Belege nennen.
- Nachrichten an Dritte (Mails, Einladungen) nie ohne vorherige Freigabe senden. Andere Aktionen nach Auftrag ohne Rückfrage.

## Sicherheit und Sorgfalt

- Vor jedem Schreibzugriff auf ein Werbekonto (Meta, Google): Änderung als Vorschau nennen und dann ausführen, ohne Rückfrage, wenn Marc sie beauftragt hat. Von sich aus ändern: nie.
- Fremde Skills werden vor der Installation gelesen: nur MIT/Apache, keine versteckten Server-Einträge (`.mcp.json`), kein Netzwerkzugriff außer zu dokumentierten Schnittstellen.
- Keine privaten Daten (Name, E-Mail, Kunden) in Anfragen an externe Dienste.
- Keine Pull Requests ohne ausdrückliche Bitte.

## Installierte Skills (`.claude/skills/`)

Herkunft, Commit und Lizenz: `.claude/QUELLEN.md`.
- Marketing (coreyhaines31/marketingskills): Copywriting, SEO, CRO, E-Mail, Preise, Positionierung, Tracking u. a.
- Werbung (AgriciDaniel/claude-ads): `ads` als Einstieg, dazu `ads-audit`, `ads-google`, `ads-meta` usw. Hilfs-Agents in `.claude/agents/`.
- Skills laden nur Sitzungen, die in diesem Repo laufen.
