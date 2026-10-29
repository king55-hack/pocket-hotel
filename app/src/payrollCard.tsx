import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Bars } from "./charts";
import { db } from "./db";
import { shortDay, todayISO } from "./lib/dates";
import { monthOf, nextMonth, payroll, prevMonth } from "./lib/payroll";
import { MAX_MONEY, tplOf } from "./lib/policy";
import { suggest, type Level } from "./lib/suggest";
import { csvSafe } from "./csv";
import type { Attendance, Hotel, PayMode, PayRec, Room, Booking, Shift } from "./lib/types";

export type Person = { id: string; name: string; active: boolean };
const rs = (n: number) => "Rs " + Math.round(n).toLocaleString("en-IN");
const money = (v: string) => Math.min(MAX_MONEY, Math.max(0, Math.round(Number(v) || 0)));

const blank = (p: Person): PayRec => ({ id: p.id, uid: p.id, name: p.name, mode: "monthly", rate: 0, adj: [] });

/** Salary: how each person is paid, the month's attendance, and the amount to pay. Only managers see this. */
export function PayrollCard({ L, h, people, att, shifts }: { L: "ne" | "en"; h: Hotel; people: Person[]; att: Attendance[]; shifts: Shift[] }) {
  const t = (n: string, e: string) => (L === "ne" ? n : e);
  const today = todayISO();
  const [month, setMonth] = useState(monthOf(today));
  const pays = useLiveQuery(() => db.pay.toArray(), [], [] as PayRec[]);
  const tpl = tplOf(h);
  const of = (p: Person) => pays.find((x) => x.id === p.id) ?? blank(p);
  const put = (rec: PayRec) => void db.pay.put({ ...rec, name: rec.name });
  const setAdj = (p: Person, patch: Partial<{ bonus: number; deduct: number; note: string }>) => {
    const cur = of(p);
    const old = cur.adj.find((a) => a.month === month) ?? { month, bonus: 0, deduct: 0, note: "" };
    const nu = { ...old, ...patch };
    const rest = cur.adj.filter((a) => a.month !== month);
    put({ ...cur, adj: nu.bonus || nu.deduct || nu.note ? [...rest, nu].slice(-36) : rest });
  };
  const rows = people.map((p) => ({ p, rec: of(p), row: payroll(of(p), att, shifts, tpl, month, today) }));
  const total = rows.reduce((s, x) => s + x.row.net, 0);

  function download() {
    const lines: (string | number)[][] = [["Name", "Pay type", "Rate", "Days present", "Hours", "Absent days", "Late days", "Gross", "Bonus", "Deduction", "Note", "Net pay"]];
    for (const { p, rec, row } of rows) lines.push([p.name, rec.mode, rec.rate, row.present, row.hours, row.absent, row.late, row.gross, row.bonus, row.deduct, row.note, row.net]);
    const text = "﻿" + lines.map((r) => r.map((v) => csvSafe(v)).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = `salary-${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="card"><h2>{t("तलब हिसाब", "Salary")}</h2>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn sm alt" aria-label="previous month" onClick={() => setMonth(prevMonth(month))}>‹</button>
        <b>{month}</b>
        <button className="btn sm alt" aria-label="next month" disabled={month >= monthOf(today)} onClick={() => setMonth(nextMonth(month))}>›</button>
      </div>
      <p style={{ fontSize: 14, color: "var(--mute)", margin: "0 0 8px" }}>{t("हाजिरी (ब्रेक घटाएर) बाट हिसाब। मासिक तलबमा तोकेको सिफ्टमा नआएको दिनको तलब कटौती हुन्छ।", "Worked out from attendance (breaks taken off). With a monthly salary, a day on the plan that the person did not come is deducted.")}</p>
      {rows.map(({ p, rec, row }) => (
        <div key={p.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 10, marginBottom: 10 }}>
          <div className="row"><b>{p.name}</b><b>{rs(row.net)}</b></div>
          <div className="grid2">
            <div><label htmlFor={"pm" + p.id}>{t("तलबको किसिम", "Pay type")}</label>
              <select id={"pm" + p.id} value={rec.mode} onChange={(e) => put({ ...rec, mode: e.target.value as PayMode })}>
                <option value="monthly">{t("महिनाको", "Monthly")}</option><option value="daily">{t("दिनको", "Per day")}</option><option value="hourly">{t("घण्टाको", "Per hour")}</option>
              </select></div>
            <div><label htmlFor={"pr" + p.id}>{t("दर (Rs)", "Rate (Rs)")}</label><input id={"pr" + p.id} type="number" inputMode="numeric" min="0" defaultValue={rec.rate} key={rec.rate} onBlur={(e) => put({ ...rec, rate: money(e.target.value) })} /></div>
            <div><label htmlFor={"pb" + p.id}>{t("बोनस", "Bonus")}</label><input id={"pb" + p.id} type="number" inputMode="numeric" min="0" defaultValue={rec.adj.find((a) => a.month === month)?.bonus ?? 0} key={month + "b" + row.bonus} onBlur={(e) => setAdj(p, { bonus: money(e.target.value) })} /></div>
            <div><label htmlFor={"pd" + p.id}>{t("कटौती / पेस्की", "Deduction / advance")}</label><input id={"pd" + p.id} type="number" inputMode="numeric" min="0" defaultValue={rec.adj.find((a) => a.month === month)?.deduct ?? 0} key={month + "d" + row.deduct} onBlur={(e) => setAdj(p, { deduct: money(e.target.value) })} /></div>
          </div>
          <input aria-label={`note ${p.name}`} placeholder={t("टिप्पणी (वैकल्पिक)", "Note (optional)")} defaultValue={rec.adj.find((a) => a.month === month)?.note ?? ""} key={month + "n" + row.note} maxLength={100} onBlur={(e) => setAdj(p, { note: e.target.value.trim().slice(0, 100) })} style={{ marginTop: 6 }} />
          <small style={{ color: "var(--mute)" }}>{t(`आएको ${row.present} दिन · ${row.hours} घण्टा · नआएको ${row.absent} · ढिला ${row.late} · कुल ${rs(row.gross)}`, `${row.present} days · ${row.hours} h · absent ${row.absent} · late ${row.late} · gross ${rs(row.gross)}`)}</small>
        </div>))}
      {!people.length && <p style={{ color: "var(--mute)" }}>{t("स्टाफ छैन।", "No staff.")}</p>}
      <div className="row"><b>{t("जम्मा तिर्नुपर्ने", "Total to pay")}</b><b>{rs(total)}</b></div>
      <button className="btn alt" onClick={download}>{t("तलबको फाइल (Excel/CSV)", "Salary file (Excel/CSV)")}</button>
    </div>
  );
}

const LEVEL: Record<Level, { ne: string; en: string; c: string }> = {
  busy: { ne: "भीड", en: "Busy", c: "var(--bad)" }, normal: { ne: "सामान्य", en: "Normal", c: "var(--pri)" }, quiet: { ne: "कम", en: "Quiet", c: "var(--warn)" },
};
const PER = "ph.perStaff";
const readPer = () => { try { return Math.min(50, Math.max(1, Number(localStorage.getItem(PER)) || 8)); } catch { return 8; } };

/** A simple estimate (not real AI): how busy the coming days will be, and how many staff that needs. */
export function SmartCard({ L, rooms, bookings, shifts }: { L: "ne" | "en"; rooms: Room[]; bookings: Booking[]; shifts: Shift[] }) {
  const t = (n: string, e: string) => (L === "ne" ? n : e);
  const [per, setPer] = useState(readPer());
  const tips = suggest(bookings, rooms, shifts, 14, per);
  const busy = tips.filter((x) => x.level === "busy").length, quiet = tips.filter((x) => x.level === "quiet").length;
  const msg = (x: (typeof tips)[number]) => {
    const gap = x.need - x.planned;
    if (x.level === "busy") return gap > 0 ? t(`भीड हुन्छ: ${gap} जना थप राख्नुस् (चाहिने ${x.need}, राखेको ${x.planned})`, `Busy: add ${gap} more staff (need ${x.need}, planned ${x.planned})`) : t("भीड हुन्छ, स्टाफ पुग्छ ✓", "Busy, staff is enough ✓");
    if (x.level === "quiet") return x.planned > x.need ? t(`कम ग्राहक: ${x.need} जना काफी, ${x.planned - x.need} जनालाई बिदा दिन मिल्छ`, `Quiet: ${x.need} staff is enough, ${x.planned - x.need} could have a day off`) : t("कम ग्राहक: थोरै स्टाफले पुग्छ", "Quiet: few staff is enough");
    return gap > 0 ? t(`${gap} जना थप भए राम्रो (चाहिने ${x.need}, राखेको ${x.planned})`, `${gap} more would be good (need ${x.need}, planned ${x.planned})`) : t("ठीक छ ✓", "Fine ✓");
  };
  return (
    <div className="card"><h2>✨ {t("स्मार्ट सुझाव", "Smart suggestion")}</h2>
      <p style={{ fontSize: 14, color: "var(--mute)", margin: "0 0 8px" }}>{t("अर्को १४ दिनको बुकिङ र पछिल्ला ८ हप्ताको सामान्य भीड हेरेर सरल अनुमान। यो असली AI होइन, अनुमान मात्र हो।", "A simple estimate from the next 14 days of bookings and how busy the last 8 weeks were. It is a rule of thumb, not real AI.")}</p>
      <div className="note" style={{ margin: "0 0 8px" }}>{t(`भीड हुने ${busy} दिन · कम हुने ${quiet} दिन`, `${busy} busy days · ${quiet} quiet days`)}</div>
      <Bars title={t("अनुमानित कोठा", "Expected rooms")} labels={tips.map((x) => shortDay(x.day))} max={Math.max(1, rooms.length)} fmt={(n) => String(Math.round(n))}
        series={[{ name: t("बुक भएको", "Booked"), color: "var(--pri)", v: tips.map((x) => x.booked) }, { name: t("सामान्य भीडबाट अनुमान", "Expected from usual pattern"), color: "var(--warn)", v: tips.map((x) => Math.max(0, x.expected - x.booked)) }]} />
      {tips.map((x) => (
        <div className="item" key={x.day}><span><b>{x.day === todayISO() ? t("आज", "Today") : shortDay(x.day)}</b> <span className="pill" style={{ background: "var(--pri2)", color: LEVEL[x.level].c }}>{LEVEL[x.level][L]} {x.pct}%</span><br /><small>{msg(x)}</small></span></div>))}
      <label htmlFor="per">{t("एक जना स्टाफले कति कोठा हेर्छ?", "Rooms one staff member can look after")}</label>
      <input id="per" type="number" inputMode="numeric" min="1" max="50" defaultValue={per} onBlur={(e) => { const v = Math.min(50, Math.max(1, Math.round(Number(e.target.value) || 8))); setPer(v); try { localStorage.setItem(PER, String(v)); } catch { /* ignore */ } }} />
    </div>
  );
}
