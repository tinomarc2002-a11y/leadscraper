// Auswertung von Impressumstexten: Inhaber/Geschäftsführer, Rechtsform, Register, Kontaktdaten.
// Grundsatz: lieber keinen Namen liefern als einen falschen.
const { istVorname, anredeFuer } = require('./vornamen');

const GROSS = 'A-ZÄÖÜÀ-ÖØ-ÞŞİĞŁŚŻŹĆČŠŽĐ';
const KLEIN = 'a-zäöüßà-öø-ÿşığłśżźćčšžđńęąřěů';
const NAME_RE = new RegExp(`^[${GROSS}][${KLEIN}]+(?:['’-][${GROSS}][${KLEIN}]+)*$`);
const VERSAL_RE = new RegExp(`^[${GROSS}]{3,}(?:-[${GROSS}]{2,})*$`);
const FIRMENWORT_RE = /^(gmbh|ggmbh|ug|ag|kg|ohg|gbr|mbh|se|eg|e\.\s?k|e\.\s?v|ltd|&|\+|co\b|verwaltungs|beteiligungs|holding|gruppe|group|stiftung|gesellschaft)/i;
const INITIAL_RE = /^[A-ZÄÖÜ]\.$/;
const STRASSE_RE = /(stra(ß|ss)e|str\.?|weg|platz|allee|gasse|ring|damm|ufer|chaussee|steig|pfad)$/i;

const menge = (s) => new Set(s.split(/\s+/).filter(Boolean));
const PARTIKEL = menge('von van de der den zu zur vom da di del della la le el al ter ten dos bin ben');
const TITEL = menge(`dr prof dipl ing med dent vet rer nat jur phil hc h c m a b sc msc bsc mba ba ma llm ra pd priv doz kfm kffr oec pol habil univ päd psych
  biol chem phys math inform wirt wirtsch betriebsw betriebswirt betriebswirtin kaufmann kauffrau ingenieur ingenieurin fh th tu apotheker apothekerin
  zahnarzt zahnärztin facharzt fachärztin arzt ärztin rechtsanwalt rechtsanwältin steuerberater steuerberaterin architekt architektin meister
  physiotherapeut physiotherapeutin ergotherapeut ergotherapeutin logopäde logopädin heilpraktiker heilpraktikerin tierarzt tierärztin notar notarin`);
const FUELL = menge(`ist sind war des der die den dem das und durch unser unsere unserer ihr herr herrn frau geschäftsführer geschäftsführerin geschäftsführung
  inhaber inhaberin gesellschafter gesellschafterin vertretungsberechtigter vertretungsberechtigte vertretungsberechtigt vertreten
  einzelvertretungsberechtigt alleinvertretungsberechtigt jeweils namentlich persönlich haftender haftende geschäftsführender geschäftsführende
  gesellschaft firma website webseite seite dieser diese dieses betreiber eigentümer verantwortlicher verantwortliche vorstand vorsitzender vorsitzende
  alleiniger alleinige ceo gf sowie auch wird werden als unternehmens unternehmen praxis name`);
const STOPP = menge(`gmbh ug ag kg ohg gbr mbh co ltd inc se eg ev gesellschaft geschäftsführer geschäftsführerin geschäftsführung geschäftsleitung inhaber
  inhaberin gesellschafter vorstand vorsitzender vorsitzende aufsichtsrat prokurist telefon tel fon fax telefax mobil handy email e-mail mail internet web
  website webseite homepage www strasse straße weg platz allee registergericht amtsgericht handelsregister registernummer register hrb hra umsatzsteuer
  ust steuernummer steuer sitz anschrift adresse kontakt impressum datenschutz verantwortlich verantwortlicher haftung deutschland germany österreich
  schweiz herr frau verwaltungs beteiligungs holding management service services team praxis firma unternehmen angaben gemäß nach die der das und für
  mit bei sie wir unsere unser ihr ihre postfach berufsbezeichnung kammer zuständige aufsichtsbehörde berufshaftpflicht versicherung inhaltlich
  redaktion bildnachweis copyright alle rechte quelle diplom staatlich öffnungszeiten montag dienstag mittwoch donnerstag freitag samstag sonntag
  januar februar märz april mai juni juli august september oktober november dezember bank iban bic sparkasse volksbank zentrale standort filiale
  niederlassung büro vertrieb verkauf einkauf buchhaltung kundenservice kundendienst support karriere jobs startseite home über leistungen produkte
  referenzen aktuelles news galerie anfahrt agb widerruf cookie cookies einstellungen newsletter facebook instagram linkedin xing youtube menü menu
  suche login warenkorb shop online gesetzlich plattform streitbeilegung streitschlichtung verbraucher europäische kommission technik design
  konzept umsetzung gestaltung fotos bilder text texte hinweis hinweise information informationen`);

const TRENNER = /\s*(?:,|;|\||·|•|\/|&|\bund\b|\boder\b|\bsowie\b)\s*/i;

function istTitel(roh) {
  const teile = roh.toLowerCase().replace(/[().,:]/g, ' ').split(/[\s-]+/).filter(Boolean);
  if (!teile.length || !teile.every((p) => TITEL.has(p))) return false;
  return /[.(]/.test(roh) || teile.some((p) => p.length >= 4) || teile[0] === 'dr';
}

const titelFall = (w) => w.split('-').map((p) => p[0] + p.slice(1).toLowerCase()).join('-');

// Liest einen Personennamen am Anfang eines Textstücks. strikt = das Stück darf nichts anderes enthalten.
function leseName(stueck, strikt = false) {
  const woerter = stueck.trim().split(/\s+/).filter(Boolean).slice(0, 14);
  let i = 0, prof = false, dr = false, fuell = 0;
  for (; i < woerter.length; i++) {
    const w = woerter[i];
    const kern = w.replace(/^[("„“:–-]+|[.,;:)"“”]+$/g, '');
    if (!kern) continue;
    if (istTitel(w)) { if (/prof/i.test(w)) prof = true; if (/dr/i.test(w)) dr = true; continue; }
    if (!strikt && FUELL.has(kern.toLowerCase())) { if (!/^(herrn?|frau)$/i.test(kern)) fuell++; continue; }
    break;
  }
  const teile = [];
  let echte = 0;
  for (; i < woerter.length && echte < 4; i++) {
    const roh = woerter[i];
    let w = roh.replace(/^[("„“]+|[.,;:)"“”]+$/g, '');
    const versal = w.length > 1 && w === w.toUpperCase();
    if (echte >= 1 && (PARTIKEL.has(w) || (versal && PARTIKEL.has(w.toLowerCase())))) { teile.push(w.toLowerCase()); continue; }
    // Mittelinitial wie in „Rudolf M. Hefele“
    if (echte >= 1 && INITIAL_RE.test(roh) && woerter[i + 1]) { teile.push(roh); continue; }
    if (VERSAL_RE.test(w)) w = titelFall(w);
    if (!NAME_RE.test(w) || STOPP.has(w.toLowerCase()) || istTitel(roh)) break;
    teile.push(w);
    echte++;
    if (/[,;:)]$/.test(roh)) { i++; break; }
  }
  const beiwerk = (p) => PARTIKEL.has(p) || INITIAL_RE.test(p);
  while (teile.length && beiwerk(teile[teile.length - 1])) { teile.pop(); i--; }
  const namensteile = teile.filter((p) => !beiwerk(p));
  if (namensteile.length < 2) return null;
  const rest = woerter.slice(i).filter((w) => !istTitel(w));
  if (STRASSE_RE.test(teile[teile.length - 1]) || (rest[0] && (STRASSE_RE.test(rest[0]) || /^\d/.test(rest[0])))) return null;
  // „Max Mustermann GmbH“ ist eine Firma (z. B. die Komplementärin einer KG), keine Person.
  if (rest[0] && FIRMENWORT_RE.test(rest[0])) return null;
  if (strikt && rest.length) return null;
  const vorname = namensteile[0];
  const bekannt = istVorname(vorname);
  if (strikt && !bekannt) return null;
  // Mehr als zwei Namensteile ohne Partikel sind nur sicher, wenn der zweite ein weiterer Vorname ist (Hans Peter Müller).
  const unsicher = namensteile.length >= 3 && teile.length === namensteile.length && !istVorname(namensteile[1]);
  const kern = teile.join(' ');
  return {
    name: [prof && 'Prof.', dr && 'Dr.', kern].filter(Boolean).join(' '),
    kern, vorname, nachname: namensteile[namensteile.length - 1],
    bekannt, unsicher, fuell, anzahlTeile: namensteile.length,
  };
}

const F = '(?:ä|ae)', U = '(?:ü|ue)';
const LABELS = [
  { stark: true, rolle: 'Geschäftsführender Gesellschafter', re: `gesch${F}ftsf${U}hrende[rn]?\\s+gesellschafter(?:in(?:nen)?)?` },
  { stark: true, rolle: 'Geschäftsführer', re: `gesch${F}ftsf${U}hr(?:er(?:s|[:*/_]?-?in(?:nen)?)?|ung)(?![a-zäöü])` },
  { stark: true, rolle: 'Geschäftsleitung', re: `gesch${F}ftsleit(?:er(?:in)?|ung)` },
  { stark: true, rolle: 'Inhaber', re: `(?<![a-zäöü])(?:praxis|firmen|betriebs|gesch${F}fts|laden|studio)?inhaber(?:s|[:*/_]?-?in)?(?![a-zäöü])` },
  { stark: true, rolle: 'Inhaber', re: `(?<![a-zäöü])inh\\.` },
  { stark: true, rolle: 'Vertretungsberechtigt', re: `(?:gesetzlich\\s+)?vertreten\\s+durch|vertretungsberechtigte?[rn]?(?:\\s+personen?)?|vertr\\.\\s*d\\.` },
  { stark: true, rolle: 'Vorstand', re: `(?<![a-zäöü])vorstand(?:svorsitzende[rn]?|smitglied(?:er)?)?` },
  { stark: true, rolle: 'Geschäftsführer', re: `(?<![a-z])(?:ceo|managing\\s+directors?|owner)(?![a-z])` },
  { stark: true, rolle: 'Betreiber', re: `(?<![a-zäöü])betreiber(?:in)?(?![a-zäöü])` },
  { stark: true, rolle: 'Gesellschafter', re: `(?<![a-zäöü])gesellschafter(?:in(?:nen)?)?(?![a-zäöü])` },
  { stark: false, rolle: 'Inhaltlich verantwortlich', re: `(?:inhaltlich|redaktionell)\\s+verantwortlich(?:e[rn]?)?[^\\n:]{0,60}|verantwortlich(?:e[rn]?)?\\s+(?:f${U}r\\s+den\\s+inhalt|i\\.?\\s?s\\.?\\s?d\\.?|im\\s+sinne|gem${F}(?:ß|ss)|nach)[^\\n:]{0,60}|v\\.\\s?i\\.\\s?s\\.\\s?d\\.\\s?p\\.?` },
  { stark: false, rolle: 'Ansprechpartner', re: `ansprechpartner(?:in)?` },
].map((l) => ({ ...l, re: new RegExp(l.re, 'gi') }));

// Je genauer die Rollenbezeichnung, desto eher wird sie bei Mehrfachnennung übernommen.
const RANG = ['Geschäftsführender Gesellschafter', 'Geschäftsführer', 'Inhaber', 'Vorstand', 'Gesellschafter', 'Geschäftsleitung', 'Betreiber', 'Vertretungsberechtigt'];
const rang = (rolle) => { const i = RANG.indexOf(rolle); return i < 0 ? 99 : i; };

const ANKER_RE = /angaben\s+gem(?:ä|ae)(?:ß|ss)\s*§|§\s*5\s*(?:tmg|ddg)|anbieterkennzeichnung/i;
const ENDE_RE = /haftung für (?:inhalte|links)|haftungsausschluss|haftungshinweis|disclaimer|urheberrecht|web-?design|realisierung|realisation|umsetzung:|konzeption|bildnachweis|bildquellen|bildrechte|fotonachweis|quellenangaben|hosting/i;

// Der eigentliche Anbieterteil eines Impressums: beginnt bei „Angaben gemäß § 5“ (oder der ersten Rollenbezeichnung)
// und endet, wo Haftungstexte, Bildnachweise oder Agentur-Hinweise anfangen. Menüs davor zählen so nicht mit.
function anbieterBereich(text) {
  let start = text.search(ANKER_RE);
  if (start < 0) {
    const stellen = LABELS.filter((l) => l.stark).map((l) => { l.re.lastIndex = 0; const m = l.re.exec(text); l.re.lastIndex = 0; return m ? m.index : -1; }).filter((i) => i >= 0);
    start = stellen.length ? Math.min(...stellen) : 0;
  }
  const ende = text.slice(start + 40).search(ENDE_RE);
  return { start, grenze: ende < 0 ? text.length : ende + start + 40 };
}

// Sammelt die Namen, die auf ein Label folgen (gleiche Zeile, sonst die nächsten Zeilen).
function namenNach(text, ab) {
  const zeilen = text.slice(ab, ab + 450).split('\n').slice(0, 7);
  const namen = [];
  let ohneTreffer = 0;
  for (let z = 0; z < zeilen.length; z++) {
    const stuecke = zeilen[z].replace(/\([^)]*\)/g, ' ').split(TRENNER).filter((s) => /[A-Za-zÄÖÜäöü]/.test(s));
    const inZeile = [];
    // Nur das Stück direkt hinter dem Label darf Füllwörter enthalten; alles Weitere muss ein reiner, bekannter Name sein.
    for (let s = 0; s < stuecke.length; s++) {
      const n = leseName(stuecke[s], s > 0 || namen.length > 0);
      if (n) inZeile.push(n);
      else if (inZeile.length || s > 0) break;
    }
    if (inZeile.length) namen.push(...inZeile);
    else if (namen.length || ++ohneTreffer > 2) break;
    if (namen.length >= 6) break;
  }
  return namen;
}

function findeInhaber(text) {
  const { grenze } = anbieterBereich(text);
  const funde = [];
  for (const label of LABELS) {
    for (const m of text.matchAll(label.re)) {
      const weiblich = /(führer|inhaber|betreiber|gesellschafter)in$/i.test(m[0]);
      for (const n of namenNach(text, m.index + m[0].length)) {
        // Unbekannte Vornamen nur, wenn der Name unmittelbar auf eine eindeutige Rolle folgt („Inhaber: Xaver Huber“).
        if (!n.bekannt && !(label.stark && n.fuell === 0 && n.anzahlTeile === 2)) continue;
        funde.push({ ...n, rolle: label.rolle, stark: label.stark, weiblich, pos: m.index, nachGrenze: m.index > grenze });
      }
    }
  }
  // Einzelunternehmer ohne Label: Name steht direkt unter „Angaben gemäß § 5 …“.
  if (!funde.some((f) => f.stark && !f.nachGrenze)) {
    const kopf = /angaben\s+gem(?:ä|ae)(?:ß|ss)\s*§\s*5[^\n]*|diensteanbieter:?|anbieterkennzeichnung[^\n]*|^impressum$/gim;
    for (const m of text.matchAll(kopf)) {
      const zeilen = text.slice(m.index + m[0].length, m.index + m[0].length + 300).split('\n').slice(0, 6);
      for (const z of zeilen) {
        const n = leseName(z, true);
        if (n) { funde.push({ ...n, rolle: 'Inhaber', stark: false, anbieter: true, pos: m.index, nachGrenze: false }); break; }
      }
    }
  }
  funde.sort((a, b) => a.pos - b.pos);
  const eindeutig = [];
  for (const f of funde) {
    const vorhanden = eindeutig.find((e) => normal(e.kern) === normal(f.kern));
    if (!vorhanden) eindeutig.push(f);
    else if (f.stark && (!vorhanden.stark || rang(f.rolle) < rang(vorhanden.rolle))) {
      Object.assign(vorhanden, { stark: true, rolle: f.rolle, nachGrenze: vorhanden.stark ? vorhanden.nachGrenze : f.nachGrenze, weiblich: f.weiblich, anbieter: false });
    }
  }
  return eindeutig;
}

const RF_ALT = 'GmbH\\s*(?:&|und|u\\.)\\s*Co\\.?\\s*KG(?:aA)?|UG\\s*\\(haftungsbeschr(?:ä|ae)nkt\\)\\s*&\\s*Co\\.?\\s*KG|gGmbH|GmbH|UG\\s*\\(haftungsbeschr(?:ä|ae)nkt\\)|UG|KGaA|AG|SE|KG|OHG|oHG|e\\.\\s?K(?:fm|fr)?\\.?|GbR|PartG\\s?mbB|PartGmbB|PartG|eG|e\\.\\s?V\\.|mbH|Ltd\\.?';
const RF_RE = new RegExp(`([A-ZÄÖÜ0-9][^\\n|]{0,90}?)[\\s,]+(${RF_ALT})(?![A-Za-zÄÖÜäöüß])`, 'g');

function rechtsformKurz(roh) {
  const r = roh.replace(/\s+/g, ' ');
  if (/GmbH.*Co.*KG|UG.*Co.*KG/i.test(r)) return 'GmbH & Co. KG';
  if (/^gGmbH/.test(r)) return 'gGmbH';
  if (/GmbH|mbH/.test(r)) return 'GmbH';
  if (/^UG/.test(r)) return 'UG';
  if (/^e\.\s?K/i.test(r)) return 'e.K.';
  if (/^e\.\s?V/i.test(r)) return 'e.V.';
  if (/^oHG|^OHG/.test(r)) return 'OHG';
  if (/^PartG/.test(r)) return 'PartG';
  if (/^Ltd/.test(r)) return 'Ltd.';
  return r;
}

const normal = (s) => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Domains schreiben Umlaute mal als „ue“, mal als „u“ – beide Formen vergleichen.
const schlicht = (s) => s.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
const enthaelt = (heu, nadel) => heu.includes(nadel) || schlicht(heu).includes(schlicht(nadel));

const GENERISCH = menge(`gmbh ug ag kg co ohg gbr mbh ek ev und the der die das fuer in im am an bei zum zur von dr med autohaus praxis zahnarztpraxis
  physiotherapie krankengymnastik ergotherapie logopaedie kuechen kuechenstudio studio haus zentrum center service services team gruppe group restaurant
  hotel gasthaus gasthof baeckerei metzgerei friseur salon apotheke kanzlei buero ingenieurbuero architekten immobilien versicherung versicherungen
  elektro elektrotechnik sanitaer heizung bau bauunternehmen dachdecker dachdeckerei schreinerei tischlerei zimmerei malerbetrieb maler garten
  landschaftsbau gartenbau metallbau fahrschule fitness optik optiker juwelier moebel kfz werkstatt pflegedienst pflege seniorenheim seniorenzentrum
  tierarztpraxis tierarzt zahnarzt arztpraxis gemeinschaftspraxis sohn soehne partner handel vertrieb technik haustechnik gebaeudetechnik auto
  autos automobile shop store markt fachmarkt betrieb firma online`);

const FREMD_RE = /versicherung|haftpflicht|kammer|verband|mitglied|aufsichtsbeh|hosting|hoster|provider|agentur|bank|sparkasse|quelle|foto|bild|©/i;

// Sucht die Firmierung des Anbieters. Fremde Firmen im Impressum (Versicherer, Verbände, Agenturen) werden übergangen.
function findeFirma(text, osmName, host = '') {
  const tokens = [...new Set(normal(osmName + ' ' + host.replace(/\.[a-z]{2,}$/, '')).split(' '))].filter((w) => w.length >= 3 && !GENERISCH.has(w));
  const { start, grenze } = anbieterBereich(text);
  let beste = null;
  for (const m of text.matchAll(RF_RE)) {
    if (m.index > grenze) break;
    const form = m[2];
    const zeileAb = text.lastIndexOf('\n', m.index) + 1;
    const zeilenEnde = text.indexOf('\n', m.index + m[0].length);
    const zeile = text.slice(zeileAb, zeilenEnde < 0 ? text.length : zeilenEnde);
    // „AG Köln, HRB 123“ ist ein Amtsgericht, keine Aktiengesellschaft.
    if (/^(AG|KG|SE|eG|UG)$/.test(form) && /amtsgericht|registergericht|HR\s?[AB]|handelsregister/i.test(zeile)) continue;
    if (m[1].length < 2 && form.length <= 3) continue;
    let name = (m[1] + ' ' + form).replace(/\s+/g, ' ').replace(/^(?:(?:impressum|pflichtangaben|kontakt|firma|anbieter|betreiber|diensteanbieter|herausgeber|copyright|©|\d{4})[\s:–|-]*)+/i, '').trim();
    // Ganze Sätze („… sind Zweigniederlassungen der XY GmbH“) auf den eigentlichen Firmennamen kürzen.
    if (name.split(' ').length > 5) name = name.replace(/^.*\s(?:der|die|des|von|bei|ist|sind)\s+(?=\S+(?:\s\S+){0,4}$)/, '');
    const n = normal(name);
    const punkte = tokens.filter((t) => enthaelt(n, t)).length;
    // Ohne Namensbezug zählt eine Firma nur, wenn sie ganz oben im Anbieterteil steht.
    if (!punkte && (FREMD_RE.test(zeile) || m.index < start || m.index > start + 500)) continue;
    if (!beste || punkte > beste.punkte) beste = { name, rechtsform: /GmbH\s*(?:&|und|u\.)\s*Co/i.test(name) ? 'GmbH & Co. KG' : rechtsformKurz(form), punkte };
  }
  return beste;
}

function findeRegister(volltext) {
  // Nur der Anbieterteil zählt – weiter hinten stehen oft Registerdaten von Agenturen oder Softwareanbietern.
  const { start, grenze } = anbieterBereich(volltext);
  const text = volltext.slice(Math.max(0, start - 200), Math.min(grenze, start + 1800));
  const nr = text.match(/\b(HR\s?[AB])\s*[:.]?\s*(?:Nr\.?\s*)?(\d{2,6}(?:\s?[A-Z]{1,2}\b)?)/);
  if (!nr) return '';
  const stadt = '([A-ZÄÖÜ][A-Za-zäöüß.\\-]+(?:[ ](?!HR)(?:am|an der|im|i\\.|a\\.|[A-ZÄÖÜ(])[A-Za-zäöüß.\\-()]*){0,3})';
  const gericht = text.match(new RegExp(`(?:Amtsgericht|Registergericht)[ ]*:?[ ]*(?:Amtsgericht[ ]+)?${stadt}`)) || text.match(new RegExp(`\\bAG[ ]+${stadt}[ ,]+HR[AB]`));
  return [gericht ? 'AG ' + gericht[1].trim().replace(/[,.]$/, '') : '', nr[1].replace(/\s/, '') + ' ' + nr[2].trim()].filter(Boolean).join(', ');
}

function saeubereTelefon(roh) {
  const t = String(roh || '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').replace(/[^\d+\s/()-]/g, '').trim();
  const ziffern = t.replace(/\D/g, '').length;
  return ziffern >= 7 && ziffern <= 15 ? t : '';
}

function findeTelefon(text) {
  const m = text.match(/(?:^|[^a-zäöü])(?:Tel(?:efon(?:nummer)?)?|Fon|Phone|Mobil|Handy|Rufnummer)\b\.?[ ]*[:.]?[ ]*((?:\+|00|\(0)?\d[\d /().–-]{5,22}\d)/i);
  return m ? saeubereTelefon(m[1]) : '';
}

const EMAIL_RE = /[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

function findeEmails(text) {
  const klar = text
    .replace(/\s*(?:\(|\[|\{)\s*(?:at|ät|a)\s*(?:\)|\]|\})\s*/gi, '@')
    .replace(/\s*(?:\(|\[|\{)\s*(?:dot|punkt)\s*(?:\)|\]|\})\s*/gi, '.');
  return [...new Set((klar.match(EMAIL_RE) || []).map((e) => e.toLowerCase().replace(/\.$/, '')))]
    .filter((e) => !/\.(png|jpe?g|gif|webp|svg|css|js)$/.test(e) && !/(sentry|wixpress|example|domain|muster|beispiel|ihre-?mail|name@)/.test(e));
}

function findeAdresse(text) {
  const m = text.match(/(?:^|\n|,\s*)([A-ZÄÖÜ][A-Za-zäöüß.\- ]{2,40}?\s\d{1,4}\s?[a-zA-Z]?(?:\s?-\s?\d{1,4})?)\s*(?:\n|,)\s*(?:D\s?-\s?)?(\d{5})\s+([A-ZÄÖÜ][A-Za-zäöüß.\-]+(?:[ /][A-Za-zäöüß.()]+){0,3})/);
  return m ? { strasse: m[1].trim(), plz: m[2], ort: m[3].trim() } : null;
}

function findeMitarbeiterzahl(text) {
  const werte = [];
  const sammle = (re) => {
    for (const m of text.matchAll(re)) {
      const roh = m[1];
      const n = parseInt(roh.replace(/\./g, ''), 10);
      if (n < 2 || n > 200000) continue;
      if (!roh.includes('.') && n >= 1900 && n <= 2100) continue; // Jahreszahl
      werte.push(n);
    }
  };
  sammle(/(\d{1,3}(?:\.\d{3})+|\d{1,5})\s*\+?\s*(?:[a-zäöüß-]+e[rnm]?\s+){0,2}(?:Mitarbeiter|Mitarbeitende|Beschäftigte|Angestellte|Fachkräfte|Teammitglieder|Kolleginnen und Kollegen)/g);
  sammle(/(\d{1,4})[- ]köpfige[sn]?\s+(?:Team|Mannschaft|Belegschaft)/gi);
  sammle(/Team\s+(?:von|aus|mit)\s+(?:über\s+|mehr als\s+|rund\s+|ca\.\s*|etwa\s+)?(\d{1,4})\b/gi);
  return werte.length ? Math.max(...werte) : 0;
}

// Zählt unterschiedliche Personennamen auf einer Team-Seite (Untergrenze für die Teamgröße).
function zaehleTeam(text) {
  const namen = new Set();
  for (const zeile of text.split('\n')) {
    if (zeile.length > 45) continue;
    const n = leseName(zeile, true);
    if (n) namen.add(n.kern.toLowerCase());
  }
  return namen.size;
}

module.exports = {
  findeInhaber, findeFirma, findeRegister, findeTelefon, saeubereTelefon, findeEmails, findeAdresse, findeMitarbeiterzahl, zaehleTeam,
  leseName, normal, enthaelt, GENERISCH, anredeFuer, anbieterBereich,
};
