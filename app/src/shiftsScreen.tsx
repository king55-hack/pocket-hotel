import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { api } from "./api";
import { db } from "./db";
import { addDays, shortDay, todayISO } from "./lib/dates";
import { tplOf } from "./lib/policy";
import type { Attendance, Shift } from "./lib/types";
import type { P } from "./screens";
import { breaksMs, clock, clockIn, clockOut, copyWeek, endBreak, hm, lateBy, openPunch, setShift, shiftId, startBreak, workedMs } from "./shifts";
import { PayrollCard, SmartCard } from "./payrollCard";

type Person = { id: string; name: string; active: boolean };
const DAYNAMES = { ne: ["आइत", "सोम", "मंगल", "बुध", "बिही", "शुक्र", "शनि"], en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] };
const dow = (iso: string) => new Date(iso + "T00:00:00").getDay();

export function Shifts({ h, L, session, can, rooms, bookings }: P) {
  const ne = L === "ne";
  const t = (n: string, e: string) => (ne ? n : e);
  const today = todayISO();
  const tpl = tplOf(h);
  const me = session?.user;
  const [week, setWeek] = useState(today);
  const [people, setPeople] = useState<Person[]>([]);
  const [msg, setMsg] = useState("");
  const manage = can("staff.manage");
  const shifts = useLiveQuery(() => db.shifts.toArray(), [], [] as Shift[]);
  const att = useLiveQuery(() => db.attendance.toArray(), [], [] as Attendance[]);
  const [open, setOpen] = useState<{ since: number; brk: boolean } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!manage) return;
    void api("/staff").then((r) => { if (r.s === 200) setPeople((r.j.staff as Person[]).filter((x) => x.active)); });
  }, [manage]);
  useEffect(() => {
    if (!me) return;
    void openPunch(me.id).then((o) => setOpen(o ? { since: o.punch.in, brk: !!o.punch.breaks?.some((b) => b.e === undefined) } : null));
  }, [me, att]);
  useEffect(() => { const i = setInterval(() => setTick((x) => x + 1), 30_000); return () => clearInterval(i); }, []);

  if (!session || !me) return <div className="card"><h2>{t("सिफ्ट", "Shifts")}</h2><p>{t("सिफ्ट प्रयोग गर्न साइन इन गर्नुस्।", "Sign in to use shifts.")}</p></div>;

  const tplOfId = (id: string) => tpl.find((x) => x.id === id);
  const label = (s: Shift | undefined) => { const x = s && s.tpl ? tplOfId(s.tpl) : undefined; return x ? `${x.name} ${x.start}–${x.end}` : t("बिदा / छैन", "Off / none"); };
  const my = (day: string) => shifts.find((s) => s.id === shiftId(me.id, day));
  const next7 = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const onDuty = shifts.filter((s) => s.day === today && s.tpl && tplOfId(s.tpl));
  const mine = att.find((a) => a.id === shiftId(me.id, today));
  void tick;

  const monday = (d: string) => addDays(d, -((dow(d) + 6) % 7));
  const start = monday(week);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <>
      <div className="card"><h2>{t("मेरो सिफ्ट", "My shifts")}</h2>
        {next7.map((d) => (
          <div className="item" key={d} style={d === today ? { fontWeight: 700 } : undefined}>
            <span>{d === today ? t("आज", "Today") : DAYNAMES[L][dow(d)]} <small>{shortDay(d)}</small></span><span>{label(my(d))}</span>
          </div>))}
        {!shifts.some((s) => s.uid === me.id && s.day >= today && s.tpl) && <p style={{ color: "var(--mute)" }}>{t("अहिले तपाईंको सिफ्ट राखिएको छैन।", "No shift has been given to you yet.")}</p>}
      </div>

      {h.feat.attendance && (
        <div className="card"><h2>{t("हाजिरी", "Attendance")}</h2>
          {open
            ? <div className="note"><b>{open.brk ? t("ब्रेकमा हुनुहुन्छ ☕", "You are on a break ☕") : t("काममा हुनुहुन्छ", "You are clocked in")}</b><br />{t("सुरु", "Since")} {clock(open.since)} · {hm(Date.now() - open.since)}</div>
            : <p style={{ color: "var(--mute)" }}>{t("अहिले तपाईं काममा हुनुहुन्न।", "You are not clocked in.")}</p>}
          {open && (open.brk
            ? <button className="btn" onClick={() => void endBreak(me.id)}>{t("ब्रेक सकियो (काममा फर्कें)", "Back from break")}</button>
            : <button className="btn alt" onClick={() => void startBreak(me.id)}>{t("ब्रेक सुरु ☕", "Start break ☕")}</button>)}
          {open
            ? <button className="btn bad" onClick={async () => { await clockOut(me.id); setMsg(""); }}>{t("काम सकियो (लगआउट)", "Clock out")}</button>
            : <button className="btn" onClick={async () => { const r = await clockIn({ uid: me.id, name: me.name }); setMsg(r === "already" ? t("पहिल्यै काममा हुनुहुन्छ।", "Already clocked in.") : ""); }}>{t("काम सुरु (लगइन)", "Clock in")}</button>}
          {msg && <div className="warn" role="alert">{msg}</div>}
          {mine && mine.punches.map((p, i) => <div className="item" key={i}><span>{clock(p.in)} → {p.out ? clock(p.out) : "…"}{p.breaks?.length ? ` · ☕ ${p.breaks.length}` : ""}</span><span>{hm(workedMs({ ...mine, punches: [p] }))}</span></div>)}
          {mine && breaksMs(mine) > 0 && <small style={{ color: "var(--mute)" }}>{t("ब्रेक", "Breaks")}: {hm(breaksMs(mine))} ({t("तलबमा गनिँदैन", "not paid")})</small>}
        </div>)}

      <div className="card"><h2>{t("आज ड्युटीमा", "On duty today")}</h2>
        {onDuty.map((s) => <div className="item" key={s.id}><span>{s.name}</span><span>{label(s)}</span></div>)}
        {!onDuty.length && <p style={{ color: "var(--mute)" }}>{t("आजको सिफ्ट राखिएको छैन।", "No shifts planned for today.")}</p>}
      </div>

      {manage && (
        <>
          <div className="card"><h2>{t("सिफ्ट बनाउने", "Plan shifts")}</h2>
            <div className="row" style={{ marginBottom: 8 }}>
              <button className="btn sm alt" aria-label="previous week" onClick={() => setWeek(addDays(start, -7))}>‹</button>
              <b>{shortDay(days[0])} – {shortDay(days[6])}</b>
              <button className="btn sm alt" aria-label="next week" onClick={() => setWeek(addDays(start, 7))}>›</button>
            </div>
            {!tpl.length && <div className="warn">{t("पहिले सेटिङमा सिफ्टका किसिम बनाउनुस्।", "First make shift types in Settings.")}</div>}
            {people.map((p) => (
              <div key={p.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8, marginBottom: 8 }}>
                <b>{p.name}</b>
                {days.map((d) => {
                  const cur = shifts.find((s) => s.id === shiftId(p.id, d));
                  return (
                    <div className="row" key={d} style={{ marginTop: 4 }}>
                      <span style={{ minWidth: 76 }}>{DAYNAMES[L][dow(d)]} <small>{shortDay(d)}</small></span>
                      <select aria-label={`${p.name} ${d}`} value={cur?.tpl ?? ""} onChange={(e) => void setShift({ uid: p.id, name: p.name }, d, e.target.value)}>
                        <option value="">{t("बिदा / छैन", "Off / none")}</option>
                        {tpl.map((x) => <option key={x.id} value={x.id}>{x.name} {x.start}–{x.end}</option>)}
                      </select>
                    </div>);
                })}
              </div>))}
            <button className="btn alt" onClick={async () => { const n = await copyWeek(days[0]); setMsg(n ? t(`${n} सिफ्ट अर्को हप्तामा सारियो।`, `${n} shifts copied to next week.`) : t("सार्नु केही छैन।", "Nothing to copy.")); }}>{t("यो हप्ता अर्को हप्तामा सार्ने", "Copy this week to next week")}</button>
            {msg && <div className="note" role="status">{msg}</div>}
          </div>

          {h.feat.attendance && <PayrollCard L={L} h={h} people={people} att={att} shifts={shifts} />}
          {h.feat.smart && <SmartCard L={L} rooms={rooms} bookings={bookings} shifts={shifts} />}
          {h.feat.attendance && (
            <div className="card"><h2>{t("हाजिरी रिपोर्ट", "Attendance report")}</h2>
              <p style={{ fontSize: 14, color: "var(--mute)", margin: "0 0 6px" }}>{shortDay(days[0])} – {shortDay(days[6])}</p>
              {people.map((p) => {
                const rows = att.filter((a) => a.uid === p.id && a.day >= days[0] && a.day <= days[6]).sort((a, b) => a.day.localeCompare(b.day));
                const total = rows.reduce((s, a) => s + workedMs(a), 0);
                return (
                  <div key={p.id} style={{ marginBottom: 8 }}>
                    <div className="row"><b>{p.name}</b><b>{hm(total)}</b></div>
                    {rows.map((a) => {
                      const sh = shifts.find((s) => s.id === a.id);
                      const late = lateBy(a, sh, sh ? tplOfId(sh.tpl) : undefined);
                      return <div className="item" key={a.id}><span>{shortDay(a.day)} · {a.punches.map((x) => `${clock(x.in)}→${x.out ? clock(x.out) : "…"}`).join(", ")}</span><span>{late !== undefined && late > 5 ? <span style={{ color: "var(--warn)" }}>{t(`${late} मिनेट ढिला`, `${late} min late`)}</span> : hm(workedMs(a))}</span></div>;
                    })}
                    {!rows.length && <small style={{ color: "var(--mute)" }}>{t("हाजिरी छैन", "No clock-ins")}</small>}
                  </div>);
              })}
            </div>)}
        </>)}
    </>
  );
}
