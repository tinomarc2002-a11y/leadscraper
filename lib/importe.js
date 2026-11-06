// Vorbereitete Lead-Listen, die sich im CRM mit einem Klick übernehmen lassen.
// Jede Liste liegt als JSON-Datei im Ordner importe/ und wird mit der Anwendung ausgeliefert (lokal wie auf Vercel).
const BUENDEL = [
  {
    id: 'handwerk-dresden-top50',
    name: 'Handwerk Dresden Top 50',
    beschreibung: '50 Handwerksbetriebe aus Dresden und Umgebung (Solar, SHK, Dach, Elektro, Maler, Fliesen, Tischler, Garten- und Landschaftsbau, Metallbau) mit Ansprechpartner, Kontakt und Werbecheck vom 5. November 2026.',
    leads: require('../importe/handwerk-dresden-top50.json'),
  },
];

module.exports = { BUENDEL };
