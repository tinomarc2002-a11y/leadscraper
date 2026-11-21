# Lead-Benachrichtigung (Standard für alle Kampagnen)

Gilt für eigene Kampagnen, Kundenkampagnen (z. B. Körperformen Wunstorf, Andretzki) und Recruiting-Kampagnen.

## Inhalt der Mail (nur Fakten)
- Datum und Uhrzeit des Leads
- Name, Firma (falls abgefragt)
- Alle Antworten aus dem Formular, jeweils mit Symbol (Zeitrahmen, Budget, Wirbt bereits, sonst Fragezeichen-Symbol)
- Telefon und E-Mail
- Drei Symbol-Buttons nebeneinander: Anrufen, WhatsApp, E-Mail (ohne Text)
- Nicht enthalten: Anzeige, Kampagne, Formular, Plattform. Das sieht Marc im Werbekonto / Leads-Center.

## Technik
- `workflow/workflow.ts` und `workflow/lib/mail.ts`: Zapier-Durable-Workflow. Trigger: Facebook Lead Ads (Seite und Formular pro Kampagne).
- Felder werden generisch erkannt (Name, Firma, Telefon, E-Mail, Rest = Antworten). Keine Anpassung pro Formular nötig.
- Schritt 1: Mail über Gmail (`EMPFAENGER`, `ABSENDER_NAME` oben in `workflow.ts`).
- Schritt 2: Zeile in Google Sheet (Spalten A bis K: Datum, Uhrzeit, Name, Firma, Telefon, E-Mail, Zeitrahmen, Budget, Wirbt bereits, Status, Notiz). Telefon mit führendem Apostroph, sonst verliert Sheets das "+".
- Symbole: `icons-site/i/*.png`, öffentlich unter https://mmm-mail-icons.vercel.app/i/ (Vercel-Projekt `mmm-mail-icons`, Deployment per Datei-Upload; Git-Deployments lieferten hier 404). Gmail zeigt kein SVG und keine data-URIs.
- Beim Update eines Zapier-Entwurfs immer alle Dateien (`workflow.ts` und `lib/mail.ts`) mitsenden, sonst fehlt das Modul.
- Telefonnummern und Zeilen mit Testdaten nach dem Test aus dem Sheet löschen.

## Neue Kampagne einrichten
1. Neuen Workflow aus dieser Vorlage anlegen, Trigger auf Seite und Formular der Kampagne setzen.
2. `EMPFAENGER` und `SHEET_ID` setzen (pro Kunde ein eigenes Sheet "Stand jetzt" mit gleichen Spalten und Status-Dropdown).
3. Draft-Testlauf mit Beispieldaten, Mail und Sheet-Zeile prüfen, Testzeile löschen, veröffentlichen, prüfen dass der Trigger "active" ist.
4. Mail an Dritte (Kunde als Empfänger) nur nach Freigabe durch Marc.
