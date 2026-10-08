// Gemeinsame Bausteine der Suche für beide Betriebsarten: lokal läuft sie als Hintergrundauftrag im Server,
// auf Vercel ruft der Browser dieselben Schritte in kleinen Etappen ab.
const BRANCHEN = require('./branchen');
const { anreichern } = require('./anreichern');
const { findeWebsite } = require('./websuche');
const { imCrm, hostVon } = require('./crm');

const RANG = { unbekannt: 0, pruefen: 1, impressum: 2, bestaetigt: 3, register: 4 };
const MA_KLASSEN = ['1–9', '10–49', '50–249', '250+'];

const mitFrist = (versprechen, ms) => Promise.race([versprechen, new Promise((_, nein) => setTimeout(() => nein(new Error('Zeitüberschreitung')), ms))]);

function leseParameter(roh) {
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
    if (imCrm(lead, kennungen)) return { grund: 'crm', websiteGefunden };
    return { lead, grund: '', websiteGefunden };
  } catch {
    return { grund: 'fehler', websiteGefunden };
  }
}

module.exports = { RANG, leseParameter, waehleKandidaten, pruefeKandidat };
