// CRM-Logik, unabhängig davon, wo die Daten liegen (lokale Datei oder Vercel-Speicher).
// Alle Funktionen arbeiten auf der übergebenen Lead-Liste.
const { anredeFuer } = require('./vornamen');
const { BUENDEL } = require('./importe');

// Was ein protokollierter Kontakt mit dem CRM-Status macht.
const KONTAKT_STATUS = { 'Nicht erreicht': 'Nicht erreicht', 'Erreicht – Rückruf vereinbart': 'Kontaktiert', 'Erreicht – Termin vereinbart': 'Termin', 'Erreicht – kein Interesse': 'Kein Interesse', 'E-Mail gesendet': 'Kontaktiert', 'Angebot gesendet': 'Angebot' };
const DATUM_RE = /^(\d{4}-\d{2}-\d{2})?$/;
// Werbe-Angaben je Kanal: leer = nicht geprüft, ja = wirbt, frueher = hat früher geworben, nein = nichts gefunden.
const WERBUNG_WERTE = ['', 'ja', 'frueher', 'nein'];
const heuteIso = () => new Date().toISOString().slice(0, 10);
const listenName = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 80);

const hostVon = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const telefonKern = (t) => { const z = String(t || '').replace(/\D/g, '').replace(/^(00)?49/, '').replace(/^0/, ''); return z.length >= 6 ? z : ''; };

// Dubletten-Schutz: dieselbe Firma taucht je nach Suche unter anderer Kennung auf – deshalb auch Website und Telefon vergleichen.
function kennungen(crm) {
  const s = new Set();
  for (const l of crm) { s.add('id:' + l.id); if (hostVon(l.website)) s.add('web:' + hostVon(l.website)); if (telefonKern(l.telefon)) s.add('tel:' + telefonKern(l.telefon)); }
  return s;
}
// Die schon vorhandene Karteikarte zu einem Lead – gleiche Kennung, Website oder Telefonnummer.
function findeDublette(crm, l) {
  const web = hostVon(l.website), tel = telefonKern(l.telefon);
  return crm.find((c) => c.id === l.id || (!!web && hostVon(c.website) === web) || (!!tel && telefonKern(c.telefon) === tel));
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

function hinzufuegen(crm, leads, liste) {
  let neu = 0, vorhanden = 0;
  const wunschliste = listenName(liste);
  for (const l of Array.isArray(leads) ? leads : []) {
    if (!l || !l.id) continue;
    const alt = crm.find((c) => c.id === l.id);
    if (alt) {
      // Eigene Eintragungen im CRM bleiben erhalten, auch die Liste und die von Hand gepflegten Werbe-Angaben.
      const behalten = { crmStatus: alt.crmStatus, notiz: alt.notiz, wiedervorlage: alt.wiedervorlage, verlauf: alt.verlauf };
      for (const f of ['liste', 'werbungGoogle', 'werbungGoogleInfo', 'werbeAnsatz']) if (alt[f] !== undefined) behalten[f] = alt[f];
      Object.assign(alt, l, behalten);
      vorhanden++;
    }
    else if (imCrm(l, kennungen(crm))) vorhanden++;
    else { crm.push({ ...l, liste: listenName(l.liste) || wunschliste, crmStatus: 'Neu', notiz: '', wiedervorlage: '', verlauf: [] }); neu++; }
  }
  return { neu, vorhanden, gesamt: crm.length };
}

// Übernimmt eine vorbereitete Liste. Wiederholbar: Was schon im CRM liegt, wird nicht doppelt angelegt;
// dort werden nur leere Felder (Liste, Werbe-Angaben, Kontaktdaten) aus der Liste ergänzt, nichts Eigenes überschrieben.
const LEER = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
function importiere(crm, id) {
  const bue = BUENDEL.find((b) => b.id === id);
  if (!bue) throw new Error('Diese Liste gibt es nicht.');
  let neu = 0, ergaenzt = 0;
  for (const roh of bue.leads) {
    const l = JSON.parse(JSON.stringify(roh));
    l.liste = bue.name;
    const vorn = String(l.inhaber || '').replace(/^(Prof|Dr)\.?\s+/g, '').split(/\s+/)[0];
    if (!l.anrede) l.anrede = anredeFuer(vorn);
    ergaenzePersonen(l);
    const alt = findeDublette(crm, l);
    l.importe = [bue.id];
    if (!alt) { crm.push({ ...l, crmStatus: 'Neu', notiz: '', wiedervorlage: '', verlauf: [] }); neu++; continue; }
    // Merken, dass dieser Lead zur Liste gehört – auch wenn er schon unter einer anderen Liste im CRM lag.
    alt.importe = [...new Set([...(alt.importe || []), bue.id])];
    let geaendert = false;
    for (const [f, v] of Object.entries(l)) if (f !== 'importe' && LEER(alt[f]) && !LEER(v)) { alt[f] = v; geaendert = true; }
    if (geaendert) ergaenzt++;
  }
  return { neu, ergaenzt, vorhanden: bue.leads.length - neu, gesamt: crm.length, liste: bue.name };
}

// Welche vorbereiteten Listen es gibt und wie viele davon schon im CRM liegen.
function importUebersicht(crm) {
  return BUENDEL.map((b) => ({ id: b.id, name: b.name, beschreibung: b.beschreibung, anzahl: b.leads.length, imCrm: crm.filter((l) => (l.importe || []).includes(b.id)).length }));
}

// Mehrere Leads in eine Liste verschieben (leerer Name = aus jeder Liste nehmen).
function verschiebe(crm, k) {
  const ids = new Set(Array.isArray(k.ids) ? k.ids : []);
  const liste = listenName(k.liste);
  let n = 0;
  for (const l of crm) if (ids.has(l.id)) { l.liste = liste; n++; }
  return { verschoben: n, liste };
}

function aendern(crm, k) {
  const l = finde(crm, k.id);
  if (typeof k.crmStatus === 'string') l.crmStatus = k.crmStatus.slice(0, 40);
  if (typeof k.notiz === 'string') l.notiz = k.notiz.slice(0, 2000);
  if (typeof k.wiedervorlage === 'string' && DATUM_RE.test(k.wiedervorlage)) l.wiedervorlage = k.wiedervorlage;
  if (typeof k.liste === 'string') l.liste = listenName(k.liste);
  if (typeof k.werbeAnsatz === 'string') l.werbeAnsatz = k.werbeAnsatz.slice(0, 600);
  // Werbe-Angaben von Hand: Der Kanal bekommt den Vermerk „von Hand“ mit Datum, damit man ihn von automatisch Geprüftem unterscheiden kann.
  for (const [feld, info] of [['werbungGoogle', 'werbungGoogleInfo'], ['werbungMeta', 'werbungMetaInfo']]) {
    if (typeof k[feld] !== 'string') continue;
    if (!WERBUNG_WERTE.includes(k[feld])) throw new Error('Ungültiger Werbe-Status.');
    l[feld] = k[feld];
    l[info] = { ...(l[info] || {}), geprueftAm: heuteIso(), quelle: 'von Hand eingetragen' };
  }
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
  if (pfad === '/api/crm/importe' && !post) return { antwort: importUebersicht(crm), crm };
  if (!post) return null;
  if (pfad === '/api/crm') return { antwort: hinzufuegen(crm, k.leads, k.liste), crm, geaendert: true };
  if (pfad === '/api/crm/import') return { antwort: importiere(crm, String(k.id || '')), crm, geaendert: true };
  if (pfad === '/api/crm/liste') return { antwort: verschiebe(crm, k), crm, geaendert: true };
  if (pfad === '/api/crm/aendern') return { antwort: aendern(crm, k), crm, geaendert: true };
  if (pfad === '/api/crm/kontakt') return { antwort: kontakt(crm, k), crm, geaendert: true };
  if (pfad === '/api/crm/loeschen') {
    const ids = new Set(Array.isArray(k.ids) ? k.ids : []);
    const rest = crm.filter((c) => !ids.has(c.id));
    return { antwort: { gesamt: rest.length }, crm: rest, geaendert: true };
  }
  return null;
}

module.exports = { behandle, kennungen, imCrm, ergaenzePersonen, hostVon, hinzufuegen, importiere, importUebersicht, verschiebe, aendern, WERBUNG_WERTE };
