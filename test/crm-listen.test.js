// Tests für Listen, Werbe-Angaben und den Import vorbereiteter Listen im CRM.
const test = require('node:test');
const assert = require('node:assert/strict');
const CRM = require('../lib/crm');
const { BUENDEL } = require('../lib/importe');

const ID = 'handwerk-dresden-top50';
const NAME = 'Handwerk Dresden Top 50';

test('Import in ein leeres CRM legt alle 50 Leads mit Liste, Personen und Werbe-Angaben an', () => {
  const crm = [];
  const r = CRM.importiere(crm, ID);
  assert.equal(r.neu, 50);
  assert.equal(crm.length, 50);
  assert.ok(crm.every((l) => l.liste === NAME && l.crmStatus === 'Neu' && l.importe.includes(ID)));
  assert.ok(crm.every((l) => ['', 'ja', 'frueher', 'nein'].includes(l.werbungGoogle) && ['', 'ja', 'frueher', 'nein'].includes(l.werbungMeta)));
  const wagner = crm.find((l) => l.name === 'Thomas Wagner GmbH');
  assert.equal(wagner.personen.length, 2);
  assert.equal(wagner.anrede, '', 'Kay ist in der Vornamenliste unisex, die Anrede bleibt leer');
  assert.equal(wagner.personen[1].name, 'Norbert Wagner');
  assert.equal(wagner.personen[1].anrede, 'Herr');
  assert.equal(crm.find((l) => l.name === 'FLIESEN Kießling e.K.').anrede, 'Frau');
  assert.equal(crm.filter((l) => l.werbungGoogle === 'ja').length, 3);
  assert.equal(crm.filter((l) => l.werbungMeta === 'frueher').length, 2);
});

test('Der Import ist wiederholbar und legt nichts doppelt an', () => {
  const crm = [];
  CRM.importiere(crm, ID);
  const r = CRM.importiere(crm, ID);
  assert.equal(r.neu, 0);
  assert.equal(r.vorhanden, 50);
  assert.equal(crm.length, 50);
});

test('Schon vorhandene Firmen behalten Notiz, Status und eigene Liste und bekommen nur leere Felder ergänzt', () => {
  const crm = [{ id: 'n123', name: 'SolTer Solar GmbH', website: 'https://www.solter-solar.de/', telefon: '', email: '', crmStatus: 'Termin', notiz: 'Rückruf Freitag', wiedervorlage: '2026-11-10', verlauf: [], liste: 'Solar Sachsen' }];
  const r = CRM.importiere(crm, ID);
  assert.equal(r.neu, 49);
  assert.equal(crm.length, 50);
  const l = crm.find((c) => c.id === 'n123');
  assert.equal(l.crmStatus, 'Termin');
  assert.equal(l.notiz, 'Rückruf Freitag');
  assert.equal(l.liste, 'Solar Sachsen');
  assert.ok(l.email.includes('@'), 'leere E-Mail wurde ergänzt');
  assert.deepEqual(l.importe, [ID]);
  assert.equal(CRM.importUebersicht(crm)[0].imCrm, 50);
});

test('Unbekannte Liste wird abgelehnt', () => {
  assert.throws(() => CRM.importiere([], 'gibt-es-nicht'), /gibt es nicht/);
});

test('Werbe-Angaben lassen sich von Hand ändern und werden geprüft', () => {
  const crm = [{ id: 'a', name: 'A', crmStatus: 'Neu', notiz: '', wiedervorlage: '', verlauf: [] }];
  const l = CRM.aendern(crm, { id: 'a', werbungGoogle: 'ja', werbungMeta: 'frueher', werbeAnsatz: 'Meta-Leadformular als Ergänzung', liste: '  Meine   Liste ' });
  assert.equal(l.werbungGoogle, 'ja');
  assert.equal(l.werbungMeta, 'frueher');
  assert.equal(l.werbungGoogleInfo.quelle, 'von Hand eingetragen');
  assert.equal(l.werbeAnsatz, 'Meta-Leadformular als Ergänzung');
  assert.equal(l.liste, 'Meine Liste');
  assert.throws(() => CRM.aendern(crm, { id: 'a', werbungGoogle: 'vielleicht' }), /Ungültiger Werbe-Status/);
  assert.equal(CRM.aendern(crm, { id: 'a', werbungGoogle: '' }).werbungGoogle, '');
});

test('Beim Übernehmen aus der Suche bekommen neue Leads die gewählte Liste, vorhandene behalten ihre', () => {
  const crm = [{ id: 'x1', name: 'X', website: 'https://x.de', crmStatus: 'Kunde', notiz: 'wichtig', wiedervorlage: '', verlauf: [], liste: 'Alt', werbeAnsatz: 'mein Ansatz', werbungGoogle: 'ja' }];
  const r = CRM.hinzufuegen(crm, [{ id: 'x1', name: 'X', website: 'https://x.de', telefon: '0351 1' }, { id: 'y2', name: 'Y', website: 'https://y.de' }], 'Neue Suche');
  assert.deepEqual([r.neu, r.vorhanden], [1, 1]);
  assert.equal(crm[0].liste, 'Alt');
  assert.equal(crm[0].werbeAnsatz, 'mein Ansatz');
  assert.equal(crm[0].werbungGoogle, 'ja');
  assert.equal(crm[0].telefon, '0351 1');
  assert.equal(crm[1].liste, 'Neue Suche');
});

test('Leads in eine Liste verschieben', () => {
  const crm = [{ id: '1' }, { id: '2' }, { id: '3', liste: 'Alt' }];
  assert.deepEqual(CRM.verschiebe(crm, { ids: ['1', '3'], liste: 'Neu' }), { verschoben: 2, liste: 'Neu' });
  assert.deepEqual(crm.map((l) => l.liste), ['Neu', undefined, 'Neu']);
});

test('Die Routen sind erreichbar und markieren Änderungen', () => {
  const crm = [];
  assert.equal(CRM.behandle('/api/crm/importe', false, {}, crm).antwort[0].id, ID);
  const r = CRM.behandle('/api/crm/import', true, { id: ID }, crm);
  assert.equal(r.geaendert, true);
  assert.equal(r.antwort.neu, 50);
  const v = CRM.behandle('/api/crm/liste', true, { ids: [crm[0].id], liste: 'Test' }, crm);
  assert.equal(v.antwort.verschoben, 1);
  assert.equal(CRM.behandle('/api/crm/gibtesnicht', true, {}, crm), null);
});

test('Importdateien haben eindeutige IDs und brauchbare Pflichtfelder', () => {
  for (const b of BUENDEL) {
    assert.equal(new Set(b.leads.map((l) => l.id)).size, b.leads.length);
    for (const l of b.leads) {
      assert.ok(l.id && l.name && l.branche, l.id);
      assert.ok(/^https?:\/\//.test(l.website), l.id + ' Website');
      assert.ok(!/^=/.test(l.name), 'keine Formeln');
    }
  }
});
