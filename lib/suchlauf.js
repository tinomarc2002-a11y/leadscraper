// Gemeinsame Bausteine der Suche für beide Betriebsarten: lokal läuft sie als Hintergrundauftrag im Server,
// auf Vercel ruft der Browser dieselben Schritte in kleinen Etappen ab.
const BRANCHEN = require('./branchen');
const { anreichern } = require('./anreichern');
const { findeWebsite } = require('./websuche');
const { imCrm, hostVon } = require('./crm');
const { RECHTSFORM_GRUPPEN, rechtsformGruppe } = require('../public/spalten');

// Startpunkt der bundesweiten Suche, wenn kein Ort angegeben ist: die geografische Mitte Deutschlands.
const MITTE = { lat: 51.163, lon: 10.447, name: 'Mitte Deutschlands' };

// Wie viele Unternehmen die bundesweite Suche einsammeln muss: Nur ein Teil hat eine Website und einen sicher
// erkennbaren Inhaber, und was schon im CRM liegt, zählt nicht mit.
const bedarfFuer = (p, imCrmAnzahl = 0) => Math.max(300, p.anzahl * 6 + (p.ohneCrm ? imCrmAnzahl : 0));

const RANG = { unbekannt: 0, pruefen: 1, impressum: 2, bestaetigt: 3, register: 4 };
const MA_KLASSEN = ['1–9', '10–49', '50–249', '250+'];

const mitFrist = (versprechen, ms) => Promise.race([versprechen, new Promise((_, nein) => setTimeout(() => nein(new Error('Zeitüberschreitung')), ms))]);

// Eigene Stichwörter aus der Suchzeile: höchstens zehn, nur unverfängliche Zeichen.
function leseStichworte(roh) {
  const worte = (Array.isArray(roh) ? roh : []).map((w) => String(w).replace(/[^\p{L}\p{N} &.+-]/gu, ' ').replace(/\s+/g, ' ').trim()).filter((w) => w.length >= 3 && w.length <= 40);
  return [...new Map(worte.map((w) => [w.toLowerCase(), w])).values()].slice(0, 10);
}

// Macht aus der Auswahl die Suchbranchen: Katalogeinträge plus je eine „Branche“ pro eigenem Stichwort.
// Ein Stichwort findet Firmen, die es im Namen tragen (z. B. „Hundeschule“).
function branchenFuer(ids, stichworte) {
  const frei = leseStichworte(stichworte).map((wort) => ({
    id: 'wort:' + wort.toLowerCase(), gruppe: 'frei', label: wort, ma: 8, tags: [],
    name: wort.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), stichworte: [wort],
  }));
  // „alle“ steht für den gesamten Katalog einschließlich der Auffang-Kategorien.
  return [...((ids || []).includes('alle') ? BRANCHEN : BRANCHEN.filter((b) => (ids || []).includes(b.id))), ...frei];
}

function leseParameter(roh) {
  const p = {
    ort: String(roh.ort || '').trim().slice(0, 120),
    radiusKm: Math.min(150, Math.max(1, +roh.radiusKm || 25)),
    // ohne Umkreisgrenze: vom Startpunkt aus so weit wie nötig, innerhalb Deutschlands
    deutschland: roh.deutschland === true,
    anzahl: Math.min(1000, Math.max(1, Math.round(+roh.anzahl) || 50)),
    branchen: (Array.isArray(roh.branchen) ? roh.branchen : []).includes('alle') ? ['alle'] : (Array.isArray(roh.branchen) ? roh.branchen : []).filter((id) => BRANCHEN.some((b) => b.id === id)),
    stichworte: leseStichworte(roh.stichworte),
    maKlassen: (Array.isArray(roh.maKlassen) ? roh.maKlassen : MA_KLASSEN).filter((k) => MA_KLASSEN.includes(k)),
    minStatus: roh.minStatus in RANG ? roh.minStatus : 'impressum',
    ohneCrm: roh.ohneCrm !== false,
    websiteSuchen: roh.websiteSuchen === true,
    // Weitere Filter: ohne Angabe sind alle Rechtsformen erlaubt.
    rechtsformen: Array.isArray(roh.rechtsformen) ? roh.rechtsformen.filter((g) => RECHTSFORM_GRUPPEN.some(([id]) => id === g)) : RECHTSFORM_GRUPPEN.map(([id]) => id),
    nurTelefon: roh.nurTelefon === true,
    nurEmail: roh.nurEmail === true,
    nurKarriere: roh.nurKarriere === true,
  };
  if (!p.ort && !p.deutschland) throw new Error('Bitte einen Ort oder eine PLZ eingeben.');
  if (!p.branchen.length && !p.stichworte.length) throw new Error('Bitte mindestens eine Branche auswählen oder ein eigenes Stichwort eingeben.');
  if (!p.maKlassen.length) throw new Error('Bitte mindestens eine Größenklasse auswählen.');
  if (!p.rechtsformen.length) throw new Error('Bitte mindestens eine Rechtsform auswählen.');
  return p;
}

// Welche Kandidaten überhaupt geprüft werden: Ohne Website lässt sich kein Inhaber prüfen – solche Einträge nur,
// wenn die Website ermittelt werden soll oder „alle“ gewünscht ist. Was schon im CRM liegt, fällt weg.
function waehleKandidaten(kandidaten, p, kennungen) {
  const ohneWebsiteErlaubt = p.websiteSuchen || RANG[p.minStatus] === 0;
  return {
    schlange: kandidaten.filter((k) => (k.website || ohneWebsiteErlaubt) && !imCrm(k, kennungen)),
    ohneWebsite: ohneWebsiteErlaubt ? 0 : kandidaten.filter((k) => !k.website).length,
    schonImCrm: kandidaten.filter((k) => imCrm(k, kennungen)).length,
  };
}

// Prüft einen Kandidaten vollständig. grund sagt, warum er ggf. nicht als Lead zählt.
// bekannteHosts: Websites, die in dieser Suche schon vergeben sind (eine ermittelte Website derselben Firma wäre eine Filiale).
async function pruefeKandidat(k, p, kennungen, bekannteHosts = new Set()) {
  let websiteGefunden = false;
  try {
    if (!k.website && p.websiteSuchen) {
      const fund = await mitFrist(findeWebsite(k), 45000).catch(() => '');
      if (fund && !bekannteHosts.has(hostVon(fund))) { bekannteHosts.add(hostVon(fund)); k = { ...k, website: fund, websiteGefunden: true }; websiteGefunden = true; }
    }
    const lead = await mitFrist(anreichern(k), 90000);
    if (RANG[lead.status] < RANG[p.minStatus]) return { grund: 'sicherheit', websiteGefunden };
    if (!p.maKlassen.includes(lead.maKlasse)) return { grund: 'groesse', websiteGefunden };
    if (!p.rechtsformen.includes(rechtsformGruppe(lead.rechtsform)) || (p.nurTelefon && !lead.telefon) || (p.nurEmail && !lead.email) || (p.nurKarriere && !lead.karriereUrl)) return { grund: 'filter', websiteGefunden };
    if (imCrm(lead, kennungen)) return { grund: 'crm', websiteGefunden };
    return { lead, grund: '', websiteGefunden };
  } catch {
    return { grund: 'fehler', websiteGefunden };
  }
}

module.exports = { RANG, MITTE, bedarfFuer, leseParameter, branchenFuer, waehleKandidaten, pruefeKandidat };
