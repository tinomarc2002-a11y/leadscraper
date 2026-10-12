/* global STATUS_TEXT, RECHTSFORM_GRUPPEN, rechtsformGruppe, EXPORT_KOPF, exportZeile */
const $ = (s, w = document) => w.querySelector(s);
const $$ = (s, w = document) => [...w.querySelectorAll(s)];
// Alle Inhalte stammen von fremden Websites – vor dem Einfügen ins HTML immer maskieren.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sichereUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const heute = () => new Date().toLocaleDateString('sv');
const datumDe = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '');

const CRM_STATUS = ['Neu', 'Kontaktiert', 'Nicht erreicht', 'Termin', 'Angebot', 'Kunde', 'Kein Interesse'];
const KONTAKT_ERGEBNISSE = ['Nicht erreicht', 'Erreicht – Rückruf vereinbart', 'Erreicht – Termin vereinbart', 'Erreicht – kein Interesse', 'E-Mail gesendet', 'Angebot gesendet', 'Notiz'];
const STATUS_HILFE = {
  register: 'Als Vertretungsberechtigter im amtlichen Handelsregister eingetragen.',
  bestaetigt: 'Im Impressum mit eindeutiger Rolle genannt und durch eine zweite Fundstelle gestützt.',
  impressum: 'Im Impressum mit eindeutiger Rolle (Geschäftsführer, Inhaber …) genannt.',
  pruefen: 'Name gefunden, aber nicht eindeutig – vor der Ansprache bitte kurz prüfen.',
  unbekannt: 'Kein Inhaber ermittelbar.',
};
const REGISTER_KURZ = { nicht_eingetragen: 'nicht eintragungspflichtig', nicht_gefunden: 'nicht gefunden', nicht_verfuegbar: 'gerade nicht abrufbar', fehler: 'Portal nicht erreichbar' };
const RANG = { unbekannt: 0, pruefen: 1, impressum: 2, bestaetigt: 3, register: 4 };

const ansichten = {
  suche: { leads: [], auswahl: new Set(), text: '', status: '', sortierung: 'entfernung', nurFaellig: false },
  crm: { leads: [], auswahl: new Set(), text: '', status: '', sortierung: 'name', nurFaellig: false },
};
let jobId = null, jobStand = 0;
let abfrageTimer = null;

// Betriebsart: 'lokal' (Server auf dem eigenen PC) oder 'cloud' (Vercel, mit Anmeldung und Suche in Etappen).
let MODUS = { modus: 'lokal', register: true };
const PASSWORT_MERKER = 'leadscraper-passwort';

async function api(pfad, daten) {
  const passwort = localStorage.getItem(PASSWORT_MERKER) || '';
  const kopf = { 'X-Leadscraper-Passwort': encodeURIComponent(passwort) };
  const r = await fetch(pfad, daten === undefined ? { headers: kopf } : { method: 'POST', headers: { ...kopf, 'Content-Type': 'application/json' }, body: JSON.stringify(daten) });
  if (r.status === 401) {
    await frageNachPasswort(!!passwort);
    return api(pfad, daten);
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.fehler || 'Der Server hat nicht geantwortet.');
  return d;
}

// Zeigt den Anmeldedialog. Mehrere gleichzeitig abgewiesene Anfragen teilen sich eine Eingabe.
let anmeldung = null;
function frageNachPasswort(warFalsch) {
  anmeldung ||= new Promise((fertig) => {
    const d = $('#anmelde-dialog');
    $('#anmelde-fehler').hidden = !warFalsch;
    $('#anmelde-passwort').value = '';
    d.showModal();
    $('#anmelde-formular').onsubmit = (e) => {
      e.preventDefault();
      localStorage.setItem(PASSWORT_MERKER, $('#anmelde-passwort').value);
      d.close();
      anmeldung = null;
      fertig();
    };
  });
  return anmeldung;
}

let hinweisTimer;
function melde(text, fehler = false, bleibt = false) {
  const h = $('#hinweis');
  h.textContent = text;
  h.className = 'hinweis' + (fehler ? ' fehler' : '');
  h.hidden = false;
  clearTimeout(hinweisTimer);
  if (!bleibt) hinweisTimer = setTimeout(() => (h.hidden = true), fehler ? 7000 : 4500);
}
const versuche = (fn) => async (...a) => { try { await fn(...a); } catch (e) { melde(e.message, true); } };

// ───────── Reiter ─────────
function zeigeReiter(name) {
  $$('.reiter button').forEach((b) => b.classList.toggle('aktiv', b.dataset.reiter === name));
  for (const r of ['suche', 'crm', 'sheets', 'datenbank']) $('#reiter-' + r).hidden = r !== name;
}
$$('.reiter button').forEach((b) => b.addEventListener('click', () => zeigeReiter(b.dataset.reiter)));

// ───────── Tabellen ─────────
const istFaellig = (l) => !!l.wiedervorlage && l.wiedervorlage <= heute() && !['Kunde', 'Kein Interesse'].includes(l.crmStatus);

function sichtbare(name) {
  const a = ansichten[name];
  const suchtext = a.text.trim().toLowerCase();
  const liste = a.leads.filter((l) => {
    if (a.status && (name === 'crm' ? l.crmStatus : l.status) !== a.status) return false;
    if (a.nurFaellig && !istFaellig(l)) return false;
    if (a.branche && l.branche !== a.branche) return false;
    if (a.rechtsform && rechtsformGruppe(l.rechtsform) !== a.rechtsform) return false;
    if ((a.mitTelefon && !l.telefon) || (a.mitEmail && !l.email) || (a.mitStellen && !l.karriereUrl)) return false;
    return !suchtext || [l.name, l.inhaber, l.weitere, l.ort, l.plz, l.branche, l.beschreibung, l.notiz].some((w) => String(w || '').toLowerCase().includes(suchtext));
  });
  const vergleich = {
    entfernung: (x, y) => (x.entfernungKm ?? 9999) - (y.entfernungKm ?? 9999),
    name: (x, y) => x.name.localeCompare(y.name, 'de'),
    sicherheit: (x, y) => RANG[y.status] - RANG[x.status] || x.entfernungKm - y.entfernungKm,
    mitarbeiter: (x, y) => y.maZahl - x.maZahl,
    wiedervorlage: (x, y) => (x.wiedervorlage || '9999').localeCompare(y.wiedervorlage || '9999'),
  }[a.sortierung];
  return liste.sort(vergleich);
}

// Ziel der Aktionsknöpfe: die angehakten Zeilen, sonst alle gerade sichtbaren.
function ziel(name) {
  const a = ansichten[name];
  const liste = sichtbare(name);
  const gewaehlt = liste.filter((l) => a.auswahl.has(l.id));
  return gewaehlt.length ? gewaehlt : liste;
}

function inhaberHtml(l, name) {
  const weitere = (l.personen || []).slice(1);
  const registerZeile = l.registerErgebnis && l.status !== 'register' ? `<div class="unter" title="${esc(l.registerHinweis)}">Register: ${esc(REGISTER_KURZ[l.registerErgebnis] || l.registerErgebnis)}</div>` : '';
  const tipp = [STATUS_HILFE[l.status], l.registerHinweis, l.hinweise].filter(Boolean).join('\n');
  return `${l.inhaber ? `<div><strong>${esc([l.anrede, l.inhaber].filter(Boolean).join(' '))}</strong></div><div class="unter">${esc(l.rolle)}</div>` : '<div class="unter">–</div>'}
    <span class="plakette ${esc(l.status)}" title="${esc(tipp)}">${esc(STATUS_TEXT[l.status])}</span>${registerZeile}
    ${weitere.map((p, i) => `<div class="unter weitere" title="${esc(p.rolle)}">+ ${esc([p.anrede, p.name].filter(Boolean).join(' '))}${name === 'crm' ? ` <button type="button" class="link haupt-kontakt" data-nr="${i + 1}" title="Als Hauptkontakt verwenden">↑</button>` : ''}</div>`).join('')}
    ${!weitere.length && l.weitere ? `<div class="unter">+ ${esc(l.weitere)}</div>` : ''}`;
}

function crmSpaltenHtml(l) {
  const verlauf = l.verlauf || [];
  return `<td class="spalte-status"><select class="crm-status" aria-label="Status">${CRM_STATUS.map((s) => `<option${s === l.crmStatus ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <label class="unter wv${istFaellig(l) ? ' faellig' : ''}">Wiedervorlage<input type="date" class="wiedervorlage" value="${esc(l.wiedervorlage || '')}"></label></td>
    <td class="spalte-notiz"><textarea class="notiz" rows="1" placeholder="Notiz …">${esc(l.notiz)}</textarea>
      <button type="button" class="neben klein-knopf kontakt-neu">+ Kontakt eintragen</button>
      ${verlauf.slice(0, 2).map((v) => `<div class="unter" title="${esc(v.notiz)}">${esc(datumDe(v.zeit))} · ${esc(v.ergebnis)}${v.notiz ? ' – ' + esc(v.notiz.slice(0, 60)) : ''}</div>`).join('')}
      ${verlauf.length > 2 ? `<div class="unter" title="${esc(verlauf.slice(2).map((v) => datumDe(v.zeit) + ' ' + v.ergebnis + (v.notiz ? ': ' + v.notiz : '')).join('\n'))}">… ${verlauf.length - 2} weitere</div>` : ''}</td>`;
}

function zeileHtml(l, name) {
  const a = ansichten[name];
  const web = sichereUrl(l.website), imp = sichereUrl(l.impressumUrl), stellen = sichereUrl(l.karriereUrl);
  const suchbegriff = (l.firmierung || l.name) + (l.ort ? ' ' + l.ort : '');
  const schonImCrm = name === 'suche' && ansichten.crm.leads.some((c) => c.id === l.id);
  const adresse = [l.strasse, [l.plz, l.ort].filter(Boolean).join(' ')].filter(Boolean);
  const grob = l.maQuelle === 'grobe Schätzung';
  return `<tr data-id="${esc(l.id)}">
    <td class="schmal"><input type="checkbox" class="wahl" ${a.auswahl.has(l.id) ? 'checked' : ''} aria-label="Auswählen"></td>
    <td class="spalte-firma"><div class="firma">${esc(l.name)}${schonImCrm ? '<span class="im-crm">✓ im CRM</span>' : ''}</div>
      <div class="unter">${esc(l.branche)}${l.rechtsform ? ' · ' + esc(l.rechtsform) : ''}</div>
      <div class="beschreibung" title="${esc(l.beschreibung)}">${esc(l.beschreibung)}</div></td>
    <td class="spalte-inhaber">${inhaberHtml(l, name)}</td>
    <td class="spalte-kontakt">${l.telefon ? `<div><a href="tel:${esc(l.telefon.replace(/[^\d+]/g, ''))}">${esc(l.telefon)}</a></div>` : ''}${l.email ? `<div><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></div>` : ''}${!l.telefon && !l.email ? '<span class="unter">–</span>' : ''}</td>
    <td class="spalte-ort">${adresse.map(esc).join('<br>') || '<span class="unter">Adresse unbekannt</span>'}${l.entfernungKm == null ? '' : `<div class="unter">${esc(l.entfernungKm)} km entfernt</div>`}</td>
    <td title="${esc(l.maQuelle)}"><div>${esc(l.maKlasse)}</div><div class="unter">${grob ? '~' : ''}${esc(l.maZahl)}${grob ? ' geschätzt' : ''}</div></td>
    <td class="links">${web ? `<a href="${esc(web)}" target="_blank" rel="noopener noreferrer">Website</a>` : ''}${imp ? `<a href="${esc(imp)}" target="_blank" rel="noopener noreferrer">Impressum</a>` : ''}
      ${stellen ? `<a href="${esc(stellen)}" target="_blank" rel="noopener noreferrer">Stellenseite</a>` : ''}
      <a href="https://www.northdata.de/${encodeURIComponent(suchbegriff)}" target="_blank" rel="noopener noreferrer">North Data</a></td>
    ${name === 'crm' ? crmSpaltenHtml(l) : ''}
  </tr>`;
}

function zeichne(name) {
  const a = ansichten[name];
  aktualisiereBranchenFilter(name);
  const liste = sichtbare(name);
  $('#leer-' + name).hidden = a.leads.length > 0;
  $('#leiste-' + name).hidden = a.leads.length === 0;
  $('#filter-' + name).hidden = a.leads.length === 0 || !a.filterOffen;
  $('#tabelle-' + name).innerHTML = !a.leads.length ? '' : `<thead><tr>
      <th class="schmal"><input type="checkbox" class="alle" ${liste.length && liste.every((l) => a.auswahl.has(l.id)) ? 'checked' : ''} aria-label="Alle auswählen"></th>
      <th>Unternehmen</th><th>Inhaber</th><th>Kontakt</th><th>Standort</th><th>Mitarbeiter</th><th>Prüfen</th>${name === 'crm' ? '<th>Status</th><th>Notiz &amp; Verlauf</th>' : ''}
    </tr></thead><tbody>${liste.map((l) => zeileHtml(l, name)).join('')}</tbody>`;
  const gewaehlt = liste.filter((l) => a.auswahl.has(l.id)).length;
  $('#leiste-' + name + ' .anzahl').textContent = gewaehlt ? `${gewaehlt} von ${liste.length} ausgewählt` : `${liste.length} Leads`;
  if (name === 'suche') zeichnePins();
  if (name === 'crm') {
    const faellig = a.leads.filter(istFaellig).length;
    $('#crm-zaehler').textContent = a.leads.length;
    $('#crm-faellig').textContent = faellig;
    $('#crm-faellig').hidden = !faellig;
    const knopf = $('#leiste-crm .f-faellig');
    knopf.textContent = `Heute fällig (${faellig})`;
    knopf.classList.toggle('aktiv', a.nurFaellig);
  }
}

// Zweite Zeile über der Tabelle: das Ergebnis nach Branche, Rechtsform und vorhandenen Angaben eingrenzen.
function baueFilterzeile(name) {
  const a = ansichten[name], zeile = $('#filter-' + name);
  const statusWahl = name === 'crm' ? CRM_STATUS.map((s) => `<option>${s}</option>`).join('') : Object.entries(STATUS_TEXT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  zeile.innerHTML = `<select class="f-status" aria-label="Status"><option value="">${name === 'crm' ? 'Alle Status' : 'Jede Sicherheit'}</option>${statusWahl}</select>
    <select class="f-branche" aria-label="Branche"><option value="">Alle Branchen</option></select>
    <select class="f-rechtsform" aria-label="Rechtsform"><option value="">Jede Rechtsform</option>${RECHTSFORM_GRUPPEN.map(([id, text]) => `<option value="${id}">${esc(text)}</option>`).join('')}</select>
    <button type="button" class="neben umschalter" data-feld="mitTelefon">mit Telefon</button>
    <button type="button" class="neben umschalter" data-feld="mitEmail">mit E-Mail</button>
    <button type="button" class="neben umschalter" data-feld="mitStellen">mit Stellenseite</button>`;
  $('.f-status', zeile).addEventListener('change', (e) => { a.status = e.target.value; zeichne(name); });
  $('.f-branche', zeile).addEventListener('change', (e) => { a.branche = e.target.value; zeichne(name); });
  $('.f-rechtsform', zeile).addEventListener('change', (e) => { a.rechtsform = e.target.value; zeichne(name); });
  $$('.umschalter', zeile).forEach((k) => k.addEventListener('click', () => {
    a[k.dataset.feld] = !a[k.dataset.feld];
    k.classList.toggle('aktiv', a[k.dataset.feld]);
    zeichne(name);
  }));
}

// Die Branchen-Auswahl der Filterzeile bietet nur an, was in der aktuellen Liste vorkommt.
function aktualisiereBranchenFilter(name) {
  const a = ansichten[name], wahl = $('#filter-' + name + ' .f-branche');
  if (!wahl) return;
  const branchen = [...new Set(a.leads.map((l) => l.branche).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'de'));
  if (wahl.dataset.stand === branchen.join('|')) return;
  wahl.dataset.stand = branchen.join('|');
  if (a.branche && !branchen.includes(a.branche)) a.branche = '';
  wahl.innerHTML = '<option value="">Alle Branchen</option>' + branchen.map((b) => `<option${b === a.branche ? ' selected' : ''}>${esc(b)}</option>`).join('');
}

function baueLeiste(name) {
  const statusWahl = name === 'crm'
    ? CRM_STATUS.map((s) => `<option>${s}</option>`).join('')
    : Object.entries(STATUS_TEXT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#leiste-' + name).innerHTML = `<span class="anzahl"></span>
    <input type="search" class="f-text" placeholder="Filtern …" aria-label="Filtern">
    <select class="f-sort" aria-label="Sortierung">
      <option value="entfernung">Nach Entfernung</option><option value="name">Nach Name</option>
      <option value="sicherheit">Nach Sicherheit</option><option value="mitarbeiter">Nach Größe</option>
      ${name === 'crm' ? '<option value="wiedervorlage">Nach Wiedervorlage</option>' : ''}</select>
    <button type="button" class="neben f-mehr">Eingrenzen</button>
    ${name === 'crm' ? '<button class="neben f-faellig"></button>' : ''}
    <span class="abstand"></span>
    ${name === 'suche' ? '<button class="haupt a-crm">Ins CRM übernehmen</button>' : '<button class="neben gefahr a-loeschen">Löschen</button>'}
    <details class="menue"><summary class="neben">Mehr</summary><div class="menue-liste">
      <button class="a-register" title="Gleicht die Inhaber mit dem amtlichen Handelsregister ab (max. ca. 25 Firmen pro Stunde)">Im Handelsregister prüfen</button>
      <button class="a-csv">CSV herunterladen</button>
      <button class="a-kopieren">Für Sheets kopieren</button>
      <button class="a-sheets">An Google Sheet senden</button>
    </div></details>`;
  const leiste = $('#leiste-' + name), a = ansichten[name];
  $('.a-register', leiste).hidden = !MODUS.register;
  $('.f-sort', leiste).value = a.sortierung;
  $('.f-text', leiste).addEventListener('input', (e) => { a.text = e.target.value; zeichne(name); });
  $('.f-mehr', leiste).addEventListener('click', (e) => { a.filterOffen = !a.filterOffen; e.currentTarget.classList.toggle('aktiv', a.filterOffen); zeichne(name); });
  // Ein Klick auf einen Menüpunkt (oder daneben) schließt das Menü wieder.
  $('.menue-liste', leiste).addEventListener('click', () => { $('.menue', leiste).open = false; });
  document.addEventListener('click', (e) => { if (!e.target.closest('.menue')) $('.menue', leiste).open = false; });
  $('.f-sort', leiste).addEventListener('change', (e) => { a.sortierung = e.target.value; zeichne(name); });
  $('.f-faellig', leiste)?.addEventListener('click', () => { a.nurFaellig = !a.nurFaellig; zeichne(name); });
  $('.a-csv', leiste).addEventListener('click', () => ladeCsv(ziel(name)));
  $('.a-kopieren', leiste).addEventListener('click', versuche(() => kopiere(ziel(name))));
  $('.a-sheets', leiste).addEventListener('click', versuche((e) => sendeAnSheets(ziel(name), e.currentTarget)));
  $('.a-register', leiste).addEventListener('click', versuche(() => starteRegister(name)));
  $('.a-crm', leiste)?.addEventListener('click', versuche(async () => {
    const d = await api('/api/crm', { leads: ziel('suche') });
    await ladeCrm();
    zeichne('suche');
    melde(`${d.neu} neue Leads im CRM gespeichert` + (d.vorhanden ? `, ${d.vorhanden} waren schon vorhanden` : '') + ` (${d.gesamt} insgesamt).`);
  }));
  $('.a-loeschen', leiste)?.addEventListener('click', versuche(async () => {
    const ids = sichtbare('crm').filter((l) => a.auswahl.has(l.id)).map((l) => l.id);
    if (!ids.length) return melde('Bitte zuerst die Leads anhaken, die gelöscht werden sollen.');
    if (!confirm(`${ids.length} Lead(s) endgültig aus dem CRM löschen?`)) return;
    await api('/api/crm/loeschen', { ids });
    a.auswahl.clear();
    await ladeCrm();
    zeichne('suche');
  }));

  const tabelle = $('#tabelle-' + name);
  const ersetze = (lead) => { a.leads[a.leads.findIndex((l) => l.id === lead.id)] = lead; };
  tabelle.addEventListener('change', versuche(async (e) => {
    const id = e.target.closest('tr')?.dataset.id;
    if (e.target.matches('.alle')) { sichtbare(name).forEach((l) => (e.target.checked ? a.auswahl.add(l.id) : a.auswahl.delete(l.id))); zeichne(name); }
    else if (e.target.matches('.wahl')) { e.target.checked ? a.auswahl.add(id) : a.auswahl.delete(id); zeichne(name); }
    else if (e.target.matches('.crm-status, .notiz, .wiedervorlage')) {
      const feld = e.target.matches('.notiz') ? 'notiz' : e.target.matches('.wiedervorlage') ? 'wiedervorlage' : 'crmStatus';
      ersetze(await api('/api/crm/aendern', { id, [feld]: e.target.value }));
      // Notizen nicht neu zeichnen – sonst springt der Cursor beim Weitertippen aus dem Feld.
      if (feld !== 'notiz') zeichne(name);
    }
  }));
  tabelle.addEventListener('click', versuche(async (e) => {
    const id = e.target.closest('tr')?.dataset.id;
    if (e.target.matches('.haupt-kontakt')) { ersetze(await api('/api/crm/aendern', { id, hauptkontakt: +e.target.dataset.nr })); zeichne(name); }
    else if (e.target.matches('.kontakt-neu')) oeffneKontaktDialog(a.leads.find((l) => l.id === id));
  }));
}

// ───────── Kontakt protokollieren ─────────
const dialog = $('#kontakt-dialog');
function oeffneKontaktDialog(lead) {
  dialog.dataset.id = lead.id;
  $('#kontakt-titel').textContent = lead.name + (lead.inhaber ? ' – ' + [lead.anrede, lead.inhaber].filter(Boolean).join(' ') : '');
  $('#kontakt-ergebnis').innerHTML = KONTAKT_ERGEBNISSE.map((k) => `<option>${esc(k)}</option>`).join('');
  $('#kontakt-notiz').value = '';
  $('#kontakt-wv').value = lead.wiedervorlage || '';
  dialog.showModal();
}
$('#kontakt-abbrechen').addEventListener('click', () => dialog.close());
$$('#kontakt-dialog [data-tage]').forEach((b) => b.addEventListener('click', () => {
  const d = new Date();
  d.setDate(d.getDate() + +b.dataset.tage);
  $('#kontakt-wv').value = d.toLocaleDateString('sv');
}));
$('#kontakt-formular').addEventListener('submit', versuche(async (e) => {
  e.preventDefault();
  const lead = await api('/api/crm/kontakt', { id: dialog.dataset.id, ergebnis: $('#kontakt-ergebnis').value, notiz: $('#kontakt-notiz').value, wiedervorlage: $('#kontakt-wv').value });
  const a = ansichten.crm;
  a.leads[a.leads.findIndex((l) => l.id === lead.id)] = lead;
  dialog.close();
  zeichne('crm');
  melde('Kontakt eingetragen.');
}));

// ───────── Handelsregister ─────────
let registerTimer = null;
async function starteRegister(name) {
  const leads = ziel(name);
  if (!leads.length) return melde('Keine Leads zum Prüfen.');
  const stand = await api('/api/register');
  const noetig = leads.filter((l) => l.status !== 'register').length;
  if (noetig > stand.frei && !confirm(`Das Registerportal erlaubt nur wenige Abrufe pro Stunde. Aktuell sind noch etwa ${stand.frei} Prüfungen möglich, ausgewählt sind ${leads.length}. Jetzt so viele wie möglich prüfen?`)) return;
  await api('/api/register', { quelle: name, ids: leads.map((l) => l.id) });
  verfolgeRegister();
}
async function verfolgeRegister(nurWennLaeuft = false) {
  clearTimeout(registerTimer);
  const d = await api('/api/register');
  if (!d.laeuft && nurWennLaeuft) return;
  if (d.laeuft) {
    melde(d.meldung, false, true);
    registerTimer = setTimeout(versuche(() => verfolgeRegister()), 1500);
    return;
  }
  if (!d.gesamt) return;
  await ladeCrm();
  jobId = null; // erzwingt vollständiges Neuladen der Suchergebnisse mit den Registerdaten
  await holeStand();
  melde(d.meldung, false, true);
  hinweisTimer = setTimeout(() => ($('#hinweis').hidden = true), 12000);
}

// ───────── Export ─────────
function csvText(leads) {
  const zelle = (w) => '"' + String(w).replace(/"/g, '""').replace(/^([=@])/, "'$1") + '"';
  return [EXPORT_KOPF.map(zelle).join(';'), ...leads.map((l) => exportZeile(l).map(zelle).join(';'))].join('\r\n');
}
// Google Sheets liest „+49 …“ und „=…“ sonst als Formel – ein Apostroph markiert die Zelle als Text.
function tabellenText(leads) {
  const zelle = (w) => String(w).replace(/[\t\r\n]+/g, ' ').replace(/^([+=])/, "'$1");
  return [EXPORT_KOPF.join('\t'), ...leads.map((l) => exportZeile(l).map(zelle).join('\t'))].join('\n');
}

function ladeCsv(leads) {
  if (!leads.length) return melde('Keine Leads zum Exportieren.');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['﻿' + csvText(leads)], { type: 'text/csv;charset=utf-8' }));
  link.download = `leads-${heute()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function kopiere(leads) {
  if (!leads.length) return melde('Keine Leads zum Kopieren.');
  await navigator.clipboard.writeText(tabellenText(leads));
  melde(`${leads.length} Leads kopiert – in Google Sheets mit Strg+V einfügen.`);
}

async function sendeAnSheets(leads, knopf) {
  if (!leads.length) return melde('Keine Leads zum Senden.');
  knopf.disabled = true;
  try {
    const d = await api('/api/sheets', { leads });
    melde(`${d.neu} neue Leads in die Google-Tabelle geschrieben` + (d.vorhanden ? `, ${d.vorhanden} waren schon vorhanden.` : '.'));
  } catch (e) {
    if (/Web-App-URL/.test(e.message)) zeigeReiter('sheets');
    throw e;
  } finally {
    knopf.disabled = false;
  }
}

// ───────── Suche ─────────
const formular = $('#suchformular');

function leseFormular() {
  const f = new FormData(formular);
  return { ort: f.get('ort'), radiusKm: Math.min(150, +f.get('radiusKm')), deutschland: formular.deutschland.checked, anzahl: +f.get('anzahl'), minStatus: f.get('minStatus'), maKlassen: f.getAll('ma'), branchen: formular.alleBranchen.checked ? ['alle'] : f.getAll('branche'), stichworte: f.getAll('stichwort'), ohneCrm: formular.ohneCrm.checked, websiteSuchen: formular.websiteSuchen.checked, websiteErraten: formular.websiteSuchen.checked,
    internet: formular.internet.checked, rechtsformen: f.getAll('rechtsform'), nurTelefon: formular.nurTelefon.checked, nurEmail: formular.nurEmail.checked, nurKarriere: formular.nurKarriere.checked };
}

function zeigeFortschritt(d) {
  const laeuft = !d.fertig;
  $('#fortschritt').hidden = false;
  $('#start').disabled = laeuft;
  $('#stopp').hidden = !laeuft;
  $('#fortschritt-titel').textContent = d.fehler ? 'Suche fehlgeschlagen' : laeuft ? 'Suche läuft …' : `${d.gesamt} ${d.gesamt === 1 ? 'Lead' : 'Leads'} gefunden`;
  $('#fortschritt-zahlen').textContent = d.kandidaten ? `${d.geprueft} von ${d.kandidaten} Unternehmen geprüft · ${d.gesamt} Treffer` : '';
  const anteil = d.fertig ? 1 : Math.max(d.gesamt / d.parameter.anzahl, d.kandidaten ? d.geprueft / d.kandidaten : 0.02);
  $('#balken-fuellung').style.width = Math.round(Math.min(1, anteil) * 100) + '%';
  $('#balken').classList.toggle('laeuft', laeuft);
  // Solange nur gesammelt wird, gibt es noch nichts zu zählen – dann wandert der Balken ohne Füllstand.
  $('#balken').classList.toggle('unbestimmt', laeuft && (!d.kandidaten || d.geprueft >= d.kandidaten) && d.gesamt < d.parameter.anzahl);
  if (d.zentrumPunkt && (suchMitte?.lat !== d.zentrumPunkt.lat || suchMitte?.lon !== d.zentrumPunkt.lon)) { suchMitte = d.zentrumPunkt; if (!ortMitte) zeigeGebiet(); }
  const teile = [d.fehler || d.meldung];
  if (d.zentrum) teile.push(d.parameter.deutschland ? `Ganz Deutschland, nächstgelegene zuerst ab ${d.zentrum.split(',').slice(0, 2).join(',')}.` : `Umkreis ${d.parameter.radiusKm} km um ${d.zentrum.split(',').slice(0, 2).join(',')}.`);
  const aus = d.aussortiert;
  if (aus.sicherheit || aus.groesse || aus.filter) teile.push(`Aussortiert: ${aus.sicherheit} wegen zu unsicherem Inhaber, ${aus.groesse} wegen Größenfilter` + (aus.filter ? `, ${aus.filter} wegen Rechtsform- oder Kontaktfilter.` : '.'));
  if (d.schonImCrm) teile.push(`${d.schonImCrm} schon im CRM – übersprungen.`);
  if (d.websitesGefunden) teile.push(`${d.websitesGefunden} fehlende Websites ermittelt.`);
  if (d.ausInternet) teile.push(`${d.ausInternet} Treffer stammen aus der Internet-Suche.`);
  if (d.ohneWebsite) teile.push(`${d.ohneWebsite} Einträge ohne Website übersprungen (Inhaber nicht prüfbar).`);
  if (d.fertig && !d.fehler && !d.abbruch && d.gesamt < d.parameter.anzahl) teile.push(d.parameter.deutschland ? 'Für mehr Treffer: mehr Branchen wählen oder die Inhaber-Sicherheit lockern.' : 'Für mehr Treffer: Umkreis vergrößern, „Ganz Deutschland“ wählen, mehr Branchen wählen oder die Inhaber-Sicherheit lockern.');
  $('#leer-suche').textContent = laeuft ? 'Die ersten Treffer erscheinen hier, sobald die Impressen geprüft sind.' : 'Keine passenden Leads gefunden.';
  const meldung = $('#fortschritt-meldung');
  const zeilen = teile.filter(Boolean);
  meldung.textContent = zeilen.slice(0, d.zentrum ? 2 : 1).join(' ');
  const rest = zeilen.slice(d.zentrum ? 2 : 1);
  $('#fortschritt-details').hidden = !rest.length;
  $('#fortschritt-einzelheiten').textContent = rest.join(' ');
  meldung.classList.toggle('fehler', !!d.fehler);
}

async function holeStand() {
  clearTimeout(abfrageTimer);
  const a = ansichten.suche;
  let d = await api('/api/suche?ab=' + a.leads.length);
  if (d.leer) return;
  // Neue Suche oder nachträglich geänderte Leads (Registerabgleich): Liste komplett neu holen.
  if (d.id !== jobId || d.stand !== jobStand) {
    if (d.id !== jobId) a.auswahl.clear();
    jobId = d.id;
    jobStand = d.stand;
    a.leads = [];
    d = await api('/api/suche?ab=0');
  }
  a.leads.push(...d.leads);
  zeigeFortschritt(d);
  if (d.leads.length || !$('#tabelle-suche').innerHTML) zeichne('suche');
  if (!d.fertig) abfrageTimer = setTimeout(versuche(holeStand), 1200);
}

// ───────── Suche in der Online-Variante ─────────
// Auf Vercel läuft kein Hintergrundauftrag. Der Browser holt erst die Unternehmen je Branchengruppe und lässt sie
// dann in kleinen Paketen prüfen; Fortschritt und Ergebnis liegen hier im Browser.
let cloudSuche = null;
const SUCHE_MERKER = 'leadscraper-suche';
const BRANCHEN_JE_ABRUF = 3, KANDIDATEN_JE_PAKET = 10, PAKETE_GLEICHZEITIG = 3;

function zeigeCloud() {
  ansichten.suche.leads = cloudSuche.leads;
  zeigeFortschritt({ ...cloudSuche, gesamt: cloudSuche.leads.length });
  zeichne('suche');
}

async function starteCloudSuche(p) {
  // Katalogbranchen und eigene Stichwörter werden gemeinsam in kleinen Gruppen abgerufen.
  const einheiten = [...p.branchen.map((id) => ({ branche: id })), ...(p.stichworte || []).map((wort) => ({ wort }))];
  if (!einheiten.length) throw new Error('Bitte mindestens eine Branche auswählen oder ein eigenes Stichwort eingeben.');
  if (cloudSuche && !cloudSuche.fertig) cloudSuche.abbruch = true;
  const c = (cloudSuche = { id: Date.now().toString(36), parameter: p, meldung: 'Ort wird gesucht …', zentrum: '', kandidaten: 0, ohneWebsite: 0, schonImCrm: 0, websitesGefunden: 0, geprueft: 0, crmNachPruefung: 0, leads: [], aussortiert: { sicherheit: 0, groesse: 0, fehler: 0, filter: 0 }, fertig: false, fehler: '', abbruch: false });
  const aktuell = () => cloudSuche === c;
  ansichten.suche.auswahl.clear();
  zeigeCloud();
  try {
    let zentrum = null;
    const erledigt = new Set();
    const abrufe = Math.ceil(einheiten.length / BRANCHEN_JE_ABRUF);
    // Durchgänge wie in der lokalen Version: erst den voraussichtlichen Bedarf sammeln und prüfen; reicht das nicht
    // für die gewünschte Lead-Zahl, die dreifache Menge holen – bis im Umkreis nichts mehr zu holen ist.
    for (let bedarf = Math.max(200, Math.ceil(((p.anzahl * 6) / abrufe) * 1.5)); ; bedarf *= 3) {
      const alle = new Map();
      let ausgeschoepft = true, ohneWebsite = 0, imCrm = 0;
      for (let i = 0; i < einheiten.length && !c.abbruch; i += BRANCHEN_JE_ABRUF) {
        const teil = einheiten.slice(i, i + BRANCHEN_JE_ABRUF);
        c.meldung = `Unternehmen werden gesammelt (Branche ${i + 1} bis ${i + teil.length} von ${einheiten.length}) …`;
        if (aktuell()) zeigeCloud();
        const r = await api('/api/kandidaten', { bedarf, parameter: p, branchen: teil.filter((x) => x.branche).map((x) => x.branche), stichworte: teil.filter((x) => x.wort).map((x) => x.wort), zentrum });
        zentrum = r.zentrum;
        c.zentrum = zentrum.name;
        c.zentrumPunkt = { lat: zentrum.lat, lon: zentrum.lon };
        ohneWebsite += r.ohneWebsite;
        imCrm += r.schonImCrm;
        if (!r.vollstaendig) ausgeschoepft = false;
        // Filialen mit derselben Website zählen als ein Unternehmen – die nächstgelegene bleibt.
        for (const k of r.schlange) { const alt = alle.get(k.schluessel); if (!alt || k.entfernungKm < alt.entfernungKm) alle.set(k.schluessel, k); }
      }
      const schlange = [...alle.values()].filter((k) => !erledigt.has(k.id)).sort((x, y) => x.entfernungKm - y.entfernungKm);
      schlange.forEach((k) => erledigt.add(k.id));
      c.kandidaten = erledigt.size;
      c.ohneWebsite = ohneWebsite;
      c.schonImCrm = imCrm + c.crmNachPruefung;
      c.meldung = 'Websites und Impressen werden geprüft …';
      let naechster = 0;
      const arbeiter = async () => {
        while (!c.abbruch && c.leads.length < p.anzahl && naechster < schlange.length) {
          const paket = schlange.slice(naechster, naechster + KANDIDATEN_JE_PAKET);
          naechster += paket.length;
          const { ergebnisse } = await api('/api/pruefen', { parameter: p, kandidaten: paket }).catch(() => ({ ergebnisse: paket.map(() => ({ grund: 'fehler' })) }));
          for (const r of ergebnisse) {
            c.geprueft++;
            if (r.websiteGefunden) c.websitesGefunden++;
            if (r.grund === 'crm') { c.schonImCrm++; c.crmNachPruefung++; }
            else if (r.grund) c.aussortiert[r.grund]++;
            else if (c.leads.length < p.anzahl) c.leads.push(r.lead);
          }
          if (aktuell()) zeigeCloud();
        }
      };
      await Promise.all(Array.from({ length: PAKETE_GLEICHZEITIG }, arbeiter));
      if (c.abbruch || c.leads.length >= p.anzahl || ausgeschoepft || !schlange.length) break;
      c.meldung = 'Noch nicht genug Treffer – es werden weitere Unternehmen gesammelt …';
      if (aktuell()) zeigeCloud();
    }
    c.meldung = c.abbruch ? 'Suche gestoppt.' : c.leads.length >= p.anzahl ? 'Gewünschte Anzahl erreicht.' : p.deutschland ? 'Alle erreichbaren Unternehmen geprüft.' : 'Alle Unternehmen im Umkreis geprüft.';
  } catch (e) {
    c.fehler = e.message;
    c.meldung = '';
  }
  c.fertig = true;
  if (!aktuell()) return;
  zeigeCloud();
  try { localStorage.setItem(SUCHE_MERKER, JSON.stringify(c)); } catch {} // zu groß für den Browserspeicher: dann eben ohne Merken
}

function ladeGemerkteCloudSuche() {
  try { cloudSuche = JSON.parse(localStorage.getItem(SUCHE_MERKER)); } catch {}
  if (cloudSuche) { cloudSuche.fertig = true; zeigeCloud(); }
}

formular.addEventListener('submit', versuche(async (e) => {
  e.preventDefault();
  const p = leseFormular();
  localStorage.setItem('leadscraper-formular', JSON.stringify({ ...p, mitte: ortMitte }));
  if (MODUS.modus === 'cloud') return starteCloudSuche(p);
  await api('/api/suche', p);
  await holeStand();
}));
$('#stopp').addEventListener('click', versuche(async () => {
  if (MODUS.modus === 'cloud') { if (cloudSuche) cloudSuche.abbruch = true; return; }
  await api('/api/suche/stop', {});
}));
formular.radiusKm.addEventListener('input', (e) => { formular.deutschland.checked = +e.target.value > 150; zeigeDeutschland(); });
// „Ganz Deutschland“ setzt den Umkreis außer Kraft; ein Ort ist dann nur noch der Startpunkt und darf fehlen.
function zeigeDeutschland() {
  const an = formular.deutschland.checked;
  if (an) formular.radiusKm.value = 151; else if (+formular.radiusKm.value > 150) formular.radiusKm.value = 150;
  $('#radius-wert').textContent = an ? 'Ganz Deutschland' : formular.radiusKm.value + ' km';
  formular.ort.required = !an;
  formular.ort.placeholder = an ? 'Startpunkt (leer = Mitte Deutschlands)' : 'Stadt oder PLZ';
  zeigeGebiet();
}
// „alle / keine“ einer Gruppe – wirkt nur auf die Branchen, die die Suchzeile gerade zeigt.
$('#branchen-gruppen').addEventListener('click', (e) => {
  const link = e.target.closest('a[data-gruppe]');
  if (!link) return;
  e.preventDefault(); // der Klick soll die Gruppe nicht auf- oder zuklappen
  const boxen = $$('#branchen-' + link.dataset.gruppe + ' input').filter((b) => !b.parentElement.hidden);
  const alle = boxen.every((b) => b.checked);
  boxen.forEach((b) => (b.checked = !alle));
  zeigeAuswahlAnzahl();
});
$('#rechtsform-alle').addEventListener('click', (e) => {
  e.preventDefault();
  const boxen = $$('input[name=rechtsform]');
  const alle = boxen.every((b) => b.checked);
  boxen.forEach((b) => (b.checked = !alle));
});
formular.alleBranchen.addEventListener('change', zeigeAuswahlAnzahl);

async function ladeBranchen() {
  const branchen = await api('/api/branchen');
  let gemerkt = {};
  try { gemerkt = JSON.parse(localStorage.getItem('leadscraper-formular')) || {}; } catch {}
  // Gruppen in Katalogreihenfolge; die beiden Schwerpunkt-Gruppen sind von Anfang an aufgeklappt, die übrigen bei Bedarf.
  const gruppen = [...new Map(branchen.map((b) => [b.gruppe, b.gruppeLabel || b.gruppe])).entries()];
  $('#branchen-gruppen').innerHTML = gruppen.map(([id, name]) => {
    const eintraege = branchen.filter((b) => b.gruppe === id);
    const offen = ['hochpreis', 'personal'].includes(id) || eintraege.some((b) => gemerkt.branchen?.includes(b.id));
    return `<details class="gruppe" ${offen ? 'open' : ''} data-offen="${offen ? 1 : ''}">
      <summary><span>${esc(name)}</span><span class="g-zahl"></span><a href="#" class="mini" data-gruppe="${esc(id)}">alle / keine</a></summary>
      <div class="chips" id="branchen-${esc(id)}">${eintraege.map((b) => `<label><input type="checkbox" name="branche" value="${esc(b.id)}" data-suche="${esc(b.suche || b.label.toLowerCase())}" ${gemerkt.branchen?.includes(b.id) ? 'checked' : ''}><span>${esc(b.label)}</span></label>`).join('')}</div>
    </details>`;
  }).join('');
  $('#rechtsformen').innerHTML = RECHTSFORM_GRUPPEN.map(([id, text]) => `<label><input type="checkbox" name="rechtsform" value="${id}" ${!gemerkt.rechtsformen || gemerkt.rechtsformen.includes(id) ? 'checked' : ''}><span>${esc(text)}</span></label>`).join('');
  if (gemerkt.ort) formular.ort.value = gemerkt.ort;
  if (gemerkt.mitte && gemerkt.mitte.name === gemerkt.ort) ortMitte = gemerkt.mitte;
  if (gemerkt.radiusKm) formular.radiusKm.value = gemerkt.radiusKm;
  if (gemerkt.anzahl) formular.anzahl.value = gemerkt.anzahl;
  if (gemerkt.minStatus) formular.minStatus.value = gemerkt.minStatus;
  if (gemerkt.maKlassen) $$('input[name=ma]').forEach((b) => (b.checked = gemerkt.maKlassen.includes(b.value)));
  if (gemerkt.ohneCrm === false) formular.ohneCrm.checked = false;
  // Früher war die Option standardmäßig aus; nur eine bewusste Abwahl seit der Umstellung zählt.
  if (gemerkt.websiteErraten === false) formular.websiteSuchen.checked = false;
  for (const feld of ['nurTelefon', 'nurEmail', 'nurKarriere']) formular[feld].checked = gemerkt[feld] === true;
  formular.alleBranchen.checked = !!gemerkt.branchen?.includes('alle');
  formular.deutschland.checked = gemerkt.deutschland === true;
  if (gemerkt.internet === false) formular.internet.checked = false;
  zeigeDeutschland();
  (gemerkt.stichworte || []).forEach(fuegeStichwortHinzu);
  zeigeAuswahlAnzahl();
}

// ───────── Vorschlagslisten (Branche und Ort) ─────────
// Eine Liste unter dem Eingabefeld: mit Pfeiltasten und Enter oder per Klick wählbar.
function vorschlagsliste(feld, liste, waehle) {
  let eintraege = [], aktiv = -1;
  const zu = () => { liste.hidden = true; feld.setAttribute('aria-expanded', 'false'); aktiv = -1; };
  const markiere = () => [...liste.children].forEach((li, i) => li.classList.toggle('aktiv', i === aktiv));
  const nimm = (i) => { const e = eintraege[i]; zu(); if (e) waehle(e); };
  liste.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault(); // das Feld soll den Fokus behalten
    nimm([...liste.children].indexOf(li));
  });
  feld.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return zu();
    if (liste.hidden || !eintraege.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      aktiv = (aktiv + (e.key === 'ArrowDown' ? 1 : -1) + eintraege.length) % eintraege.length;
      markiere();
    } else if (e.key === 'Enter') {
      e.preventDefault(); // Enter wählt den Vorschlag und startet nicht die Suche
      e.stopImmediatePropagation();
      nimm(Math.max(aktiv, 0));
    }
  });
  feld.addEventListener('blur', () => setTimeout(zu, 120));
  return {
    zu,
    zeige(neue) {
      eintraege = neue;
      aktiv = -1;
      liste.innerHTML = neue.map((e) => `<li role="option">${e.html}</li>`).join('');
      liste.hidden = !neue.length;
      feld.setAttribute('aria-expanded', String(!!neue.length));
    },
  };
}

// ───────── Branchen-Suchzeile ─────────
// Tippen schlägt die passenden Katalogbranchen vor. Was der Katalog nicht kennt, lässt sich als eigenes
// Stichwort aufnehmen – die Suche findet dann Firmen, die dieses Wort im Namen tragen.
const suchfeld = $('#branchen-suche');
const BELIEBT = ['solar', 'kuechen', 'autohaus', 'immobilien', 'fenster', 'shk', 'dach', 'zahnarzt', 'pflege'];

const branchenVorschlaege = vorschlagsliste(suchfeld, $('#branchen-vorschlaege'), (e) => {
  if (e.stichwort) return fuegeStichwortHinzu(e.stichwort);
  e.box.checked = true;
  suchfeld.value = '';
  filtereBranchen();
  zeigeAuswahlAnzahl();
});

function filtereBranchen() {
  const worte = suchfeld.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const treffer = [];
  for (const gruppe of $$('#branchen-gruppen details')) {
    let sichtbar = 0;
    for (const label of $('.chips', gruppe).children) {
      const box = label.firstElementChild;
      const passt = worte.every((w) => box.dataset.suche.includes(w));
      label.hidden = !passt;
      if (passt) { sichtbar++; if (worte.length && !box.checked) treffer.push({ box, name: label.textContent, gruppe: $('summary span', gruppe).textContent }); }
    }
    // Beim Suchen klappen die Gruppen mit Treffern auf; ohne Suchtext gilt wieder der Ausgangszustand.
    gruppe.hidden = !sichtbar;
    gruppe.open = worte.length ? sichtbar > 0 : !!gruppe.dataset.offen || !!$('input:checked', gruppe);
  }
  const eingabe = suchfeld.value.trim().replace(/\s+/g, ' ');
  // Treffer, die mit der Eingabe beginnen, zuerst
  const beginnt = (t) => (t.name.toLowerCase().startsWith(worte[0]) ? 0 : 1);
  const eintraege = treffer.sort((x, y) => beginnt(x) - beginnt(y)).slice(0, 8).map((t) => ({ ...t, html: `<span>${esc(t.name)}</span><span class="unter">${esc(t.gruppe)}</span>` }));
  // Leeres Feld: die beliebten Branchen anbieten
  if (!worte.length) for (const id of BELIEBT) { const box = $(`input[name=branche][value="${id}"]`); if (box && !box.checked) eintraege.push({ box, html: `<span>${esc(box.parentElement.textContent)}</span><span class="unter">beliebt</span>` }); }
  if (eingabe.length >= 3) eintraege.push({ stichwort: eingabe, html: `<span>+ „${esc(eingabe)}“ als eigenes Stichwort</span><span class="unter">findet Firmen mit dem Wort im Namen</span>` });
  if (document.activeElement === suchfeld) branchenVorschlaege.zeige(eintraege); else branchenVorschlaege.zu();
}

// Die Auswahl als Marken in der Suchzeile – ein Klick entfernt die Branche wieder.
function zeigeMarken() {
  const alle = formular.alleBranchen.checked;
  const marke = (art, wert, text) => `<button type="button" class="marke-knopf" data-art="${art}" data-wert="${esc(wert)}" title="Entfernen">${esc(text)}<span aria-hidden="true"> ×</span></button>`;
  const gewaehlt = alle ? [] : $$('input[name=branche]:checked');
  const zeigen = gewaehlt.slice(0, 6);
  $('#auswahl-marken').innerHTML = (alle ? marke('alle', '', 'Alle Branchen') : zeigen.map((b) => marke('branche', b.value, b.parentElement.textContent)).join('')) +
    $$('input[name=stichwort]:checked').map((b) => marke('stichwort', b.value, '„' + b.value + '“')).join('') +
    (gewaehlt.length > zeigen.length ? `<button type="button" class="marke-knopf mehr" data-art="mehr">+ ${gewaehlt.length - zeigen.length} weitere</button>` : '');
  suchfeld.placeholder = $('#auswahl-marken').children.length ? 'weitere Branche …' : 'Branche eintippen, z. B. Solar, Zahnarzt, Küchen …';
}
$('#auswahl-marken').addEventListener('click', (e) => {
  const k = e.target.closest('button');
  if (!k) return;
  if (k.dataset.art === 'mehr') { $('#katalog').open = true; return; }
  if (k.dataset.art === 'alle') formular.alleBranchen.checked = false;
  else {
    const box = $$(`input[name=${k.dataset.art}]`).find((b) => b.value === k.dataset.wert);
    if (box) { box.checked = false; if (k.dataset.art === 'stichwort') box.parentElement.remove(); }
    $('#gruppe-frei').hidden = !$('#branchen-frei').children.length;
  }
  zeigeAuswahlAnzahl();
});
// Klick irgendwo in den Rahmen setzt den Cursor ins Suchfeld.
$('#was-rahmen').addEventListener('click', (e) => { if (e.target === e.currentTarget || e.target.id === 'auswahl-marken') suchfeld.focus(); });
// Wie viele der weiteren Filter vom Standard abweichen – steht neben „Weitere Filter“.
function zeigeFilterAnzahl() {
  const n = [formular.minStatus.value !== 'impressum', $$('input[name=ma]').some((b) => !b.checked), $$('input[name=rechtsform]').some((b) => !b.checked),
    formular.nurTelefon.checked, formular.nurEmail.checked, formular.nurKarriere.checked, !formular.ohneCrm.checked, !formular.websiteSuchen.checked,
    !$('#internet-zeile').hidden && !formular.internet.checked].filter(Boolean).length;
  $('#filter-anzahl').textContent = n ? `${n} aktiv` : '';
}

function zeigeAuswahlAnzahl() {
  const alle = formular.alleBranchen.checked;
  const n = $$('input[name=branche]:checked').length, eigene = $$('input[name=stichwort]:checked').length;
  $('#branchen-anzahl').textContent = alle ? '(alle gewählt)' : n + eigene ? `(${n + eigene} ausgewählt)` : '';
  $('#branchen-gruppen').classList.toggle('aus', alle);
  for (const gruppe of $$('#branchen-gruppen details')) {
    const gewaehlt = $$('input:checked', gruppe).length;
    $('.g-zahl', gruppe).textContent = gewaehlt ? `${gewaehlt} von ${$$('input', gruppe).length}` : '';
  }
  zeigeMarken();
  zeigeFilterAnzahl();
}

function fuegeStichwortHinzu(wort) {
  wort = String(wort).trim().replace(/\s+/g, ' ').slice(0, 40);
  if (wort.length < 3) return;
  const feld = $('#branchen-frei');
  if (![...feld.querySelectorAll('input')].some((b) => b.value.toLowerCase() === wort.toLowerCase())) {
    if (feld.children.length >= 10) return melde('Mehr als zehn eigene Stichwörter gehen nicht auf einmal.', true);
    feld.insertAdjacentHTML('beforeend', `<label title="Entfernen"><input type="checkbox" name="stichwort" value="${esc(wort)}" checked><span>${esc(wort)}</span></label>`);
  }
  $('#gruppe-frei').hidden = false;
  suchfeld.value = '';
  filtereBranchen();
  zeigeAuswahlAnzahl();
}

suchfeld.addEventListener('input', filtereBranchen);
suchfeld.addEventListener('focus', filtereBranchen);
suchfeld.addEventListener('keydown', (e) => {
  // Enter ohne Vorschlag soll nicht die ganze Suche starten; Rücktaste im leeren Feld entfernt die letzte Marke.
  if (e.key === 'Enter' && suchfeld.value.trim()) e.preventDefault();
  if (e.key === 'Backspace' && !suchfeld.value) $$('#auswahl-marken button:not(.mehr)').pop()?.click();
});
// Ein abgewähltes eigenes Stichwort verschwindet ganz.
$('#branchen-frei').addEventListener('change', (e) => {
  if (!e.target.checked) e.target.parentElement.remove();
  $('#gruppe-frei').hidden = !$('#branchen-frei').children.length;
});
formular.addEventListener('change', zeigeAuswahlAnzahl);

// ───────── Ort: Vorschläge, Schnellwahl und Karte ─────────
// Ortsvorschläge und Karte kommen von OpenStreetMap (Photon und Leaflet) – kostenlos und ohne Schlüssel.
const PHOTON = 'https://photon.komoot.io';
const DE_RAHMEN = '5.87,47.27,15.04,55.06';
const STAEDTE = [['Berlin', 52.52, 13.405], ['Hamburg', 53.551, 9.994], ['München', 48.137, 11.575], ['Köln', 50.938, 6.96], ['Frankfurt am Main', 50.11, 8.682], ['Stuttgart', 48.778, 9.18],
  ['Düsseldorf', 51.227, 6.773], ['Leipzig', 51.34, 12.375], ['Dresden', 51.05, 13.738], ['Nürnberg', 49.452, 11.077], ['Hannover', 52.375, 9.732], ['Bremen', 53.079, 8.801]];
const ortFeld = formular.ort;
let ortMitte = null; // { lat, lon, name } zum Text im Ortsfeld, sobald bekannt
let ortAbruf = null, ortTimer = null;

async function frageOrte(text, anzahl = 6) {
  ortAbruf?.abort();
  ortAbruf = new AbortController();
  // Postleitzahlen kennt Photon nur ohne die Einschränkung auf Orte.
  const nurOrte = /^\d/.test(text) ? '' : '&layer=city';
  const r = await fetch(`${PHOTON}/api/?q=${encodeURIComponent(text)}&lang=de&limit=${anzahl}${nurOrte}&bbox=${DE_RAHMEN}`, { signal: ortAbruf.signal });
  const gesehen = new Set();
  return ((await r.json()).features || []).filter((f) => f.properties.countrycode === 'DE').map((f) => {
    const p = f.properties, name = p.name || p.city || p.postcode || text;
    return { name, land: p.state || '', lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
  }).filter((o) => !gesehen.has(o.name + o.land) && gesehen.add(o.name + o.land));
}

function setzeOrt(o, schwenk = true) {
  // Gleichnamige Orte: das Bundesland macht die Angabe für die Suche eindeutig.
  ortFeld.value = o.eindeutig === false && o.land ? `${o.name}, ${o.land}` : o.name;
  ortMitte = { lat: o.lat, lon: o.lon, name: ortFeld.value };
  zeigeGebiet(schwenk);
}

const ortVorschlaege = vorschlagsliste(ortFeld, $('#ort-vorschlaege'), (o) => setzeOrt(o));
ortFeld.addEventListener('input', () => {
  clearTimeout(ortTimer);
  ortMitte = null;
  const text = ortFeld.value.trim();
  if (text.length < 2 || /^\d{1,5}$/.test(text)) return ortVorschlaege.zu();
  ortTimer = setTimeout(async () => {
    try {
      const orte = await frageOrte(text);
      const namen = orte.map((o) => o.name);
      if (document.activeElement === ortFeld && ortFeld.value.trim() === text) ortVorschlaege.zeige(orte.map((o) => ({ ...o, eindeutig: namen.filter((n) => n === o.name).length === 1, html: `<span>${esc(o.name)}</span><span class="unter">${esc(o.land)}</span>` })));
    } catch {} // abgebrochen oder Dienst nicht erreichbar: dann eben ohne Vorschläge
  }, 300);
});
// Ohne gewählten Vorschlag (frei getippt, Postleitzahl): den Ort für die Karte nachschlagen.
ortFeld.addEventListener('change', async () => {
  const text = ortFeld.value.trim();
  if (!text || ortMitte?.name === text) return zeigeGebiet();
  try { const [o] = await frageOrte(text, 1); if (o && ortFeld.value.trim() === text) { ortMitte = { lat: o.lat, lon: o.lon, name: text }; zeigeGebiet(); } } catch {}
});
// Leeres Feld: die großen Städte anbieten
ortFeld.addEventListener('focus', () => {
  if (!ortFeld.value.trim()) ortVorschlaege.zeige(STAEDTE.map(([name, lat, lon]) => ({ name, lat, lon, html: `<span>${esc(name)}</span>` })));
});

// Die Karte: Kreis = Suchgebiet, Punkte = Treffer. Lädt die Kartenbibliothek nach; klappt das nicht, bleibt die Spalte weg.
let karte = null, gebiet = null, pins = null, suchMitte = null, pinsEingepasst = -1;
const DE_GRENZEN = [[47.27, 5.87], [55.06, 15.04]];
const PIN_FARBE = { register: '#12805c', bestaetigt: '#12805c', impressum: '#1f5fbf', pruefen: '#9a6700', unbekannt: '#5d6577' };

function ladeKarte() {
  const skript = document.createElement('script');
  skript.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
  skript.crossOrigin = 'anonymous';
  skript.onerror = () => { $('#kartenspalte').hidden = true; $('.zweispaltig').classList.add('ohne-karte'); };
  skript.onload = () => {
    karte = L.map('karte', { zoomControl: true, attributionControl: true }).fitBounds(DE_GRENZEN);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(karte);
    gebiet = L.layerGroup().addTo(karte);
    pins = L.layerGroup().addTo(karte);
    karte.on('click', versuche(async (e) => {
      // Der nächstgelegene Ort zum Klick wird zum Suchort.
      const r = await fetch(`${PHOTON}/reverse?lat=${e.latlng.lat.toFixed(5)}&lon=${e.latlng.lng.toFixed(5)}&lang=de&layer=city&radius=30`);
      const f = ((await r.json()).features || [])[0];
      if (!f || f.properties.countrycode !== 'DE') return melde('Hier liegt kein Ort in Deutschland.');
      setzeOrt({ name: f.properties.name, land: f.properties.state, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }, false);
    }));
    // Ändert sich die Größe der Kartenfläche (Fenster, aufgeklappte Filter), muss die Karte neu vermessen werden.
    new ResizeObserver(() => karte.invalidateSize()).observe($('#karte'));
    karte.invalidateSize();
    zeigeGebiet();
    zeichnePins();
  };
  document.head.append(skript);
}

// Zeichnet das Suchgebiet zum Formular: Kreis um den Ort oder – bei „Ganz Deutschland“ – das ganze Land.
function zeigeGebiet(schwenk = true) {
  if (!karte) return;
  gebiet.clearLayers();
  const mitte = ortMitte || suchMitte;
  const land = formular.deutschland.checked;
  if (mitte) L.circleMarker([mitte.lat, mitte.lon], { radius: 5, color: '#3b4fd8', fillColor: '#3b4fd8', fillOpacity: 1, interactive: false }).addTo(gebiet);
  if (land || !mitte) { if (schwenk) karte.fitBounds(DE_GRENZEN); return; }
  const kreis = L.circle([mitte.lat, mitte.lon], { radius: +formular.radiusKm.value * 1000, color: '#3b4fd8', weight: 2, fillColor: '#3b4fd8', fillOpacity: 0.08, interactive: false }).addTo(gebiet);
  if (schwenk) karte.fitBounds(kreis.getBounds(), { padding: [12, 12] });
}

function zeichnePins() {
  if (!karte) return;
  pins.clearLayers();
  const liste = sichtbare('suche').filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lon));
  for (const l of liste) {
    const farbe = PIN_FARBE[l.status] || PIN_FARBE.unbekannt;
    L.circleMarker([l.lat, l.lon], { radius: 6, color: '#fff', weight: 1.5, fillColor: farbe, fillOpacity: 0.95 })
      .bindTooltip(`<strong>${esc(l.name)}</strong>${l.inhaber ? '<br>' + esc([l.anrede, l.inhaber].filter(Boolean).join(' ')) : ''}<br>${esc([l.plz, l.ort].filter(Boolean).join(' '))}`)
      .on('click', (e) => {
        L.DomEvent.stopPropagation(e); // nicht als Ortswahl werten
        const zeile = $$('#tabelle-suche tbody tr').find((tr) => tr.dataset.id === l.id);
        if (!zeile) return;
        zeile.scrollIntoView({ behavior: 'smooth', block: 'center' });
        zeile.classList.add('hervor');
        setTimeout(() => zeile.classList.remove('hervor'), 2200);
      }).addTo(pins);
  }
  // Bundesweit gibt es keinen Kreis – dann auf die Treffer zoomen.
  // Nur wenn Treffer dazugekommen sind – sonst würde jeder Klick in der Tabelle den Ausschnitt zurücksetzen.
  const einpassen = liste.length !== pinsEingepasst;
  pinsEingepasst = liste.length;
  if (einpassen && liste.length && (formular.deutschland.checked || !(ortMitte || suchMitte))) karte.fitBounds(L.latLngBounds(liste.map((l) => [l.lat, l.lon])), { padding: [24, 24], maxZoom: 11 });
}

// ───────── CRM & Google Sheets ─────────
async function ladeCrm() {
  ansichten.crm.leads = await api('/api/crm');
  zeichne('crm');
}

const APPS_SCRIPT = `function doPost(e) {
  var daten = JSON.parse(e.postData.contents);
  var mappe = SpreadsheetApp.getActiveSpreadsheet();
  var blatt = mappe.getSheetByName('Leads') || mappe.insertSheet('Leads');
  var sperre = LockService.getScriptLock();
  sperre.waitLock(30000);
  try {
    if (blatt.getLastRow() === 0) {
      blatt.getRange(1, 1, 1, daten.kopf.length).setValues([daten.kopf]).setFontWeight('bold');
      blatt.setFrozenRows(1);
    }
    var vorhanden = {};
    if (blatt.getLastRow() > 1) {
      blatt.getRange(2, 1, blatt.getLastRow() - 1, 1).getValues().forEach(function (z) { vorhanden[z[0]] = true; });
    }
    var neu = daten.zeilen.filter(function (z) { return !vorhanden[z[0]]; });
    if (neu.length) {
      var bereich = blatt.getRange(blatt.getLastRow() + 1, 1, neu.length, daten.kopf.length);
      bereich.setNumberFormat('@');
      bereich.setValues(neu);
    }
    return antwort({ ok: true, neu: neu.length, vorhanden: daten.zeilen.length - neu.length });
  } catch (fehler) {
    return antwort({ ok: false, fehler: String(fehler) });
  } finally {
    sperre.releaseLock();
  }
}

function antwort(objekt) {
  return ContentService.createTextOutput(JSON.stringify(objekt)).setMimeType(ContentService.MimeType.JSON);
}`;

$('#apps-script').textContent = APPS_SCRIPT;
$('#code-kopieren').addEventListener('click', versuche(async () => { await navigator.clipboard.writeText(APPS_SCRIPT); melde('Code kopiert.'); }));
$('#sheets-speichern').addEventListener('click', versuche(async () => {
  const status = $('#sheets-status');
  status.className = 'klein';
  status.textContent = 'Verbindung wird getestet …';
  try {
    await api('/api/einstellungen', { sheetsUrl: $('#sheets-url').value });
    await api('/api/sheets', { leads: [] });
    status.textContent = '✓ Verbindung steht. Leads können jetzt direkt gesendet werden.';
  } catch (e) {
    status.className = 'klein fehler';
    status.textContent = e.message;
  }
}));

// ───────── Internet-Suche (nur lokale Version) ─────────
// Zeigt, ob die Liste der deutschen Internet-Adressen eingerichtet ist, und richtet sie auf Knopfdruck ein.
async function zeigeInternetStand() {
  if (!MODUS.internet) return;
  const d = await api('/api/internet');
  $('#internet-zeile').hidden = !d.vorhanden;
  $('#internet-einrichten').hidden = d.vorhanden || d.einrichtung.laeuft;
  $('#internet-status').textContent = d.vorhanden ? `(${(d.anzahl / 1e6).toFixed(1).replace('.', ',')} Mio. deutsche Adressen – im Umkreis dauert der erste Durchlauf je Branche einige Minuten, danach geht es schnell)` : '';
  if (d.einrichtung.laeuft) { melde(d.einrichtung.meldung, false, true); setTimeout(versuche(zeigeInternetStand), 1500); }
  else if (d.einrichtung.fehler) melde(d.einrichtung.fehler, true);
  else if (d.einrichtung.meldung) melde(d.einrichtung.meldung);
}
$('#internet-einrichten').addEventListener('click', versuche(async () => {
  await api('/api/internet', {});
  await zeigeInternetStand();
}));

// ───────── Firmen-Datenbank (nur lokale Version) ─────────
const zahlDe = (n) => Math.round(n).toLocaleString('de-DE');
async function zeigeDatenbank() {
  if (!MODUS.internet) return;
  const d = await api('/api/datenbank');
  $('#reiter-knopf-datenbank').hidden = false;
  $('#db-zaehler').textContent = d.zahl.firmen >= 1000 ? Math.floor(d.zahl.firmen / 1000) + ' Tsd.' : d.zahl.firmen;
  $('#db-firmen').textContent = zahlDe(d.zahl.firmen);
  $('#db-sicher').textContent = zahlDe(d.zahl.sicher);
  $('#db-adressen').textContent = zahlDe(d.zahl.adressen);
  const arbeitet = d.laeuft && !d.pausiertWegenSuche;
  $('#db-balken').classList.toggle('laeuft', arbeitet);
  $('#db-fuellung').style.width = (d.gesamt ? Math.round((d.erledigt / d.gesamt) * 1000) / 10 : 0) + '%';
  $('#db-start').textContent = d.an ? 'Pausieren' : d.zahl.adressen > 1000 ? 'Aufbau fortsetzen' : 'Aufbau starten';
  $('#db-start').dataset.an = d.an ? '' : '1';
  const rest = d.gesamt - d.erledigt;
  const stunden = d.jeSekunde > 0.5 ? rest / d.jeSekunde / 3600 : 0;
  $('#db-stand').textContent = d.pausiertWegenSuche ? 'Pausiert, solange die Suche läuft.'
    : arbeitet && d.gesamt ? `${zahlDe(d.erledigt)} von ${zahlDe(d.gesamt)} Adressen geprüft` + (stunden ? ` · noch etwa ${stunden >= 1.5 ? Math.round(stunden) + ' Stunden' : Math.max(1, Math.round(stunden * 60)) + ' Minuten'}` : ' · Adressen werden herausgesucht …')
    : d.an ? 'Wird gestartet …' : d.meldung || (d.zahl.adressen > 1000 ? 'Pausiert.' : 'Noch nicht gestartet.');
  setTimeout(versuche(zeigeDatenbank), d.an ? 2000 : 15000);
}
$('#db-start').addEventListener('click', versuche(async (e) => {
  await api('/api/datenbank', { an: !!e.target.dataset.an });
  e.target.textContent = e.target.dataset.an ? 'Pausieren' : 'Aufbau fortsetzen';
  e.target.dataset.an = e.target.dataset.an ? '' : '1';
}));

$('#anmelde-dialog').addEventListener('cancel', (e) => e.preventDefault());
$('#abmelden').addEventListener('click', () => { localStorage.removeItem(PASSWORT_MERKER); location.reload(); });

(versuche(async () => {
  MODUS = await api('/api/modus');
  const cloud = MODUS.modus === 'cloud';
  $('#abmelden').hidden = !MODUS.passwort;
  baueLeiste('suche');
  baueLeiste('crm');
  baueFilterzeile('suche');
  baueFilterzeile('crm');
  await ladeBranchen();
  await ladeCrm();
  $('#sheets-url').value = (await api('/api/einstellungen')).sheetsUrl || '';
  await zeigeInternetStand();
  zeigeFilterAnzahl();
  ladeKarte();
  zeigeDatenbank().catch(() => {});
  if (cloud) { zeichne('suche'); return ladeGemerkteCloudSuche(); }
  await holeStand();
  zeichne('suche');
  await verfolgeRegister(true);
}))();

// ───────── Assistent ─────────
// Versteht einfache Sätze wie „50 Solarfirmen 30 km um Dresden mit Telefonnummer“ und stellt daraus die Suche
// zusammen. Das sind feste Regeln im Browser – keine KI, kein Dienst im Hintergrund, keine Kosten.
const glatt = (s) => String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const stamm = (w) => (w.length >= 7 ? w.replace(/(innen|en|er|es|e|n|s)$/, '') : w);
const FUELLWORT = new Set(['firmen', 'firma', 'unternehmen', 'betriebe', 'betrieb', 'leads', 'kontakte', 'studio', 'studios', 'handel', 'haendler', 'service', 'technik', 'praxis', 'praxen', 'geschaeft', 'geschaefte', 'laden', 'laeden', 'dienst', 'dienste', 'anbieter', 'deutschland', 'umkreis', 'bitte', 'suche', 'finde', 'brauche', 'zeige', 'telefon', 'telefonnummer', 'email', 'stellenseite', 'karriere', 'sicherem', 'inhaber', 'weitere', 'andere', 'sonstige', 'sonstiges']);
let entwurf = {}; // was aus den bisherigen Nachrichten schon feststeht, solange noch etwas fehlt

function erkenneBranchen(text) {
  const t = glatt(text);
  const treffer = [];
  for (const box of $$('input[name=branche]')) {
    const worte = glatt(box.parentElement.textContent + ' ' + box.dataset.suche).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !FUELLWORT.has(w));
    const laenge = Math.max(0, ...worte.map(stamm).filter((w) => t.includes(w)).map((w) => w.length));
    if (laenge) treffer.push({ box, laenge });
  }
  // Mehrere Treffer auf dasselbe Wort (Solar steckt in zwei Branchen): die mit dem längsten gemeinsamen Wort gewinnen.
  const beste = Math.max(0, ...treffer.map((x) => x.laenge));
  return treffer.filter((x) => x.laenge >= Math.min(beste, 7)).sort((x, y) => y.laenge - x.laenge).slice(0, 4).map((x) => x.box);
}

async function erkenneOrt(text) {
  const plz = text.match(/\b\d{5}\b/);
  if (plz) { const [o] = await frageOrte(plz[0], 1).catch(() => []); return o ? { ...o, name: plz[0] } : { name: plz[0], lat: NaN, lon: NaN }; }
  const stadt = STAEDTE.find(([name]) => glatt(text).includes(glatt(name.split(' ')[0])));
  if (stadt) return { name: stadt[0], lat: stadt[1], lon: stadt[2] };
  // „in / um / bei / Raum / Nähe von“ + Ortsname, sonst jedes großgeschriebene Wort, das keine Branche ist
  const nach = text.match(/\b(?:in|um|bei|raum|nahe|nähe(?:\s+von)?|rund\s+um|ab)\s+((?:[A-ZÄÖÜ][\wäöüß.-]+)(?:\s+(?:am|an der|im|ob der|bei|vor der)?\s*[A-ZÄÖÜ][\wäöüß.-]+){0,2})/);
  const kandidaten = nach ? [nach[1]] : (text.match(/\b[A-ZÄÖÜ][a-zäöüß-]{2,}\b/g) || []).filter((w) => !FUELLWORT.has(glatt(w)) && !erkenneBranchen(w).length).slice(0, 3);
  for (const k of kandidaten) {
    // mehrere holen: der erste Treffer liegt manchmal im Ausland und fällt dann weg
    const [o] = await frageOrte(k, 5).catch(() => []);
    if (o && glatt(o.name).startsWith(glatt(k).slice(0, 4))) return o;
  }
  return null;
}

async function verstehe(text) {
  const t = glatt(text);
  const e = entwurf;
  if (/^(stopp?|halt|abbrechen|stoppen)\b/.test(t)) { $('#stopp').click(); return 'Okay, ich halte die Suche an.'; }
  if (/^(hilfe|was kannst du|\?)/.test(t)) return 'Sag mir einfach, was du brauchst – zum Beispiel: „50 Solarfirmen 30 km um Dresden“, „Zahnärzte in München mit Telefonnummer“ oder „100 Küchenstudios in ganz Deutschland“. Ich stelle die Suche zusammen und starte sie.';

  const km = t.match(/(\d{1,3})\s*(?:km|kilometer)/);
  if (km) { e.radiusKm = Math.min(150, Math.max(1, +km[1])); e.deutschland = false; }
  if (/ganz deutschland|deutschlandweit|bundesweit|ueberall/.test(t)) e.deutschland = true;
  const zahl = t.replace(/\d{1,3}\s*(?:km|kilometer)/g, ' ').replace(/\b\d{5}\b/g, ' ').match(/\b(\d{1,4})\b/);
  if (zahl) e.anzahl = Math.min(1000, Math.max(1, +zahl[1]));
  if (/telefon|anrufen|rufnummer/.test(t)) e.nurTelefon = true;
  if (/e-?mail/.test(t)) e.nurEmail = true;
  if (/stellen|karriere|jobs|personal such/.test(t)) e.nurKarriere = true;
  if (/doppelt|ganz sicher|nur sichere|bestaetigt/.test(t)) e.minStatus = 'bestaetigt';
  const branchen = erkenneBranchen(text);
  if (branchen.length) { e.branchen = branchen; e.neu = true; }
  const ort = e.deutschland && !/\b(in|um|bei|ab)\s+[A-ZÄÖÜ]/.test(text) ? null : await erkenneOrt(text);
  if (ort) e.ort = ort;

  // Fehlt etwas Wesentliches, nachfragen – die bisherigen Angaben bleiben stehen.
  if (!e.branchen?.length && !$$('input[name=branche]:checked, input[name=stichwort]:checked').length && !formular.alleBranchen.checked)
    return 'Welche Branche soll es sein? Zum Beispiel Solar, Küchenstudios, Zahnärzte oder Pflegedienste.';
  if (!e.ort && !e.deutschland && !ortFeld.value.trim() && !formular.deutschland.checked) return 'Und wo soll ich suchen? Nenn mir eine Stadt oder sag „ganz Deutschland“.';

  // Formular füllen
  if (e.branchen?.length) {
    formular.alleBranchen.checked = false;
    $$('input[name=branche]').forEach((b) => (b.checked = e.branchen.includes(b)));
  }
  if (e.ort) setzeOrt(e.ort, false);
  if (e.deutschland !== undefined) { formular.deutschland.checked = e.deutschland; if (!e.deutschland && +formular.radiusKm.value > 150) formular.radiusKm.value = 25; }
  if (e.radiusKm) formular.radiusKm.value = e.radiusKm;
  if (e.anzahl) formular.anzahl.value = e.anzahl;
  // Eine neue Anfrage (mit Branche) beginnt ohne die Zusatzfilter der vorigen.
  for (const feld of ['nurTelefon', 'nurEmail', 'nurKarriere']) if (e[feld] || e.neu) formular[feld].checked = !!e[feld];
  if (e.minStatus || e.neu) formular.minStatus.value = e.minStatus || 'impressum';
  zeigeDeutschland();
  zeigeAuswahlAnzahl();
  entwurf = {};

  const was = formular.alleBranchen.checked ? 'alle Branchen' : [...$$('input[name=branche]:checked').map((b) => b.parentElement.textContent), ...$$('input[name=stichwort]:checked').map((b) => '„' + b.value + '“')].join(', ');
  const wo = formular.deutschland.checked ? 'in ganz Deutschland' + (ortFeld.value.trim() ? `, zuerst rund um ${ortFeld.value.trim()}` : '') : `${formular.radiusKm.value} km um ${ortFeld.value.trim()}`;
  const extra = [formular.nurTelefon.checked && 'mit Telefonnummer', formular.nurEmail.checked && 'mit E-Mail', formular.nurKarriere.checked && 'mit Stellenseite'].filter(Boolean).join(', ');
  zeigeReiter('suche');
  formular.requestSubmit();
  return `Läuft: ${formular.anzahl.value} Leads · ${was} · ${wo}${extra ? ' · ' + extra : ''}. Die Treffer erscheinen oben in der Liste.`;
}

function chatZeile(text, wer) {
  const z = document.createElement('div');
  z.className = 'chat-zeile ' + wer;
  z.textContent = text;
  $('#chat-verlauf').append(z);
  $('#chat-verlauf').scrollTop = 1e6;
}
$('#chat-knopf').addEventListener('click', () => {
  const fenster = $('#chat-fenster');
  fenster.hidden = !fenster.hidden;
  $('#chat-knopf').setAttribute('aria-expanded', String(!fenster.hidden));
  if (!fenster.hidden) { if (!$('#chat-verlauf').children.length) chatZeile('Hallo! Sag mir, was du brauchst – zum Beispiel „50 Solarfirmen 30 km um Dresden“. Ich stelle die Suche zusammen und starte sie.', 'bot'); $('#chat-eingabe').focus(); }
});
$('#chat-zu').addEventListener('click', () => $('#chat-knopf').click());
$('#chat-formular').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#chat-eingabe').value.trim();
  if (!text) return;
  $('#chat-eingabe').value = '';
  chatZeile(text, 'ich');
  try { chatZeile(await verstehe(text), 'bot'); } catch (f) { chatZeile('Das hat nicht geklappt: ' + f.message, 'bot'); }
});

// ───────── Tabelle mit der Maus verschieben ─────────
// In eine freie Stelle der Tabelle klicken und ziehen verschiebt sie – der Rollbalken am unteren Rand ist dafür nicht nötig.
for (const rahmen of $$('.tabellenrahmen')) {
  let start = null;
  rahmen.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('a, button, input, select, textarea, label, summary')) return;
    start = { x: e.clientX, y: e.clientY, links: rahmen.scrollLeft, oben: rahmen.scrollTop, gezogen: false };
  });
  window.addEventListener('mousemove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    // Erst ab ein paar Pixeln gilt es als Ziehen – ein normaler Klick bleibt ein Klick.
    if (!start.gezogen && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    start.gezogen = true;
    rahmen.classList.add('zieht');
    rahmen.scrollLeft = start.links - dx;
    rahmen.scrollTop = start.oben - dy;
    e.preventDefault();
  });
  window.addEventListener('mouseup', () => {
    if (!start) return;
    rahmen.classList.remove('zieht');
    start = null;
  });
}

// ───────── Karte aus- und einblenden ─────────
// Ohne Karte bekommt die Trefferliste die ganze Breite. Die Wahl wird gemerkt.
function zeigeKartenspalte(sichtbar) {
  $('#kartenspalte').hidden = !sichtbar;
  $('#reiter-suche .zweispaltig').classList.toggle('ohne-karte', !sichtbar);
  $('#karte-umschalten').textContent = sichtbar ? 'Karte ausblenden' : 'Karte anzeigen';
  if (sichtbar && karte) { karte.invalidateSize(); zeigeGebiet(); }
}
$('#karte-umschalten').addEventListener('click', () => {
  const sichtbar = $('#kartenspalte').hidden;
  localStorage.setItem('leadscraper-karte', sichtbar ? 'an' : 'aus');
  zeigeKartenspalte(sichtbar);
});
if (localStorage.getItem('leadscraper-karte') === 'aus') zeigeKartenspalte(false);
