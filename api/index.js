// Leadscraper auf Vercel. Dort gibt es keinen dauerhaft laufenden Server: jede Anfrage startet diese Funktion neu.
// Deshalb steuert der Browser die Suche in Etappen (/api/kandidaten, dann /api/pruefen in kleinen Paketen),
// und CRM sowie Einstellungen liegen im privaten Vercel-Speicher. Ist LEADSCRAPER_PASSWORT gesetzt, braucht jede Anfrage dieses Passwort.
const crypto = require('crypto');
const BRANCHEN = require('../lib/branchen');
const { geocode, sucheUnternehmen } = require('../lib/osm');
const { sendeAnSheets } = require('../lib/sheets');
const CRM = require('../lib/crm');
const speicher = require('../lib/speicher');
const { leseParameter, waehleKandidaten, pruefeKandidat } = require('../lib/suchlauf');

const MAX_JE_PAKET = 10;
const MAX_BRANCHEN_JE_ABRUF = 3;

function passwortStimmt(req) {
  const soll = process.env.LEADSCRAPER_PASSWORT;
  // Ohne gesetztes Passwort ist die Anwendung offen: jeder mit dem Link kann suchen und das CRM sehen.
  // Zum Schützen in Vercel die Umgebungsvariable LEADSCRAPER_PASSWORT setzen und neu deployen.
  if (!soll) return true;
  const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
  let eingabe = '';
  try { eingabe = decodeURIComponent(req.headers['x-leadscraper-passwort'] || ''); } catch {}
  return crypto.timingSafeEqual(hash(eingabe), hash(soll));
}

async function api(pfad, post, k) {
  if (pfad === '/api/modus') return { modus: 'cloud', register: false, passwort: !!process.env.LEADSCRAPER_PASSWORT };
  if (pfad === '/api/branchen') return BRANCHEN.map(({ id, label, gruppe }) => ({ id, label, gruppe }));

  // Etappe 1: Unternehmen im Umkreis sammeln – höchstens drei Branchen je Abruf, damit die Laufzeitgrenze sicher hält.
  if (pfad === '/api/kandidaten' && post) {
    const p = leseParameter(k.parameter || {});
    const ids = (Array.isArray(k.branchen) ? k.branchen : p.branchen).slice(0, MAX_BRANCHEN_JE_ABRUF);
    const zentrum = k.zentrum && Number.isFinite(+k.zentrum.lat) && Number.isFinite(+k.zentrum.lon) ? { lat: +k.zentrum.lat, lon: +k.zentrum.lon, name: String(k.zentrum.name || '') } : await geocode(p.ort);
    const kandidaten = await sucheUnternehmen(BRANCHEN.filter((b) => ids.includes(b.id)), zentrum, p.radiusKm);
    const kennungen = p.ohneCrm ? CRM.kennungen(await speicher.lese('crm', [])) : new Set();
    return { zentrum, ...waehleKandidaten(kandidaten, p, kennungen) };
  }

  // Etappe 2: ein Paket Kandidaten prüfen (Website laden, Impressum auswerten, Filter anwenden).
  if (pfad === '/api/pruefen' && post) {
    const p = leseParameter(k.parameter || {});
    const paket = (Array.isArray(k.kandidaten) ? k.kandidaten : []).slice(0, MAX_JE_PAKET).filter((c) => c && c.id && c.name);
    const kennungen = p.ohneCrm ? CRM.kennungen(await speicher.lese('crm', [])) : new Set();
    return { ergebnisse: await Promise.all(paket.map((c) => pruefeKandidat(c, p, kennungen))) };
  }

  if (pfad.startsWith('/api/crm')) {
    const r = CRM.behandle(pfad, post, k, await speicher.lese('crm', []));
    if (!r) return null;
    if (r.geaendert) await speicher.schreibe('crm', r.crm);
    return r.antwort;
  }

  if (pfad === '/api/einstellungen' && post) {
    const einstellungen = { sheetsUrl: String(k.sheetsUrl || '').trim() };
    await speicher.schreibe('einstellungen', einstellungen);
    return einstellungen;
  }
  if (pfad === '/api/einstellungen') return speicher.lese('einstellungen', { sheetsUrl: '' });
  if (pfad === '/api/sheets' && post) return sendeAnSheets((await speicher.lese('einstellungen', {})).sheetsUrl, Array.isArray(k.leads) ? k.leads : []);
  if (pfad.startsWith('/api/register')) throw new Error('Der Handelsregister-Abgleich läuft nur in der lokalen Version (er braucht einen Browser auf dem eigenen PC).');
  return null;
}

module.exports = async (req, res) => {
  const antworte = (code, daten) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(daten)); };
  if (!passwortStimmt(req)) return antworte(401, { fehler: 'Bitte anmelden.' });
  try {
    // vercel.json leitet /api/<pfad> hierher und reicht den Pfad als Parameter durch.
    const pfad = '/api/' + String(req.query?.pfad || '').replace(/^\/+|\/+$/g, '');
    const post = req.method === 'POST';
    const ergebnis = await api(pfad, post, post && req.body && typeof req.body === 'object' ? req.body : {});
    return ergebnis === null ? antworte(404, { fehler: 'Unbekannte Adresse' }) : antworte(200, ergebnis);
  } catch (e) {
    antworte(400, { fehler: e.message });
  }
};
