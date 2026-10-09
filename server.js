// Leadscraper – lokaler Server. Start: node server.js (oder Doppelklick auf start.bat)
// (Die Online-Variante auf Vercel nutzt stattdessen api/index.js mit denselben Modulen aus lib/.)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const BRANCHEN = require('./lib/branchen');
const { geocode, sucheUnternehmen } = require('./lib/osm');
const { pruefeLeads, freieSuchen } = require('./lib/register');
const { sendeAnSheets } = require('./lib/sheets');
const CRM = require('./lib/crm');
const { MITTE, bedarfFuer, leseParameter, branchenFuer, waehleKandidaten, pruefeKandidat, ausschlussgrund } = require('./lib/suchlauf');
const Internet = require('./lib/internet');

// Websites laden und auswerten übernehmen Hilfsprozesse – ein Absturz dort reißt den Server nicht mit (siehe lib/werkzeug.js).
require('./lib/werkzeug').nutzeHilfsprozesse();

const PORT = +(process.argv.find((a) => a.startsWith('--port=')) || '').slice(7) || +process.env.PORT || 4310;
const DATA = path.join(__dirname, 'data');
const PUBLIC = path.join(__dirname, 'public');
const PARALLEL = 16; // gleichzeitig geprüfte Unternehmen (jedes auf einer anderen Website)

fs.mkdirSync(DATA, { recursive: true });
const lese = (datei, standard) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, datei), 'utf8')); } catch { return standard; } };
const schreibe = (datei, daten) => fs.writeFileSync(path.join(DATA, datei), JSON.stringify(daten, null, 1));

let crm = lese('crm.json', []);
let einstellungen = lese('einstellungen.json', { sheetsUrl: '' });
let job = lese('letzte-suche.json', null);
// Stand die letzte Suche beim Beenden noch mitten im Lauf (Fenster geschlossen, Absturz), bleiben ihre Treffer erhalten.
if (job && !job.fertig) Object.assign(job, { fertig: true, meldung: 'Die Suche wurde unterbrochen – die bis dahin gefundenen Leads sind erhalten.' });
crm.forEach(CRM.ergaenzePersonen);
job?.leads.forEach(CRM.ergaenzePersonen);

let registerLauf = { laeuft: false, gesamt: 0, erledigt: 0, meldung: '', zaehler: {}, abbruch: false };

async function laufe(j) {
  const p = j.parameter;
  const zentrum = p.ort ? await geocode(p.ort) : MITTE;
  j.zentrum = zentrum.name;
  const branchen = branchenFuer(p.branchen, p.stichworte);
  const kennungen = p.ohneCrm ? CRM.kennungen(crm) : new Set();
  const erledigt = new Set(), hosts = new Set();
  let ausgeschoepft = false;
  // Durchgänge: erst so viele Unternehmen sammeln, wie voraussichtlich nötig sind, und prüfen. Reicht das nicht für die
  // gewünschte Lead-Zahl (strenge Filter, viele ohne Impressum), wird die dreifache Menge geholt – bis zum Rand des Umkreises.
  for (let bedarf = bedarfFuer(p, crm.length); ; bedarf *= 3) {
    const kandidaten = await sucheUnternehmen(branchen, zentrum, p.deutschland ? 0 : p.radiusKm, (m) => (j.meldung = m), () => j.abbruch, bedarf);
    const { schlange, ohneWebsite, schonImCrm } = waehleKandidaten(kandidaten, p, kennungen);
    const neu = schlange.filter((k) => !erledigt.has(k.id));
    neu.forEach((k) => { erledigt.add(k.id); if (k.website) hosts.add(CRM.hostVon(k.website)); });
    Object.assign(j, { kandidaten: erledigt.size, ohneWebsite, schonImCrm: schonImCrm + j.imCrmNachPruefung, meldung: 'Websites und Impressen werden geprüft …' });
    let naechster = 0;
    const arbeiter = async () => {
      while (!j.abbruch && j.leads.length < p.anzahl && naechster < neu.length) {
        const r = await pruefeKandidat(neu[naechster++], p, kennungen, hosts);
        j.geprueft++;
        if (r.websiteGefunden) j.websitesGefunden++;
        if (r.grund === 'crm') { j.schonImCrm++; j.imCrmNachPruefung++; }
        else if (r.grund) j.aussortiert[r.grund]++;
        else if (j.leads.length < p.anzahl) j.leads.push(r.lead);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, arbeiter));
    ausgeschoepft = kandidaten.vollstaendig || !neu.length;
    if (j.abbruch || j.leads.length >= p.anzahl || ausgeschoepft) break;
    j.meldung = 'Noch nicht genug Treffer – es werden weitere Unternehmen gesammelt …';
  }
  // Reicht die Karte nicht: weiter über die Liste aller .de-Adressen, die ein Branchenwort tragen. Bei sehr breiter
  // Auswahl wären das Hunderttausende Adressen – dort bleibt es bei der Karte.
  if (!j.abbruch && j.leads.length < p.anzahl && p.internet && branchen.length <= 30 && Internet.status().vorhanden) {
    const stand = j.geprueft;
    const r = await Internet.suche({
      branchen, zentrum, radiusKm: p.deutschland ? 0 : p.radiusKm, ortName: p.ort, bekannteHosts: hosts,
      melde: (m) => { j.meldung = m; },
      weiter: () => !j.abbruch && j.leads.length < p.anzahl,
      nimm: (lead) => {
        // Manche Firmen haben mehrere Adressen (Website und Shop) – jede Firma nur einmal aufnehmen.
        // Dasselbe gilt für mehrere Seiten derselben Person am selben Ort.
        const firma = (l) => (l.firmierung ? l.firmierung.toLowerCase() + '|' + l.plz : '');
        const person = (l) => (l.inhaber && l.plz ? l.inhaber.toLowerCase() + '|' + l.plz : '');
        if (CRM.imCrm(lead, CRM.kennungen(j.leads)) || j.leads.some((l) => (firma(lead) && firma(l) === firma(lead)) || (person(lead) && person(l) === person(lead)))) return;
        const grund = ausschlussgrund(lead, p, kennungen);
        if (grund === 'crm') j.schonImCrm++;
        else if (grund) j.aussortiert[grund]++;
        else if (j.leads.length < p.anzahl) { j.leads.push(lead); j.ausInternet++; }
      },
    });
    j.geprueft = stand + r.erledigt;
    j.kandidaten += r.gesamt;
    ausgeschoepft = r.ausgeschoepft;
  }
  j.meldung = j.abbruch ? 'Suche gestoppt.' : j.leads.length >= p.anzahl ? 'Gewünschte Anzahl erreicht.' : p.deutschland ? 'Alle erreichbaren Unternehmen geprüft.' : 'Alle Unternehmen im Umkreis geprüft.';
}

function starteSuche(roh) {
  const p = leseParameter(roh);
  if (job && !job.fertig) job.abbruch = true;
  const j = { id: Date.now().toString(36), parameter: p, meldung: 'Ort wird gesucht …', zentrum: '', kandidaten: 0, ohneWebsite: 0, schonImCrm: 0, websitesGefunden: 0, geprueft: 0, imCrmNachPruefung: 0, ausInternet: 0, leads: [], aussortiert: { sicherheit: 0, groesse: 0, fehler: 0, filter: 0 }, fertig: false, fehler: '', abbruch: false, stand: 0 };
  job = j;
  // Zwischenstand alle paar Sekunden sichern, damit bei einem Abbruch nichts verloren geht.
  const sicherung = setInterval(() => { if (job === j) schreibe('letzte-suche.json', j); }, 8000);
  laufe(j)
    .catch((e) => { j.fehler = e.message; j.meldung = ''; })
    .finally(() => { clearInterval(sicherung); j.fertig = true; if (job === j) schreibe('letzte-suche.json', j); });
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

async function api(req, pfad, url) {
  const post = req.method === 'POST';
  const k = post ? await leseKoerper(req) : {};
  if (pfad === '/api/modus') return { modus: 'lokal', register: true, internet: true };
  if (pfad === '/api/internet' && post) { Internet.richteEin(); return Internet.status(); }
  if (pfad === '/api/internet') return Internet.status();
  if (pfad === '/api/branchen') return BRANCHEN.map(({ id, label, gruppe, gruppeLabel, suche }) => ({ id, label, gruppe, gruppeLabel, suche }));
  if (pfad === '/api/suche' && post) return { id: starteSuche(k).id };
  if (pfad === '/api/suche') {
    if (!job) return { leer: true };
    const ab = Math.max(0, +url.searchParams.get('ab') || 0);
    return { ...job, leads: job.leads.slice(ab), gesamt: job.leads.length };
  }
  if (pfad === '/api/suche/stop' && post) { if (job) job.abbruch = true; return { ok: true }; }

  const crmErgebnis = CRM.behandle(pfad, post, k, crm);
  if (crmErgebnis) {
    crm = crmErgebnis.crm;
    if (crmErgebnis.geaendert) schreibe('crm.json', crm);
    return crmErgebnis.antwort;
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
