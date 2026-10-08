// Spalten für CSV, Zwischenablage und Google Sheets – wird von Browser und Server gemeinsam benutzt.
const STATUS_TEXT = { register: 'Im Handelsregister bestätigt', bestaetigt: 'Doppelt bestätigt', impressum: 'Laut Impressum', pruefen: 'Bitte prüfen', unbekannt: 'Nicht gefunden' };

// Weitere Geschäftsführer/Inhaber als „Frau Erika Muster (Geschäftsführer)“
const person = (nr) => (l) => {
  const p = (l.personen || [])[nr];
  return p ? [p.anrede, p.name].filter(Boolean).join(' ') + (p.rolle ? ' (' + p.rolle + ')' : '') : '';
};
const letzterKontakt = (l) => { const v = (l.verlauf || [])[0]; return v ? v.zeit.slice(0, 10) + ' ' + v.ergebnis : ''; };
const verlauf = (l) => (l.verlauf || []).map((v) => v.zeit.slice(0, 10) + ' ' + v.ergebnis + (v.notiz ? ': ' + v.notiz : '')).join(' | ');

const SPALTEN = [
  ['ID', (l) => l.id],
  ['Unternehmen', (l) => l.name],
  ['Branche', (l) => l.branche],
  ['Tätigkeit', (l) => l.beschreibung],
  ['Inhaber', (l) => l.inhaber],
  ['Anrede', (l) => l.anrede],
  ['Rolle', (l) => l.rolle],
  ['Inhaber-Sicherheit', (l) => STATUS_TEXT[l.status] || ''],
  ['Registerprüfung', (l) => l.registerHinweis],
  ['Inhaber 2', person(1)],
  ['Inhaber 3', person(2)],
  ['Inhaber 4', person(3)],
  ['Rechtsform', (l) => l.rechtsform],
  ['Firmierung', (l) => l.firmierung],
  ['Register', (l) => l.register],
  ['Telefon', (l) => l.telefon],
  ['E-Mail', (l) => l.email],
  ['Straße', (l) => l.strasse],
  ['PLZ', (l) => l.plz],
  ['Ort', (l) => l.ort],
  ['Entfernung (km)', (l) => l.entfernungKm],
  ['Mitarbeiter (geschätzt)', (l) => l.maZahl],
  ['Größenklasse', (l) => l.maKlasse],
  ['Grundlage Schätzung', (l) => l.maQuelle],
  ['Website', (l) => l.website],
  ['Impressum', (l) => l.impressumUrl],
  ['Hinweise', (l) => l.hinweise],
  ['CRM-Status', (l) => l.crmStatus],
  ['Wiedervorlage', (l) => l.wiedervorlage],
  ['Letzter Kontakt', letzterKontakt],
  ['Kontaktverlauf', verlauf],
  ['Notiz', (l) => l.notiz],
  ['Erfasst am', (l) => l.erfasstAm],
];

const zeileAus = (lead) => SPALTEN.map(([, hole]) => { const w = hole(lead); return w == null ? '' : String(w); });

if (typeof module !== 'undefined') module.exports = { SPALTEN, STATUS_TEXT, zeileAus };
