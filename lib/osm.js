// Firmensuche über OpenStreetMap-Daten, ohne kostenpflichtige Schnittstellen:
//   1. Nominatim: Ort → Koordinaten
//   2. Photon (Umkreissuche je Kategorie) + OSM-API (Website, Telefon, Adresse zu den Treffern)
//   3. Overpass als Ausweichweg, falls Photon nicht erreichbar ist
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'Leadscraper/1.0 (lokale Anwendung)';
// Auf Vercel ist nur das temporäre Verzeichnis beschreibbar; der Zwischenspeicher lebt dort nur kurz.
const CACHE_DIR = process.env.VERCEL ? path.join(require('os').tmpdir(), 'leadscraper-cache') : path.join(__dirname, '..', 'data', 'cache');
const CACHE_TAGE = 7;
const PHOTON = 'https://photon.komoot.io';
const PHOTON_MAX = 50; // Photon liefert höchstens 50 Treffer je Anfrage
const PHOTON_BUDGET = 220; // Obergrenze für Anfragen je Suche – der Dienst ist kostenlos und soll es bleiben
const OSM_API = 'https://api.openstreetmap.org/api/0.6';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const NAMENS_KEYS = ['shop', 'craft', 'office', 'healthcare', 'amenity', 'man_made'];

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

async function holeJson(url, { versuche = 3, timeout = 25000, optionen = {} } = {}) {
  let fehler;
  for (let v = 0; v < versuche; v++) {
    if (v) await warte(1500 * v);
    try {
      const r = await fetch(url, { ...optionen, headers: { 'User-Agent': UA, 'Accept-Language': 'de', ...optionen.headers }, signal: AbortSignal.timeout(timeout) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      fehler = e;
    }
  }
  throw fehler;
}

async function geocode(ort) {
  let d;
  try {
    d = await holeJson('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=de,at,ch&q=' + encodeURIComponent(ort));
  } catch (e) {
    throw new Error('Ortssuche nicht erreichbar (' + e.message + '). Bitte gleich noch einmal versuchen.');
  }
  if (!d.length) throw new Error('Ort „' + ort + '“ wurde nicht gefunden.');
  return { lat: +d[0].lat, lon: +d[0].lon, name: d[0].display_name };
}

function distanzKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
const KM_JE_GRAD = 111.32;
const versetze = (p, ostKm, nordKm) => ({ lat: p.lat + nordKm / KM_JE_GRAD, lon: p.lon + ostKm / (KM_JE_GRAD * Math.cos((p.lat * Math.PI) / 180)) });

// ───────── Photon ─────────

// Alle Objekte einer Kategorie im Umkreis. Weil Photon nur die 50 nächsten liefert, wird dichtes Gebiet
// in Viertel zerlegt und von innen nach außen abgefragt, bis alles erfasst oder das Budget verbraucht ist.
async function photonKategorie(tag, zentrum, radiusKm, budget, sammle) {
  const offen = [{ ...zentrum, h: radiusKm, wurzel: true }];
  let anfragen = 0;
  while (offen.length && anfragen < budget) {
    offen.sort((a, b) => distanzKm(zentrum.lat, zentrum.lon, a.lat, a.lon) - distanzKm(zentrum.lat, zentrum.lon, b.lat, b.lon));
    const q = offen.shift();
    const radius = q.wurzel ? q.h : q.h * Math.SQRT2;
    const d = await holeJson(`${PHOTON}/reverse?lon=${q.lon.toFixed(5)}&lat=${q.lat.toFixed(5)}&radius=${radius.toFixed(2)}&limit=${PHOTON_MAX}&osm_tag=${encodeURIComponent(tag.k + ':' + tag.v)}`);
    anfragen++;
    const treffer = d.features || [];
    treffer.forEach(sammle);
    if (treffer.length < PHOTON_MAX || q.h < 0.4) continue;
    for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const kind = { ...versetze(q, (x * q.h) / 2, (y * q.h) / 2), h: q.h / 2 };
      // Viertel, die komplett außerhalb des Suchkreises liegen, überspringen.
      if (distanzKm(zentrum.lat, zentrum.lon, kind.lat, kind.lon) - kind.h * Math.SQRT2 <= radiusKm) offen.push(kind);
    }
    await warte(120);
  }
  return anfragen;
}

async function photonStichwort(wort, zentrum, radiusKm, sammle) {
  const sw = versetze(zentrum, -radiusKm, -radiusKm), no = versetze(zentrum, radiusKm, radiusKm);
  const d = await holeJson(`${PHOTON}/api/?q=${encodeURIComponent(wort)}&lat=${zentrum.lat.toFixed(5)}&lon=${zentrum.lon.toFixed(5)}&limit=${PHOTON_MAX}&lang=de&bbox=${sw.lon.toFixed(5)},${sw.lat.toFixed(5)},${no.lon.toFixed(5)},${no.lat.toFixed(5)}`);
  (d.features || []).filter((f) => NAMENS_KEYS.includes(f.properties.osm_key)).forEach(sammle);
}

// Photon kennt Name und Adresse, aber nicht Website/Telefon – die vollständigen Tags kommen gebündelt von der OSM-API.
async function ladeTags(funde, melde) {
  const plural = { N: 'nodes', W: 'ways', R: 'relations' };
  const kurz = { node: 'N', way: 'W', relation: 'R' };
  for (const typ of ['N', 'W', 'R']) {
    const ids = [...funde.values()].filter((f) => f.typ === typ).map((f) => f.osmId);
    for (let i = 0; i < ids.length; i += 250) {
      melde(`Kontaktdaten zu ${funde.size} Unternehmen werden geladen …`);
      try {
        const d = await holeJson(`${OSM_API}/${plural[typ]}.json?${plural[typ]}=${ids.slice(i, i + 250).join(',')}`, { timeout: 40000 });
        for (const el of d.elements || []) {
          const f = funde.get(kurz[el.type] + el.id);
          // Photons Adresse bleibt als Rückfall erhalten, falls am OSM-Objekt selbst keine eingetragen ist.
          if (f && el.tags) f.tags = { ...f.tags, ...el.tags };
        }
      } catch {} // dann bleiben für diesen Block nur Name und Adresse aus Photon
      await warte(150);
    }
  }
}

async function elementeUeberPhoton(branchen, zentrum, radiusKm, melde, abgebrochen) {
  const funde = new Map();
  const sammle = (f) => {
    const p = f.properties, [lon, lat] = f.geometry.coordinates;
    if (!p.name || !p.osm_id || distanzKm(zentrum.lat, zentrum.lon, lat, lon) > radiusKm) return;
    const schluessel = p.osm_type + p.osm_id;
    if (!funde.has(schluessel)) {
      funde.set(schluessel, { typ: p.osm_type, osmId: p.osm_id, lat, lon,
        tags: { name: p.name, [p.osm_key]: p.osm_value, 'addr:street': p.street || '', 'addr:housenumber': p.housenumber || '', 'addr:postcode': p.postcode || '', 'addr:city': p.city || '' } });
    }
  };
  const tags = [...new Map(branchen.flatMap((b) => b.tags).map((t) => [t.k + '=' + t.v, t])).values()];
  const woerter = [...new Set(branchen.flatMap((b) => (b.name ? b.name.split('|').slice(0, 3) : [])))];
  const jeKategorie = Math.max(3, Math.floor((PHOTON_BUDGET - woerter.length) / Math.max(1, tags.length)));
  let anfragen = 0;
  for (let i = 0; i < tags.length && !abgebrochen() && anfragen < PHOTON_BUDGET; i++) {
    melde(`Unternehmen werden gesammelt (Kategorie ${i + 1} von ${tags.length}, bisher ${funde.size} gefunden) …`);
    anfragen += await photonKategorie(tags[i], zentrum, radiusKm, jeKategorie, sammle);
  }
  for (let i = 0; i < woerter.length && !abgebrochen() && anfragen < PHOTON_BUDGET + 40; i++, anfragen++) {
    melde(`Unternehmen werden gesammelt (Stichwort „${woerter[i]}“, bisher ${funde.size} gefunden) …`);
    await photonStichwort(woerter[i], zentrum, radiusKm, sammle).catch(() => {});
    await warte(120);
  }
  if (!abgebrochen()) await ladeTags(funde, melde);
  return [...funde.values()].map((f) => ({ type: { N: 'node', W: 'way', R: 'relation' }[f.typ], id: f.osmId, lat: f.lat, lon: f.lon, tags: f.tags }));
}

// ───────── Overpass (Ausweichweg) ─────────

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

function baueAbfrage(branchen, lat, lon, radiusM) {
  const um = `(around:${Math.round(radiusM)},${lat.toFixed(4)},${lon.toFixed(4)})`;
  const zeilen = [];
  for (const b of branchen) for (const { k, v } of b.tags) zeilen.push(`nwr["${k}"="${esc(v)}"]["name"]${um};`);
  const namen = branchen.filter((b) => b.name).map((b) => b.name).join('|');
  if (namen) for (const key of NAMENS_KEYS.slice(0, 4)) zeilen.push(`nwr["name"~"${esc(namen)}",i]["${key}"]${um};`);
  return `[out:json][timeout:120];(\n${zeilen.join('\n')}\n);out center tags;`;
}

async function elementeUeberOverpass(branchen, zentrum, radiusKm, melde) {
  const abfrage = baueAbfrage(branchen, zentrum.lat, zentrum.lon, radiusKm * 1000);
  let fehler;
  for (let versuch = 0; versuch < OVERPASS.length; versuch++) {
    melde(`Unternehmen werden gesammelt (Ausweichserver, Versuch ${versuch + 1} von ${OVERPASS.length}) …`);
    if (versuch) await warte(3000);
    try {
      const d = await holeJson(OVERPASS[versuch], { versuche: 1, timeout: 140000, optionen: { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(abfrage) } });
      // Bei Überlast antwortet der Server teils mit HTTP 200, leerem Ergebnis und einer Fehlerbemerkung.
      if (d.remark && /error|timed out|out of memory/i.test(d.remark)) throw new Error('Server überlastet');
      return (d.elements || []).map((el) => ({ ...el, lat: el.lat ?? el.center?.lat, lon: el.lon ?? el.center?.lon }));
    } catch (e) {
      fehler = e;
    }
  }
  throw new Error('Die OpenStreetMap-Server sind gerade nicht erreichbar (' + (fehler?.message || 'unbekannt') + '). Bitte in ein paar Minuten erneut versuchen.');
}

// ───────── Gemeinsame Aufbereitung ─────────

function branchePasst(b, tags) {
  if (b.tags.some(({ k, v }) => tags[k] === v)) return true;
  return !!b.name && NAMENS_KEYS.some((k) => tags[k]) && new RegExp(b.name, 'i').test(tags.name || '');
}

function normalisiereWebsite(w) {
  if (!w) return '';
  w = w.trim().split(/[\s;]/)[0];
  if (!/^https?:\/\//i.test(w)) w = 'https://' + w;
  try {
    const u = new URL(w);
    // Profilseiten auf Portalen sind keine eigene Website – ihr Impressum gehört dem Portal, nicht der Firma.
    if (/(^|\.)(facebook|instagram|linkedin|xing|youtube|tiktok|twitter|x|google|jameda|doctolib|booking|tripadvisor|lieferando|mobile|autoscout24|immobilienscout24|immowelt|kleinanzeigen|ebay|eatbu|speisekarte|yelp|linktr|wa|t|business)\.[a-z.]+$/i.test(u.hostname)) return '';
    return u.href;
  } catch {
    return '';
  }
}

// Liefert deduplizierte Kandidaten, nach Entfernung sortiert.
async function sucheUnternehmen(branchen, zentrum, radiusKm, melde = () => {}, abgebrochen = () => false) {
  const schluesselRoh = branchen.map((b) => b.id).sort().join(',') + '|' + zentrum.lat.toFixed(3) + '|' + zentrum.lon.toFixed(3) + '|' + radiusKm;
  const datei = path.join(CACHE_DIR, 'firmen-' + crypto.createHash('sha1').update(schluesselRoh).digest('hex') + '.json');
  let elemente = null;
  try {
    if (Date.now() - fs.statSync(datei).mtimeMs < CACHE_TAGE * 864e5) elemente = JSON.parse(fs.readFileSync(datei, 'utf8'));
  } catch {}
  if (!elemente) {
    try {
      elemente = await elementeUeberPhoton(branchen, zentrum, radiusKm, melde, abgebrochen);
    } catch {
      elemente = await elementeUeberOverpass(branchen, zentrum, radiusKm, melde);
    }
    if (!abgebrochen() && elemente.length) {
      try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(datei, JSON.stringify(elemente));
      } catch {} // ohne Zwischenspeicher geht es auch, nur langsamer
    }
  }

  const gesehen = new Set();
  const kandidaten = [];
  for (const el of elemente) {
    const tg = el.tags || {};
    if (!tg.name || el.lat == null) continue;
    const branche = branchen.find((b) => branchePasst(b, tg));
    if (!branche) continue;
    const website = normalisiereWebsite(tg.website || tg['contact:website'] || tg.url);
    let host = '';
    try { host = website ? new URL(website).hostname.replace(/^www\./, '') : ''; } catch {}
    kandidaten.push({
      id: el.type[0] + el.id,
      // Filialen mit derselben Website gehören zum selben Unternehmen → nur die nächstgelegene behalten.
      schluessel: host || tg.name.toLowerCase() + '|' + el.lat.toFixed(3) + '|' + el.lon.toFixed(3),
      name: tg.name,
      brancheId: branche.id,
      branche: branche.label,
      maBasis: branche.ma,
      website,
      telefon: tg.phone || tg['contact:phone'] || tg['contact:mobile'] || '',
      email: tg.email || tg['contact:email'] || '',
      strasse: [tg['addr:street'], tg['addr:housenumber']].filter(Boolean).join(' '),
      plz: tg['addr:postcode'] || '',
      ort: tg['addr:city'] || tg['addr:suburb'] || '',
      lat: el.lat, lon: el.lon,
      entfernungKm: Math.round(distanzKm(zentrum.lat, zentrum.lon, el.lat, el.lon) * 10) / 10,
    });
  }
  kandidaten.sort((a, b) => a.entfernungKm - b.entfernungKm);
  return kandidaten.filter((k) => !gesehen.has(k.schluessel) && gesehen.add(k.schluessel));
}

module.exports = { geocode, sucheUnternehmen };
