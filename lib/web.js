// Seiten laden und HTML in auswertbaren Text umwandeln (ohne externe Bibliotheken).
const fs = require('fs');
const os = require('os');
const path = require('path');
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

async function ladeEinmal(url, timeoutMs) {
  const r = await fetch(url, { headers: KOPF, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (!istOeffentlicheAdresse(r.url)) throw new Error('Weiterleitung auf interne Adresse');
  const typ = r.headers.get('content-type') || '';
  if (!r.ok || (typ && !/html|text\/plain|xml/i.test(typ))) return null;
  const teile = [];
  let groesse = 0;
  for await (const stueck of r.body) {
    teile.push(stueck);
    groesse += stueck.length;
    if (groesse > MAX_BYTES) break;
  }
  return { url: r.url, html: dekodiere(Buffer.concat(teile), typ) };
}

function dekodiere(puffer, typ = '') {
  let zeichensatz = (typ.match(/charset=([\w-]+)/i) || [])[1];
  if (!zeichensatz) zeichensatz = (puffer.subarray(0, 2048).toString('latin1').match(/charset=["']?([\w-]+)/i) || [])[1];
  try { return new TextDecoder(zeichensatz || 'utf-8').decode(puffer); } catch { return puffer.toString('utf8'); }
}

// Viele kleine Firmenseiten haben eine unvollständige oder abgelaufene Zertifikatskette. Browser zeigen sie trotzdem an;
// da hier nur öffentliche Seiten gelesen werden, wird in genau diesen Fällen ohne Zertifikatsprüfung geladen.
const ZERT_FEHLER = ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'];

function ladeOhneZertPruefung(url, timeoutMs, tiefe = 0) {
  return new Promise((ja) => {
    if (tiefe > 5 || !istOeffentlicheAdresse(url)) return ja(null);
    const anfrage = (url.startsWith('https:') ? https : http).get(url, { headers: { ...KOPF, 'Accept-Encoding': 'gzip, deflate, br' }, rejectUnauthorized: false, timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return ja(ladeOhneZertPruefung(new URL(res.headers.location, url).href, timeoutMs, tiefe + 1));
      }
      const typ = res.headers['content-type'] || '';
      if (res.statusCode !== 200 || (typ && !/html|text\/plain|xml/i.test(typ))) { res.resume(); return ja(null); }
      const kodierung = res.headers['content-encoding'];
      const strom = kodierung === 'gzip' ? res.pipe(zlib.createGunzip()) : kodierung === 'br' ? res.pipe(zlib.createBrotliDecompress()) : kodierung === 'deflate' ? res.pipe(zlib.createInflate()) : res;
      const teile = [];
      let groesse = 0;
      strom.on('data', (s) => { teile.push(s); groesse += s.length; if (groesse > MAX_BYTES) anfrage.destroy(); });
      strom.on('end', () => ja({ url, html: dekodiere(Buffer.concat(teile), typ) }));
      strom.on('error', () => ja(teile.length ? { url, html: dekodiere(Buffer.concat(teile), typ) } : null));
    });
    anfrage.on('timeout', () => anfrage.destroy());
    anfrage.on('error', () => ja(null));
  });
}

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
async function ladeSeite(url, timeoutMs = 12000, { rendern = true } = {}) {
  if (!istOeffentlicheAdresse(url)) return null;
  let seite = null;
  try {
    seite = await ladeEinmal(url, timeoutMs);
  } catch (e) {
    if (ZERT_FEHLER.includes(e.cause?.code)) seite = await ladeOhneZertPruefung(url.replace(/^http:/, 'https:'), timeoutMs);
    else if (url.startsWith('https://')) {
      try { seite = await ladeEinmal('http://' + url.slice(8), timeoutMs); } catch {}
    }
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
