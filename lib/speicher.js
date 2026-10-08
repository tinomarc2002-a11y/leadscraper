// Ablage für CRM und Einstellungen. Lokal sind das JSON-Dateien im Ordner data/,
// auf Vercel (kein dauerhaftes Dateisystem) ein privater Blob-Speicher.
const fs = require('fs');
const path = require('path');

const AUF_VERCEL = !!process.env.VERCEL;
const DATA = path.join(__dirname, '..', 'data');

const datei = {
  async lese(name, standard) {
    try { return JSON.parse(fs.readFileSync(path.join(DATA, name + '.json'), 'utf8')); } catch { return standard; }
  },
  async schreibe(name, daten) {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(path.join(DATA, name + '.json'), JSON.stringify(daten, null, 1));
  },
};

const blob = {
  async lese(name, standard) {
    const { get } = require('@vercel/blob');
    // useCache: false – direkt nach dem Speichern muss der neue Stand gelesen werden, nicht eine Kopie aus dem Zwischenspeicher.
    const r = await get(name + '.json', { access: 'private', useCache: false }).catch((e) => { if (/not.?found|does not exist/i.test(e.message)) return null; throw e; });
    if (!r || r.statusCode !== 200) return standard;
    return JSON.parse(await new Response(r.stream).text());
  },
  async schreibe(name, daten) {
    const { put } = require('@vercel/blob');
    await put(name + '.json', JSON.stringify(daten), { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' });
  },
};

module.exports = AUF_VERCEL ? blob : datei;
