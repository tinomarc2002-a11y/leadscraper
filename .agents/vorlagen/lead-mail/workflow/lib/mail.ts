// Lead-Benachrichtigung: nur Fakten (Antworten, Datum, Uhrzeit, Name, Telefon, E-Mail).
// Keine Herkunftsdaten (Anzeige, Kampagne, Formular). Die sieht Marc im Werbekonto / Leads-Center.
export type Antwort = { label: string; wert: string; icon: string };

export type LeadDaten = {
  datum: string; // 21.11.2026
  uhrzeit: string; // 16:55
  name: string;
  firma: string;
  telefon: string;
  mail: string;
  antworten: Antwort[];
};

const TINTE = "#14161A";
const GRAU = "#6B7078";
const HELLGRAU = "#9AA0A8";
const LINIE = "#ECECE8";
const GRUEN = "#2E9E6B";
const WA_GRUEN = "#1FAF5A";
const ICON_BASIS = "https://mmm-mail-icons.vercel.app/i/";

const esc = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const waNummer = (tel: string): string => {
  let d = tel.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "49" + d.slice(1);
  return d;
};

const icon = (name: string, px: number, alt = ""): string =>
  `<img src="${ICON_BASIS}${name}.png" width="${px}" height="${px}" alt="${esc(alt)}" style="display:block;border:0;width:${px}px;height:${px}px;">`;

type Knopf = { href: string; icon: string; alt: string; bg: string; rand: string };

const knopfZeile = (k: Knopf[]): string => {
  if (!k.length) return "";
  const zellen = k
    .map((x, i) => {
      const z = `<td width="33%" style="padding:0;"><a href="${esc(x.href)}" aria-label="${esc(x.alt)}" style="display:block;text-align:center;text-decoration:none;background:${x.bg};border:1px solid ${x.rand};border-radius:14px;padding:15px 0 14px 0;"><img src="${ICON_BASIS}${x.icon}.png" width="24" height="24" alt="${esc(x.alt)}" style="display:inline-block;vertical-align:top;border:0;width:24px;height:24px;font-size:13px;line-height:24px;color:${GRAU};"></a></td>`;
      return i < k.length - 1 ? `${z}<td width="10" style="font-size:1px;line-height:1px;">&nbsp;</td>` : z;
    })
    .join("");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${zellen}</tr></table>`;
};

const zeile = (ic: string, label: string, wert: string, opt: { href?: string; letzte?: boolean } = {}): string => {
  const rand = opt.letzte ? "" : `border-bottom:1px solid ${LINIE};`;
  const inhalt = opt.href
    ? `<a href="${esc(opt.href)}" style="color:${TINTE};text-decoration:none;">${esc(wert)}</a>`
    : esc(wert);
  return `<tr><td style="padding:0 24px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
<td width="32" valign="middle" style="padding:11px 0;${rand}">${icon(ic, 20, label)}</td>
<td valign="middle" style="padding:10px 0;${rand}"><div style="font-size:11px;line-height:14px;color:${HELLGRAU};">${esc(label)}</div><div style="font-size:15px;line-height:21px;font-weight:600;color:${TINTE};word-break:break-word;">${inhalt}</div></td>
</tr></table></td></tr>`;
};

export const baueMail = (d: LeadDaten): { subject: string; html: string } => {
  const tel = d.telefon.replace(/[^+\d]/g, "");
  const wa = tel ? waNummer(tel) : "";
  const subject = `Neue Anfrage: ${d.name}${d.firma ? " · " + d.firma : ""}`;
  const preheader = d.antworten.map((a) => a.wert).filter(Boolean).join(" · ");

  const knoepfe: Knopf[] = [];
  if (tel) knoepfe.push({ href: `tel:${tel}`, icon: "telefon", alt: "Anrufen", bg: TINTE, rand: TINTE });
  if (wa) knoepfe.push({ href: `https://wa.me/${wa}`, icon: "whatsapp", alt: "WhatsApp", bg: WA_GRUEN, rand: WA_GRUEN });
  if (d.mail) knoepfe.push({ href: `mailto:${d.mail}`, icon: "mail", alt: "E-Mail", bg: "#FFFFFF", rand: "#D9DCE1" });

  const zeilen: string[] = [];
  const alle: Array<[string, string, string, string]> = [];
  for (const a of d.antworten) if (a.wert.trim()) alle.push([a.icon, a.label, a.wert.trim(), ""]);
  if (d.telefon.trim()) alle.push(["z-telefon", "Telefon", d.telefon.trim(), tel ? `tel:${tel}` : ""]);
  if (d.mail.trim()) alle.push(["z-mail", "E-Mail", d.mail.trim(), `mailto:${d.mail.trim()}`]);
  alle.forEach(([ic, l, w, h], i) => zeilen.push(zeile(ic, l, w, { href: h, letzte: i === alle.length - 1 })));

  const html = `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#F3F3F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F3F3F0;"><tr><td align="center" style="padding:16px 12px 24px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;">
<tr><td style="background:#FFFFFF;border:1px solid #E6E6E1;border-radius:18px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">

<tr><td style="padding:20px 24px 0 24px;">
<table role="presentation" cellspacing="0" cellpadding="0"><tr>
<td valign="middle" style="padding-right:6px;">${icon("z-kalender", 16)}</td>
<td valign="middle" style="font-size:13px;line-height:16px;color:${GRAU};padding-right:14px;">${esc(d.datum)}</td>
<td valign="middle" style="padding-right:6px;">${icon("z-zeit", 16)}</td>
<td valign="middle" style="font-size:13px;line-height:16px;color:${GRAU};">${esc(d.uhrzeit)}</td>
</tr></table>
<div style="font-size:26px;line-height:32px;font-weight:700;color:${TINTE};padding-top:12px;letter-spacing:-0.4px;word-break:break-word;">${esc(d.name)}</div>
${d.firma ? `<div style="font-size:14px;line-height:20px;color:${GRAU};word-break:break-word;">${esc(d.firma)}</div>` : ""}
</td></tr>

<tr><td style="padding:16px 24px 8px 24px;">${knopfZeile(knoepfe)}</td></tr>
${zeilen.join("\n")}
<tr><td style="font-size:1px;line-height:14px;">&nbsp;</td></tr>
</table></td></tr>
<tr><td align="center" style="padding:12px 8px 0 8px;font-size:11px;color:${HELLGRAU};"><span style="color:${GRUEN};">&#9679;</span> Neue Anfrage</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, html };
};
