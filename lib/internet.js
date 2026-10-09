// Internet-Suche: findet Firmen, die in keiner Karte stehen, über ihre Internet-Adresse.
// Grundlage ist die frei verfügbare Liste aller bekannten Domains von Common Crawl. Daraus werden einmalig alle
// .de-Adressen herausgezogen (einige Millionen). Eine Suche nimmt die Adressen, die ein Branchenwort enthalten
// („solar“, „kuechen“ …), ruft jede Website auf und wertet ihr Impressum aus – wie bei den Karten-Treffern.
// Liste, Postleitzahl-Tabelle und die Ergebnisse geprüfter Adressen liegen außerhalb des Projektordners
// (nicht in OneDrive), weil sie groß sind und sich jederzeit neu erzeugen lassen.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { Readable } = require('stream');
const { domainToUnicode } = require('url');
const { anreichern, ABGESTUERZT } = require('./werkzeug');
const { BASIS, PLZ_DATEI, koordinaten, vergissTabelle, distanzKm, imUmkreis } = require('./plz');

const LISTE = path.join(BASIS, 'de-domains.txt');
const INFO = path.join(BASIS, 'de-domains.json');
const GEPRUEFT = path.join(BASIS, 'gepruefte-domains.jsonl');
const GRAPHEN = 'https://index.commoncrawl.org/graphinfo.json';
const PLZ_QUELLE = 'https://raw.githubusercontent.com/WZBSocialScienceCenter/plz_geocoord/master/plz_geocoord.csv';
const GLEICHZEITIG = 14; // mehr gleichzeitige Abrufe überlasten übliche Heimanschlüsse (Router verliert Pakete) und bringen kein Tempo
const HALTBAR_TAGE = 60; // so lange gilt das Ergebnis einer geprüften Adresse
const MAX_ADRESSEN = 60000;
const AUSWERTUNG = 2; // erhöhen, wenn die Impressum-Auswertung besser wird: gemerkte Leads werden dann neu geprüft

// Wörter, die in der Internet-Adresse einer Firma dieser Branche typischerweise vorkommen (Umlaute ausgeschrieben).
const WEBWORTE = {
  kuechen: ['kuechen', 'kuechenstudio'], autohaus: ['autohaus'], wohnmobil: ['wohnmobil', 'caravan', 'reisemobil'], motorrad: ['motorrad'],
  boote: ['yacht', 'bootsbau', 'bootswerft'], moebel: ['moebel', 'einrichtungshaus'], juwelier: ['juwelier', 'goldschmied'], immobilien: ['immobilien', 'makler'],
  solar: ['solar', 'photovoltaik'], fenster: ['fensterbau', 'fenster'], wintergarten: ['wintergarten', 'wintergaerten', 'terrassendach'],
  shk: ['heizung', 'sanitaer', 'haustechnik', 'waermepumpe', 'badstudio'], kamin: ['kamin', 'ofenbau', 'kachelofen'], pool: ['poolbau', 'schwimmbad', 'saunabau'],
  galabau: ['galabau', 'gartenbau', 'landschaftsbau', 'gartengestaltung'], bau: ['bauunternehmen', 'massivhaus', 'hausbau', 'bautraeger'],
  dach: ['dachdecker', 'bedachung', 'zimmerei', 'holzbau'], schreiner: ['schreinerei', 'tischlerei'], elektro: ['elektrotechnik', 'elektro'],
  metallbau: ['metallbau', 'stahlbau', 'treppenbau', 'schlosserei'], boden: ['parkett', 'bodenbelaege'], zahnarzt: ['zahnarzt', 'zahnaerzte', 'kieferorthopaed'],
  aesthetik: ['aesthetik', 'schoenheitsklinik'], hoerakustik: ['hoergeraete', 'hoerakustik'], optiker: ['optik', 'optiker'], ebike: ['fahrrad', 'zweirad', 'ebike'],
  architekt: ['architekt', 'ingenieurbuero'], finanz: ['finanzberatung', 'versicherungsmakler'], landtechnik: ['landtechnik', 'landmaschinen', 'baumaschinen'],
  physio: ['physio', 'krankengymnastik'], ergo: ['ergotherapie'], logo: ['logopaedie'], pflege: ['pflegedienst', 'seniorenresidenz', 'tagespflege'],
  arzt: ['arztpraxis', 'hausarzt'], tierarzt: ['tierarzt', 'tierklinik'], apotheke: ['apotheke'], sanitaetshaus: ['sanitaetshaus', 'orthopaedietechnik'],
  gastro: ['restaurant', 'gasthaus'], hotel: ['hotel'], baeckerei: ['baeckerei', 'konditorei'], metzgerei: ['metzgerei', 'fleischerei'], friseur: ['friseur', 'frisoer'],
  kosmetik: ['kosmetik', 'beauty'], kfz: ['kfz', 'autowerkstatt'], spedition: ['spedition', 'logistik', 'umzuege'], reinigung: ['gebaeudereinigung', 'gebaeudeservice'],
  sicherheit: ['sicherheitsdienst', 'wachschutz'], maler: ['malerbetrieb', 'malermeister', 'stuckateur'], fliesen: ['fliesen'], industrie: ['maschinenbau', 'anlagenbau', 'werkzeugbau'],
  it: ['software', 'systemhaus'], steuer: ['steuerberater', 'steuerkanzlei'], recht: ['rechtsanwalt', 'kanzlei'], fitness: ['fitness'], fahrschule: ['fahrschule'],
};

// Wo das Wort in der Adresse mehrdeutig ist, muss der Seiteninhalt eindeutig zur Branche gehören
// („solar“ steckt auch im Nachnamen Solarek oder in Solaris-Software).
const WEBINHALT = {
  solar: 'photovoltaik|solaranlage|solarmodul|solarstrom|solarthermie|pv-anlage|solartechnik',
  elektro: 'elektroinstallation|elektrotechnik|elektriker|elektromeister',
  optiker: 'brille|augenoptik|kontaktlinsen',
  fenster: 'fensterbau|kunststofffenster|holzfenster|fenster und türen|fenster & türen',
  kfz: 'werkstatt|kfz-meister|inspektion|reparatur',
  it: 'softwareentwicklung|it-service|systemhaus|it-dienstleist',
  kosmetik: 'kosmetikstudio|kosmetikbehandlung|kosmetikerin',
};

const lese = (datei, standard) => { try { return JSON.parse(fs.readFileSync(datei, 'utf8')); } catch { return standard; } };
const ohneUmlaute = (s) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

function webWorte(b) {
  if (b.stichworte) return b.stichworte.map((w) => ohneUmlaute(w).replace(/[^a-z0-9]+/g, ''));
  if (WEBWORTE[b.id]) return WEBWORTE[b.id];
  // Kein eigener Eintrag: die längeren Wörter aus Bezeichnung und Namensmustern der Branche
  const quelle = (b.name ? b.name.split('|') : []).concat(b.label.split(/[^A-Za-zÄÖÜäöüß]+/));
  return [...new Set(quelle.map((w) => ohneUmlaute(w).replace(/[^a-z]+/g, '')).filter((w) => w.length >= 7))].slice(0, 4);
}

// ───────── Einrichtung ─────────

let einrichtung = { laeuft: false, meldung: '', fehler: '' };

function status() {
  const info = lese(INFO, null);
  return { vorhanden: !!info && fs.existsSync(LISTE), anzahl: info?.anzahl || 0, stand: info?.stand || '', einrichtung };
}

// Lädt die Domain-Liste und behält nur die .de-Adressen. Die Liste ist nach Endung sortiert: Sobald der .de-Abschnitt
// vorbei ist, wird der Download abgebrochen – der Rest (rund 40 %) wird nicht mehr gebraucht.
async function richteEin() {
  if (einrichtung.laeuft) return;
  einrichtung = { laeuft: true, meldung: 'Verbindung wird aufgebaut …', fehler: '' };
  const abbruch = new AbortController();
  try {
    fs.mkdirSync(BASIS, { recursive: true });
    const graphen = await (await fetch(GRAPHEN, { signal: AbortSignal.timeout(30000) })).json();
    let antwort, stand;
    // Die neueste Liste nehmen; ist ihre Datei (noch) nicht abrufbar, die vorherige.
    for (const g of graphen.slice(0, 3)) {
      stand = g.id;
      antwort = await fetch(`https://data.commoncrawl.org/projects/hyperlinkgraph/${g.id}/domain/${g.id}-domain-vertices.txt.gz`, { signal: abbruch.signal }).catch(() => null);
      if (antwort?.ok) break;
    }
    if (!antwort?.ok) throw new Error('Die Domain-Liste ist gerade nicht abrufbar.');
    const gesamtMb = Math.round((+antwort.headers.get('content-length') || 0) / 1e6);
    let geladen = 0, anzahl = 0, imAbschnitt = false, fertig = false;
    const roh = Readable.fromWeb(antwort.body), entpacker = zlib.createGunzip();
    // Der gewollte Abbruch am Ende des .de-Abschnitts löst in beiden Strömen einen Fehler aus – das ist kein Problem.
    roh.on('error', () => {});
    entpacker.on('error', () => {});
    roh.on('data', (stueck) => { geladen += stueck.length; });
    const ausgabe = fs.createWriteStream(LISTE + '.neu');
    const zeilen = readline.createInterface({ input: roh.pipe(entpacker) });
    const anzeige = setInterval(() => { einrichtung.meldung = `Internet-Liste wird geladen: ${Math.round(geladen / 1e6)} von ${gesamtMb} MB, ${anzahl.toLocaleString('de-DE')} deutsche Adressen gefunden …`; }, 1000);
    try {
      for await (const zeile of zeilen) {
        // Zeilenaufbau: Nummer, Domain rückwärts geschrieben („de.beispiel“), Anzahl Unteradressen
        const rueckwaerts = zeile.split('\t')[1] || '';
        if (rueckwaerts.startsWith('de.')) {
          imAbschnitt = true;
          const name = rueckwaerts.slice(3);
          if (name && !name.includes('.')) { ausgabe.write(name + '\n'); anzahl++; }
        } else if (imAbschnitt) { fertig = true; break; }
      }
    } catch (e) {
      if (!fertig) throw e;
    } finally {
      clearInterval(anzeige);
      abbruch.abort();
    }
    await new Promise((ja) => ausgabe.end(ja));
    if (anzahl < 100000) throw new Error('Die Liste war unvollständig (nur ' + anzahl + ' Adressen).');
    fs.renameSync(LISTE + '.neu', LISTE);

    einrichtung.meldung = 'Postleitzahl-Tabelle wird geladen …';
    const csv = await (await fetch(PLZ_QUELLE, { signal: AbortSignal.timeout(60000) })).text();
    const plz = {};
    for (const zeile of csv.split('\n').slice(1)) { const [p, lat, lon] = zeile.split(','); if (/^\d{5}$/.test(p)) plz[p] = [+(+lat).toFixed(4), +(+lon).toFixed(4)]; }
    if (Object.keys(plz).length < 5000) throw new Error('Die Postleitzahl-Tabelle war unvollständig.');
    fs.writeFileSync(PLZ_DATEI, JSON.stringify(plz));
    vergissTabelle();

    fs.writeFileSync(INFO, JSON.stringify({ stand, anzahl, zeit: new Date().toISOString() }));
    einrichtung = { laeuft: false, meldung: `Fertig: ${anzahl.toLocaleString('de-DE')} deutsche Internet-Adressen bereit.`, fehler: '' };
  } catch (e) {
    try { fs.rmSync(LISTE + '.neu', { force: true }); } catch {}
    einrichtung = { laeuft: false, meldung: '', fehler: 'Einrichtung fehlgeschlagen: ' + e.message };
  }
}

// ───────── Suche ─────────

// Alle .de-Adressen, deren Name eines der Wörter enthält.
async function findeAdressen(worte) {
  const treffer = [];
  for await (const name of readline.createInterface({ input: fs.createReadStream(LISTE) })) {
    // Umlaut-Adressen sind verschlüsselt gespeichert („xn--…“) – für den Vergleich lesbar machen.
    const lesbar = name.startsWith('xn--') ? ohneUmlaute(domainToUnicode(name + '.de').slice(0, -3)) : name;
    if (worte.some((w) => lesbar.includes(w))) { treffer.push(name + '.de'); if (treffer.length >= MAX_ADRESSEN) break; }
  }
  return treffer;
}

// Ergebnisse bereits geprüfter Adressen. Jede Zeile der Datei: { d: Adresse, z: Zeitpunkt, l: Lead oder null }
let geprueft = null;
function ladeGeprueft() {
  if (geprueft) return geprueft;
  geprueft = new Map();
  try {
    const grenze = Date.now() - HALTBAR_TAGE * 864e5;
    for (const zeile of fs.readFileSync(GEPRUEFT, 'utf8').split('\n')) {
      if (!zeile) continue;
      try { const e = JSON.parse(zeile); if (e.z > grenze && !(e.l && e.v !== AUSWERTUNG)) geprueft.set(e.d + '|' + e.b, e.p ? { l: null, p: e.p } : { l: e.l }); } catch {}
    }
  } catch {}
  return geprueft;
}

const mitFrist = (versprechen, ms) => Promise.race([versprechen, new Promise((_, nein) => setTimeout(() => nein(new Error('Zeitüberschreitung')), ms))]);

// Prüft eine Adresse für eine Branche. Liefert den Lead oder null (keine Firma dieser Branche, kein deutsches Impressum …).
// umkreis = { lat, lon, km } bei Umkreis-Suchen; bundesweit fehlt es.
async function pruefeAdresse(domain, b, umkreis) {
  const merker = ladeGeprueft(), schluessel = domain + '|' + b.id;
  const bekannt = merker.get(schluessel);
  // Fertig geprüft → Ergebnis steht fest. Nur der Standort bekannt (p) → außerhalb des Umkreises ist nichts zu tun,
  // sonst wird die Adresse jetzt vollständig ausgewertet.
  if (bekannt && !bekannt.p) return bekannt.l;
  if (bekannt && umkreis && imUmkreis(bekannt.p, umkreis) === false) return null;
  let lead = null, standort = '';
  try {
    lead = await mitFrist(anreichern({
      id: 'd:' + domain, name: domain.replace(/\.de$/, ''), brancheId: b.id, branche: b.label, maBasis: b.ma, website: 'https://' + domain,
      telefon: '', email: '', strasse: '', plz: '', ort: '', entfernungKm: null,
      // Die Seite muss erkennbar zur Branche gehören – das Wort in der Adresse allein genügt nicht („solaris-beratung.de“).
      ausInternet: true, ohneRendern: true, mussEnthalten: WEBINHALT[b.id] || b.name || webWorte(b).join('|'), darfNichtEnthalten: b.nicht || '',
      umkreis,
    }), 45000);
    standort = lead.zuWeit || '';
    // Ohne deutsche Postleitzahl im Impressum ist es kein brauchbarer Firmeneintrag.
    if (standort || lead.passtNicht || !/^\d{5}$/.test(lead.plz || '')) lead = null;
  } catch (e) {
    // Ein abgestürzter Hilfsprozess sagt nichts über die Adresse – nicht merken, beim nächsten Mal neu prüfen.
    if (e.message === ABGESTUERZT) return null;
  }
  merker.set(schluessel, standort ? { l: null, p: standort } : { l: lead });
  fs.appendFile(GEPRUEFT, JSON.stringify({ d: domain, b: b.id, z: Date.now(), v: AUSWERTUNG, l: lead, ...(standort && { p: standort }) }) + '\n', () => {});
  return lead;
}

// Durchsucht das Internet für die gewählten Branchen. nimm(lead) entscheidet, ob ein Lead zählt (Filter des Nutzers);
// weiter() sagt, ob noch gesucht werden soll. radiusKm = 0 heißt ganz Deutschland.
async function suche({ branchen, zentrum, radiusKm, ortName, bekannteHosts, melde, weiter, nimm }) {
  const aufgaben = [];
  const gesehen = new Set(bekannteHosts);
  for (const b of branchen) {
    const worte = webWorte(b).filter((w) => w.length >= 4);
    if (!worte.length) continue;
    melde(`Internet-Suche: Adressen mit „${worte.join('“, „')}“ werden herausgesucht …`);
    for (const domain of await findeAdressen(worte)) if (!gesehen.has(domain)) { gesehen.add(domain); aufgaben.push([domain, b]); }
  }
  // Reihenfolge: zuerst, was schon einmal geprüft wurde (sofort da), dann Adressen mit dem Ortsnamen, dann der Rest
  // in gemischter Folge (sonst kämen immer zuerst die Adressen mit „a“).
  const merker = ladeGeprueft();
  const ort = ohneUmlaute(ortName || '').replace(/[^a-z]+/g, '');
  const streu = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
  const rang = ([domain, b]) => (merker.has(domain + '|' + b.id) ? 0 : ort.length >= 4 && domain.includes(ort) ? 1 : 2);
  aufgaben.sort((x, y) => rang(x) - rang(y) || streu(x[0]) - streu(y[0]));

  const umkreis = radiusKm ? { lat: zentrum.lat, lon: zentrum.lon, km: radiusKm } : null;
  let naechste = 0, erledigt = 0;
  const arbeiter = async () => {
    while (weiter() && naechste < aufgaben.length) {
      const [domain, b] = aufgaben[naechste++];
      const lead = await pruefeAdresse(domain, b, umkreis);
      erledigt++;
      if (erledigt % 5 === 0) melde(`Internet-Suche: ${erledigt.toLocaleString('de-DE')} von ${aufgaben.length.toLocaleString('de-DE')} Adressen geprüft …`);
      if (!lead) continue;
      const k = koordinaten(lead.plz);
      const entfernung = k ? Math.round(distanzKm(zentrum.lat, zentrum.lon, k[0], k[1])) : null;
      if (radiusKm && (entfernung === null || entfernung > radiusKm)) continue;
      nimm({ ...lead, entfernungKm: entfernung });
    }
  };
  await Promise.all(Array.from({ length: GLEICHZEITIG }, arbeiter));
  return { gesamt: aufgaben.length, erledigt, ausgeschoepft: naechste >= aufgaben.length };
}

module.exports = { status, richteEin, suche, webWorte };
