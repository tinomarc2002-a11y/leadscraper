// Versand von Leads an eine Google-Tabelle über die vom Nutzer bereitgestellte Apps-Script-Web-App.
const { SPALTEN, zeileAus } = require('../public/spalten');

const WEBAPP_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

// pruefeUrl=false nur für Tests gegen einen lokalen Nachbau der Web-App.
async function sendeAnSheets(url, leads, { pruefeUrl = true } = {}) {
  if (pruefeUrl && !WEBAPP_RE.test(url || '')) throw new Error('Bitte zuerst unter „Google Sheets“ die Web-App-URL hinterlegen.');
  // Ausgelesene Werte dürfen im Sheet nicht als Formel landen.
  const zeilen = leads.map((l) => zeileAus(l).map((w) => w.replace(/^=+/, '')));
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kopf: SPALTEN.map((s) => s[0]), zeilen }), signal: AbortSignal.timeout(90000) });
  const text = await r.text();
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('Google hat nicht wie erwartet geantwortet. Ist die Web-App mit Zugriff „Jeder“ bereitgestellt?'); }
  if (!d.ok) throw new Error('Google Sheets meldet: ' + (d.fehler || 'unbekannter Fehler'));
  return d;
}

module.exports = { sendeAnSheets };
