import { defineDurable } from "@zapier/zapier-durable";
import { createZapierSdk } from "@zapier/zapier-sdk";
import { z } from "zod";
import { baueMail, type Antwort } from "./lib/mail.ts";

const sdk = createZapierSdk();

// --- Pro Kampagne anpassen --------------------------------------------------
const EMPFAENGER = "info@thera-recruiting.de";
const ABSENDER_NAME = "Lead-Alarm · Marketing mit Marc";
const SHEET_ID = "1nCNtnN6Ub_ghO9GxV4_zFX2Hz7wUYBclP_wLeeoAEi4";
// ----------------------------------------------------------------------------

const InputSchema = z.object({ created_time: z.string().nullable().optional() }).loose();

const META = /^(id|raw|created_time|platform|is_organic|.*_id|form_name|ad_name|adset_name|campaign_name|.*_time)$/i;

const alsText = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

const labelUndIcon = (key: string): { label: string; icon: string; slot: "zeit" | "budget" | "werbung" | "" } => {
  const k = key.toLowerCase();
  if (/budget|euro|€|invest/.test(k)) return { label: "Budget pro Monat", icon: "z-budget", slot: "budget" };
  if (/schnell|wann|zeitrahmen|start|dringend/.test(k)) return { label: "Zeitrahmen", icon: "z-zeit", slot: "zeit" };
  if (/werbung|anzeigen|bereits/.test(k)) return { label: "Wirbt bereits", icon: "z-werbung", slot: "werbung" };
  const roh = key.replace(/[_?]+/g, " ").trim();
  const kurz = roh.length > 38 ? roh.slice(0, 36).trim() + "…" : roh;
  return { label: kurz.charAt(0).toUpperCase() + kurz.slice(1), icon: "z-frage", slot: "" };
};

const workflow = defineDurable({
  name: "neuer-lead-benachrichtigung",
  inputSchema: InputSchema,
  run: async (ctx, rawInput) => {
    const input = InputSchema.parse(rawInput) as Record<string, unknown>;

    const { datum, uhrzeit } = await ctx.step("format-lead-time", async () => {
      const d = input.created_time ? new Date(String(input.created_time)) : new Date();
      const t = Number.isNaN(d.getTime()) ? new Date() : d;
      const o = { timeZone: "Europe/Berlin" } as const;
      return {
        datum: t.toLocaleDateString("de-DE", { ...o, day: "2-digit", month: "2-digit", year: "numeric" }),
        uhrzeit: t.toLocaleTimeString("de-DE", { ...o, hour: "2-digit", minute: "2-digit" }),
      };
    });

    let name = "";
    let firma = "";
    let telefon = "";
    let mail = "";
    const antworten: Antwort[] = [];
    const slots: Record<string, string> = {};
    const sonst: string[] = [];

    for (const [key, val] of Object.entries(input)) {
      const wert = alsText(val);
      if (!wert) continue;
      const k = key.toLowerCase();
      if (/mail/.test(k)) mail = wert;
      else if (/telefon|phone|handy|mobil/.test(k)) telefon = wert;
      else if (/unternehmen|firma|company/.test(k)) firma = wert;
      else if (/^(vollst.ndiger_name|full_name|name|vorname|nachname)$/.test(k)) name = name ? `${name} ${wert}` : wert;
      else if (META.test(key)) continue;
      else {
        const m = labelUndIcon(key);
        antworten.push({ label: m.label, wert, icon: m.icon });
        if (m.slot) slots[m.slot] = wert;
        else sonst.push(`${m.label}: ${wert}`);
      }
    }
    if (!name) name = "Unbekannt";

    const { subject, html } = baueMail({ datum, uhrzeit, name, firma, telefon, mail, antworten });

    const sent = await ctx.step("send-lead-email", async () =>
      sdk.runAction({
        appKey: "GoogleMailV2CLIAPI",
        actionType: "write",
        actionKey: "message",
        connection: "gmail_main",
        inputs: { to: [EMPFAENGER], subject, body: html, body_type: "html", from_name: ABSENDER_NAME },
      }),
    );

    // Eintrag im Google Sheet "Stand jetzt". Fehler hier verhindern die Mail nicht (Mail ging schon raus).
    const sheet = await ctx.step("add-sheet-row", async () => {
      try {
        await sdk.runAction({
          appKey: "GoogleSheetsV2CLIAPI",
          actionType: "write",
          actionKey: "add_row",
          connection: "sheets_main",
          inputs: {
            spreadsheet: SHEET_ID,
            worksheet: "0",
            "COL$A": datum,
            "COL$B": uhrzeit,
            "COL$C": name,
            "COL$D": firma,
            "COL$E": telefon,
            "COL$F": mail,
            "COL$G": slots.zeit ?? "",
            "COL$H": slots.budget ?? "",
            "COL$I": slots.werbung ?? "",
            "COL$J": "Neu",
            "COL$K": sonst.join(" | "),
          },
        });
        return "ok";
      } catch (e) {
        return `fehler: ${e instanceof Error ? e.message : String(e)}`;
      }
    });

    return { sent: true, subject, sent_id: sent.data[0]?.id ?? null, sheet };
  },
});

export default workflow;
