// Findet die Website zu Firmen, für die in OpenStreetMap keine eingetragen ist, indem naheliegende
// Domains ausprobiert werden (autohaus-meier.de, meier-ulm.de …). Jeder Fund wird gegengeprüft –
// die Seite muss Postleitzahl bzw. Ort UND den Firmennamen tragen, sonst wird sie verworfen.
// Eine Suchmaschinen-Abfrage gibt es bewusst nicht: die Anbieter sperren automatische Anfragen per Captcha.
const { ladeSeite, htmlZuText, leseLinks } = require('./web');
const { normal, enthaelt, GENERISCH } = require('./impressum');

const hostVon = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const namensTeile = (name) => normal(name).split(' ').filter((w) => w.length >= 3 && !GENERISCH.has(w));

// Gehört die Seite wirklich zu dieser Firma? Ortsbezug (PLZ oder Ort) und Namensbezug müssen beide stimmen.
async function gehoertZu(url, k) {
  const start = await ladeSeite(url, 8000, { rendern: false });
  if (!start) return '';
  const host = hostVon(start.url);
  // Leitet die geratene Adresse woandershin (Werkstattkette, Portal), muss der Firmenname auch in der neuen Domain stecken.
  if (host !== hostVon(url) && !namensTeile(k.name).some((t) => enthaelt(normal(host), t))) return '';
  let text = htmlZuText(start.html);
  const ortPasst = (t) => (k.plz ? t.includes(k.plz) : enthaelt(normal(t), normal(k.ort)));
  if (!ortPasst(text)) {
    const impressum = leseLinks(start.html, start.url).find((l) => /impressum|imprint|kontakt/i.test(l.href + ' ' + l.text) && hostVon(l.href) === host);
    const seite = impressum && (await ladeSeite(impressum.href, 8000, { rendern: false }));
    if (!seite) return '';
    text += '\n' + htmlZuText(seite.html);
    if (!ortPasst(text)) return '';
  }
  const teile = namensTeile(k.name);
  const heu = normal(host.replace(/\.[a-z]{2,}$/, '') + ' ' + text.slice(0, 20000));
  return teile.length && teile.filter((t) => enthaelt(heu, t)).length >= Math.ceil(teile.length / 2) ? start.url : '';
}

function rateDomains(k) {
  const fuell = ['gmbh', 'ug', 'ag', 'kg', 'co', 'mbh', 'ek', 'und', 'dr', 'med'];
  const alle = normal(k.name).split(' ').filter((w) => w.length >= 2 && !fuell.includes(w)).slice(0, 4);
  const eigen = namensTeile(k.name).slice(0, 3);
  if (!eigen.length) return [];
  const ort = normal(k.ort || '').split(' ')[0];
  const varianten = new Set([alle.join('-'), alle.join(''), eigen.join('-'), ort && eigen.join('-') + '-' + ort, ort && alle.join('-') + '-' + ort]);
  return [...varianten].filter((v) => v && v.length >= 5 && v.length <= 40).map((v) => `https://www.${v}.de`);
}

async function findeWebsite(k) {
  if (!k.plz && !k.ort) return ''; // ohne Ortsangabe lässt sich ein Fund nicht gegenprüfen
  for (const url of rateDomains(k)) {
    const treffer = (await gehoertZu(url, k)) || (await gehoertZu(url.replace('://www.', '://'), k));
    if (treffer) return treffer;
  }
  return '';
}

module.exports = { findeWebsite };
