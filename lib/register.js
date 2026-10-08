// Abgleich mit dem amtlichen Handelsregister (handelsregister.de): sucht die Firma und liest aus dem
// „strukturierten Registerinhalt“ (SI), wer als vertretungsberechtigt eingetragen ist.
// Das Portal erlaubt höchstens 60 Abrufe pro Stunde – deshalb ist der Abgleich bewusst gedrosselt.
const fs = require('fs');
const path = require('path');
const { starteBrowser } = require('./chrome');
const { normal } = require('./impressum');
const { anredeFuer } = require('./vornamen');

const DATA = path.join(__dirname, '..', 'data');
const ZAEHLER = path.join(DATA, 'register-abrufe.json');
const CACHE = path.join(DATA, 'register-cache.json');
const SUCHSEITE = 'https://www.handelsregister.de/rp_web/erweitertesuche/welcome.xhtml';
const MAX_JE_STUNDE = 50; // Sicherheitsabstand zur Grenze von 60
const ABRUFE_JE_SUCHE = 2; // Suche + Registerinhalt
const CACHE_TAGE = 30;
// Rollen-Codes aus dem XJustiz-Standard: wer zur Leitung zählt und wer ausdrücklich nicht.
const LEITUNG = { '086': 'Geschäftsführer', 194: 'Vorstand', 252: 'Persönlich haftender Gesellschafter' };
const KEINE_LEITUNG = new Set(['285', '275', '287', '288']); // Prokurist, Kommanditist, Rechtsträger, Registergericht
const LEITUNG_RE = /gesch(ä|ae)ftsf(ü|ue)hr|vorstand|inhaber|pers(ö|oe)nlich haftend|partner|direktor|liquidator|abwickler/i;
const FIRMENFORM_RE = /\b(GmbH|gGmbH|UG|AG|KG|OHG|SE|eG|e\.\s?K|mbH)/;

const lese = (datei, standard) => { try { return JSON.parse(fs.readFileSync(datei, 'utf8')); } catch { return standard; } };
const schreibe = (datei, daten) => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(datei, JSON.stringify(daten)); };

const abrufeLetzteStunde = () => lese(ZAEHLER, []).filter((t) => Date.now() - t < 3600e3);
const freieSuchen = () => Math.max(0, Math.floor((MAX_JE_STUNDE - abrufeLetzteStunde().length) / ABRUFE_JE_SUCHE));
const zaehle = (anzahl) => schreibe(ZAEHLER, [...abrufeLetzteStunde(), ...Array(anzahl).fill(Date.now())]);

class LimitErreicht extends Error {}

// „AG Kempten (Allgäu), HRB 3340“ → { art: 'HRB', nummer: '3340', gericht: 'Kempten (Allgäu)' }
function zerlegeRegister(text) {
  const nr = /(HR\s?[AB])\s*(\d+)/.exec(text || '');
  if (!nr) return null;
  return { art: nr[1].replace(/\s/, ''), nummer: nr[2], gericht: (/AG\s+([^,]+)/.exec(text) || [])[1]?.trim() || '' };
}

const tag = (xml, name) => (new RegExp(`<tns:${name}>([^<]*)</tns:${name}>`).exec(xml) || [])[1]?.trim() || '';

// Liest aus dem XJustiz-Datensatz, wer die Firma vertritt: natürliche Personen (ohne Prokuristen) und –
// bei einer GmbH & Co. KG – die Komplementär-Gesellschaft, deren Geschäftsführer in einem eigenen Eintrag stehen.
function leseVertretung(xml) {
  const vertreter = new Set([...xml.matchAll(/<tns:vertretungsberechtigte>\s*<tns:ref\.rollennummer>(\d+)</g)].map((m) => m[1]));
  const personen = [];
  let gesellschaft = null;
  for (const block of xml.split('<tns:beteiligung>').slice(1)) {
    // Manche Gerichte schreiben die Rolle zusätzlich als Kommentar dazu: <!--Vorstand--><code>194</code>
    const [, kommentar = '', code = ''] = /<tns:rollenbezeichnung[^>]*>\s*(?:<!--([\s\S]*?)-->)?\s*<code>([^<]*)</.exec(block) || [];
    if (KEINE_LEITUNG.has(code) || /prokurist|kommanditist/i.test(kommentar)) continue;
    const rolle = LEITUNG[code] || (LEITUNG_RE.test(kommentar) ? kommentar.replace(/\(r\)/g, 'r').replace(/\(in\)/g, '').trim() : '');
    // Unbekannte Rollen zählen nur, wenn das Register sie ausdrücklich als vertretungsberechtigt führt.
    if (!rolle && !vertreter.has(tag(block, 'rollennummer'))) continue;
    if (block.includes('<tns:natuerlichePerson>')) {
      const vorname = tag(block, 'vorname'), nachname = [tag(block, 'namensvorsatz'), tag(block, 'nachname')].filter(Boolean).join(' ');
      if (!vorname || !nachname) continue;
      // Das Register führt alle Vornamen; für die Ansprache genügt der erste (Rufname).
      personen.push({ name: [tag(block, 'titel'), vorname.split(' ')[0], nachname].filter(Boolean).join(' '), vorname, nachname, rolle: rolle || 'Vertretungsberechtigt', anrede: anredeFuer(vorname.split(' ')[0]) });
    } else if (block.includes('<tns:organisation>')) {
      const nr = /(HR\s?[AB])\s*(\d+)/.exec(tag(block, 'registernummer'));
      const gericht = (/<tns:inlaendischesRegistergericht>\s*<tns:gericht[^>]*>\s*(?:<!--[\s\S]*?-->)?\s*<code>([^<]*)</.exec(block) || [])[1];
      const firma = tag(block, 'bezeichnung.aktuell').replace(/&amp;/g, '&');
      // Das Gericht der Komplementärin steht mal als Code, mal als Name da; fehlt die Nummer ganz, wird über den Namen gesucht.
      const gerichtName = tag(block, 'registerbehoerde').replace(/^Amtsgericht\s+/, '');
      if (gesellschaft || !rolle) continue;
      if (nr && (gericht || gerichtName)) gesellschaft = { art: nr[1].replace(/\s/, ''), nummer: nr[2], ...(gericht ? { gerichtCode: gericht.replace(/R$/, '') } : { gericht: gerichtName }), firma };
      else if (firma) gesellschaft = { firma };
    }
  }
  return { personen, gesellschaft };
}

const gleichePerson = (a, b) => {
  const na = normal(a.nachname).split(' ').pop(), nb = normal(b.nachname).split(' ').pop();
  const va = normal(a.vorname).split(' ')[0], vb = normal(b.vorname).split(' ')[0];
  return !!na && na === nb && (va === vb || va[0] === vb[0]);
};

// Eine Suche im Portal samt Abruf des Registerinhalts. such: { art, nummer, gericht | gerichtCode, firma }
async function holeEintrag(seite, such) {
  const schluessel = such.nummer ? `${such.art}|${such.nummer}|${such.gerichtCode || normal(such.gericht)}` : 'name|' + normal(such.firma);
  const cache = lese(CACHE, {});
  if (cache[schluessel] && Date.now() - cache[schluessel].zeit < CACHE_TAGE * 864e5) return cache[schluessel];
  if (freieSuchen() < 1) throw new LimitErreicht();
  zaehle(ABRUFE_JE_SUCHE);

  const stichwort = such.firma.replace(/\b(GmbH\s*&\s*Co\.?\s*KG|gGmbH|GmbH|UG \(haftungsbeschränkt\)|UG|AG|KG|OHG|e\.\s?K\.?|mbH)(?![\p{L}])/gu, ' ').replace(/[^\p{L}\p{N} &.-]/gu, ' ').replace(/\s+/g, ' ').trim();
  await seite.oeffne(SUCHSEITE);
  const geladen = seite.warteAufLaden();
  await seite.werte(`(() => {
    const such = ${JSON.stringify(such)}, stichwort = ${JSON.stringify(stichwort)};
    const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
    const feld = (id) => document.getElementById(id);
    if (such.nummer) {
      feld('form:registerArt_input').value = such.art;
      feld('form:registerNummer').value = such.nummer;
      const gerichte = [...feld('form:registergericht_input').options];
      const ort = norm((such.gericht || '').replace(/^Amtsgericht /, '').split(/[ (,]/)[0]);
      const treffer = such.gerichtCode ? gerichte.filter((o) => o.value === such.gerichtCode) : ort.length > 2 ? gerichte.filter((o) => norm(o.text).includes(ort)) : [];
      if (treffer.length === 1) feld('form:registergericht_input').value = treffer[0].value;
      else feld('form:schlagwoerter').value = stichwort.split(' ').slice(0, 2).join(' ');
    } else {
      feld('form:schlagwoerter').value = stichwort;
    }
    if (feld('form:ergebnisseProSeite_input')) feld('form:ergebnisseProSeite_input').value = '25';
    feld('form:btnSuche').click();
  })()`);
  await geladen;
  const zeilen = await seite.werte(`[...document.querySelectorAll('tr[data-ri]')].map((tr) => ({
    gericht: tr.querySelector('td.fontTableNameSize')?.innerText.trim() || '',
    name: tr.querySelector('span.marginLeft20')?.innerText.trim() || '',
    sitz: tr.querySelector('td.sitzSuchErgebnisse')?.innerText.trim() || '',
    status: tr.querySelectorAll('span.verticalText')[1]?.innerText.trim() || '',
    si: [...tr.querySelectorAll('a.dokumentList')].find((a) => a.innerText.trim() === 'SI')?.id || '',
  }))`);
  // Passende Zeile: bei Suche über die Nummer muss die Nummer stimmen, bei Namenssuche der vollständige Name.
  const ziel = normal(such.firma);
  const aktiv = zeilen.filter((z) => z.name && z.si && !/gelöscht/i.test(z.status));
  const passend = aktiv.filter((z) => (such.nummer ? new RegExp(`${such.art}\\s*${such.nummer}(?!\\d)`).test(z.gericht) : normal(z.name) === ziel));
  const zeile = passend.length === 1 ? passend[0] : passend.find((z) => normal(z.name) === ziel);
  if (!zeile) return { fehlt: true, mehrdeutig: passend.length > 1 };

  const antwort = await seite.werte(`(async () => {
    const f = document.getElementById('ergebnissForm'), daten = new URLSearchParams(new FormData(f));
    daten.set(${JSON.stringify(zeile.si)}, ${JSON.stringify(zeile.si)});
    const r = await fetch(f.action, { method: 'POST', body: daten, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    return (await r.text()).slice(0, 400000);
  })()`, 60000);
  const eintrag = { zeit: Date.now(), firma: zeile.name, sitz: zeile.sitz, gericht: zeile.gericht };
  // Liefert das Registergericht gerade keine Daten, kommt eine Fehlerseite statt XML – dann nicht zwischenspeichern.
  if (!antwort.includes('<tns:beteiligung>')) return { ...eintrag, ohneDetails: true };
  Object.assign(eintrag, { stand: tag(antwort, 'abrufdatum'), ...leseVertretung(antwort) });
  cache[schluessel] = eintrag;
  schreibe(CACHE, cache);
  return eintrag;
}

async function pruefeEinen(seite, lead) {
  const reg = zerlegeRegister(lead.register);
  const firma = lead.firmierung || lead.name;
  let eintrag = await holeEintrag(seite, { ...(reg || {}), firma });
  if (eintrag.fehlt) return { ergebnis: 'nicht_gefunden', hinweis: eintrag.mehrdeutig ? 'Im Handelsregister nicht eindeutig zuzuordnen' : 'Im Handelsregister nicht gefunden' };
  const kopf = { registerFirma: eintrag.firma, registerGericht: eintrag.gericht, stand: eintrag.stand };
  const ohneDetails = { ergebnis: 'nicht_verfuegbar', ...kopf, hinweis: 'Firma im Handelsregister gefunden, das Registergericht liefert aber gerade keine Detaildaten – später erneut versuchen' };
  if (eintrag.ohneDetails) return ohneDetails;

  let personen = eintrag.personen;
  if (!personen.length && eintrag.gesellschaft) {
    // GmbH & Co. KG: vertreten durch die Komplementär-GmbH → deren Geschäftsführer nachschlagen.
    const komplementaer = await holeEintrag(seite, eintrag.gesellschaft);
    if (komplementaer.ohneDetails) return ohneDetails;
    personen = (komplementaer.personen || []).map((p) => ({ ...p, rolle: p.rolle + ' (' + eintrag.gesellschaft.firma + ')' }));
  }
  if (!personen.length) return { ergebnis: 'nicht_verfuegbar', ...kopf, hinweis: 'Registereintrag nennt keine vertretungsberechtigte Person' };
  const bisher = (lead.personen || []).filter((p) => p.nachname);
  const bestaetigt = bisher.length > 0 && personen.some((p) => gleichePerson(p, bisher[0]));
  return { ergebnis: bestaetigt ? 'bestaetigt' : bisher.length ? 'abweichend' : 'ergaenzt', ...kopf, personen };
}

// Überträgt das Prüfergebnis auf den Lead. Das Register ist die maßgebliche Quelle und hat Vorrang vor dem Impressum.
function wendeAn(lead, r) {
  lead.registerGeprueft = new Date().toISOString().slice(0, 10);
  lead.registerErgebnis = r.ergebnis;
  lead.registerHinweis = r.hinweis || '';
  if (!r.personen) return lead;
  const vorher = lead.inhaber;
  // Der bisherige Hauptkontakt bleibt vorn, sofern er im Register steht.
  const bisher = (lead.personen || [])[0];
  const vorn = (p) => (bisher && gleichePerson(p, bisher) ? 0 : 1);
  const sortiert = [...r.personen].sort((a, b) => vorn(a) - vorn(b)).slice(0, 5);
  Object.assign(lead, {
    personen: sortiert, inhaber: sortiert[0].name, anrede: sortiert[0].anrede, rolle: sortiert[0].rolle,
    weitere: sortiert.slice(1).map((p) => p.name).join(', '), status: 'register', firmierung: r.registerFirma || lead.firmierung,
  });
  const stand = r.stand ? ` (Stand ${r.stand.split('-').reverse().join('.')})` : '';
  lead.registerHinweis = r.ergebnis === 'bestaetigt' ? 'Im Handelsregister eingetragen' + stand
    : r.ergebnis === 'abweichend' ? `Handelsregister nennt eine andere Person als das Impressum (dort: ${vorher}) – Registerangabe übernommen` + stand
    : 'Aus dem Handelsregister ergänzt' + stand;
  return lead;
}

// Prüft mehrere Leads nacheinander in einer Browsersitzung. fortschritt(lead, ergebnis) wird je Lead aufgerufen.
async function pruefeLeads(leads, fortschritt, abgebrochen = () => false) {
  let browser = null;
  try {
    for (const lead of leads) {
      if (abgebrochen()) break;
      let r;
      if (!zerlegeRegister(lead.register) && !FIRMENFORM_RE.test(lead.firmierung || lead.name)) {
        r = { ergebnis: 'nicht_eingetragen', hinweis: 'Einzelunternehmen oder Freiberufler – nicht im Handelsregister eingetragen' };
      } else {
        try {
          browser ||= await starteBrowser();
          r = await pruefeEinen(browser.seite, lead);
        } catch (e) {
          r = e instanceof LimitErreicht
            ? { ergebnis: 'limit', hinweis: 'Stundenlimit des Registerportals erreicht – später fortsetzen' }
            : { ergebnis: 'fehler', hinweis: 'Registerportal nicht erreichbar (' + e.message + ')' };
          if (r.ergebnis === 'fehler') { browser?.schliesse(); browser = null; }
        }
      }
      if (r.ergebnis === 'limit') { fortschritt(lead, r); break; }
      fortschritt(wendeAn(lead, r), r);
    }
  } finally {
    browser?.schliesse();
  }
}

module.exports = { pruefeLeads, freieSuchen, leseVertretung, zerlegeRegister };
