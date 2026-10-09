// Postleitzahl → Koordinaten, für Entfernungen bei Treffern aus der Internet-Suche.
// Die Tabelle wird bei der Einrichtung der Internet-Suche geladen und liegt außerhalb des Projektordners.
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASIS = path.join(process.env.LOCALAPPDATA || os.homedir(), 'Leadscraper');
const PLZ_DATEI = path.join(BASIS, 'plz.json');

let tabelle = null;
function koordinaten(plz) {
  if (!tabelle) { try { tabelle = JSON.parse(fs.readFileSync(PLZ_DATEI, 'utf8')); } catch { tabelle = {}; } }
  return tabelle[plz] || null;
}
const vergissTabelle = () => { tabelle = null; };

function distanzKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// Liegt die Postleitzahl im Umkreis { lat, lon, km }? Mit etwas Zugabe, weil die Postleitzahl-Mitte nicht genau
// am Firmensitz liegt. Unbekannte Postleitzahlen gelten als „weiß nicht“ (null).
function imUmkreis(plz, umkreis) {
  const k = koordinaten(plz);
  return k ? distanzKm(umkreis.lat, umkreis.lon, k[0], k[1]) <= umkreis.km + 8 : null;
}

module.exports = { BASIS, PLZ_DATEI, koordinaten, vergissTabelle, distanzKm, imUmkreis };
