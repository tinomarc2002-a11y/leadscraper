// Spalten für CSV, Zwischenablage und Google Sheets sowie die Einteilung der Rechtsformen –
// wird von Browser und Server gemeinsam benutzt.
const STATUS_TEXT = { register: 'Im Handelsregister bestätigt', bestaetigt: 'Doppelt bestätigt', impressum: 'Laut Impressum', pruefen: 'Bitte prüfen', unbekannt: 'Nicht gefunden' };

// Rechtsformen, nach denen sich filtern lässt. Wer im Impressum keinen Rechtsformzusatz führt,
// ist in aller Regel Einzelunternehmer oder Freiberufler.
const RECHTSFORM_GRUPPEN = [
  ['gmbh', 'GmbH'], ['ug', 'UG'], ['gmbhco', 'GmbH & Co. KG'], ['ag', 'AG / SE'], ['ek', 'e.K.'],
  ['personen', 'GbR, OHG, KG, PartG'], ['einzel', 'Einzelunternehmen / Freiberufler'], ['verein', 'Verein, gGmbH, Genossenschaft'], ['sonst', 'Sonstige'],
];
function rechtsformGruppe(rechtsform) {
  const rf = rechtsform || '';
  if (/GmbH & Co|UG.*Co/.test(rf)) return 'gmbhco';
  if (/^(gGmbH|e\.V\.|eG)$/.test(rf)) return 'verein';
  if (/GmbH|mbH/.test(rf)) return 'gmbh';
  if (rf === 'UG') return 'ug';
  if (/^(AG|SE|KGaA)$/.test(rf)) return 'ag';
  if (rf === 'e.K.') return 'ek';
  if (/^(GbR|OHG|KG|PartG)$/.test(rf)) return 'personen';
  if (!rf || rf === 'Einzelunternehmen') return 'einzel';
  return 'sonst';
}

// Der Ansprechpartner (erste Person) in seinen Bestandteilen. Ältere Leads kennen nur den vollen Namen.
const TITEL_RE = /^(?:(?:Prof|Dr|Dipl|Ing|med|dent|jur|rer|nat|h\.\s?c|mult)\.?[-\s]*|\(FH\)\s*)+/i;
function ansprechpartner(l) {
  const p = (l.personen || [])[0] || {};
  const voll = String(p.name || l.inhaber || '').trim();
  const titel = (voll.match(TITEL_RE) || [''])[0].trim();
  const teile = voll.replace(TITEL_RE, '').trim().split(/\s+/).filter(Boolean);
  // Namenszusätze gehören zum Nachnamen („von der Heide“)
  let schnitt = Math.max(1, teile.length - 1);
  while (schnitt > 1 && /^(von|van|de|der|den|zu|zur|vom|del|della|di|el|al)$/i.test(teile[schnitt - 1])) schnitt--;
  return { titel, vorname: teile.length > 1 ? teile.slice(0, schnitt).join(' ') : p.vorname || '', nachname: teile.length > 1 ? teile.slice(schnitt).join(' ') : p.nachname || teile[0] || '' };
}
// Alle weiteren Geschäftsführer/Inhaber in einer Spalte: „Frau Erika Muster (Geschäftsführerin); Herr …“
const weiterePersonen = (l) => (l.personen || []).slice(1).map((p) => [p.anrede, p.name].filter(Boolean).join(' ') + (p.rolle ? ' (' + p.rolle + ')' : '')).join('; ') || l.weitere || '';
const letzterKontakt = (l) => { const v = (l.verlauf || [])[0]; return v ? v.zeit.slice(0, 10) + ' ' + v.ergebnis : ''; };

// Reihenfolge wie man sie zum Arbeiten braucht: Firma → Ansprechpartner → Kontakt → Adresse → Hintergrund → eigene Notizen.
// Die ID steht nur für Google Sheets vorn (daran erkennt die Tabelle schon vorhandene Leads); CSV und Kopieren lassen sie weg.
const SPALTEN = [
  ['ID', (l) => l.id],
  ['Unternehmen', (l) => l.firmierung || l.name],
  ['Branche', (l) => l.branche],
  ['Anrede', (l) => l.anrede],
  ['Titel', (l) => ansprechpartner(l).titel],
  ['Vorname', (l) => ansprechpartner(l).vorname],
  ['Nachname', (l) => ansprechpartner(l).nachname],
  ['Position', (l) => l.rolle],
  ['Telefon', (l) => l.telefon],
  ['E-Mail', (l) => l.email],
  ['Website', (l) => l.website],
  ['Straße', (l) => l.strasse],
  ['PLZ', (l) => l.plz],
  ['Ort', (l) => l.ort],
  ['Rechtsform', (l) => l.rechtsform || (l.inhaber ? 'Einzelunternehmen' : '')],
  ['Mitarbeiter (geschätzt)', (l) => l.maZahl || ''],
  ['Was die Firma macht', (l) => l.beschreibung],
  ['Inhaber geprüft', (l) => STATUS_TEXT[l.status] || ''],
  ['Meta-Werbung', (l) => ({ ja: 'Ja', nein: 'Nicht gefunden' }[l.werbungMeta] || '')],
  ['Meta-Anzeigen', (l) => l.werbungMetaInfo?.link || ''],
  ['Weitere Geschäftsführer', weiterePersonen],
  ['Stellenseite', (l) => l.karriereUrl],
  ['Impressum', (l) => l.impressumUrl],
  ['Status', (l) => l.crmStatus],
  ['Wiedervorlage', (l) => l.wiedervorlage],
  ['Letzter Kontakt', letzterKontakt],
  ['Notiz', (l) => l.notiz],
  ['Erfasst am', (l) => l.erfasstAm],
];

const zeileAus = (lead) => SPALTEN.map(([, hole]) => { const w = hole(lead); return w == null ? '' : String(w); });
// Für CSV und Zwischenablage: ohne die technische ID
const EXPORT_KOPF = SPALTEN.slice(1).map((s) => s[0]);
const exportZeile = (lead) => zeileAus(lead).slice(1);

if (typeof module !== 'undefined') module.exports = { SPALTEN, STATUS_TEXT, RECHTSFORM_GRUPPEN, rechtsformGruppe, zeileAus };
