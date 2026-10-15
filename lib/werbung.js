// Prüft über die offizielle Meta-Werbebibliothek (Ad Library API), ob ein Unternehmen gerade Anzeigen auf Facebook
// oder Instagram schaltet. Kostenlos; nötig ist ein Zugangsschlüssel aus einem Meta-Entwicklerkonto mit bestätigter Identität.
// Für Deutschland (EU) führt Meta alle Anzeigen, nicht nur politische.
//
// Zuordnung: Gesucht wird nach dem Firmennamen. Eine Anzeige zählt nur, wenn sie auf die Website der Firma verlinkt
// oder die werbende Seite genauso heißt – sonst würden Anzeigen anderer, die den Namen nur erwähnen, mitgezählt.
// „Nicht gefunden“ heißt deshalb nicht sicher „wirbt nicht“ (Agentur-Seiten, abweichende Seitennamen).
const API = 'https://graph.facebook.com/v21.0/ads_archive';
const FELDER = 'id,page_id,page_name,ad_snapshot_url,ad_delivery_start_time,ad_creative_link_captions,publisher_platforms';

const glatt = (s) => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
const RECHTSFORM_RE = /\b(gmbh\s*&\s*co\.?\s*kg|gmbh|ug|haftungsbeschr(ae|ä)nkt|ag|kg|ohg|gbr|e\.?\s?k\.?|e\.?\s?v\.?|mbh|inh\.?|inhaber(in)?|partg(mbb)?|co\.?|und|&)\b/gi;
const hostVon = (url) => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

// Kurzer Suchbegriff: Firmenname ohne Rechtsform und Zusätze
function suchbegriff(lead) {
  const name = String(lead.firmierung || lead.name || '').replace(/\(.*?\)/g, ' ').replace(RECHTSFORM_RE, ' ').replace(/[^\p{L}\p{N}&.\- ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  return name.split(' ').slice(0, 4).join(' ');
}

class MetaFehler extends Error {
  constructor(text, art) { super(text); this.art = art; }
}

async function frage(begriff, token) {
  const url = `${API}?search_terms=${encodeURIComponent(begriff)}&ad_reached_countries=${encodeURIComponent('["DE"]')}&ad_type=ALL&ad_active_status=ACTIVE&limit=50&fields=${FELDER}&access_token=${encodeURIComponent(token)}`;
  let r;
  try { r = await fetch(url, { signal: AbortSignal.timeout(20000) }); } catch { throw new MetaFehler('Meta ist gerade nicht erreichbar.', 'netz'); }
  const d = await r.json().catch(() => ({}));
  if (d.error) {
    const c = d.error.code;
    if ([4, 17, 32, 613].includes(c) || r.status === 429) throw new MetaFehler('Meta-Abfragelimit erreicht.', 'limit');
    if (c === 190) throw new MetaFehler('Der Meta-Zugangsschlüssel ist abgelaufen oder ungültig. Bitte unter „Verbindungen“ einen neuen eintragen.', 'zugang');
    if (c === 10 || c === 200 || d.error.error_subcode === 2332002) throw new MetaFehler('Meta erlaubt den Zugriff auf die Werbebibliothek noch nicht. Bitte die Identität unter facebook.com/ID bestätigen und die Bedingungen der Werbebibliothek akzeptieren.', 'zugang');
    throw new MetaFehler('Meta meldet: ' + (d.error.message || 'unbekannter Fehler'), 'sonst');
  }
  return d.data || [];
}

// Liefert { werbungMeta: 'ja' | 'nein', werbungMetaInfo: { anzahl, seiten, link, geprueftAm } }
async function pruefeMeta(lead, token) {
  const host = hostVon(lead.website);
  const stamm = host.replace(/\.[a-z]{2,}$/, '');
  const name = glatt(suchbegriff(lead));
  const passt = (ad) => {
    const ziele = (ad.ad_creative_link_captions || []).map((c) => String(c).toLowerCase().replace(/^www\./, ''));
    if (host && ziele.some((z) => z === host || z.endsWith('.' + host) || z.startsWith(host + '/'))) return true;
    const seite = glatt(ad.page_name);
    return name.length >= 5 && (seite === name || seite.replace(/ /g, '') === name.replace(/ /g, ''));
  };
  const begriffe = [...new Set([suchbegriff(lead), stamm.length >= 5 ? stamm.replace(/-/g, ' ') : ''].filter((b) => b && b.length >= 3))];
  let treffer = [];
  for (const b of begriffe) {
    treffer = (await frage(b, token)).filter(passt);
    if (treffer.length) break;
  }
  const seiten = [...new Set(treffer.map((a) => a.page_name).filter(Boolean))];
  const seitenId = treffer[0]?.page_id;
  return {
    werbungMeta: treffer.length ? 'ja' : 'nein',
    werbungMetaInfo: {
      anzahl: treffer.length, seiten,
      // Link auf alle aktiven Anzeigen dieser Seite in der Werbebibliothek
      link: seitenId ? `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=DE&view_all_page_id=${seitenId}` : '',
      geprueftAm: new Date().toISOString().slice(0, 10),
    },
  };
}

// Kurzer Test des Zugangs (beim Speichern des Schlüssels)
async function testeZugang(token) {
  await frage('Solarwatt', token);
  return true;
}

module.exports = { pruefeMeta, testeZugang, MetaFehler };
