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
const PHOTON_BUDGET = 300; // Obergrenze für Anfragen je Suche – der Dienst ist kostenlos und soll es bleiben
const OSM_API = 'https://api.openstreetmap.org/api/0.6';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const NAMENS_KEYS = ['shop', 'craft', 'office', 'healthcare', 'amenity', 'man_made', 'leisure', 'tourism'];
const BUNDESWEIT_KM = 900; // reicht von jedem Ort in Deutschland bis in jede Ecke des Landes
// Auf Vercel endet jede Anfrage nach fünf Minuten – das Sammeln muss vorher fertig sein.
const ZEIT_BUDGET_MS = process.env.VERCEL ? 170e3 : 420e3;
const { KEIN_UNTERNEHMEN } = require('./branchen');

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

// Arbeitet eine Liste mit begrenzt vielen gleichzeitigen Aufgaben ab.
async function parallel(liste, gleichzeitig, arbeit) {
  let naechster = 0;
  await Promise.all(Array.from({ length: Math.min(gleichzeitig, liste.length) }, async () => {
    while (naechster < liste.length) { const i = naechster++; await arbeit(liste[i], i); }
  }));
}

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

// Die höchstens 50 nächstgelegenen Objekte einer Kategorie rund um einen Punkt.
async function photonUmkreis(tag, punkt, radiusKm) {
  const d = await holeJson(`${PHOTON}/reverse?lon=${punkt.lon.toFixed(5)}&lat=${punkt.lat.toFixed(5)}&radius=${radiusKm.toFixed(2)}&limit=${PHOTON_MAX}&osm_tag=${encodeURIComponent(tag.v === undefined ? tag.k : tag.k + ':' + tag.v)}`);
  return d.features || [];
}

// Die vier Viertel eines Suchquadrats, soweit sie den Suchkreis berühren. Viertel, die ganz innerhalb von
// schonErfasstKm liegen (dort ist bereits alles gesammelt), entfallen.
function viertel(q, zentrum, radiusKm, schonErfasstKm = 0) {
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]]
    .map(([x, y]) => ({ ...versetze(q, (x * q.h) / 2, (y * q.h) / 2), h: q.h / 2 }))
    .filter((kind) => {
      const abstand = distanzKm(zentrum.lat, zentrum.lon, kind.lat, kind.lon), halbeDiagonale = kind.h * Math.SQRT2;
      return abstand - halbeDiagonale <= radiusKm && abstand + halbeDiagonale > schonErfasstKm;
    });
}

// Betriebe, die ein Stichwort im Namen tragen, innerhalb eines Quadrats (halbe Kantenlänge hKm) um einen Punkt.
// voll = true heißt: Photon hat die Obergrenze geliefert, im Gebiet gibt es vermutlich mehr.
async function photonWort(wort, punkt, hKm) {
  const sw = versetze(punkt, -hKm, -hKm), no = versetze(punkt, hKm, hKm);
  const d = await holeJson(`${PHOTON}/api/?q=${encodeURIComponent(wort)}&lat=${punkt.lat.toFixed(5)}&lon=${punkt.lon.toFixed(5)}&limit=${PHOTON_MAX}&lang=de&bbox=${sw.lon.toFixed(5)},${sw.lat.toFixed(5)},${no.lon.toFixed(5)},${no.lat.toFixed(5)}`);
  const alle = d.features || [];
  return { treffer: alle.filter((f) => NAMENS_KEYS.includes(f.properties.osm_key)), voll: alle.length >= PHOTON_MAX };
}

// Photon kennt Name und Adresse, aber nicht Website/Telefon – die vollständigen Tags kommen gebündelt von der OSM-API.
async function ladeTags(funde, melde) {
  const plural = { N: 'nodes', W: 'ways', R: 'relations' };
  const kurz = { node: 'N', way: 'W', relation: 'R' };
  const bloecke = [];
  for (const typ of ['N', 'W', 'R']) {
    const ids = [...funde.values()].filter((f) => f.typ === typ).map((f) => f.osmId);
    for (let i = 0; i < ids.length; i += 250) bloecke.push([typ, ids.slice(i, i + 250)]);
  }
  melde(`Kontaktdaten zu ${funde.size} Unternehmen werden geladen …`);
  await parallel(bloecke, 3, async ([typ, ids]) => {
    try {
      const d = await holeJson(`${OSM_API}/${plural[typ]}.json?${plural[typ]}=${ids.join(',')}`, { timeout: 40000 });
      for (const el of d.elements || []) {
        const f = funde.get(kurz[el.type] + el.id);
        // Photons Adresse bleibt als Rückfall erhalten, falls am OSM-Objekt selbst keine eingetragen ist.
        if (f && el.tags) f.tags = { ...f.tags, ...el.tags };
      }
    } catch {} // dann bleiben für diesen Block nur Name und Adresse aus Photon
  });
}

// Die OSM-Tags der gewählten Branchen ohne Doppelte. Deckt ein Tag die ganze Kategorie ab („shop“),
// entfallen deren Einzelwerte; ganze Kategorien stehen vorn.
function reduziereTags(branchen) {
  const alle = [...new Map(branchen.flatMap((b) => b.tags).map((t) => [t.k + '=' + (t.v ?? '*'), t])).values()];
  const ganze = new Set(alle.filter((t) => t.v === undefined).map((t) => t.k));
  // „Alle Branchen“: Auch Gastronomie, Unterkünfte und Freizeit laufen dann als ganze Kategorie – wenige volle Abfragen
  // statt 70 einzelner. Was davon kein Betrieb aus dem Katalog ist (Schulen, Kirchen …), fällt später heraus.
  if (branchen.length > 100) for (const k of ['amenity', 'tourism', 'leisure']) { ganze.add(k); alle.push({ k }); }
  return alle.filter((t) => t.v === undefined || !ganze.has(t.k)).sort((a, b) => (a.v === undefined ? 0 : 1) - (b.v === undefined ? 0 : 1));
}

// Sammelt Unternehmen rund um den Startpunkt – nur so viele, wie gebraucht werden (bedarf), die nächstgelegenen zuerst.
// Photon beantwortet Anfragen eines Nutzers nacheinander (rund eine pro Sekunde) und liefert je Anfrage höchstens
// 50 Objekte; jede eingesparte Anfrage ist deshalb gesparte Wartezeit. Gesucht wird über zwei Arten von Quellen:
// Kategorien (OSM-Tags wie shop=kitchen) und Namens-Stichwörter („Solar“) – beide nach demselben Verfahren:
//   Runde 1: je Quelle die nächstgelegenen Betriebe.
//   Weitere Runden: reihum wird jede noch nicht ausgeschöpfte Quelle gebietsweise vertieft (von innen nach außen),
//   bis der Bedarf gedeckt, der Umkreis vollständig erfasst oder das Anfragen-Budget verbraucht ist.
// radiusKm = 0 heißt „ganz Deutschland“: Der Umkreis ergibt sich dann aus der Dichte der Betriebe und dem Bedarf.
// Liefert { elemente, radiusKm, vollstaendig } mit dem tatsächlich abgedeckten Umkreis.
async function elementeUeberPhoton(branchen, zentrum, radiusKm, melde, abgebrochen, bedarf) {
  const bundesweit = radiusKm === 0;
  let grenzeKm = bundesweit ? BUNDESWEIT_KM : radiusKm;
  const funde = new Map();
  const entfernung = (f) => distanzKm(zentrum.lat, zentrum.lon, f.geometry.coordinates[1], f.geometry.coordinates[0]);
  const sammle = (f) => {
    const p = f.properties, [lon, lat] = f.geometry.coordinates;
    if (!p.name || !p.osm_id || entfernung(f) > grenzeKm || (bundesweit && p.countrycode !== 'DE')) return;
    const schluessel = p.osm_type + p.osm_id;
    if (!funde.has(schluessel)) {
      funde.set(schluessel, { typ: p.osm_type, osmId: p.osm_id, lat, lon,
        tags: { name: p.name, [p.osm_key]: p.osm_value, 'addr:street': p.street || '', 'addr:housenumber': p.housenumber || '', 'addr:postcode': p.postcode || '', 'addr:city': p.city || '' } });
    }
  };
  // Photon kennt nur einfache Schlüssel; Unterschlüssel wie „healthcare:speciality“ laufen über die Namens-Stichwörter.
  // Bei sehr breiter Auswahl („alle Branchen“) decken die Kategorien alles ab – die Zusatz-Stichwörter des Katalogs
  // entfallen dann; eigene Stichwörter aus der Suchzeile werden immer gesucht.
  const breit = branchen.length > 40;
  const quellen = [
    ...reduziereTags(branchen).filter((t) => !t.k.includes(':')).map((tag) => ({ tag, name: tag.v || tag.k })),
    ...[...new Set(branchen.flatMap((b) => b.stichworte || (b.name && !breit ? b.name.split('|') : [])))].map((wort) => ({ wort, name: '„' + wort + '“' })),
  ];
  const frist = Date.now() + ZEIT_BUDGET_MS;
  let anfragen = 0, fehlschlaege = 0;
  const weiter = () => !abgebrochen() && anfragen < PHOTON_BUDGET && Date.now() < frist;
  // Eine Abfrage: Kategorien als Umkreis um den Punkt, Stichwörter als Quadrat. Fällt eine einzelne aus, geht es mit den
  // übrigen weiter. Klappt von Anfang an gar nichts, ist der Dienst gestört – dann übernimmt der Ausweichserver.
  const frage = async (quelle, punkt, hKm, radius) => {
    anfragen++;
    try {
      let treffer, voll;
      if (quelle.tag) { treffer = await photonUmkreis(quelle.tag, punkt, radius); voll = treffer.length >= PHOTON_MAX; }
      else ({ treffer, voll } = await photonWort(quelle.wort, punkt, hKm));
      fehlschlaege = 0;
      treffer.forEach(sammle);
      return { treffer, voll };
    } catch (e) {
      if (++fehlschlaege >= 3 && !funde.size) throw e;
      return { treffer: [], voll: false };
    }
  };

  // Runde 1: je Quelle die nächstgelegenen Betriebe. „weit“ merkt sich, bis wohin die Quelle damit vollständig ist.
  const weit = new Map();
  let dichte = 0;
  for (let i = 0; i < quellen.length && weiter(); i++) {
    melde(`Unternehmen werden gesammelt (${i + 1} von ${quellen.length}: ${quellen[i].name}, bisher ${funde.size} gefunden) …`);
    const { treffer, voll } = await frage(quellen[i], zentrum, grenzeKm, grenzeKm);
    // Kategorien liefern streng die nächsten 50 – bis zum fernsten davon ist alles erfasst. Stichwort-Treffer sind
    // nach Relevanz sortiert; sind es 50, ist über die Vollständigkeit nichts bekannt.
    const reichweite = !voll ? Infinity : quellen[i].tag ? Math.max(1, ...treffer.map(entfernung)) : 0;
    weit.set(quellen[i], reichweite);
    if (quellen[i].tag && voll) dichte += PHOTON_MAX / (Math.PI * reichweite * reichweite);
  }
  if (bundesweit) {
    // Aus der Summe der Dichten folgt der Umkreis, in dem der Bedarf voraussichtlich gedeckt ist. Ohne Dichte-Angabe
    // (reine Stichwortsuche) beginnt die Suche bei 100 km und wächst von dort.
    const offeneQuellen = [...weit.values()].some((w) => w < Infinity);
    radiusKm = dichte ? Math.min(BUNDESWEIT_KM, Math.max(15, Math.ceil(Math.sqrt(bedarf / (Math.PI * dichte))))) : offeneQuellen ? 100 : BUNDESWEIT_KM;
    grenzeKm = radiusKm;
  }

  // Weitere Runden: nur für Quellen, deren erste Treffer nicht bis zum Rand des Umkreises reichen.
  const nah = (a, b) => distanzKm(zentrum.lat, zentrum.lon, a.lat, a.lon) - distanzKm(zentrum.lat, zentrum.lon, b.lat, b.lon);
  let vollstaendig = false;
  for (let erfasstKm = 0; ; ) {
    const offen = new Map(quellen.filter((q) => (weit.get(q) ?? Infinity) < radiusKm).map((q) => [q, viertel({ ...zentrum, h: radiusKm }, zentrum, radiusKm, q.tag ? erfasstKm : 0)]));
    while (offen.size && funde.size < bedarf && weiter()) {
      for (const [quelle, gebiete] of offen) {
        if (funde.size >= bedarf || !weiter()) break;
        melde(`Unternehmen werden gesammelt (bisher ${funde.size} gefunden, gebraucht werden etwa ${bedarf}) …`);
        const q = gebiete.sort(nah).shift();
        const { voll } = await frage(quelle, q, q.h, q.h * Math.SQRT2);
        if (voll && q.h >= 0.4) gebiete.push(...viertel(q, zentrum, radiusKm, quelle.tag ? erfasstKm : 0));
        if (!gebiete.length) offen.delete(quelle);
      }
    }
    // Vollständig heißt: jede Quelle ist bis zum Rand des Umkreises (bundesweit: des Landes) ausgeschöpft.
    vollstaendig = !offen.size && (!bundesweit || radiusKm >= BUNDESWEIT_KM);
    // Bundesweit: Ist der geschätzte Umkreis vollständig erfasst und der Bedarf noch nicht gedeckt, wächst der Umkreis.
    if (!bundesweit || offen.size || funde.size >= bedarf || radiusKm >= BUNDESWEIT_KM || !weiter()) break;
    erfasstKm = radiusKm;
    radiusKm = Math.min(BUNDESWEIT_KM, radiusKm * 2);
    grenzeKm = radiusKm;
    // Stichwörter, die im kleineren Umkreis schon vollständig waren, müssen im größeren neu gefragt werden.
    for (const q of quellen) if (q.wort) weit.set(q, 0);
  }

  if (!abgebrochen()) await ladeTags(funde, melde);
  const elemente = [...funde.values()].map((f) => ({ type: { N: 'node', W: 'way', R: 'relation' }[f.typ], id: f.osmId, lat: f.lat, lon: f.lon, tags: f.tags }));
  return { elemente, radiusKm, vollstaendig };
}

// ───────── Overpass (Ausweichweg) ─────────

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

function baueAbfrage(branchen, lat, lon, radiusM) {
  const um = `(around:${Math.round(radiusM)},${lat.toFixed(4)},${lon.toFixed(4)})`;
  const zeilen = [];
  for (const { k, v } of reduziereTags(branchen)) zeilen.push(v === undefined ? `nwr["${k}"]["name"]${um};` : `nwr["${k}"="${esc(v)}"]["name"]${um};`);
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
  if (b.tags.some(({ k, v }) => (v === undefined ? !!tags[k] : tags[k] === v))) return true;
  if (!b.name || !NAMENS_KEYS.some((k) => tags[k]) || !new RegExp(b.name, 'i').test(tags.name || '')) return false;
  // Namen, die das Stichwort nur zufällig enthalten („Solarium“ bei „Solar“)
  return !(b.nicht && new RegExp(b.nicht, 'i').test(tags.name || ''));
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
// radiusKm = 0 sucht ohne Umkreisgrenze in ganz Deutschland; bedarf sagt dann, wie viele Unternehmen gebraucht werden.
// Am Ergebnis hängen als Eigenschaften radiusKm (der tatsächlich abgedeckte Umkreis) und vollstaendig (true, wenn
// im Umkreis nichts mehr zu holen ist; false, wenn nur der Bedarf gedeckt wurde und es weitere Unternehmen gibt).
async function sucheUnternehmen(branchen, zentrum, radiusKm, melde = () => {}, abgebrochen = () => false, bedarf = 2000) {
  const schluesselRoh = branchen.map((b) => b.id).sort().join(',') + '|' + zentrum.lat.toFixed(3) + '|' + zentrum.lon.toFixed(3) + '|' + (radiusKm || 'bundesweit') + '|bedarf' + Math.ceil(Math.log2(bedarf));
  const datei = path.join(CACHE_DIR, 'firmen-' + crypto.createHash('sha1').update(schluesselRoh).digest('hex') + '.json');
  let elemente = null, umkreis = radiusKm, vollstaendig = true;
  try {
    if (Date.now() - fs.statSync(datei).mtimeMs < CACHE_TAGE * 864e5) {
      const gemerkt = JSON.parse(fs.readFileSync(datei, 'utf8'));
      // ältere Zwischenspeicher-Dateien enthalten nur die Liste
      // (reine Listen stammen aus der Zeit, als immer der ganze Umkreis gesammelt wurde)
      if (Array.isArray(gemerkt)) elemente = gemerkt; else ({ elemente, radiusKm: umkreis, vollstaendig = false } = gemerkt);
    }
  } catch {}
  if (!elemente) {
    try {
      ({ elemente, radiusKm: umkreis, vollstaendig } = await elementeUeberPhoton(branchen, zentrum, radiusKm, melde, abgebrochen, bedarf));
    } catch (e) {
      console.error('Sammeln über Photon fehlgeschlagen:', e.stack || e.message);
      // Der Ausweichserver kann nur einen festen Umkreis abfragen.
      if (!radiusKm) throw new Error('Die bundesweite Suche ist gerade nicht erreichbar (' + e.message + '). Bitte gleich noch einmal versuchen oder einen festen Umkreis wählen.');
      elemente = await elementeUeberOverpass(branchen, zentrum, radiusKm, melde);
    }
    if (!abgebrochen() && elemente.length) {
      try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(datei, JSON.stringify({ elemente, radiusKm: umkreis, vollstaendig }));
      } catch {} // ohne Zwischenspeicher geht es auch, nur langsamer
    }
  }

  const gesehen = new Set();
  const kandidaten = [];
  for (const el of elemente) {
    const tg = el.tags || {};
    if (!tg.name || el.lat == null) continue;
    // Behörden, Parteien, leerstehende Läden u. Ä. sind keine Unternehmen.
    if (Object.entries(KEIN_UNTERNEHMEN).some(([k, werte]) => werte.includes(tg[k]))) continue;
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
  const ergebnis = kandidaten.filter((k) => !gesehen.has(k.schluessel) && gesehen.add(k.schluessel));
  ergebnis.radiusKm = umkreis;
  ergebnis.vollstaendig = vollstaendig;
  return ergebnis;
}

module.exports = { geocode, sucheUnternehmen };
