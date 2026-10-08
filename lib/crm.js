// CRM-Logik, unabhängig davon, wo die Daten liegen (lokale Datei oder Vercel-Speicher).
// Alle Funktionen arbeiten auf der übergebenen Lead-Liste.
const { anredeFuer } = require('./vornamen');

// Was ein protokollierter Kontakt mit dem CRM-Status macht.
const KONTAKT_STATUS = { 'Nicht erreicht': 'Nicht erreicht', 'Erreicht – Rückruf vereinbart': 'Kontaktiert', 'Erreicht – Termin vereinbart': 'Termin', 'Erreicht – kein Interesse': 'Kein Interesse', 'E-Mail gesendet': 'Kontaktiert', 'Angebot gesendet': 'Angebot' };
const DATUM_RE = /^(\d{4}-\d{2}-\d{2})?$/;

const hostVon = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const telefonKern = (t) => { const z = String(t || '').replace(/\D/g, '').replace(/^(00)?49/, '').replace(/^0/, ''); return z.length >= 6 ? z : ''; };

// Dubletten-Schutz: dieselbe Firma taucht je nach Suche unter anderer Kennung auf – deshalb auch Website und Telefon vergleichen.
function kennungen(crm) {
  const s = new Set();
  for (const l of crm) { s.add('id:' + l.id); if (hostVon(l.website)) s.add('web:' + hostVon(l.website)); if (telefonKern(l.telefon)) s.add('tel:' + telefonKern(l.telefon)); }
  return s;
}
const imCrm = (l, k) => k.has('id:' + l.id) || (!!hostVon(l.website) && k.has('web:' + hostVon(l.website))) || (!!telefonKern(l.telefon) && k.has('tel:' + telefonKern(l.telefon)));

// Leads aus älteren Versionen kennen nur „inhaber“ und „weitere“ als Text – daraus die Personenliste nachbilden.
function ergaenzePersonen(l) {
  if (l.personen?.length || !l.inhaber) return;
  const zerlege = (name) => { const t = name.replace(/\b(Prof|Dr)\.\s*/g, '').trim().split(/\s+/); return { vorname: t[0] || '', nachname: t[t.length - 1] || '' }; };
  l.personen = [l.inhaber, ...String(l.weitere || '').split(', ').filter(Boolean)].map((name, i) => {
    const { vorname, nachname } = zerlege(name);
    return { name, vorname, nachname, rolle: i === 0 ? l.rolle || '' : '', anrede: i === 0 ? l.anrede || '' : anredeFuer(vorname) };
  });
}

function finde(crm, id) {
  const l = crm.find((c) => c.id === id);
  if (!l) throw new Error('Lead nicht gefunden');
  return l;
}

function hinzufuegen(crm, leads) {
  let neu = 0, vorhanden = 0;
  for (const l of Array.isArray(leads) ? leads : []) {
    if (!l || !l.id) continue;
    const alt = crm.find((c) => c.id === l.id);
    if (alt) { Object.assign(alt, l, { crmStatus: alt.crmStatus, notiz: alt.notiz, wiedervorlage: alt.wiedervorlage, verlauf: alt.verlauf }); vorhanden++; }
    else if (imCrm(l, kennungen(crm))) vorhanden++;
    else { crm.push({ ...l, crmStatus: 'Neu', notiz: '', wiedervorlage: '', verlauf: [] }); neu++; }
  }
  return { neu, vorhanden, gesamt: crm.length };
}

function aendern(crm, k) {
  const l = finde(crm, k.id);
  if (typeof k.crmStatus === 'string') l.crmStatus = k.crmStatus.slice(0, 40);
  if (typeof k.notiz === 'string') l.notiz = k.notiz.slice(0, 2000);
  if (typeof k.wiedervorlage === 'string' && DATUM_RE.test(k.wiedervorlage)) l.wiedervorlage = k.wiedervorlage;
  // Anderen Geschäftsführer zum Hauptkontakt machen
  if (Number.isInteger(k.hauptkontakt) && l.personen?.[k.hauptkontakt]) {
    const [p] = l.personen.splice(k.hauptkontakt, 1);
    l.personen.unshift(p);
    Object.assign(l, { inhaber: p.name, anrede: p.anrede || '', rolle: p.rolle || '', weitere: l.personen.slice(1).map((x) => x.name).join(', ') });
  }
  return l;
}

function kontakt(crm, k) {
  const l = finde(crm, k.id);
  const ergebnis = String(k.ergebnis || 'Notiz').slice(0, 60);
  (l.verlauf ||= []).unshift({ zeit: new Date().toISOString(), ergebnis, notiz: String(k.notiz || '').slice(0, 1000) });
  if (KONTAKT_STATUS[ergebnis]) l.crmStatus = KONTAKT_STATUS[ergebnis];
  if (typeof k.wiedervorlage === 'string' && DATUM_RE.test(k.wiedervorlage)) l.wiedervorlage = k.wiedervorlage;
  return l;
}

// Bearbeitet eine CRM-Anfrage. Liefert null, wenn der Pfad nicht zum CRM gehört,
// sonst { antwort, crm, geaendert } – der Aufrufer speichert, wenn geaendert gesetzt ist.
function behandle(pfad, post, k, crm) {
  if (pfad === '/api/crm' && !post) return { antwort: crm, crm };
  if (!post) return null;
  if (pfad === '/api/crm') return { antwort: hinzufuegen(crm, k.leads), crm, geaendert: true };
  if (pfad === '/api/crm/aendern') return { antwort: aendern(crm, k), crm, geaendert: true };
  if (pfad === '/api/crm/kontakt') return { antwort: kontakt(crm, k), crm, geaendert: true };
  if (pfad === '/api/crm/loeschen') {
    const ids = new Set(Array.isArray(k.ids) ? k.ids : []);
    const rest = crm.filter((c) => !ids.has(c.id));
    return { antwort: { gesamt: rest.length }, crm: rest, geaendert: true };
  }
  return null;
}

module.exports = { behandle, kennungen, imCrm, ergaenzePersonen, hostVon };
