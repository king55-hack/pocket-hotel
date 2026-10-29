import { useState } from "react";
import { CSV_TEMPLATE, MAX_FILE, checkBackup, exportAll, importBookingsCsv, restoreBackup, type Checked } from "./backup";
import { csvFile } from "./csv";
import { todayISO } from "./lib/dates";
import type { Lang } from "./i18n";

function save(text: string, name: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
const readFile = (f: File) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsText(f); });

/** Premium: keep a copy of the hotel's data outside the app, bring it back, and load old records from a spreadsheet. */
export function BackupCard({ L, withPay }: { L: Lang; withPay: boolean }) {
  const t = (n: string, e: string) => (L === "ne" ? n : e);
  const [chk, setChk] = useState<Extract<Checked, { ok: true }> | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<"ok" | "bad">("ok");
  const say = (m: string, k: "ok" | "bad" = "ok") => { setMsg(m); setKind(k); };
  const today = todayISO();

  async function pick(file: File | undefined) {
    setChk(null); setMsg("");
    if (!file) return;
    if (file.size > MAX_FILE) return say(t("फाइल धेरै ठूलो छ।", "The file is too big."), "bad");
    const r = checkBackup(await readFile(file));
    if (!r.ok) return say(r.error === "json" ? t("यो फाइल पढ्न मिलेन (ब्याकअप फाइल होइन)।", "Cannot read this file (it is not a backup).") : r.error === "version" ? t("यो ब्याकअप नयाँ संस्करणको हो। एप अपडेट गर्नुस्।", "This backup is from a newer version. Update the app.") : t("यो पकेट होटलको ब्याकअप फाइल होइन।", "This is not a Pocket Hotel backup file."), "bad");
    setChk(r);
  }
  async function csvImport(file: File | undefined) {
    setMsg("");
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return say(t("फाइल धेरै ठूलो छ।", "The file is too big."), "bad");
    setBusy(true);
    const r = await importBookingsCsv(await readFile(file), today);
    setBusy(false);
    say(`${t("थपियो", "Added")}: ${r.added} · ${t("छोडियो", "Skipped")}: ${r.skipped}${r.problems.length ? "\n" + r.problems.join("\n") : ""}`, r.added ? "ok" : "bad");
  }
  return (
    <div className="card"><h2>💾 {t("ब्याकअप र पुरानो डेटा", "Backup and old data")}</h2>
      <p style={{ fontSize: 14, color: "var(--mute)", margin: "0 0 8px" }}>{t("ग्राहकको महत्त्वपूर्ण डेटा सुरक्षित राख्न आफ्नो फोन/कम्प्युटर वा Google Drive मा एउटा फाइल राख्नुस्।", "Keep a file with your important data on your phone, computer or Google Drive.")}</p>
      <button className="btn" onClick={async () => { save(JSON.stringify(await exportAll(withPay)), `pocket-hotel-backup-${today}.json`, "application/json"); say(t("ब्याकअप डाउनलोड भयो। फाइललाई सुरक्षित ठाउँमा राख्नुस्।", "Backup downloaded. Keep the file somewhere safe.")); }}>{t("ब्याकअप डाउनलोड", "Download backup")}</button>

      <h3>{t("ब्याकअपबाट फर्काउने", "Restore from a backup")}</h3>
      <label htmlFor="rf">{t("ब्याकअप फाइल (.json) रोज्नुस्", "Choose a backup file (.json)")}</label>
      <input id="rf" type="file" accept=".json,application/json" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
      {chk && (
        <div className="note">
          <b>{chk.hotelName || t("ब्याकअप", "Backup")}</b> · {new Date(chk.data.at).toLocaleDateString()}<br />
          {t("कोठा", "Rooms")} {chk.counts.rooms} · {t("बुकिङ", "Bookings")} {chk.counts.bookings} · {t("अर्डर", "Orders")} {chk.counts.orders} · {t("सिफ्ट", "Shifts")} {chk.counts.shifts} · {t("हाजिरी", "Attendance")} {chk.counts.attendance}{withPay ? ` · ${t("तलब", "Pay")} ${chk.counts.pay}` : ""}
          {chk.skipped > 0 && <div className="warn">{t(`${chk.skipped} वटा गलत रेकर्ड छोडिनेछ।`, `${chk.skipped} invalid records will be left out.`)}</div>}
          <small style={{ display: "block", margin: "6px 0" }}>{t("अहिले भएको केही मेटिँदैन। नभएको वा फाइलमा नयाँ भएको मात्र थपिन्छ।", "Nothing you have now is erased. Only what is missing, or newer in the file, is added.")}</small>
          <button className="btn" disabled={busy} onClick={async () => { setBusy(true); const n = await restoreBackup(chk.data, withPay); setBusy(false); setChk(null); say(t(`${n} रेकर्ड फर्कियो।`, `${n} records restored.`)); }}>{t("फर्काउनुस्", "Restore")}</button>
          <button className="btn alt" onClick={() => setChk(null)}>{t("रद्द", "Cancel")}</button>
        </div>)}

      <h3>{t("पुरानो बुकिङ (Excel/CSV) हाल्ने", "Add old bookings (Excel/CSV)")}</h3>
      <p style={{ fontSize: 14, color: "var(--mute)", margin: "0 0 6px" }}>{t("पहिले नमुना फाइल लिनुस्, आफ्ना पुराना बुकिङ त्यसमा भरेर CSV सेभ गर्नुस्, अनि यहाँ हाल्नुस्। पहिले कोठा बनाइसकेको हुनुपर्छ। रकम अन्तिम बिल मानिन्छ।", "Get the sample file, fill in your old bookings, save it as CSV and add it here. The rooms must exist first. The amount is taken as the final bill.")}</p>
      <button className="btn alt" onClick={() => save(csvFile(CSV_TEMPLATE), "old-bookings-sample.csv", "text/csv")}>{t("नमुना फाइल", "Sample file")}</button>
      <label htmlFor="cf">{t("पुरानो बुकिङको CSV रोज्नुस्", "Choose the CSV of old bookings")}</label>
      <input id="cf" type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => { void csvImport(e.target.files?.[0]); e.target.value = ""; }} />
      {msg && <div className={kind === "bad" ? "warn" : "note"} role="status" style={{ whiteSpace: "pre-line" }}>{msg}</div>}
    </div>
  );
}
