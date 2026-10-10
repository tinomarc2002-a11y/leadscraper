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
const HALTBAR_TAGE = 180; // so lange gilt das Ergebnis einer geprüften Adresse
const MAX_ADRESSEN = 150000; // je Branche
const AUSWERTUNG = 3; // erhöhen, wenn die Auswertung besser wird: gemerkte Ergebnisse werden dann neu geprüft
const UNERREICHBAR_TAGE = 20; // nicht erreichbare Adressen früher noch einmal versuchen (Server war vielleicht nur kurz weg)

// Wörter, die in der Internet-Adresse einer Firma dieser Branche typischerweise vorkommen (Umlaute ausgeschrieben).
const WEBWORTE = {
  kuechen: ['kuechen', 'kuechenstudio'], autohaus: ['autohaus', 'automobile', 'autocenter', 'autohandel'], wohnmobil: ['wohnmobil', 'caravan', 'reisemobil'], motorrad: ['motorrad'],
  boote: ['yacht', 'bootsbau', 'bootswerft'], moebel: ['moebel', 'einrichtungshaus'], juwelier: ['juwelier', 'goldschmied'], immobilien: ['immobilien', 'makler', 'hausverwaltung', 'immo'],
  solar: ['solar', 'photovoltaik'], fenster: ['fensterbau', 'fenster'], wintergarten: ['wintergarten', 'wintergaerten', 'terrassendach'],
  shk: ['heizung', 'sanitaer', 'haustechnik', 'waermepumpe', 'badstudio', 'klimatechnik', 'kaeltetechnik', 'installateur'], kamin: ['kamin', 'ofenbau', 'kachelofen'], pool: ['poolbau', 'schwimmbad', 'saunabau'],
  galabau: ['galabau', 'gartenbau', 'landschaftsbau', 'gartengestaltung', 'gaertnerei', 'gartenpflege', 'baumpflege'],
  bau: ['bauunternehmen', 'massivhaus', 'hausbau', 'bautraeger', 'baugeschaeft', 'hochbau', 'tiefbau', 'bauservice', 'strassenbau', 'geruestbau'],
  dach: ['dachdecker', 'bedachung', 'zimmerei', 'holzbau', 'dachbau', 'dachtechnik', 'spenglerei', 'klempnerei'], schreiner: ['schreinerei', 'tischlerei', 'moebelbau', 'innenausbau'], elektro: ['elektrotechnik', 'elektro'],
  metallbau: ['metallbau', 'stahlbau', 'treppenbau', 'schlosserei', 'edelstahl'], boden: ['parkett', 'bodenbelaege'], zahnarzt: ['zahnarzt', 'zahnaerzte', 'kieferorthopaed', 'zahn', 'dental'],
  aesthetik: ['aesthetik', 'schoenheitsklinik'], hoerakustik: ['hoergeraete', 'hoerakustik'], optiker: ['optik', 'optiker'], ebike: ['fahrrad', 'zweirad', 'ebike'],
  architekt: ['architekt', 'ingenieurbuero', 'planungsbuero'], finanz: ['finanzberatung', 'versicherungsmakler', 'finanz', 'versicherung'], landtechnik: ['landtechnik', 'landmaschinen', 'baumaschinen'],
  physio: ['physio', 'krankengymnastik', 'osteopath'], ergo: ['ergotherapie'], logo: ['logopaedie'], pflege: ['pflegedienst', 'seniorenresidenz', 'tagespflege', 'pflege', 'altenheim', 'seniorenheim'],
  arzt: ['arztpraxis', 'hausarzt', 'praxis', 'facharzt', 'kinderarzt', 'augenarzt', 'orthopaed', 'dermatolog', 'kardiolog', 'gynaekolog', 'urolog', 'internist'],
  tierarzt: ['tierarzt', 'tierklinik'], apotheke: ['apotheke'], sanitaetshaus: ['sanitaetshaus', 'orthopaedietechnik'],
  gastro: ['restaurant', 'gasthaus', 'gasthof', 'pizzeria', 'ristorante', 'bistro', 'catering', 'brauhaus', 'wirtshaus'], hotel: ['hotel'], baeckerei: ['baeckerei', 'konditorei'], metzgerei: ['metzgerei', 'fleischerei'],
  friseur: ['friseur', 'frisoer', 'coiffeur', 'haarstudio', 'hairstyl'],
  kosmetik: ['kosmetik', 'beauty'], kfz: ['kfz', 'autowerkstatt', 'autoservice', 'karosserie', 'autolackier', 'reifenservice'], spedition: ['spedition', 'logistik', 'umzuege', 'transporte'],
  reinigung: ['gebaeudereinigung', 'gebaeudeservice', 'reinigung', 'gebaeudemanagement'],
  sicherheit: ['sicherheitsdienst', 'wachschutz', 'security'], maler: ['malerbetrieb', 'malermeister', 'stuckateur', 'maler'], fliesen: ['fliesen'],
  industrie: ['maschinenbau', 'anlagenbau', 'werkzeugbau', 'zerspanung', 'metalltechnik', 'kunststofftechnik', 'automation', 'fertigungstechnik'],
  it: ['software', 'systemhaus', 'itservice', 'edv'], steuer: ['steuerberater', 'steuerkanzlei', 'steuerberatung'], recht: ['rechtsanwalt', 'kanzlei', 'anwalt', 'notar'], fitness: ['fitness'], fahrschule: ['fahrschule'],
};

// Wo das Wort in der Adresse mehrdeutig ist, muss der Seiteninhalt eindeutig zur Branche gehören
// („solar“ steckt auch im Nachnamen Solarek oder in Solaris-Software, „zahn“ auch in Zahnrad).
const WEBINHALT = {
  solar: 'photovoltaik|solaranlage|solarmodul|solarstrom|solarthermie|pv-anlage|solartechnik',
  elektro: 'elektroinstallation|elektrotechnik|elektriker|elektromeister',
  optiker: 'brille|augenoptik|kontaktlinsen',
  fenster: 'fensterbau|kunststofffenster|holzfenster|fenster und türen|fenster & türen',
  kfz: 'werkstatt|kfz-meister|inspektion|reparatur|lackierung|reifenwechsel',
  it: 'softwareentwicklung|it-service|systemhaus|it-dienstleist|edv-',
  kosmetik: 'kosmetikstudio|kosmetikbehandlung|kosmetikerin',
  zahnarzt: 'zahnarzt|zahnärzt|zahnmedizin|kieferorthop|implantolog|prophylaxe|zahntechnik|dentallabor',
  arzt: 'sprechzeiten|sprechstunde|facharzt|fachärzt|hausarzt|hausärzt|patienten',
  pflege: 'pflegedienst|ambulante pflege|pflegeheim|tagespflege|altenpflege|seniorenheim|pflegeeinrichtung|intensivpflege',
  immobilien: 'immobilie|makler|hausverwaltung|mietverwaltung',
  finanz: 'finanzberat|versicherungsmakler|vermögensberat|baufinanzierung|versicherungsagentur|finanzplanung',
  autohaus: 'autohaus|neuwagen|gebrauchtwagen|fahrzeugangebot',
  gastro: 'speisekarte|reservier|mittagstisch|unsere küche|catering|biergarten',
  friseur: 'friseur|frisör|haarschnitt|coiffeur|haarverlängerung',
  spedition: 'spedition|transporte|logistik|umzug|umzüge',
  reinigung: 'gebäudereinigung|unterhaltsreinigung|glasreinigung|reinigungsservice|reinigungsfirma|büroreinigung',
  sicherheit: 'sicherheitsdienst|objektschutz|wachdienst|bewachung|werkschutz|veranstaltungsschutz',
  maler: 'malerbetrieb|malermeister|malerarbeiten|anstrich|lackierarbeiten|fassadengestaltung',
  recht: 'rechtsanw|kanzlei|notar|fachanwalt',
  industrie: 'maschinenbau|anlagenbau|werkzeugbau|zerspanung|cnc|fertigung|automatisierung',
  metallbau: 'metallbau|stahlbau|schlosserei|edelstahlverarbeitung|geländer|schweiß',
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

// Ordnet in einem Durchgang durch die Liste jeder passenden .de-Adresse eine Branche zu (die erste, deren Wort im
// Namen steckt). eintraege = [{ b, worte }]. Liefert [[adresse, branche], …].
async function findeAdressen(eintraege, uebersprungen = new Set()) {
  const aufgaben = [], zahl = new Map();
  if (!eintraege.length) return aufgaben;
  // Ein gemeinsamer Ausdruck sortiert die über 90 % der Adressen ohne jedes Branchenwort sofort aus.
  const irgendeins = new RegExp([...new Set(eintraege.flatMap((e) => e.worte))].join('|'));
  for await (const name of readline.createInterface({ input: fs.createReadStream(LISTE) })) {
    // Umlaut-Adressen sind verschlüsselt gespeichert („xn--…“) – für den Vergleich lesbar machen.
    const lesbar = name.startsWith('xn--') ? ohneUmlaute(domainToUnicode(name + '.de').slice(0, -3)) : name;
    if (!irgendeins.test(lesbar)) continue;
    const e = eintraege.find((x) => x.worte.some((w) => lesbar.includes(w)) && (zahl.get(x) || 0) < MAX_ADRESSEN);
    if (!e || uebersprungen.has(name + '.de')) continue;
    zahl.set(e, (zahl.get(e) || 0) + 1);
    aufgaben.push([name + '.de', e.b]);
  }
  return aufgaben;
}

// Ergebnisse bereits geprüfter Adressen – zugleich die Firmen-Datenbank. Jede Zeile der Datei:
// { d: Adresse, b: Branche, z: Zeitpunkt, l: Lead oder null }. Die Datei wird zeilenweise gelesen, sie kann groß werden.
let geprueft = null, ladend = null;
const zaehler = { adressen: 0, firmen: 0, sicher: 0 };
const SICHER = new Set(['impressum', 'bestaetigt', 'register']);
function merke(schluessel, eintrag) {
  const alt = geprueft.get(schluessel);
  if (!alt) zaehler.adressen++;
  if (alt?.l) { zaehler.firmen--; if (SICHER.has(alt.l.status)) zaehler.sicher--; }
  if (eintrag.l) { zaehler.firmen++; if (SICHER.has(eintrag.l.status)) zaehler.sicher++; }
  geprueft.set(schluessel, eintrag);
}
function ladeGeprueft() {
  return (ladend ||= (async () => {
    geprueft = new Map();
    const grenze = Date.now() - HALTBAR_TAGE * 864e5, grenzeKurz = Date.now() - UNERREICHBAR_TAGE * 864e5;
    try {
      for await (const zeile of readline.createInterface({ input: fs.createReadStream(GEPRUEFT) })) {
        if (!zeile) continue;
        try { const e = JSON.parse(zeile); if (e.z > (e.u ? grenzeKurz : grenze) && e.v === AUSWERTUNG) merke(e.d + '|' + e.b, e.p ? { l: null, p: e.p } : { l: e.l }); } catch {}
      }
    } catch {} // Datei gibt es noch nicht
    return geprueft;
  })());
}
// Wie viele Adressen geprüft sind und wie viele Firmen daraus geworden sind.
async function zaehle() { await ladeGeprueft(); return { ...zaehler }; }

const mitFrist = (versprechen, ms) => Promise.race([versprechen, new Promise((_, nein) => setTimeout(() => nein(new Error('Zeitüberschreitung')), ms))]);

// Prüft eine Adresse für eine Branche. Liefert den Lead oder null (keine Firma dieser Branche, kein deutsches Impressum …).
// umkreis = { lat, lon, km } bei Umkreis-Suchen; bundesweit fehlt es.
async function pruefeAdresse(domain, b, umkreis) {
  const merker = await ladeGeprueft(), schluessel = domain + '|' + b.id;
  const bekannt = merker.get(schluessel);
  // Fertig geprüft → Ergebnis steht fest. Nur der Standort bekannt (p) → außerhalb des Umkreises ist nichts zu tun,
  // sonst wird die Adresse jetzt vollständig ausgewertet.
  if (bekannt && !bekannt.p) return bekannt.l;
  if (bekannt && umkreis && imUmkreis(bekannt.p, umkreis) === false) return null;
  let lead = null, standort = '', unerreichbar = false;
  try {
    lead = await mitFrist(anreichern({
      id: 'd:' + domain, name: domain.replace(/\.de$/, ''), brancheId: b.id, branche: b.label, maBasis: b.ma, website: 'https://' + domain,
      telefon: '', email: '', strasse: '', plz: '', ort: '', entfernungKm: null,
      // Bei mehrdeutigen Wörtern muss die Seite erkennbar zur Branche gehören („solaris-beratung.de“ ist keine Solarfirma).
      ausInternet: true, ohneRendern: true, mussEnthalten: WEBINHALT[b.id] || '.', darfNichtEnthalten: b.nicht || '',
      umkreis,
    }), 45000);
    standort = lead.zuWeit || '';
    unerreichbar = /nicht erreichbar/.test(lead.hinweise);
    // Ohne deutsche Postleitzahl im Impressum ist es kein brauchbarer Firmeneintrag.
    if (standort || lead.passtNicht || !/^\d{5}$/.test(lead.plz || '')) lead = null;
  } catch (e) {
    // Ein abgestürzter Hilfsprozess sagt nichts über die Adresse – nicht merken, beim nächsten Mal neu prüfen.
    if (e.message === ABGESTUERZT) return null;
    unerreichbar = true;
  }
  merke(schluessel, standort ? { l: null, p: standort } : { l: lead });
  fs.appendFile(GEPRUEFT, JSON.stringify({ d: domain, b: b.id, z: Date.now(), v: AUSWERTUNG, l: lead, ...(standort && { p: standort }), ...(unerreichbar && { u: 1 }) }) + '\n', () => {});
  return lead;
}

// Durchsucht das Internet für die gewählten Branchen. nimm(lead) entscheidet, ob ein Lead zählt (Filter des Nutzers);
// weiter() sagt, ob noch gesucht werden soll. radiusKm = 0 heißt ganz Deutschland.
// stand(erledigt, gesamt) meldet laufend den Fortschritt. So entsteht auch die Datenbank: bundesweit, ohne Obergrenze.
async function suche({ branchen, zentrum, radiusKm, ortName, bekannteHosts, melde, weiter, nimm, stand }) {
  const eintraege = branchen.map((b) => ({ b, worte: webWorte(b).filter((w) => w.length >= 4) })).filter((e) => e.worte.length);
  melde(eintraege.length === 1 ? `Internet-Suche: Adressen mit „${eintraege[0].worte.join('“, „')}“ werden herausgesucht …` : `Internet-Suche: passende Adressen für ${eintraege.length} Branchen werden herausgesucht …`);
  const aufgaben = await findeAdressen(eintraege, new Set(bekannteHosts));
  // Reihenfolge: zuerst, was schon einmal geprüft wurde (sofort da), dann Adressen mit dem Ortsnamen, dann der Rest
  // in gemischter Folge (sonst kämen immer zuerst die Adressen mit „a“).
  const merker = await ladeGeprueft();
  const ort = ohneUmlaute(ortName || '').replace(/[^a-z]+/g, '');
  const streu = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
  const rang = ([domain, b]) => (merker.has(domain + '|' + b.id) ? 0 : ort.length >= 4 && domain.includes(ort) ? 1 : 2);
  const ordnung = new Map(aufgaben.map((a) => [a, [rang(a), streu(a[0])]]));
  aufgaben.sort((x, y) => ordnung.get(x)[0] - ordnung.get(y)[0] || ordnung.get(x)[1] - ordnung.get(y)[1]);

  const umkreis = radiusKm ? { lat: zentrum.lat, lon: zentrum.lon, km: radiusKm } : null;
  let naechste = 0, erledigt = 0;
  stand?.(0, aufgaben.length);
  const arbeiter = async () => {
    while (weiter() && naechste < aufgaben.length) {
      const [domain, b] = aufgaben[naechste++];
      const lead = await pruefeAdresse(domain, b, umkreis);
      erledigt++;
      stand?.(erledigt, aufgaben.length);
      if (erledigt % 5 === 0) melde(`Internet-Suche: ${erledigt.toLocaleString('de-DE')} von ${aufgaben.length.toLocaleString('de-DE')} Adressen geprüft …`);
      if (!lead) continue;
      const k = koordinaten(lead.plz);
      const entfernung = k ? Math.round(distanzKm(zentrum.lat, zentrum.lon, k[0], k[1])) : null;
      if (radiusKm && (entfernung === null || entfernung > radiusKm)) continue;
      // Für die Karte: Lage der Postleitzahl (die genaue Adresse wird nicht nachgeschlagen)
      nimm({ ...lead, entfernungKm: entfernung, lat: k ? k[0] : null, lon: k ? k[1] : null });
    }
  };
  await Promise.all(Array.from({ length: GLEICHZEITIG }, arbeiter));
  return { gesamt: aufgaben.length, erledigt, ausgeschoepft: naechste >= aufgaben.length };
}

module.exports = { status, richteEin, suche, webWorte, zaehle };
