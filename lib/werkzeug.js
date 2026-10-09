// Die eigentliche Prüfarbeit: Websites laden und auswerten (anreichern) sowie fehlende Websites ermitteln.
// In der lokalen Version läuft sie in Hilfsprozessen. Grund: Node kann unter Windows beim Abbruch mancher
// Verbindungen hart abstürzen (Fehler in Node selbst, etwa bei Websites mit fehlerhafter Verschlüsselung).
// Trifft es einen Hilfsprozess, startet er neu und die Suche läuft weiter – der Server selbst bleibt unberührt.
// Auf Vercel und in Tests wird direkt im eigenen Prozess gearbeitet.
const path = require('path');

let direkt = null;
const lade = () => (direkt ||= { anreichern: require('./anreichern').anreichern, findeWebsite: require('./websuche').findeWebsite });

let hilfen = null;
let abstuerze = 0;
const ABGESTUERZT = 'Hilfsprozess abgestürzt';

function nutzeHilfsprozesse(anzahl = 4) {
  if (hilfen) return;
  const { fork } = require('child_process');
  let laufnummer = 0, reihum = 0;
  const starte = (platz, fehlstarts = 0) => {
    const kind = fork(path.join(__dirname, 'werkzeug-kind.js'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
    const eintrag = { kind, offen: new Map(), gestartet: Date.now() };
    kind.on('message', (m) => {
      const wartend = eintrag.offen.get(m.id);
      if (!wartend) return;
      eintrag.offen.delete(m.id);
      m.fehler ? wartend.nein(new Error(m.fehler)) : wartend.ja(m.ergebnis);
    });
    kind.on('exit', () => {
      if (hilfen) abstuerze++;
      // Was der Prozess gerade in Arbeit hatte, gilt als fehlgeschlagen; ein neuer Prozess übernimmt den Platz.
      for (const wartend of eintrag.offen.values()) wartend.nein(new Error(ABGESTUERZT));
      eintrag.offen.clear();
      if (!hilfen) return;
      // Stirbt ein Prozess immer wieder sofort nach dem Start, stimmt etwas Grundsätzliches nicht – dann nicht endlos neu starten.
      const sofort = Date.now() - eintrag.gestartet < 3000 ? fehlstarts + 1 : 0;
      if (sofort < 5) setTimeout(() => { if (hilfen) hilfen[platz] = starte(platz, sofort); }, 300 * (sofort + 1));
      else hilfen[platz] = null;
    });
    return eintrag;
  };
  hilfen = Array.from({ length: anzahl }, (_, i) => starte(i));
  hilfen.rufe = (name, k) => new Promise((ja, nein) => {
    // reihum verteilen; fehlt gerade ein Prozess (Neustart), den nächsten nehmen
    let eintrag = null;
    for (let i = 0; i < anzahl && !eintrag; i++) { const e = hilfen[reihum++ % anzahl]; if (e && e.kind.connected) eintrag = e; }
    if (!eintrag) return lade()[name](k).then(ja, nein); // kein Hilfsprozess verfügbar: ausnahmsweise selbst arbeiten
    const id = ++laufnummer;
    eintrag.offen.set(id, { ja, nein });
    eintrag.kind.send({ id, name, k }, (fehler) => { if (fehler && eintrag.offen.delete(id)) nein(fehler); });
  });
}

// Stürzt der Hilfsprozess mitten im Auftrag ab, wird der Auftrag einmal wiederholt (meist traf es einen Nachbarauftrag).
const rufe = (name) => async (k) => {
  if (!hilfen) return lade()[name](k);
  try { return await hilfen.rufe(name, k); } catch (e) { if (e.message !== ABGESTUERZT) throw e; }
  return hilfen.rufe(name, k);
};

module.exports = { anreichern: rufe('anreichern'), findeWebsite: rufe('findeWebsite'), nutzeHilfsprozesse, ABGESTUERZT, stand: () => ({ abstuerze }) };
