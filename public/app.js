/* global SPALTEN, STATUS_TEXT, RECHTSFORM_GRUPPEN, rechtsformGruppe, zeileAus */
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
  for (const r of ['suche', 'crm', 'sheets']) $('#reiter-' + r).hidden = r !== name;
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
    entfernung: (x, y) => x.entfernungKm - y.entfernungKm,
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
    <td class="spalte-ort">${adresse.map(esc).join('<br>') || '<span class="unter">Adresse unbekannt</span>'}<div class="unter">${esc(l.entfernungKm)} km entfernt</div></td>
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
  $('#filter-' + name).hidden = a.leads.length === 0;
  $('#tabelle-' + name).innerHTML = !a.leads.length ? '' : `<thead><tr>
      <th class="schmal"><input type="checkbox" class="alle" ${liste.length && liste.every((l) => a.auswahl.has(l.id)) ? 'checked' : ''} aria-label="Alle auswählen"></th>
      <th>Unternehmen</th><th>Inhaber</th><th>Kontakt</th><th>Standort</th><th>Mitarbeiter</th><th>Prüfen</th>${name === 'crm' ? '<th>Status</th><th>Notiz &amp; Verlauf</th>' : ''}
    </tr></thead><tbody>${liste.map((l) => zeileHtml(l, name)).join('')}</tbody>`;
  const gewaehlt = liste.filter((l) => a.auswahl.has(l.id)).length;
  $('#leiste-' + name + ' .anzahl').textContent = gewaehlt ? `${gewaehlt} von ${liste.length} ausgewählt` : `${liste.length} Leads`;
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
  zeile.innerHTML = `<span class="unter">Eingrenzen:</span>
    <select class="f-branche" aria-label="Branche"><option value="">Alle Branchen</option></select>
    <select class="f-rechtsform" aria-label="Rechtsform"><option value="">Jede Rechtsform</option>${RECHTSFORM_GRUPPEN.map(([id, text]) => `<option value="${id}">${esc(text)}</option>`).join('')}</select>
    <button type="button" class="neben umschalter" data-feld="mitTelefon">mit Telefon</button>
    <button type="button" class="neben umschalter" data-feld="mitEmail">mit E-Mail</button>
    <button type="button" class="neben umschalter" data-feld="mitStellen">mit Stellenseite</button>`;
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
    <select class="f-status" aria-label="Status"><option value="">${name === 'crm' ? 'Alle Status' : 'Jede Sicherheit'}</option>${statusWahl}</select>
    <select class="f-sort" aria-label="Sortierung">
      <option value="entfernung">Nach Entfernung</option><option value="name">Nach Name</option>
      <option value="sicherheit">Nach Sicherheit</option><option value="mitarbeiter">Nach Größe</option>
      ${name === 'crm' ? '<option value="wiedervorlage">Nach Wiedervorlage</option>' : ''}</select>
    ${name === 'crm' ? '<button class="neben f-faellig"></button>' : ''}
    <span class="abstand"></span>
    ${name === 'suche' ? '<button class="haupt a-crm">Ins CRM übernehmen</button>' : '<button class="neben gefahr a-loeschen">Löschen</button>'}
    <button class="neben a-register" title="Gleicht die Inhaber mit dem amtlichen Handelsregister ab (max. ca. 25 Firmen pro Stunde)">Im Handelsregister prüfen</button>
    <button class="neben a-csv">CSV herunterladen</button>
    <button class="neben a-kopieren">Für Sheets kopieren</button>
    <button class="neben a-sheets">An Google Sheet senden</button>`;
  const leiste = $('#leiste-' + name), a = ansichten[name];
  $('.a-register', leiste).hidden = !MODUS.register;
  $('.f-sort', leiste).value = a.sortierung;
  $('.f-text', leiste).addEventListener('input', (e) => { a.text = e.target.value; zeichne(name); });
  $('.f-status', leiste).addEventListener('change', (e) => { a.status = e.target.value; zeichne(name); });
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
  return [SPALTEN.map((s) => zelle(s[0])).join(';'), ...leads.map((l) => zeileAus(l).map(zelle).join(';'))].join('\r\n');
}
// Google Sheets liest „+49 …“ und „=…“ sonst als Formel – ein Apostroph markiert die Zelle als Text.
function tabellenText(leads) {
  const zelle = (w) => String(w).replace(/[\t\r\n]+/g, ' ').replace(/^([+=])/, "'$1");
  return [SPALTEN.map((s) => s[0]).join('\t'), ...leads.map((l) => zeileAus(l).map(zelle).join('\t'))].join('\n');
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
  return { ort: f.get('ort'), radiusKm: +f.get('radiusKm'), deutschland: formular.deutschland.checked, anzahl: +f.get('anzahl'), minStatus: f.get('minStatus'), maKlassen: f.getAll('ma'), branchen: formular.alleBranchen.checked ? ['alle'] : f.getAll('branche'), stichworte: f.getAll('stichwort'), ohneCrm: formular.ohneCrm.checked, websiteSuchen: formular.websiteSuchen.checked, websiteErraten: formular.websiteSuchen.checked,
    rechtsformen: f.getAll('rechtsform'), nurTelefon: formular.nurTelefon.checked, nurEmail: formular.nurEmail.checked, nurKarriere: formular.nurKarriere.checked };
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
  const teile = [d.fehler || d.meldung];
  if (d.zentrum) teile.push(d.parameter.deutschland ? `Ganz Deutschland, nächstgelegene zuerst ab ${d.zentrum.split(',').slice(0, 2).join(',')}.` : `Umkreis ${d.parameter.radiusKm} km um ${d.zentrum.split(',').slice(0, 2).join(',')}.`);
  const aus = d.aussortiert;
  if (aus.sicherheit || aus.groesse || aus.filter) teile.push(`Aussortiert: ${aus.sicherheit} wegen zu unsicherem Inhaber, ${aus.groesse} wegen Größenfilter` + (aus.filter ? `, ${aus.filter} wegen Rechtsform- oder Kontaktfilter.` : '.'));
  if (d.schonImCrm) teile.push(`${d.schonImCrm} schon im CRM – übersprungen.`);
  if (d.websitesGefunden) teile.push(`${d.websitesGefunden} fehlende Websites ermittelt.`);
  if (d.ohneWebsite) teile.push(`${d.ohneWebsite} Einträge ohne Website übersprungen (Inhaber nicht prüfbar).`);
  if (d.fertig && !d.fehler && !d.abbruch && d.gesamt < d.parameter.anzahl) teile.push(d.parameter.deutschland ? 'Für mehr Treffer: mehr Branchen wählen oder die Inhaber-Sicherheit lockern.' : 'Für mehr Treffer: Umkreis vergrößern, „Ganz Deutschland“ wählen, mehr Branchen wählen oder die Inhaber-Sicherheit lockern.');
  $('#leer-suche').textContent = laeuft ? 'Die ersten Treffer erscheinen hier, sobald die Impressen geprüft sind.' : 'Keine passenden Leads gefunden.';
  const meldung = $('#fortschritt-meldung');
  meldung.textContent = teile.filter(Boolean).join(' ');
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
  localStorage.setItem('leadscraper-formular', JSON.stringify(p));
  if (MODUS.modus === 'cloud') return starteCloudSuche(p);
  await api('/api/suche', p);
  await holeStand();
}));
$('#stopp').addEventListener('click', versuche(async () => {
  if (MODUS.modus === 'cloud') { if (cloudSuche) cloudSuche.abbruch = true; return; }
  await api('/api/suche/stop', {});
}));
formular.radiusKm.addEventListener('input', (e) => ($('#radius-wert').textContent = e.target.value));
// „Ganz Deutschland“ setzt den Umkreis außer Kraft; ein Ort ist dann nur noch der Startpunkt und darf fehlen.
function zeigeDeutschland() {
  const an = formular.deutschland.checked;
  formular.radiusKm.disabled = an;
  formular.ort.required = !an;
  formular.ort.placeholder = an ? 'Startpunkt, z. B. Augsburg (leer = Mitte Deutschlands)' : 'z. B. Augsburg oder 86150';
  $('#umkreis-zeile').classList.toggle('aus', an);
}
formular.deutschland.addEventListener('change', zeigeDeutschland);
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
  if (gemerkt.radiusKm) { formular.radiusKm.value = gemerkt.radiusKm; $('#radius-wert').textContent = gemerkt.radiusKm; }
  if (gemerkt.anzahl) formular.anzahl.value = gemerkt.anzahl;
  if (gemerkt.minStatus) formular.minStatus.value = gemerkt.minStatus;
  if (gemerkt.maKlassen) $$('input[name=ma]').forEach((b) => (b.checked = gemerkt.maKlassen.includes(b.value)));
  if (gemerkt.ohneCrm === false) formular.ohneCrm.checked = false;
  // Früher war die Option standardmäßig aus; nur eine bewusste Abwahl seit der Umstellung zählt.
  if (gemerkt.websiteErraten === false) formular.websiteSuchen.checked = false;
  for (const feld of ['nurTelefon', 'nurEmail', 'nurKarriere']) formular[feld].checked = gemerkt[feld] === true;
  formular.alleBranchen.checked = !!gemerkt.branchen?.includes('alle');
  formular.deutschland.checked = gemerkt.deutschland === true;
  zeigeDeutschland();
  (gemerkt.stichworte || []).forEach(fuegeStichwortHinzu);
  zeigeAuswahlAnzahl();
}

// ───────── Branchen-Suchzeile ─────────
// Tippen blendet die passenden Katalogbranchen ein. Was der Katalog nicht kennt, lässt sich als eigenes
// Stichwort aufnehmen – die Suche findet dann Firmen, die dieses Wort im Namen tragen.
const suchfeld = $('#branchen-suche');

function filtereBranchen() {
  const worte = suchfeld.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  let treffer = 0;
  for (const gruppe of $$('#branchen-gruppen details')) {
    let sichtbar = 0;
    for (const label of $('.chips', gruppe).children) {
      const passt = worte.every((w) => label.firstElementChild.dataset.suche.includes(w));
      label.hidden = !passt;
      if (passt) sichtbar++;
    }
    // Beim Suchen klappen die Gruppen mit Treffern auf; ohne Suchtext gilt wieder der Ausgangszustand.
    gruppe.hidden = !sichtbar;
    gruppe.open = worte.length ? sichtbar > 0 : !!gruppe.dataset.offen || !!$('input:checked', gruppe);
    treffer += sichtbar;
  }
  const eingabe = suchfeld.value.trim().replace(/\s+/g, ' ');
  const knopf = $('#stichwort-neu');
  knopf.hidden = eingabe.length < 3;
  knopf.textContent = `+ „${eingabe}“ als eigenes Stichwort suchen`;
  const hinweis = $('#branchen-hinweis');
  hinweis.hidden = treffer > 0;
  hinweis.textContent = 'Keine passende Branche im Katalog.' + (eingabe.length >= 3 ? ' Als eigenes Stichwort findet die Suche Firmen, die das Wort im Namen tragen.' : '');
}

function zeigeAuswahlAnzahl() {
  const alle = formular.alleBranchen.checked;
  const n = $$('input[name=branche]:checked').length, eigene = $$('input[name=stichwort]:checked').length;
  $('#branchen-anzahl').textContent = alle ? 'alle' + (eigene ? ` + ${eigene} Stichwort` : '') : n + eigene ? `${n + eigene} ausgewählt` : '';
  $('#branchen-gruppen').classList.toggle('aus', alle);
  for (const gruppe of $$('#branchen-gruppen details')) {
    const gewaehlt = $$('input:checked', gruppe).length;
    $('.g-zahl', gruppe).textContent = gewaehlt ? `${gewaehlt} von ${$$('input', gruppe).length}` : '';
  }
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
suchfeld.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault(); // Enter soll hier nicht die ganze Suche starten
  const sichtbar = $$('input[name=branche]').filter((b) => !b.parentElement.hidden);
  if (!suchfeld.value.trim()) return;
  if (sichtbar.length === 1) { sichtbar[0].checked = true; suchfeld.value = ''; filtereBranchen(); zeigeAuswahlAnzahl(); }
  else if (!sichtbar.length) fuegeStichwortHinzu(suchfeld.value);
});
$('#stichwort-neu').addEventListener('click', () => fuegeStichwortHinzu(suchfeld.value));
// Ein abgewähltes eigenes Stichwort verschwindet ganz.
$('#branchen-frei').addEventListener('change', (e) => {
  if (!e.target.checked) e.target.parentElement.remove();
  $('#gruppe-frei').hidden = !$('#branchen-frei').children.length;
});
formular.addEventListener('change', zeigeAuswahlAnzahl);

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
  if (cloud) { zeichne('suche'); return ladeGemerkteCloudSuche(); }
  await holeStand();
  zeichne('suche');
  await verfolgeRegister(true);
}))();
