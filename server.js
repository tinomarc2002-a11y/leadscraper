// Leadscraper – lokaler Server. Start: node server.js (oder Doppelklick auf start.bat)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const BRANCHEN = require('./lib/branchen');
const { geocode, sucheUnternehmen } = require('./lib/osm');
const { anreichern } = require('./lib/anreichern');
const { findeWebsite } = require('./lib/websuche');
const { pruefeLeads, freieSuchen } = require('./lib/register');
const { sendeAnSheets } = require('./lib/sheets');
const { anredeFuer } = require('./lib/vornamen');

const PORT = +(process.argv.find((a) => a.startsWith('--port=')) || '').slice(7) || +process.env.PORT || 4310;
const DATA = path.join(__dirname, 'data');
const PUBLIC = path.join(__dirname, 'public');
const PARALLEL = 8;
const RANG = { unbekannt: 0, pruefen: 1, impressum: 2, bestaetigt: 3, register: 4 };
const MA_KLASSEN = ['1–9', '10–49', '50–249', '250+'];
// Was ein protokollierter Kontakt mit dem CRM-Status macht.
const KONTAKT_STATUS = { 'Nicht erreicht': 'Nicht erreicht', 'Erreicht – Rückruf vereinbart': 'Kontaktiert', 'Erreicht – Termin vereinbart': 'Termin', 'Erreicht – kein Interesse': 'Kein Interesse', 'E-Mail gesendet': 'Kontaktiert', 'Angebot gesendet': 'Angebot' };

fs.mkdirSync(DATA, { recursive: true });
const lese = (datei, standard) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, datei), 'utf8')); } catch { return standard; } };
const schreibe = (datei, daten) => fs.writeFileSync(path.join(DATA, datei), JSON.stringify(daten, null, 1));

let crm = lese('crm.json', []);
let einstellungen = lese('einstellungen.json', { sheetsUrl: '' });
let job = lese('letzte-suche.json', null);
if (job) job.fertig = true;

// Leads aus älteren Versionen kennen nur „inhaber“ und „weitere“ als Text – daraus die Personenliste nachbilden.
function ergaenzePersonen(l) {
  if (l.personen?.length || !l.inhaber) return;
  const zerlege = (name) => { const t = name.replace(/\b(Prof|Dr)\.\s*/g, '').trim().split(/\s+/); return { vorname: t[0] || '', nachname: t[t.length - 1] || '' }; };
  l.personen = [l.inhaber, ...String(l.weitere || '').split(', ').filter(Boolean)].map((name, i) => {
    const { vorname, nachname } = zerlege(name);
    return { name, vorname, nachname, rolle: i === 0 ? l.rolle || '' : '', anrede: i === 0 ? l.anrede || '' : anredeFuer(vorname) };
  });
}
crm.forEach(ergaenzePersonen);
job?.leads.forEach(ergaenzePersonen);

let registerLauf = { laeuft: false, gesamt: 0, erledigt: 0, meldung: '', zaehler: {}, abbruch: false };

const mitFrist = (versprechen, ms) => Promise.race([versprechen, new Promise((_, nein) => setTimeout(() => nein(new Error('Zeitüberschreitung')), ms))]);
const hostVon = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const telefonKern = (t) => { const z = String(t || '').replace(/\D/g, '').replace(/^(00)?49/, '').replace(/^0/, ''); return z.length >= 6 ? z : ''; };

// Dubletten-Schutz: dieselbe Firma taucht je nach Suche unter anderer Kennung auf – deshalb auch Website und Telefon vergleichen.
function crmKennungen() {
  const s = new Set();
  for (const l of crm) { s.add('id:' + l.id); if (hostVon(l.website)) s.add('web:' + hostVon(l.website)); if (telefonKern(l.telefon)) s.add('tel:' + telefonKern(l.telefon)); }
  return s;
}
const imCrm = (l, kennungen) => kennungen.has('id:' + l.id) || (hostVon(l.website) && kennungen.has('web:' + hostVon(l.website))) || (telefonKern(l.telefon) && kennungen.has('tel:' + telefonKern(l.telefon)));

async function laufe(j) {
  const p = j.parameter;
  const zentrum = await geocode(p.ort);
  j.zentrum = zentrum.name;
  const branchen = BRANCHEN.filter((b) => p.branchen.includes(b.id));
  const kandidaten = await sucheUnternehmen(branchen, zentrum, p.radiusKm, (m) => (j.meldung = m), () => j.abbruch);
  const minRang = RANG[p.minStatus];
  const kennungen = p.ohneCrm ? crmKennungen() : new Set();
  // Ohne Website lässt sich kein Inhaber prüfen – solche Einträge nur, wenn die Website nachgeschlagen werden soll oder „alle“ gewünscht ist.
  const schlange = kandidaten.filter((k) => (k.website || p.websiteSuchen || minRang === 0) && !imCrm(k, kennungen));
  j.kandidaten = schlange.length;
  j.ohneWebsite = p.websiteSuchen || minRang === 0 ? 0 : kandidaten.filter((k) => !k.website).length;
  j.schonImCrm = kandidaten.filter((k) => imCrm(k, kennungen)).length;
  j.meldung = 'Websites und Impressen werden geprüft …';
  const hosts = new Set(schlange.map((k) => hostVon(k.website)).filter(Boolean));
  let naechster = 0;
  const arbeiter = async () => {
    while (!j.abbruch && j.leads.length < p.anzahl && naechster < schlange.length) {
      const k = schlange[naechster++];
      let lead = null;
      try {
        if (!k.website && p.websiteSuchen) {
          const fund = await mitFrist(findeWebsite(k), 45000).catch(() => '');
          // Führt der Fund zu einer Firma, die schon in der Liste steht, ist es eine weitere Filiale.
          if (fund && !hosts.has(hostVon(fund))) { hosts.add(hostVon(fund)); k.website = fund; k.websiteGefunden = true; j.websitesGefunden++; }
        }
        lead = await mitFrist(anreichern(k), 90000);
      } catch {}
      j.geprueft++;
      if (!lead) { j.aussortiert.fehler++; continue; }
      if (RANG[lead.status] < minRang) { j.aussortiert.sicherheit++; continue; }
      if (!p.maKlassen.includes(lead.maKlasse)) { j.aussortiert.groesse++; continue; }
      if (imCrm(lead, kennungen)) { j.schonImCrm++; continue; }
      if (j.leads.length < p.anzahl) j.leads.push(lead);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, arbeiter));
  j.meldung = j.abbruch ? 'Suche gestoppt.' : j.leads.length >= p.anzahl ? 'Gewünschte Anzahl erreicht.' : 'Alle Unternehmen im Umkreis geprüft.';
}

function starteSuche(roh) {
  const p = {
    ort: String(roh.ort || '').trim().slice(0, 120),
    radiusKm: Math.min(150, Math.max(1, +roh.radiusKm || 25)),
    anzahl: Math.min(1000, Math.max(1, Math.round(+roh.anzahl) || 50)),
    branchen: (Array.isArray(roh.branchen) ? roh.branchen : []).filter((id) => BRANCHEN.some((b) => b.id === id)),
    maKlassen: (Array.isArray(roh.maKlassen) ? roh.maKlassen : MA_KLASSEN).filter((k) => MA_KLASSEN.includes(k)),
    minStatus: roh.minStatus in RANG ? roh.minStatus : 'impressum',
    ohneCrm: roh.ohneCrm !== false,
    websiteSuchen: roh.websiteSuchen === true,
  };
  if (!p.ort) throw new Error('Bitte einen Ort oder eine PLZ eingeben.');
  if (!p.branchen.length) throw new Error('Bitte mindestens eine Branche auswählen.');
  if (!p.maKlassen.length) throw new Error('Bitte mindestens eine Größenklasse auswählen.');
  if (job && !job.fertig) job.abbruch = true;
  const j = { id: Date.now().toString(36), parameter: p, meldung: 'Ort wird gesucht …', zentrum: '', kandidaten: 0, ohneWebsite: 0, schonImCrm: 0, websitesGefunden: 0, geprueft: 0, leads: [], aussortiert: { sicherheit: 0, groesse: 0, fehler: 0 }, fertig: false, fehler: '', abbruch: false, stand: 0 };
  job = j;
  laufe(j)
    .catch((e) => { j.fehler = e.message; j.meldung = ''; })
    .finally(() => { j.fertig = true; if (job === j) schreibe('letzte-suche.json', j); });
  return j;
}

// ───────── Handelsregister-Abgleich ─────────

function starteRegisterpruefung(quelle, ids) {
  if (registerLauf.laeuft) throw new Error('Es läuft bereits ein Registerabgleich.');
  const liste = (quelle === 'crm' ? crm : job?.leads || []).filter((l) => ids.includes(l.id));
  if (!liste.length) throw new Error('Keine Leads zum Prüfen ausgewählt.');
  const lauf = (registerLauf = { laeuft: true, gesamt: liste.length, erledigt: 0, meldung: 'Registerportal wird geöffnet …', zaehler: {}, abbruch: false });
  // Geprüft wird auf Kopien; das Ergebnis geht an alle Stellen, an denen derselbe Lead liegt (Suche und CRM).
  const uebernimm = (ergebnis) => {
    for (const ziel of [crm.find((l) => l.id === ergebnis.id), job?.leads.find((l) => l.id === ergebnis.id)]) {
      if (ziel) for (const feld of ['personen', 'inhaber', 'anrede', 'rolle', 'weitere', 'status', 'firmierung', 'registerGeprueft', 'registerErgebnis', 'registerHinweis']) if (ergebnis[feld] !== undefined) ziel[feld] = ergebnis[feld];
    }
  };
  pruefeLeads(liste.map((l) => structuredClone(l)), (lead, r) => {
    lauf.erledigt++;
    lauf.zaehler[r.ergebnis] = (lauf.zaehler[r.ergebnis] || 0) + 1;
    lauf.meldung = `${lauf.erledigt} von ${lauf.gesamt} geprüft – zuletzt: ${lead.name}`;
    if (r.ergebnis !== 'limit') uebernimm(lead);
  }, () => lauf.abbruch)
    .catch((e) => { lauf.fehler = e.message; })
    .finally(() => {
      lauf.laeuft = false;
      const z = lauf.zaehler;
      const teile = [[(z.bestaetigt || 0), 'bestätigt'], [(z.abweichend || 0), 'korrigiert'], [(z.ergaenzt || 0), 'ergänzt'], [(z.nicht_eingetragen || 0), 'nicht eintragungspflichtig'], [(z.nicht_gefunden || 0), 'nicht gefunden'], [(z.nicht_verfuegbar || 0) + (z.fehler || 0), 'gerade nicht abrufbar']].filter(([n]) => n).map(([n, t]) => `${n} ${t}`);
      lauf.meldung = lauf.fehler ? 'Registerabgleich abgebrochen: ' + lauf.fehler : 'Registerabgleich fertig: ' + (teile.join(', ') || 'nichts geprüft') + (z.limit ? '. Stundenlimit des Portals erreicht – Rest bitte später prüfen.' : '.');
      schreibe('crm.json', crm);
      if (job) { job.stand++; if (job.fertig) schreibe('letzte-suche.json', job); }
    });
  return { gesamt: liste.length, frei: freieSuchen() };
}

// ───────── HTTP ─────────

const TYPEN = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function leseKoerper(req) {
  return new Promise((ja, nein) => {
    let daten = '';
    req.on('data', (s) => { daten += s; if (daten.length > 20e6) { nein(new Error('Anfrage zu groß')); req.destroy(); } });
    req.on('end', () => { try { ja(daten ? JSON.parse(daten) : {}); } catch { nein(new Error('Ungültige Anfrage')); } });
    req.on('error', nein);
  });
}

const crmLead = (id) => { const l = crm.find((c) => c.id === id); if (!l) throw new Error('Lead nicht gefunden'); return l; };

async function api(req, pfad, url) {
  const post = req.method === 'POST';
  const k = post ? await leseKoerper(req) : {};
  if (pfad === '/api/branchen') return BRANCHEN.map(({ id, label, gruppe }) => ({ id, label, gruppe }));
  if (pfad === '/api/suche' && post) return { id: starteSuche(k).id };
  if (pfad === '/api/suche') {
    if (!job) return { leer: true };
    const ab = Math.max(0, +url.searchParams.get('ab') || 0);
    return { ...job, leads: job.leads.slice(ab), gesamt: job.leads.length };
  }
  if (pfad === '/api/suche/stop' && post) { if (job) job.abbruch = true; return { ok: true }; }

  if (pfad === '/api/crm' && post) {
    let neu = 0, vorhanden = 0;
    for (const l of Array.isArray(k.leads) ? k.leads : []) {
      if (!l || !l.id) continue;
      const alt = crm.find((c) => c.id === l.id);
      if (alt) { Object.assign(alt, l, { crmStatus: alt.crmStatus, notiz: alt.notiz, wiedervorlage: alt.wiedervorlage, verlauf: alt.verlauf }); vorhanden++; }
      else if (imCrm(l, crmKennungen())) vorhanden++;
      else { crm.push({ ...l, crmStatus: 'Neu', notiz: '', wiedervorlage: '', verlauf: [] }); neu++; }
    }
    schreibe('crm.json', crm);
    return { neu, vorhanden, gesamt: crm.length };
  }
  if (pfad === '/api/crm') return crm;
  if (pfad === '/api/crm/aendern' && post) {
    const l = crmLead(k.id);
    if (typeof k.crmStatus === 'string') l.crmStatus = k.crmStatus.slice(0, 40);
    if (typeof k.notiz === 'string') l.notiz = k.notiz.slice(0, 2000);
    if (typeof k.wiedervorlage === 'string' && /^(\d{4}-\d{2}-\d{2})?$/.test(k.wiedervorlage)) l.wiedervorlage = k.wiedervorlage;
    // Anderen Geschäftsführer zum Hauptkontakt machen
    if (Number.isInteger(k.hauptkontakt) && l.personen?.[k.hauptkontakt]) {
      const [p] = l.personen.splice(k.hauptkontakt, 1);
      l.personen.unshift(p);
      Object.assign(l, { inhaber: p.name, anrede: p.anrede || '', rolle: p.rolle || '', weitere: l.personen.slice(1).map((x) => x.name).join(', ') });
    }
    schreibe('crm.json', crm);
    return l;
  }
  if (pfad === '/api/crm/kontakt' && post) {
    const l = crmLead(k.id);
    const ergebnis = String(k.ergebnis || 'Notiz').slice(0, 60);
    (l.verlauf ||= []).unshift({ zeit: new Date().toISOString(), ergebnis, notiz: String(k.notiz || '').slice(0, 1000) });
    if (KONTAKT_STATUS[ergebnis]) l.crmStatus = KONTAKT_STATUS[ergebnis];
    if (typeof k.wiedervorlage === 'string' && /^(\d{4}-\d{2}-\d{2})?$/.test(k.wiedervorlage)) l.wiedervorlage = k.wiedervorlage;
    schreibe('crm.json', crm);
    return l;
  }
  if (pfad === '/api/crm/loeschen' && post) {
    const ids = new Set(Array.isArray(k.ids) ? k.ids : []);
    crm = crm.filter((c) => !ids.has(c.id));
    schreibe('crm.json', crm);
    return { gesamt: crm.length };
  }

  if (pfad === '/api/register' && post) return starteRegisterpruefung(k.quelle, Array.isArray(k.ids) ? k.ids : []);
  if (pfad === '/api/register') return { ...registerLauf, frei: freieSuchen() };
  if (pfad === '/api/register/stop' && post) { registerLauf.abbruch = true; return { ok: true }; }

  if (pfad === '/api/einstellungen' && post) {
    einstellungen = { sheetsUrl: String(k.sheetsUrl || '').trim() };
    schreibe('einstellungen.json', einstellungen);
    return einstellungen;
  }
  if (pfad === '/api/einstellungen') return einstellungen;
  if (pfad === '/api/sheets' && post) return sendeAnSheets(einstellungen.sheetsUrl, Array.isArray(k.leads) ? k.leads : []);
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const antworte = (code, daten) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(daten)); };
  // Nur der eigene Browser-Tab darf die Anwendung bedienen, keine fremden Websites.
  const erlaubt = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
  if (!erlaubt.includes(req.headers.host) || (req.headers.origin && !erlaubt.includes(req.headers.origin.replace(/^https?:\/\//, '')))) return antworte(403, { fehler: 'Nicht erlaubt' });
  try {
    if (url.pathname.startsWith('/api/')) {
      const ergebnis = await api(req, url.pathname, url);
      return ergebnis === null ? antworte(404, { fehler: 'Unbekannte Adresse' }) : antworte(200, ergebnis);
    }
    const datei = path.join(PUBLIC, path.normalize(url.pathname === '/' ? 'index.html' : url.pathname));
    if (!datei.startsWith(PUBLIC) || !fs.existsSync(datei) || !fs.statSync(datei).isFile()) { res.writeHead(404); return res.end('Nicht gefunden'); }
    res.writeHead(200, { 'Content-Type': TYPEN[path.extname(datei)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(datei).pipe(res);
  } catch (e) {
    antworte(400, { fehler: e.message });
  }
});

const adresse = `http://localhost:${PORT}`;
const oeffneBrowser = () => { if (process.platform === 'win32' && !process.argv.includes('--kein-browser')) exec(`start "" "${adresse}"`); };
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.log(`Leadscraper läuft bereits: ${adresse}`); oeffneBrowser(); setTimeout(() => process.exit(0), 500); } else throw e;
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Leadscraper läuft: ${adresse}\n  Dieses Fenster offen lassen, solange du die Anwendung nutzt.\n`);
  oeffneBrowser();
});
