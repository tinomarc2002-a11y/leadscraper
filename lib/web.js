// Seiten laden und HTML in auswertbaren Text umwandeln (ohne externe Bibliotheken).
const fs = require('fs');
const os = require('os');
const path = require('path');
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { execFile } = require('child_process');

const KOPF = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.5',
};
const MAX_BYTES = 1_500_000;
const VERBINDUNG_MS = 5000; // nimmt ein Server so lange keine Verbindung an, ist die Website nicht (mehr) da

function istOeffentlicheAdresse(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    const h = u.hostname;
    if (!h.includes('.') || h.endsWith('.local') || h.includes(':')) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
    return true;
  } catch {
    return false;
  }
}

function dekodiere(puffer, typ = '') {
  let zeichensatz = (typ.match(/charset=([\w-]+)/i) || [])[1];
  if (!zeichensatz) zeichensatz = (puffer.subarray(0, 2048).toString('latin1').match(/charset=["']?([\w-]+)/i) || [])[1];
  try { return new TextDecoder(zeichensatz || 'utf-8').decode(puffer); } catch { return puffer.toString('utf8'); }
}

// Namensauflösung ohne Umweg über Windows: Dessen Auflösung läuft über wenige Arbeitsfäden und braucht für nicht
// (mehr) vorhandene Adressen mehrere Sekunden – bei Tausenden Adressen bremst das die ganze Suche aus.
// Lokal werden zuerst öffentliche DNS-Server gefragt (Cloudflare, Quad9, Google): Heimrouter beantworten nur wenige
// Anfragen pro Sekunde und setzen unter Last sekundenlang aus. Sind die öffentlichen Server nicht erreichbar
// (etwa im Firmennetz gesperrt), gilt der DNS-Server des Systems.
const DNS_SYSTEM = new dns.Resolver({ timeout: 3000, tries: 2 });
const DNS_OEFFENTLICH = process.env.VERCEL ? [] : [['1.1.1.1', '9.9.9.9', '8.8.8.8'], ['9.9.9.9', '8.8.8.8', '1.1.1.1'], ['8.8.8.8', '1.1.1.1', '9.9.9.9']].map((server) => {
  const r = new dns.Resolver({ timeout: 2000, tries: 2 });
  r.setServers(server);
  return r;
});
let dnsReihum = 0, dnsAusfaelle = 0;
const frage = (resolver, host) => new Promise((ja, nein) => resolver.resolve4(host, (fehler, adressen) => (fehler ? nein(fehler) : adressen.length ? ja(adressen) : nein(Object.assign(new Error('keine Adresse'), { code: 'ENODATA' })))));
async function frageOeffentlich(host) {
  try {
    const adressen = await frage(DNS_OEFFENTLICH[dnsReihum++ % DNS_OEFFENTLICH.length], host);
    dnsAusfaelle = 0;
    return adressen;
  } catch (e) {
    // „Gibt es nicht“ ist eine gültige Antwort; alles andere heißt: Server nicht erreichbar → System fragen.
    if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') { dnsAusfaelle = 0; throw e; }
    dnsAusfaelle++;
    return frage(DNS_SYSTEM, host);
  }
}
const aufgeloest = new Map();
function frageDns(host) {
  let p = aufgeloest.get(host);
  if (!p) {
    if (aufgeloest.size > 4000) aufgeloest.clear();
    // Nach mehreren Ausfällen in Folge gelten die öffentlichen Server als gesperrt.
    p = DNS_OEFFENTLICH.length && dnsAusfaelle < 6 ? frageOeffentlich(host) : frage(DNS_SYSTEM, host);
    p.catch(() => {});
    aufgeloest.set(host, p);
  }
  return p;
}
function loeseAuf(host, optionen, fertig) {
  if (typeof optionen === 'function') { fertig = optionen; optionen = {}; }
  const art = net.isIP(host);
  if (art) return fertig(null, optionen.all ? [{ address: host, family: art }] : host, art);
  frageDns(host).then(
    (adressen) => fertig(null, optionen.all ? adressen.map((address) => ({ address, family: 4 })) : adressen[0], 4),
    (fehler) => {
      // Adresse gibt es nicht → sofort aufgeben. Bei allem anderen (DNS-Server antwortet nicht, nur IPv6) Windows fragen.
      if (fehler.code === 'ENOTFOUND') return fertig(Object.assign(new Error('getaddrinfo ENOTFOUND ' + host), { code: 'ENOTFOUND' }));
      dns.lookup(host, optionen, fertig);
    },
  );
}

// Holt eine Seite, folgt Weiterleitungen und entpackt die Antwort. Wirft bei Verbindungsfehlern (der Aufrufer versucht
// es dann anders), liefert null bei „gibt es nicht“ oder falschem Inhaltstyp. zeit gilt für den ganzen Abruf.
function hole(url, zeit, zertPruefen = true, tiefe = 0, ende = Date.now() + zeit) {
  return new Promise((ja, nein) => {
    if (tiefe > 5 || !istOeffentlicheAdresse(url)) return ja(null);
    let erledigt = false;
    let aufbau = null;
    const zuLangsam = () => anfrage.destroy(Object.assign(new Error('Zeitüberschreitung'), { code: 'ZEIT' }));
    const schluss = (fehler, wert) => { if (erledigt) return; erledigt = true; clearTimeout(frist); clearTimeout(aufbau); fehler ? nein(fehler) : ja(wert); };
    const anfrage = (url.startsWith('https:') ? https : http).get(url, { headers: { ...KOPF, 'Accept-Encoding': 'gzip, deflate, br' }, rejectUnauthorized: zertPruefen, lookup: loeseAuf }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        let ziel;
        try { ziel = new URL(res.headers.location, url).href; } catch { return schluss(null, null); }
        return hole(ziel, zeit, zertPruefen, tiefe + 1, ende).then((w) => schluss(null, w), (f) => schluss(f));
      }
      const typ = res.headers['content-type'] || '';
      if (res.statusCode !== 200 || (typ && !/html|text\/plain|xml/i.test(typ))) { res.resume(); return schluss(null, null); }
      const kodierung = res.headers['content-encoding'];
      const strom = kodierung === 'gzip' ? res.pipe(zlib.createGunzip()) : kodierung === 'br' ? res.pipe(zlib.createBrotliDecompress()) : kodierung === 'deflate' ? res.pipe(zlib.createInflate()) : res;
      const teile = [];
      let groesse = 0;
      const seite = () => ({ url, html: dekodiere(Buffer.concat(teile), typ) });
      strom.on('data', (stueck) => { teile.push(stueck); groesse += stueck.length; if (groesse > MAX_BYTES) { schluss(null, seite()); anfrage.destroy(); } });
      strom.on('end', () => schluss(null, seite()));
      strom.on('error', (f) => (teile.length ? schluss(null, seite()) : schluss(f)));
      res.on('error', (f) => (teile.length ? schluss(null, seite()) : schluss(f)));
    });
    const frist = setTimeout(zuLangsam, Math.max(1, ende - Date.now()));
    anfrage.on('socket', (leitung) => {
      if (!leitung.connecting) return; // wiederverwendete Verbindung
      aufbau = setTimeout(zuLangsam, VERBINDUNG_MS);
      leitung.once(url.startsWith('https:') ? 'secureConnect' : 'connect', () => clearTimeout(aufbau));
    });
    anfrage.on('error', (f) => schluss(f));
  });
}

// Viele kleine Firmenseiten haben eine unvollständige oder abgelaufene Zertifikatskette. Browser zeigen sie trotzdem an;
// da hier nur öffentliche Seiten gelesen werden, wird in genau diesen Fällen ohne Zertifikatsprüfung geladen.
const ZERT_FEHLER = ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'];

// Reine JavaScript-Seiten liefern ohne Browser nur eine leere Hülle. Für sie wird der ohnehin installierte
// Edge (oder Chrome) unsichtbar gestartet und das fertig aufgebaute HTML ausgelesen.
const BROWSER = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
const RENDER_GLEICHZEITIG = 2;
let renderLaufend = 0;
const renderWarteschlange = [];

async function rendere(url) {
  if (!BROWSER || !istOeffentlicheAdresse(url)) return null;
  if (renderLaufend >= RENDER_GLEICHZEITIG) await new Promise((weiter) => renderWarteschlange.push(weiter));
  renderLaufend++;
  // Eigenes Profil je Aufruf, damit der Aufruf nicht im offenen Browserfenster des Nutzers landet.
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'leadscraper-browser-'));
  try {
    const html = await new Promise((ja) => {
      execFile(BROWSER, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', '--mute-audio', '--user-data-dir=' + profil, '--virtual-time-budget=7000', '--dump-dom', url],
        { timeout: 30000, maxBuffer: 12 * 1024 * 1024, windowsHide: true }, (fehler, ausgabe) => ja(fehler && !ausgabe ? '' : ausgabe || ''));
    });
    return html.length > 500 ? { url, html, gerendert: true } : null;
  } finally {
    renderLaufend--;
    renderWarteschlange.shift()?.();
    fs.rm(profil, { recursive: true, force: true, maxRetries: 3 }, () => {});
  }
}

const istLeereHuelle = (html) => /<script/i.test(html) && htmlZuText(html).length < 250;

// Lädt eine Seite. Reihenfolge der Rettungsversuche: ohne Zertifikatsprüfung, über HTTP, im unsichtbaren Browser.
async function ladeSeite(url, timeoutMs = 9000, { rendern = true } = {}) {
  if (!istOeffentlicheAdresse(url)) return null;
  let seite = null;
  try {
    seite = await hole(url, timeoutMs);
  } catch (e) {
    if (ZERT_FEHLER.includes(e.code)) seite = await hole(url.replace(/^http:/, 'https:'), timeoutMs, false).catch(() => null);
    // Gibt es die Adresse gar nicht, hilft auch der Versuch ohne Verschlüsselung nicht.
    else if (url.startsWith('https://') && e.code !== 'ENOTFOUND') seite = await hole('http://' + url.slice(8), timeoutMs).catch(() => null);
  }
  // Nur rendern, wenn die Seite noch zur angefragten Domain gehört – nicht bei Weiterleitungen auf Fremd- oder Parkseiten.
  const gleicheDomain = seite && new URL(seite.url).hostname.replace(/^www\./, '') === new URL(url).hostname.replace(/^www\./, '');
  if (seite && rendern && gleicheDomain && istLeereHuelle(seite.html)) seite = (await rendere(seite.url)) || seite;
  return seite;
}

const ENTITAETEN = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', agrave: 'à', ndash: '–', mdash: '—', shy: '', copy: '©', reg: '®', euro: '€', sect: '§', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', middot: '·', bull: '•', commat: '@', period: '.', colon: ':' };

function dekodiereEntitaeten(s) {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) || 32))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(+d || 32))
    .replace(/&([a-zA-Z]+);/g, (m, n) => (n in ENTITAETEN ? ENTITAETEN[n] : m));
}

// Cloudflare verschleiert E-Mail-Adressen als Hex-Kette mit XOR-Schlüssel im ersten Byte.
function dekodiereCfEmail(hex) {
  const k = parseInt(hex.slice(0, 2), 16);
  let aus = '';
  for (let i = 2; i < hex.length; i += 2) aus += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ k);
  return aus;
}

function htmlZuText(html) {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|select)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*data-cfemail="([0-9a-f]+)"[^>]*>[\s\S]*?<\/a>/gi, (_, h) => ' ' + dekodiereCfEmail(h) + ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|ul|ol|tr|td|th|table|h[1-6]|section|article|header|footer|nav|address|dd|dt|dl|blockquote|main|aside|form|hr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  // Weiche Trennzeichen und unsichtbare Zeichen zerreißen sonst Wörter wie „Geschäfts­führer“.
  s = dekodiereEntitaeten(s).replace(/[­​-‍⁠﻿]/g, '').replace(/[   \t\r]+/g, ' ');
  return s.split('\n').map((z) => z.replace(/ {2,}/g, ' ').trim()).filter(Boolean).join('\n');
}

function leseLinks(html, basis) {
  const links = [];
  const re = /<a\b[^>]*?href\s*=\s*["']([^"'#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && links.length < 600) {
    const roh = dekodiereEntitaeten(m[1].trim());
    if (/^(javascript|data):/i.test(roh)) continue;
    try {
      links.push({ href: new URL(roh, basis).href, text: htmlZuText(m[2]).replace(/\n/g, ' ').slice(0, 80) });
    } catch {}
  }
  return links;
}

function leseMeta(html) {
  const hole = (re) => { const m = html.match(re); return m ? dekodiereEntitaeten(m[1]).replace(/\s+/g, ' ').trim() : ''; };
  const attr = (name) =>
    hole(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']{10,})["']`, 'i')) ||
    hole(new RegExp(`<meta[^>]+content=["']([^"']{10,})["'][^>]*(?:name|property)=["']${name}["']`, 'i'));
  return { titel: hole(/<title[^>]*>([\s\S]*?)<\/title>/i), beschreibung: attr('description') || attr('og:description') };
}

module.exports = { BROWSER, ladeSeite,htmlZuText, leseLinks, leseMeta, dekodiereCfEmail };
