// Steuert ein unsichtbares Chrome/Edge über dessen eingebaute Fernsteuerung (DevTools-Protokoll) – ohne Zusatzpakete.
// Wird für Seiten gebraucht, die sich nur mit einem echten Browser bedienen lassen (Handelsregister-Portal).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { BROWSER } = require('./web');

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

async function starteBrowser() {
  if (!BROWSER) throw new Error('Weder Chrome noch Edge gefunden – dafür wird einer der beiden Browser gebraucht.');
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'leadscraper-browser-'));
  const prozess = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions', '--mute-audio', '--remote-debugging-port=0', '--user-data-dir=' + profil, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  const schliesse = () => {
    try { prozess.kill(); } catch {}
    setTimeout(() => fs.rm(profil, { recursive: true, force: true, maxRetries: 5 }, () => {}), 1500);
  };
  try {
    // Chrome schreibt den zufällig gewählten Port in eine Datei im Profilordner.
    let zeilen = null;
    for (let i = 0; i < 75 && !zeilen; i++) {
      await warte(200);
      try { const t = fs.readFileSync(path.join(profil, 'DevToolsActivePort'), 'utf8').trim().split('\n'); if (t.length >= 2) zeilen = t; } catch {}
    }
    if (!zeilen) throw new Error('Browser ließ sich nicht starten.');
    const ws = new WebSocket(`ws://127.0.0.1:${zeilen[0].trim()}${zeilen[1].trim()}`);
    await new Promise((ja, nein) => { ws.onopen = ja; ws.onerror = () => nein(new Error('Verbindung zum Browser fehlgeschlagen.')); });

    let laufnummer = 0;
    const offen = new Map();
    const lauscher = new Set();
    ws.onmessage = (ereignis) => {
      const m = JSON.parse(ereignis.data);
      const wartend = m.id && offen.get(m.id);
      if (wartend) { offen.delete(m.id); m.error ? wartend.nein(new Error(m.error.message)) : wartend.ja(m.result); }
      else lauscher.forEach((l) => l(m));
    };
    const sende = (method, params = {}, sessionId) => new Promise((ja, nein) => {
      const id = ++laufnummer;
      offen.set(id, { ja, nein });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const warteAuf = (passt, ms) => new Promise((ja, nein) => {
      const l = (m) => { if (passt(m)) { clearTimeout(frist); lauscher.delete(l); ja(m); } };
      const frist = setTimeout(() => { lauscher.delete(l); nein(new Error('Zeitüberschreitung')); }, ms);
      lauscher.add(l);
    });

    const { targetId } = await sende('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await sende('Target.attachToTarget', { targetId, flatten: true });
    await sende('Page.enable', {}, sessionId);
    const seite = {
      async oeffne(url, ms = 45000) {
        const geladen = warteAuf((m) => m.method === 'Page.loadEventFired' && m.sessionId === sessionId, ms);
        await sende('Page.navigate', { url }, sessionId);
        await geladen;
      },
      // Führt JavaScript in der Seite aus und liefert das (JSON-fähige) Ergebnis zurück.
      async werte(ausdruck, ms = 60000) {
        const r = await Promise.race([
          sende('Runtime.evaluate', { expression: ausdruck, awaitPromise: true, returnByValue: true }, sessionId),
          warte(ms).then(() => { throw new Error('Zeitüberschreitung'); }),
        ]);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      },
      warteAufLaden: (ms = 45000) => warteAuf((m) => m.method === 'Page.loadEventFired' && m.sessionId === sessionId, ms),
    };
    return { seite, sende, warteAuf, schliesse: () => { try { ws.close(); } catch {} schliesse(); } };
  } catch (e) {
    schliesse();
    throw e;
  }
}

module.exports = { starteBrowser };
