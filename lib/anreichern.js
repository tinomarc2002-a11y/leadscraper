// Macht aus einem OpenStreetMap-Kandidaten einen geprüften Lead: Website laden, Impressum auswerten,
// Inhaber bestimmen und die Sicherheit der Angabe einstufen.
const { ladeSeite, htmlZuText, leseLinks, leseMeta } = require('./web');
const I = require('./impressum');

const RE = {
  impressum: /impressum|imprint|legal[-_ ]?notice|anbieterkennzeichnung|rechtliche[-_ ]?hinweise|rechtliches/i,
  ueber: /(ue|ü)ber[-_ ]?uns|about|wir[-_ ]?(ue|ü)ber|team|unternehmen|philosophie|firmengeschichte|wer[-_ ]wir[-_ ]sind/i,
  kontakt: /kontakt|contact/i,
  karriere: /karriere|\bjobs?\b|stellenangebot|stellenanzeige|offene[-_ ]stellen|career|wir[-_ ]suchen|ausbildung/i,
};
const ANBIETER_RE = /angaben\s+gem(ä|ae)(ß|ss)\s*§\s*5|§\s*5\s*(tmg|ddg)/i;
const HAT_IMPRESSUM =/angaben\s+gem(ä|ae)(ß|ss)\s*§\s*5|§\s*5\s*(tmg|ddg)|impressum/i;

const ohneWww = (h) => h.replace(/^www\./, '');

function findeLink(links, host, re, fremdErlaubt = false) {
  for (const l of links) {
    let u;
    try { u = new URL(l.href); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || /\.(pdf|jpe?g|png|docx?|zip)$/i.test(u.pathname)) continue;
    if (!fremdErlaubt && ohneWww(u.hostname) !== host) continue;
    let pfad = u.pathname + u.search;
    try { pfad = decodeURIComponent(pfad); } catch {}
    if (re.test(pfad) || re.test(l.text)) return u.href;
  }
  return '';
}

const telLinks = (links) => links.filter((l) => /^tel:/i.test(l.href)).map((l) => { try { return I.saeubereTelefon(decodeURIComponent(l.href.slice(4))); } catch { return ''; } }).filter(Boolean);
const mailLinks = (links) => links.filter((l) => /^mailto:/i.test(l.href)).flatMap((l) => { try { return I.findeEmails(decodeURIComponent(l.href.slice(7).split('?')[0])); } catch { return []; } });

function maKlasse(z) {
  return z < 10 ? '1–9' : z < 50 ? '10–49' : z < 250 ? '50–249' : '250+';
}

const RF_FAKTOR = { 'GmbH & Co. KG': 2, GmbH: 1.3, gGmbH: 1.5, UG: 0.5, AG: 5, SE: 8, KGaA: 8, 'e.K.': 0.7, GbR: 0.6, OHG: 1, KG: 1.3, 'e.V.': 1, eG: 3, PartG: 1 };

// Mitarbeiterzahl: echte Angabe von der Website, sonst gezählte Team-Seite, sonst grobe Schätzung aus Branche und Rechtsform.
function schaetzeMitarbeiter({ basis, rechtsform, anzahlGf, karriere, textZahl, teamZahl }) {
  // Sehr große Zahlen stammen bei kleinen Betrieben meist von Herstellern oder Verbänden, die auf der Seite erwähnt werden.
  if (textZahl && (textZahl <= 3000 || ['AG', 'SE', 'KGaA'].includes(rechtsform))) return { zahl: textZahl, quelle: 'Angabe auf Website' };
  let z = basis * (RF_FAKTOR[rechtsform] ?? 0.6);
  if (anzahlGf > 1) z *= 1.4;
  if (karriere) z *= 1.4;
  z = Math.max(1, Math.round(z));
  if (teamZahl >= 3 && teamZahl >= z) return { zahl: teamZahl, quelle: 'Team-Seite gezählt' };
  return { zahl: z, quelle: 'grobe Schätzung' };
}

function waehleEmail(kandidaten, host, nachname) {
  const nn = nachname ? I.normal(nachname) : '';
  const stamm = host.split('.').slice(-2).join('.');
  const rang = (e) => {
    const [lokal, domain] = e.split('@');
    if (/^(datenschutz|privacy|webmaster|abuse|noreply|no-reply|bewerbung|jobs|karriere|presse)/.test(lokal)) return 9;
    const eigen = domain.endsWith(stamm);
    if (nn.length >= 4 && I.enthaelt(I.normal(lokal), nn)) return eigen ? 0 : 2;
    if (eigen) return /^(info|kontakt|mail|office|post|praxis|hallo|service|buero|anfrage|empfang|zentrale)/.test(lokal) ? 1 : 3;
    return /(gmail|gmx|web\.de|t-online|outlook|hotmail|yahoo|icloud|aol|freenet|posteo|mailbox)/.test(domain) ? 4 : 6;
  };
  return [...new Set(kandidaten)].sort((a, b) => rang(a) - rang(b))[0] || '';
}

function beschreibe(meta, startText) {
  let b = meta.beschreibung;
  // Ohne Meta-Beschreibung: erster richtiger Satz der Startseite, sonst der Seitentitel.
  const istSatz = (z) => z.length >= 80 && z.length <= 500 && /^[A-ZÄÖÜ„"]/.test(z) && z.split(' ').length >= 10 && (z.match(/\d/g) || []).length < 6 && !/cookie|datenschutz|javascript|©|\bUhr\b|öffnungszeiten/i.test(z);
  if (!b) b = startText.split('\n').find(istSatz) || (/^(start(seite)?|home|willkommen|herzlich willkommen)\b/i.test(meta.titel) ? '' : meta.titel);
  b = (b || '').replace(/\s+/g, ' ').trim();
  return b.length > 240 ? b.slice(0, 237).replace(/\s+\S*$/, '') + '…' : b;
}

async function anreichern(k) {
  const lead = {
    id: k.id, name: k.name, branche: k.branche, brancheId: k.brancheId, beschreibung: '',
    inhaber: '', anrede: '', rolle: '', weitere: '', personen: [], status: 'unbekannt', hinweise: [],
    rechtsform: '', firmierung: '', register: '',
    telefon: I.saeubereTelefon(k.telefon), email: (k.email || '').toLowerCase(),
    strasse: k.strasse, plz: k.plz, ort: k.ort, entfernungKm: k.entfernungKm,
    maZahl: 0, maKlasse: '', maQuelle: '', website: k.website, impressumUrl: '', erfasstAm: new Date().toISOString().slice(0, 10),
  };
  const fertig = (extra = {}) => {
    const ma = schaetzeMitarbeiter({ basis: k.maBasis, rechtsform: lead.rechtsform, anzahlGf: 0, karriere: false, textZahl: 0, teamZahl: 0, ...extra });
    Object.assign(lead, { maZahl: ma.zahl, maKlasse: maKlasse(ma.zahl), maQuelle: ma.quelle, hinweise: lead.hinweise.join(' · ') });
    return lead;
  };

  if (!k.website) { lead.hinweise.push('Keine Website bekannt – Inhaber nicht prüfbar'); return fertig(); }
  if (k.websiteGefunden) lead.hinweise.push('Website über den Firmennamen ermittelt (nicht in OpenStreetMap eingetragen)');
  let start = await ladeSeite(k.website);
  // Veraltete Unterseiten-Links: dann wenigstens die Startseite der Domain versuchen.
  if (!start) { try { const u = new URL(k.website); if (u.pathname.length > 1) start = await ladeSeite(u.origin); } catch {} }
  if (!start) { lead.hinweise.push('Website nicht erreichbar'); return fertig(); }

  const startUrl = new URL(start.url);
  const host = ohneWww(startUrl.hostname);
  const links = leseLinks(start.html, start.url);
  const startText = htmlZuText(start.html);
  const meta = leseMeta(start.html);
  // Abgelaufene Domains landen bei Domainhändlern – das ist nicht mehr die Website des Unternehmens.
  if (/domain (is|may be) for sale|diese domain (steht|kann)|domain (zu verkaufen|zum verkauf|kaufen)|buy this domain|sedoparking|parkingcrew/i.test(startText.slice(0, 3000))) {
    lead.hinweise.push('Domain ist nicht mehr aktiv (steht zum Verkauf)');
    return fertig();
  }
  lead.website = startUrl.origin + (startUrl.pathname.length > 1 ? startUrl.pathname : '');
  lead.beschreibung = beschreibe(meta, startText);

  // Impressum suchen: verlinkte Seite, sonst übliche Pfade, sonst die Startseite selbst (Onepager).
  let impUrl = findeLink(links, host, RE.impressum, true);
  let imp = impUrl && impUrl !== start.url ? await ladeSeite(impUrl) : null;
  if (!imp) {
    for (const pfad of ['/impressum', '/impressum.html', '/imprint', '/impressum.php']) {
      const versuch = await ladeSeite(startUrl.origin + pfad, 8000);
      if (versuch && HAT_IMPRESSUM.test(htmlZuText(versuch.html).slice(0, 6000))) { imp = versuch; break; }
    }
  }
  let impText = imp ? htmlZuText(imp.html) : '';
  let impLinks = imp ? leseLinks(imp.html, imp.url) : [];
  const onepager = !impText && ANBIETER_RE.test(startText);
  if (onepager) { impText = startText; impLinks = links; }

  const ueberUrl = findeLink(links, host, RE.ueber);
  const kontaktUrl = findeLink(links, host, RE.kontakt);
  const [ueber, kontakt] = await Promise.all([
    ueberUrl && ueberUrl !== start.url ? ladeSeite(ueberUrl) : null,
    kontaktUrl && kontaktUrl !== start.url && kontaktUrl !== ueberUrl ? ladeSeite(kontaktUrl) : null,
  ]);
  const ueberText = ueber ? htmlZuText(ueber.html) : '';
  const kontaktText = kontakt ? htmlZuText(kontakt.html) : '';
  const kontaktLinks = kontakt ? leseLinks(kontakt.html, kontakt.url) : [];
  // Manche Seiten führen das Impressum nur auf der Kontaktseite oder verlinken es erst dort.
  if (!impText && kontakt) {
    const spaet = findeLink(kontaktLinks, host, RE.impressum, true);
    if (spaet && spaet !== kontakt.url) imp = await ladeSeite(spaet);
    if (imp) { impText = htmlZuText(imp.html); impLinks = leseLinks(imp.html, imp.url); }
    else if (ANBIETER_RE.test(kontaktText)) { imp = kontakt; impText = kontaktText; impLinks = kontaktLinks; }
  }
  lead.impressumUrl = imp ? imp.url : onepager ? start.url : '';

  const mitarbeiter = {
    karriere: !!findeLink(links, host, RE.karriere, true),
    textZahl: Math.max(I.findeMitarbeiterzahl(startText), I.findeMitarbeiterzahl(ueberText)),
    teamZahl: I.zaehleTeam(ueberText),
  };

  if (!impText) {
    lead.hinweise.push('Kein Impressum gefunden');
    lead.telefon = telLinks(links)[0] || I.findeTelefon(kontaktText) || lead.telefon;
    lead.email = waehleEmail([...mailLinks(links), ...mailLinks(kontaktLinks), lead.email].filter(Boolean), host, '');
    return fertig(mitarbeiter);
  }

  const firma = I.findeFirma(impText, k.name, host);
  if (firma) { lead.firmierung = firma.name; lead.rechtsform = firma.rechtsform; }
  lead.register = I.findeRegister(impText);

  const nameNorm = I.normal(k.name);
  const hostNorm = I.normal(host.replace(/\.[a-z]{2,}$/, ''));
  const firmaNorm = I.normal(firma?.name);
  const imNamen = (f) => { const nn = I.normal(f.nachname); return nn.length >= 3 && [nameNorm, firmaNorm, hostNorm].some((h) => I.enthaelt(h, nn)); };

  // Fundstellen nach Verlässlichkeit: die erste nicht leere Stufe gewinnt.
  const funde = I.findeInhaber(impText);
  const sauber = (f) => f.bekannt && !f.unsicher;
  const [stufe, auswahl] = [
    ['klar', funde.filter((f) => f.stark && !f.nachGrenze && sauber(f))],
    ['anbieter', funde.filter((f) => f.anbieter && sauber(f))],
    ['spaet', funde.filter((f) => f.stark && f.nachGrenze && sauber(f))],
    ['schwach', funde.filter((f) => !f.stark && !f.anbieter && sauber(f))],
    ['unsauber', funde.filter((f) => f.stark && !sauber(f))],
  ].find(([, liste]) => liste.length) || ['', []];
  const haupt = auswahl.find(imNamen) || auswahl[0];

  if (haupt) {
    const kapital = !!firma && !['e.K.', 'GbR', 'PartG'].includes(firma.rechtsform);
    lead.inhaber = haupt.name;
    lead.rolle = haupt.rolle;
    lead.weitere = auswahl.filter((f) => f !== haupt).slice(0, 4).map((f) => f.name).join(', ');
    if (!lead.rechtsform && haupt.rolle === 'Inhaber') lead.rechtsform = 'Einzelunternehmen';

    lead.status = {
      klar: 'impressum',
      // Person direkt unter „Angaben gemäß § 5“: bei Einzelunternehmen der Inhaber, bei einer GmbH nicht zwingend.
      anbieter: kapital ? 'pruefen' : 'impressum',
      // Weiter hinten stehen auch Agenturen und Fotografen – nur zählen, wenn der Nachname zur Firma passt.
      spaet: imNamen(haupt) ? 'impressum' : 'pruefen',
      schwach: imNamen(haupt) && !kapital ? 'impressum' : 'pruefen',
      unsauber: 'pruefen',
    }[stufe];

    if (!haupt.bekannt) lead.hinweise.push('Vorname nicht in Namensliste');
    if (haupt.unsicher) lead.hinweise.push('Namensgrenze unsicher');
    if (stufe === 'spaet') lead.hinweise.push('Fundstelle im hinteren Teil des Impressums');
    if (stufe === 'schwach') lead.hinweise.push('Nur als „' + haupt.rolle + '“ genannt');
    if (stufe === 'anbieter' && kapital) lead.hinweise.push('Ohne Rollenbezeichnung genannt');
    if (auswahl.length > 1) lead.hinweise.push(auswahl.length + ' Personen genannt');
    if (ohneWww(new URL(k.website).hostname) !== host) lead.hinweise.push('Website leitet weiter auf ' + host);

    // Passt das Impressum überhaupt zu diesem Unternehmen? (Schutz vor Portal- und Konzernseiten)
    const tokens = nameNorm.split(' ').filter((w) => w.length >= 3 && !I.GENERISCH.has(w));
    // In Domain und Firmierung genügt ein Wortteil, im Fließtext zählt nur das ganze Wort („handel“ steckt sonst in „Handelsregister“).
    const worte = ' ' + I.normal(impText.slice(0, 4000)) + ' ';
    const treffer = tokens.filter((t) => I.enthaelt(hostNorm + ' ' + firmaNorm, t) || worte.includes(' ' + t + ' ')).length;
    if (tokens.length && treffer < Math.ceil(tokens.length / 2)) {
      lead.hinweise.push('Impressum nennt den Firmennamen nicht – evtl. Portal oder Konzernseite');
      if (lead.status === 'impressum') lead.status = 'pruefen';
    }

    // Zweite, unabhängige Fundstelle macht aus „laut Impressum“ ein „doppelt bestätigt“.
    const belege = [];
    if (imNamen(haupt)) belege.push('Nachname im Firmennamen');
    const voll = I.normal(haupt.kern);
    const andereSeiten = [onepager || !imp ? '' : startText, ueberText, kontaktText].map((t) => I.normal(t));
    if (andereSeiten.some((t) => t.includes(voll))) belege.push('auch auf weiterer Seite genannt');
    const nn = I.normal(haupt.nachname);
    const alleMails = [...mailLinks(impLinks), ...I.findeEmails(impText), ...mailLinks(links), ...mailLinks(kontaktLinks)];
    if (nn.length >= 4 && alleMails.some((e) => I.enthaelt(I.normal(e.split('@')[0]), nn))) belege.push('E-Mail-Adresse passt zum Namen');
    if (lead.status === 'impressum' && belege.length) lead.status = 'bestaetigt';
    if (belege.length) lead.hinweise.unshift('Belege: Impressum + ' + belege.join(' + '));

    const ausName = I.anredeFuer(haupt.vorname);
    lead.anrede = haupt.weiblich && auswahl.length === 1 ? (ausName === 'Herr' ? '' : 'Frau') : ausName;
    // Alle genannten Personen einzeln, Hauptkontakt zuerst – für Export, Kontaktwechsel im CRM und Registerabgleich.
    lead.personen = [haupt, ...auswahl.filter((f) => f !== haupt)].slice(0, 5).map((f, i) => ({
      name: f.name, vorname: f.vorname, nachname: f.nachname, rolle: f.rolle, anrede: i === 0 ? lead.anrede : I.anredeFuer(f.vorname),
    }));
  } else {
    lead.hinweise.push('Im Impressum keine Person eindeutig erkennbar');
  }

  // Im Impressum stehen auch Nummern von Kammern und Versicherern – nur den Teil davor nach der Firmennummer durchsuchen.
  const bereich = I.anbieterBereich(impText);
  const kopf = impText.slice(Math.max(0, bereich.start - 300), bereich.grenze);
  const fremdAb = kopf.search(/aufsichtsbeh|zuständige\s+kammer|kammer\s*:|berufsbezeichnung|versicherung|haftpflicht/i);
  lead.telefon = I.findeTelefon(fremdAb < 0 ? kopf : kopf.slice(0, fremdAb)) || telLinks(links)[0] || telLinks(impLinks)[0] || lead.telefon || I.findeTelefon(kontaktText);
  lead.email = waehleEmail(
    [...mailLinks(impLinks), ...I.findeEmails(impText), ...mailLinks(links), ...mailLinks(kontaktLinks), ...I.findeEmails(kontaktText), lead.email].filter(Boolean),
    host, haupt?.nachname,
  );
  const adr = I.findeAdresse(impText);
  if (adr && (!lead.plz || lead.plz === adr.plz)) {
    lead.strasse ||= adr.strasse; lead.plz ||= adr.plz; lead.ort ||= adr.ort;
  }
  return fertig({ ...mitarbeiter, anzahlGf: auswahl.length });
}

module.exports = { anreichern };
