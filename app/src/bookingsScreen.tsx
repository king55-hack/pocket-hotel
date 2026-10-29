import { useMemo, useState } from "react";
import { cancelBooking, checkIn, editBooking, type Result } from "./actions";
import { addDays, daysBetween, shortDay, todayISO } from "./lib/dates";
import { paidSum } from "./lib/booking";
import { calcBill } from "./lib/bill";
import { MAX_EXTRA_BEDS, catsOf, maxPersons, policyOf } from "./lib/policy";
import type { Booking, Hotel, Room } from "./lib/types";
import type { P } from "./screens";

type Filter = "today" | "house" | "soon" | "past";
type Tr = (ne: string, en: string) => string;
type Fail = Extract<Result, { ok: false }>;
const rs = (n: number) => "Rs " + Math.round(n).toLocaleString("en-IN");

export function Bookings({ h, L, rooms, bookings, sel, go, can }: P) {
  const ne = L === "ne";
  const t: Tr = (n, e) => (ne ? n : e);
  const today = todayISO();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(sel);
  const [mode, setMode] = useState<"" | "edit" | "checkin" | "cancel">("");
  const [msg, setMsg] = useState("");

  const groups = useMemo(() => {
    const by = (f: (b: Booking) => boolean) => bookings.filter(f).sort((a, b) => a.from.localeCompare(b.from) || a.room.localeCompare(b.room));
    return {
      today: by((b) => b.status === "booked" && b.from <= today),
      house: by((b) => b.status === "occupied"),
      soon: by((b) => b.status === "booked" && b.from > today),
      past: by((b) => ["done", "cancelled", "noshow"].includes(b.status)).reverse(),
    };
  }, [bookings, today]);
  const [filter, setFilter] = useState<Filter>(() => {
    const s = bookings.find((b) => b.id === sel);
    if (s) return s.status === "occupied" ? "house" : s.status === "booked" ? (s.from <= today ? "today" : "soon") : "past";
    return groups.today.length ? "today" : groups.house.length ? "house" : "soon";
  });

  const needle = q.trim().toLowerCase();
  const pool = needle ? bookings.slice().sort((a, b) => a.from.localeCompare(b.from)) : groups[filter];
  const list = pool.filter((b) => !needle || [b.guest, b.phone, b.room, b.billNo ?? "", b.src].some((x) => x.toLowerCase().includes(needle)));

  const chip = (f: Filter, label: string) => (
    <button key={f} className={"btn sm " + (filter === f && !needle ? "" : "alt")} onClick={() => { setFilter(f); setQ(""); setOpen(""); setMode(""); }}>{label} · {groups[f].length}</button>
  );
  const err = (r: Fail) =>
    r.error === "taken" ? t("यो कोठा ती मितिमा पहिल्यै बुक छ।", "This room is already booked on those dates.")
      : r.error === "name" ? t("नाम लेख्नुहोस्।", "Please write a name.")
      : r.error === "dates" ? t("मिति वा रात ठीक छैन।", "The date or nights are not right.")
      : r.error === "past" ? t("बितिसकेको मितिमा सार्न मिल्दैन।", "You cannot move a booking to a day that is already over.")
      : t("यो गर्न मिलेन।", "Could not do this.");

  return (
    <>
      <div className="card"><h2>{t("बुकिङ सूची", "Bookings")}</h2>
        <label htmlFor="bq">{t("खोज्नुस् (नाम, फोन, कोठा, बिल)", "Search (name, phone, room, bill)")}</label>
        <input id="bq" value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ marginTop: 8 }}>
          {chip("today", t("आज आउने", "Arriving"))}{chip("house", t("भित्र बसेका", "In house"))}{chip("soon", t("आउने (पछि)", "Upcoming"))}{chip("past", t("पुराना", "Past"))}
        </div>
      </div>
      {!list.length && <div className="card"><p>{t("यहाँ केही छैन।", "Nothing here.")}</p></div>}
      {list.map((b) => {
        const isOpen = open === b.id;
        const days = daysBetween(today, b.from);
        const end = addDays(b.from, b.nights);
        const when = b.status === "booked" ? (days > 0 ? t(`${days} दिनपछि`, `in ${days} days`) : days === 0 ? t("आज", "today") : t(`${-days} दिन ढिला`, `${-days} days late`)) : "";
        return (
          <div className="card" key={b.id}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div><b>{b.guest}</b> <span className={"pill s-" + (b.status === "occupied" ? "occupied" : b.status === "booked" ? "booked" : "out")}>{b.status}</span><br />
                <small>{t("कोठा", "Room")} {b.room} · {shortDay(b.from)} → {shortDay(end)} · {b.nights} {t("रात", "nights")}{when && ` · ${when}`}</small><br />
                <small>{b.src}{b.phone && ` · ${b.phone}`}{paidSum(b) > 0 && ` · ${t("अग्रिम", "paid")} ${rs(paidSum(b))}`}{b.billNo && ` · ${b.billNo}`}</small></div>
              <button className="btn sm alt" aria-label="open" onClick={() => { setOpen(isOpen ? "" : b.id); setMode(""); setMsg(""); }}>{isOpen ? "▲" : "▼"}</button>
            </div>
            {isOpen && (
              <div style={{ marginTop: 8 }}>
                {b.status === "booked" && mode === "" && (
                  <div className="grid2">
                    {b.from <= today
                      ? <button className="btn" onClick={() => { setMode("checkin"); setMsg(""); }}>{t("चेक-इन", "Check-in")}</button>
                      : <button className="btn" onClick={async () => {
                          const nights = daysBetween(today, end);
                          if (nights < 1) return setMsg(t("यो बुकिङ आज सार्न मिल्दैन।", "Cannot move this booking to today."));
                          const r = await editBooking(b.id, { from: today, nights });
                          if (r.ok) setMode("checkin"); else setMsg(err(r));
                        }}>{t("आजै आयो (मिति आज सार्ने)", "Arrived early (move to today)")}</button>}
                    <button className="btn alt" onClick={() => setMode("edit")}>{t("बदल्ने", "Change")}</button>
                    <button className="btn alt" onClick={() => setMode("cancel")}>{t("रद्द / आएन", "Cancel / no-show")}</button>
                  </div>)}
                {b.status === "occupied" && mode === "" && (
                  <div className="grid2">
                    <button className="btn" onClick={() => go("bill", b.id)}>{t("बिल / चेक-आउट", "Bill / check-out")}</button>
                    <button className="btn alt" onClick={() => setMode("edit")}>{t("बस्ने रात बदल्ने", "Change nights")}</button>
                  </div>)}
                {mode === "edit" && <EditForm key={b.id} b={b} rooms={rooms.map((r) => r.n)} t={t} onDone={() => { setMode(""); setMsg(""); }} fail={(r) => setMsg(err(r))} />}
                {mode === "checkin" && <CheckInForm b={b} h={h} room={rooms.find((x) => x.n === b.room)} canRate={can("prices.edit") || can("discount")} t={t} canForce={can("rooms.manage") || can("housekeeping")} onDone={() => { setMode(""); go("rooms"); }} />}
                {mode === "cancel" && <CancelForm b={b} t={t} noShowOk={b.from <= today} onDone={() => { setMode(""); setOpen(""); }} />}
                {msg && <div className="warn" role="alert">{msg}</div>}
              </div>)}
          </div>
        );
      })}
    </>
  );
}

function EditForm({ b, rooms, t, onDone, fail }: { b: Booking; rooms: string[]; t: Tr; onDone: () => void; fail: (r: Fail) => void }) {
  const inHouse = b.status === "occupied";
  const [f, setF] = useState({ guest: b.guest, phone: b.phone, room: b.room, from: b.from, nights: String(b.nights) });
  return (
    <div>
      <label htmlFor="eg">{t("नाम", "Name")}</label><input id="eg" value={f.guest} onChange={(e) => setF({ ...f, guest: e.target.value })} />
      <label htmlFor="ep">{t("फोन", "Phone")}</label><input id="ep" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      {!inHouse && (
        <div className="grid2">
          <div><label htmlFor="er">{t("कोठा", "Room")}</label><select id="er" value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })}>{rooms.map((r) => <option key={r}>{r}</option>)}</select></div>
          <div><label htmlFor="ef">{t("आगमन मिति", "Arrival")}</label><input id="ef" type="date" min={todayISO()} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
        </div>)}
      <label htmlFor="en">{t("कति रात", "Nights")}</label><input id="en" type="number" min="1" inputMode="numeric" value={f.nights} onChange={(e) => setF({ ...f, nights: e.target.value })} />
      <div className="grid2">
        <button className="btn" onClick={async () => { const r = await editBooking(b.id, { guest: f.guest, phone: f.phone, room: f.room, from: f.from, nights: Number(f.nights) }); if (r.ok) onDone(); else fail(r); }}>{t("सेभ", "Save")}</button>
        <button className="btn alt" onClick={onDone}>{t("बन्द", "Close")}</button>
      </div>
    </div>
  );
}

function CheckInForm({ b, h, room, t, onDone, canForce, canRate }: { b: Booking; h: Hotel; room: Room | undefined; t: Tr; onDone: () => void; canForce: boolean; canRate: boolean }) {
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [f, setF] = useState({ nationality: "Nepali", persons: String(b.persons ?? 1), idNo: "", visa: "", extraBeds: "0" });
  const pol = policyOf(h);
  const [rate, setRate] = useState(String(room?.price ?? 0));
  const [agreed, setAgreed] = useState(false);
  const info = () => ({ nationality: f.nationality, persons: Math.max(1, Number(f.persons) || 1), idNo: f.idNo.trim(), visa: f.visa.trim(), extraBeds: Number(f.extraBeds) });
  const rateN = Math.max(0, Math.round(Number(rate) || 0));
  const total = calcBill(rateN * b.nights, h.bill).total;
  const fits = room ? maxPersons(room, catsOf(h), Number(f.extraBeds)) : MAX_EXTRA_BEDS + 1;
  const tooMany = (Number(f.persons) || 1) > fits;
  const blocked = tooMany || (pol.confirmPrice && !agreed);
  const go = async (force: boolean) => {
    const r = await checkIn(b.id, info(), { force, rate: pol.editRate && canRate ? rateN : undefined });
    if (r.ok) return onDone();
    if (r.error === "dirty") setDirty(true);
    else if (r.error === "guests") setMsg(t(`यो कोठामा ${fits} जनासम्म मात्र बस्न मिल्छ।`, `This room holds ${fits} people at most.`));
    else setMsg(t("चेक-इन गर्न मिलेन। जाँचेर फेरि प्रयास गर्नुस्।", "Could not check in. Please check and try again."));
  };
  return (
    <div>
      <div className="grid2">
        <div><label htmlFor="nat">{t("राष्ट्रियता", "Nationality")}</label><select id="nat" value={f.nationality} onChange={(e) => setF({ ...f, nationality: e.target.value })}><option>Nepali</option><option>Indian</option><option>Other</option></select></div>
        <div><label htmlFor="per">{t("कति जना", "Persons")}</label><input id="per" type="number" min="1" max={fits} value={f.persons} onChange={(e) => setF({ ...f, persons: e.target.value })} /></div>
      </div>
      {room && <p style={{ margin: "4px 0", fontSize: 14, color: tooMany ? "var(--bad)" : "var(--mute)" }}>{t(`${room.type} कोठा: ${maxPersons(room, catsOf(h), 0)} जना (थप खाट सहित ${fits})`, `${room.type} room: ${maxPersons(room, catsOf(h), 0)} people (${fits} with extra beds)`)}</p>}
      <label htmlFor="idn">{t("परिचयपत्र / पासपोर्ट नम्बर", "ID / passport number")}</label><input id="idn" value={f.idNo} onChange={(e) => setF({ ...f, idNo: e.target.value })} />
      <label htmlFor="vs">{t("भिसा (विदेशी भए)", "Visa (foreigners)")}</label><input id="vs" value={f.visa} onChange={(e) => setF({ ...f, visa: e.target.value })} />
      <label htmlFor="eb">{t("थप खाट", "Extra bed")}</label><select id="eb" value={f.extraBeds} onChange={(e) => setF({ ...f, extraBeds: e.target.value })}><option>0</option><option>1</option><option>2</option></select>
      {(pol.confirmPrice || (pol.editRate && canRate)) && (
        <div className="note" role="group" aria-label={t("मूल्य पक्का गर्नुस्", "Confirm the price")}>
          <b>{t("मूल्य ग्राहकलाई भन्नुस्", "Tell the guest the price")}</b>
          {pol.editRate && canRate
            ? <><label htmlFor="rt">{t("एक रातको मूल्य (Rs)", "Price per night (Rs)")}</label><input id="rt" type="number" min="0" inputMode="numeric" value={rate} onChange={(e) => { setRate(e.target.value); setAgreed(false); }} /></>
            : <div style={{ fontSize: 18 }}>Rs {rateN.toLocaleString("en-IN")} {t("/ रात", "/ night")}</div>}
          <div>{b.nights} {t("रात", "nights")} → <b>Rs {total.toLocaleString("en-IN")}</b> <small>{h.bill.taxIncluded ? t("(कर सहित)", "(tax included)") : t("(कर थपिन्छ)", "(tax is added)")}</small></div>
          {pol.confirmPrice && <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--ink)" }}><input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />{t("ग्राहकले यो मूल्य मन्जुर गर्नुभयो", "The guest agrees to this price")}</label>}
        </div>)}
      {dirty && (
        <div className="warn" role="alert">{t("यो कोठा अझै सफा भएको छैन (अघिल्लो पाहुना गएपछि)। सफाई सकिएपछि मात्र चेक-इन गर्नुस्।", "This room has not been cleaned yet (the last guest has left). Check in only after it is cleaned.")}
          {canForce && <button className="btn sm bad" disabled={blocked} onClick={() => void go(true)}>{t("तैपनि चेक-इन गर्ने", "Check in anyway")}</button>}</div>)}
      {msg && <div className="warn" role="alert">{msg}</div>}
      <button className="btn" disabled={blocked} onClick={() => void go(false)}>{t("चेक-इन पूरा", "Complete check-in")}</button>
    </div>
  );
}

function CancelForm({ b, t, noShowOk, onDone }: { b: Booking; t: Tr; noShowOk: boolean; onDone: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <div>
      <label htmlFor="rs">{t("कारण", "Reason")}</label><input id="rs" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="grid2">
        <button className="btn bad" onClick={async () => { await cancelBooking(b.id, reason || "-"); onDone(); }}>{t("बुकिङ रद्द", "Cancel booking")}</button>
        {noShowOk && <button className="btn alt" onClick={async () => { await cancelBooking(b.id, reason || "-", true); onDone(); }}>{t("आएन (No-show)", "No-show")}</button>}
      </div>
    </div>
  );
}
