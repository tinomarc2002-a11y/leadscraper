// Hilfsprozess der lokalen Version: nimmt Aufträge vom Server entgegen (eine Website auswerten oder die Website
// zu einer Firma ermitteln) und schickt das Ergebnis zurück. Siehe werkzeug.js.
const arbeiten = { anreichern: require('./anreichern').anreichern, findeWebsite: require('./websuche').findeWebsite };

process.on('message', async ({ id, name, k }) => {
  try {
    process.send({ id, ergebnis: await arbeiten[name](k) });
  } catch (e) {
    if (process.connected) process.send({ id, fehler: e.message });
  }
});
// Endet der Server, endet auch der Hilfsprozess.
process.on('disconnect', () => process.exit(0));
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
