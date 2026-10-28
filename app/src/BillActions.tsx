import { useMemo, useState } from "react";
import { api, type Session } from "./api";
import type { Lang } from "./i18n";
import type { Booking, Hotel, Room } from "./lib/types";
import { pdfFromCanvas } from "./pdf";
import { PrintBar } from "./PrintBar";
import { billTotals, drawRows, getPaper, receiptRows, widthPx } from "./print";
import { bytesToBase64, saveFile, shareOrSave, toBlob } from "./share";

const rs = (n: number) => "Rs " + Math.round(n).toLocaleString("en-IN");

/** Nepal numbers: 98XXXXXXXX becomes 97798XXXXXXXX for WhatsApp. Anything else is used as typed (digits only). */
export function waNumber(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("9")) return "977" + d;
  if (d.length === 11 && d.startsWith("09")) return "977" + d.slice(1);
  return d;
}

/** A bill you can look at, then print, share (WhatsApp, Viber, Drive…), save as PDF, or email. */
export function BillActions({ L, h, b, room, session, copy }: { L: Lang; h: Hotel; b: Booking; room: Room | undefined; session: Session | null; copy: boolean }) {
  const ne = L === "ne";
  const t = (n: string, e: string) => (ne ? n : e);
  const paper = getPaper();
  const rows = () => receiptRows(h, b, room, L, { copy });
  const preview = useMemo(() => drawRows(rows(), widthPx(paper), 2).toDataURL("image/png"), [h, b, room, L, copy, paper]); // eslint-disable-line react-hooks/exhaustive-deps
  const tot = billTotals(h, b, room);
  const summary = `${t("जम्मा", "Total")} ${rs(tot.total)}${tot.due > 0 ? ` · ${t("बाँकी", "Due")} ${rs(tot.due)}` : ""}`;
  const [msg, setMsg] = useState("");
  const [mail, setMail] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = `bill-${(b.billNo ?? "copy").replace(/[^\w-]/g, "")}.pdf`;
  const pdf = () => pdfFromCanvas(drawRows(rows(), widthPx(paper), 2), paper === "a4");

  async function share() {
    const r = await shareOrSave(toBlob(pdf(), "application/pdf"), name, `${h.name} ${b.billNo ?? ""}`);
    setMsg(r === "shared" ? t("पठाइयो।", "Shared.") : r === "saved" ? t("PDF सेभ भयो।", "PDF saved.") : "");
  }
  function whatsapp() {
    const text = `${h.name}\n${t("बिल", "Bill")} ${b.billNo ?? ""}\n${t("कोठा", "Room")} ${b.room} · ${b.guest}\n${summary}`;
    window.open(`https://wa.me/${waNumber(b.phone)}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }
  async function email() {
    if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(mail.trim())) return setMsg(t("इमेल ठेगाना ठीक छैन।", "That email address is not right."));
    setBusy(true);
    setMsg("");
    const r = await api("/send/email", "POST", { to: mail.trim(), billNo: b.billNo ?? "", summary, data: bytesToBase64(pdf()) });
    setBusy(false);
    const e = r.j?.error as string | undefined;
    setMsg(r.s === 200 ? t("इमेल पठाइयो।", "Email sent.")
      : r.s === 0 ? t("इन्टरनेट छैन।", "No internet.")
      : e === "feature_off" ? t("यो सुविधा तपाईंको होटलमा बन्द छ।", "This feature is switched off for your hotel.")
      : e === "mail" ? t("सर्भरमा इमेल मिलाइएको छैन, पठाउन सकिएन।", "Email is not set up on the server, so it was not sent.")
      : e === "limit" ? t("आजको इमेल सीमा सकियो।", "Today's email limit is used up.")
      : t("इमेल पठाउन सकिएन।", "Could not send the email."));
  }

  return (
    <div>
      <p style={{ margin: "8px 0 4px", color: "var(--mute)", fontSize: 14 }}>{t("बिलको झलक", "Bill preview")}</p>
      <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 12, padding: 6, textAlign: "center", overflow: "auto", maxHeight: 420 }}>
        <img src={preview} alt={t("बिल", "Bill")} style={{ maxWidth: "100%", height: "auto" }} />
      </div>
      <div className="grid2" style={{ marginTop: 8 }}>
        <button className="btn" onClick={() => void share()}>📤 {t("शेयर (PDF)", "Share (PDF)")}</button>
        <button className="btn" onClick={whatsapp}>💬 WhatsApp</button>
        <button className="btn alt" onClick={() => { saveFile(toBlob(pdf(), "application/pdf"), name); setMsg(t("PDF सेभ भयो।", "PDF saved.")); }}>⬇ PDF</button>
        {h.feat.email && session ? <button className="btn alt" onClick={() => setOpen(!open)}>✉ {t("इमेल", "Email")}</button> : <span />}
      </div>
      {open && (
        <div>
          <label htmlFor="bm">{t("पाहुनाको इमेल", "Guest's email")}</label>
          <input id="bm" type="email" inputMode="email" autoCapitalize="none" value={mail} onChange={(e) => setMail(e.target.value)} />
          <button className="btn" disabled={busy} onClick={() => void email()}>{busy ? "…" : t("इमेल पठाउनुस्", "Send email")}</button>
        </div>
      )}
      {msg && <div className="note" role="status">{msg}</div>}
      <PrintBar L={L} rows={rows} />
    </div>
  );
}
