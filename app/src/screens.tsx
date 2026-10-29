import { useState } from "react";
import { addOrderToBooking, addToRoomBill, checkOut, createBooking, loadSampleRooms, moveBooking, payOrderAtTable, type Result } from "./actions";
import { MenuCard, PrinterCard, RoomsCard } from "./settingsCards";
import { CategoriesCard, RulesCard, ShiftSetupCard } from "./settingsCards2";
import { BillActions } from "./BillActions";
import { db, STARTER_MENU, uid } from "./db";
import { calcBill, sumLines } from "./lib/bill";
import { MAX_EXTRA_BEDS, catsOf, discOf, maxDiscount, maxPersons, rateOf } from "./lib/policy";
import { bookingAt, findConflicts, paidSum } from "./lib/booking";
import { addDays, daysBetween, shortDay, todayISO } from "./lib/dates";
import type { Booking, Hotel, Line, Order, Room } from "./lib/types";
import { tr, type Key, type Lang } from "./i18n";
import { api, type Session } from "./api";
import { AccountCard, LocalCard } from "./screens2";

export type Tab = "rooms" | "book" | "stay" | "food" | "bill" | "money" | "clean" | "set" | "staff" | "report" | "shifts";
export type P = {
  h: Hotel; L: Lang; rooms: Room[]; bookings: Booking[]; orders: Order[];
  go: (t: Tab, id?: string) => void; sel: string; can: (p: string) => boolean; session: Session | null; onOut: () => void;
  draft: { room: string; from: string } | null; setDraft: (d: { room: string; from: string } | null) => void;
};

const rs = (n: number) => "Rs " + Math.round(n).toLocaleString("en-IN");
const useT = (L: Lang) => (k: Key) => tr(L, k);
const errText = (L: Lang, e: string) =>
  e === "name" ? tr(L, "needName")
    : e === "taken" ? tr(L, "taken")
    : e === "past" ? (L === "ne" ? "बितिसकेको मितिमा बुकिङ गर्न मिल्दैन। आजको वा पछिको मिति रोज्नुहोस्।" : "You cannot book a day that is already over. Pick today or a later date.")
    : e === "guests" ? (L === "ne" ? "कोठामा अटाउने भन्दा बढी मान्छे राख्न मिल्दैन।" : "More people than the room can hold.")
    : e === "money" ? (L === "ne" ? "रकम ठूलो वा गलत छ (अग्रिम पूरा बसाइको बिल भन्दा बढी हुन मिल्दैन)।" : "The amount is too big or not right (an advance cannot be more than the whole stay).")
    : L === "ne" ? "यो काम गर्न मिलेन। फेरि जाँच्नुहोस्।" : "Could not do this. Please check and try again.";

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return <button className={"tg" + (on ? " on" : "")} aria-label={label} aria-pressed={on} onClick={onClick} />;
}

function stateOf(r: Room, bookings: Booking[], day: string): "free" | "booked" | "occupied" | "clean" | "out" {
  if (r.st === "out") return "out";
  const b = bookingAt(bookings, r.n, day);
  if (b) return b.status === "occupied" ? "occupied" : "booked";
  return r.st === "clean" ? "clean" : "free";
}

export function Chart({ h, L, rooms, bookings, go, setDraft, session }: P) {
  const t = useT(L);
  const [off, setOff] = useState(0);
  const jump = (iso: string) => { if (iso.length === 10 && !Number.isNaN(Date.parse(iso + "T00:00:00Z"))) setOff(daysBetween(todayISO(), iso)); };
  const today = todayISO();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, off + i));
  const conflicts = findConflicts(bookings);
  const [mv, setMv] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const occ = rooms.filter((r) => stateOf(r, bookings, today) === "occupied").length;
  const arriving = bookings.filter((b) => b.status === "booked" && b.from === today).length;
  if (!rooms.length)
    return (
      <div className="card">
        <h2>{t("rooms")}</h2>
        {!session && <button className="btn alt" onClick={() => void loadSampleRooms()}>{t("sample")}</button>}
        <button className="btn" onClick={() => go("set")}>{L === "ne" ? "कोठा थप्नुस् (सेटिङ)" : "Add rooms (Settings)"}</button>
      </div>
    );
  return (
    <>
      {conflicts.map(({ keep, move }) => (
        <div className="warn" key={move.id} role="alert">
          <b>{t("conflict")}</b>
          <p>{t("conflictHint")} {move.guest} ({shortDay(move.from)}, {move.room}) ← {keep.guest}</p>
          <div className="row">
            <select aria-label={t("move")} value={mv[move.id] ?? ""} onChange={(e) => setMv({ ...mv, [move.id]: e.target.value })}>
              <option value="">{t("move")}…</option>
              {rooms.filter((r) => r.n !== move.room).map((r) => <option key={r.n}>{r.n}</option>)}
            </select>
            <button className="btn sm" onClick={async () => { const r = await moveBooking(move.id, mv[move.id] ?? ""); setMsg(r.ok ? "" : errText(L, r.ok ? "" : r.error)); }}>OK</button>
          </div>
          {msg && <p>{msg}</p>}
        </div>
      ))}
      <div className="card">
        <div className="row"><h2>{t("rooms")}</h2>
          <span><button className="btn sm alt" aria-label="back" onClick={() => setOff(off - 7)}>‹</button><button className="btn sm alt" onClick={() => setOff(0)}>{t("today")}</button><button className="btn sm alt" aria-label="next" onClick={() => setOff(off + 7)}>›</button></span></div>
        <label htmlFor="jd">{L === "ne" ? "मितिमा जानुस्" : "Go to date"}</label><input id="jd" type="date" value={days[0]} onChange={(e) => jump(e.target.value)} />
        <div className="leg" style={{ marginTop: 8 }}><span className="pill s-free">{t("free")}</span> <span className="pill s-booked">{t("booked")}</span> <span className="pill s-occupied">{t("occupied")}</span> <span className="pill s-clean">{t("toClean")}</span></div>
        <p style={{ color: "var(--mute)", fontSize: 14, margin: "6px 0" }}>{t("tapFree")}</p>
        <div className="tbl"><table>
          <thead><tr><th />{days.map((d) => <th key={d}>{shortDay(d)}</th>)}</tr></thead>
          <tbody>{rooms.map((r) => (
            <tr key={r.n}>
              <td className="rn"><b>{r.n}</b> <small>{r.type}</small>{r.st === "clean" && <span title="needs cleaning"> 🧹</span>}</td>
              {days.map((d) => {
                if (r.st === "out") return <td key={d} style={{ background: "var(--out)" }}>✕</td>;
                const b = bookingAt(bookings, r.n, d);
                if (b) return <td key={d} className={b.status === "occupied" ? "o" : "b"} onClick={() => go(b.status === "occupied" ? "bill" : "stay", b.id)}>{b.guest.split(" ")[0]}</td>;
                if (d < today) return <td key={d} className="past" aria-label={`${r.n} ${d} past`}>·</td>;
                if (r.st === "clean" && d === today) return <td key={d} className="cl" aria-label={`${r.n} needs cleaning`} onClick={() => { if (h.feat.housekeeping) go("clean"); }}>🧹</td>;
                return <td key={d} className="c f" onClick={() => { setDraft({ room: r.n, from: d }); go("book"); }} aria-label={`${r.n} ${d}`}>+</td>;
              })}
            </tr>))}</tbody>
        </table></div>
      </div>
      <div className="card"><b>{t("today")}</b>
        <div className="grid2" style={{ marginTop: 8 }}>
          <div className="note">{t("occupied")}: {occ}/{rooms.length}</div>
          <div className="note">{t("arriving")}: {arriving}</div>
        </div>
        <p style={{ display: "none" }}>{h.name}</p>
      </div>
    </>
  );
}

export function Booking({ h, L, rooms, draft, setDraft, go }: P) {
  const t = useT(L);
  const open = rooms.filter((r) => r.st !== "out");
  const [guest, setGuest] = useState("");
  const [phone, setPhone] = useState("");
  const [room, setRoom] = useState(draft?.room ?? open[0]?.n ?? "");
  const [from, setFrom] = useState(draft?.from ?? todayISO());
  const [nights, setNights] = useState("1");
  const [src, setSrc] = useState(h.sources[0] ?? "Phone");
  const [adv, setAdv] = useState("0");
  const [pax, setPax] = useState("1");
  const [err, setErr] = useState("");
  const sel = rooms.find((x) => x.n === room);
  const most = sel ? maxPersons(sel, catsOf(h), MAX_EXTRA_BEDS) : 1;
  async function save() {
    const r = await createBooking({ room, from, nights: Number(nights), guest, phone, src, advance: Number(adv), persons: Number(pax) });
    if (!r.ok) return setErr(errText(L, r.error));
    setDraft(null);
    go("rooms");
  }
  return (
    <div className="card"><h2>{t("book")}</h2>
      <label htmlFor="bg">{t("guestName")}</label><input id="bg" value={guest} onChange={(e) => setGuest(e.target.value)} autoComplete="off" />
      <label htmlFor="bp">{t("phone")}</label><input id="bp" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <div className="grid2">
        <div><label htmlFor="br">{t("room")}</label><select id="br" value={room} onChange={(e) => setRoom(e.target.value)}>{open.map((r) => <option key={r.n} value={r.n}>{r.n} · {r.type}{r.st === "clean" ? " 🧹" : ""}</option>)}</select></div>
        <div><label htmlFor="bn">{t("nights")}</label><input id="bn" type="number" min="1" inputMode="numeric" value={nights} onChange={(e) => setNights(e.target.value)} /></div>
      </div>
      <div className="grid2">
        <div><label htmlFor="bx">{L === "ne" ? "कति जना" : "People"}</label><input id="bx" type="number" min="1" max={most} inputMode="numeric" value={pax} onChange={(e) => setPax(e.target.value)} /></div>
        <div className="note" style={{ alignSelf: "end", margin: 0 }}><small>{L === "ne" ? `यो कोठामा ${sel ? maxPersons(sel, catsOf(h), 0) : 1} जना (थप खाटसहित ${most})` : `Fits ${sel ? maxPersons(sel, catsOf(h), 0) : 1} (${most} with extra beds)`}</small></div>
      </div>
      <label htmlFor="bd">{t("arrival")}</label><input id="bd" type="date" min={todayISO()} value={from} onChange={(e) => setFrom(e.target.value)} />
      <label htmlFor="bs">{t("from")}</label><select id="bs" value={src} onChange={(e) => setSrc(e.target.value)}>{h.sources.map((s) => <option key={s}>{s}</option>)}</select>
      <label htmlFor="ba">{t("advance")}</label><input id="ba" type="number" min="0" inputMode="numeric" value={adv} onChange={(e) => setAdv(e.target.value)} />
      {err && <div className="warn" role="alert">{err}</div>}
      <button className="btn" onClick={() => void save()}>{t("saveBooking")}</button>
    </div>
  );
}

export function Food({ h, L, bookings, orders }: P) {
  const t = useT(L);
  const [cart, setCart] = useState<Line[]>([]);
  const occupied = bookings.filter((b) => b.status === "occupied");
  const [to, setTo] = useState("T1");
  const menu = h.menu ?? STARTER_MENU;
  const cats = [...new Set(menu.map((m) => m.cat || "-"))];
  const add = (name: string, price: number) => setCart((c) => (c.find((l) => l.name === name) ? c.map((l) => (l.name === name ? { ...l, qty: l.qty + 1 } : l)) : [...c, { name, qty: 1, price }]));
  return (
    <>
      <div className="card"><h2>{t("food")}</h2>
        {cats.map((cat) => (
          <div key={cat}>{cats.length > 1 && <h3>{cat}</h3>}
            <div className="grid2">{menu.filter((m) => (m.cat || "-") === cat).map((m) => <button key={m.id} className="btn alt" style={{ margin: 0 }} onClick={() => add(m.name, m.price)}>{m.name}<br /><small>{rs(m.price)}</small></button>)}</div></div>))}
        {!menu.length && <p style={{ color: "var(--mute)" }}>{L === "ne" ? "मेनु खाली छ। सेटिङमा मेनु थप्नुस्।" : "The menu is empty. Add items in Settings."}</p>}</div>
      <div className="card"><h3>{t("order")}</h3>
        {cart.map((l, i) => <div className="item" key={l.name}><span>{l.qty} × {l.name}</span><span>{rs(l.qty * l.price)} <button className="btn sm bad" aria-label="remove" onClick={() => setCart(cart.filter((_, j) => j !== i))}>✕</button></span></div>)}
        {!cart.length && <p style={{ color: "var(--mute)" }}>{t("empty")}</p>}
        <div className="row"><b>{t("total")}</b><b>{rs(sumLines(cart))}</b></div>
        <label htmlFor="fto">{t("room")} / {t("table")}</label>
        <select id="fto" value={to} onChange={(e) => setTo(e.target.value)}><option value="T1">{t("table")} 1</option><option value="T2">{t("table")} 2</option>{occupied.map((b) => <option key={b.id} value={"R" + b.id}>{t("room")} {b.room} · {b.guest}</option>)}</select>
        <button className="btn" disabled={!cart.length} onClick={async () => { await db.orders.add({ id: uid(), to, items: cart, done: false, billed: false, at: Date.now() }); setCart([]); }}>{t("send")}</button></div>
      <div className="card"><h3>{L === "ne" ? "भान्छा स्क्रिन" : "Kitchen screen"}</h3>
        {orders.filter((o) => !o.billed).map((o) => {
          const bid = o.to.startsWith("R") ? o.to.slice(1) : "";
          const bk = bookings.find((b) => b.id === bid);
          return (
            <div className="item" key={o.id}>
              <div><b>{bk ? `${t("room")} ${bk.room}` : o.to.replace("T", t("table") + " ")}</b><br /><small>{o.items.map((x) => `${x.qty}× ${x.name}`).join(", ")}</small></div>
              {!o.done ? <button className="btn sm" onClick={() => void db.orders.update(o.id, { done: true })}>{t("served")}</button>
                : bid ? <button className="btn sm" onClick={async () => { const r = await addToRoomBill(bid, o.items); if (r.ok) await db.orders.update(o.id, { billed: true }); }}>{t("toRoom")}</button>
                : (
                  <span>
                    <button className="btn sm" onClick={() => void payOrderAtTable(o.id, "cash")}>{L === "ne" ? "नगद तिर्यो" : "Paid cash"}</button>
                    <button className="btn sm" onClick={() => void payOrderAtTable(o.id, "qr")}>{L === "ne" ? "QR तिर्यो" : "Paid QR"}</button>
                    {occupied.length > 0 && (
                      <select aria-label={L === "ne" ? "रुम बिलमा राख्ने" : "Put on a room bill"} value="" onChange={(e) => e.target.value && void addOrderToBooking(o.id, e.target.value)}>
                        <option value="">{L === "ne" ? "तिरेन → रुम बिलमा…" : "Not paid → room bill…"}</option>
                        {occupied.map((b2) => <option key={b2.id} value={b2.id}>{t("room")} {b2.room} · {b2.guest}</option>)}
                      </select>)}
                  </span>)}
            </div>);
        })}
        <p style={{ display: "none" }}>{h.name}</p>
      </div>
    </>
  );
}

export function BillScreen({ h, L, rooms, bookings, orders, sel, session, can }: P) {
  const [reprint, setReprint] = useState("");
  const t = useT(L);
  const occ = bookings.filter((b) => b.status === "occupied");
  const [pick, setPick] = useState(sel);
  const [extra, setExtra] = useState("0");
  const [cash, setCash] = useState<string | null>(null);
  const [qr, setQr] = useState("0");
  const [disc, setDisc] = useState("0");
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ billNo: string; due: number; id: string } | null>(null);
  const b = occ.find((x) => x.id === pick) ?? occ[0];
  const recent = bookings.filter((x) => x.status === "done" && x.billNo).sort((p, q) => q.updatedAt - p.updatedAt).slice(0, 8);
  const waiting = (id: string) => orders.filter((o) => !o.billed && (o.to === "R" + id || o.to.startsWith("T")));
  const finished = done ? bookings.find((x) => x.id === done.id) : undefined;
  if (done)
    return (
      <div className="card"><h2>{t("bill")} {done.billNo} ✓</h2>
        {done.due > 0 && <div className="warn">{t("due")}: {rs(done.due)}</div>}
        {finished && <BillActions L={L} h={h} b={finished} room={rooms.find((r) => r.n === finished.room)} session={session} copy={false} />}
        <button className="btn alt" onClick={() => setDone(null)}>OK</button></div>
    );
  const recentCard = recent.length > 0 && (
    <div className="card"><h3>{L === "ne" ? "हालका बिल (फेरि प्रिन्ट)" : "Recent bills (print again)"}</h3>
      {recent.map((x) => (
        <div key={x.id}>
          <div className="item"><span><b>{x.billNo}</b> · {x.room} {x.guest}</span><button className="btn sm alt" onClick={() => setReprint(reprint === x.id ? "" : x.id)}>🖨</button></div>
          {reprint === x.id && <BillActions L={L} h={h} b={x} room={rooms.find((r) => r.n === x.room)} session={session} copy />}
        </div>))}
    </div>
  );
  if (!b) return <><div className="card"><h2>{t("bill")}</h2><p>{t("noOcc")}</p></div>{recentCard}</>;
  const room = rooms.find((r) => r.n === b.room);
  const e = Math.max(0, Math.round(Number(extra) || 0));
  const roomAmt = rateOf(b, room) * b.nights, food = sumLines(b.food);
  const sub = roomAmt + food + e;
  const dc = discOf(h);
  const showDisc = dc.on && can("discount");
  const cap = maxDiscount(sub, dc);
  const d = showDisc ? Math.max(0, Math.round(Number(disc) || 0)) : 0;
  const c = calcBill(sub - Math.min(d, sub), h.bill);
  const due = c.total - paidSum(b);
  const cashV = cash ?? String(Math.max(0, due));
  const inc = h.bill.taxIncluded;
  async function out() {
    if (!b) return;
    const r: Result<{ billNo: string; due: number }> = await checkOut(b.id, e, { cash: Number(cashV) || 0, qr: Number(qr) || 0 }, d);
    if (!r.ok) return setErr(r.error === "amount" ? (d > cap ? (L === "ne" ? `छुट ${rs(cap)} (${dc.maxPct}%) भन्दा बढी हुन मिल्दैन।` : `The discount cannot be more than ${rs(cap)} (${dc.maxPct}%).`) : L === "ne" ? "भुक्तानी तिर्न बाँकी भन्दा बढी छ।" : "Payment is more than the amount due.") : r.error === "money" ? (L === "ne" ? "रकम ठूलो वा गलत छ।" : "The amount is too big or not right.") : errText(L, r.error));
    setDone({ ...r.value, id: b.id });
  }
  return (
    <>
    <div className="card"><h2>{t("bill")}</h2>
      <label htmlFor="bsel">{t("room")}</label>
      <select id="bsel" value={b.id} onChange={(e2) => { setPick(e2.target.value); setCash(null); setErr(""); setDisc("0"); }}>{occ.map((x) => <option key={x.id} value={x.id}>{x.room} · {x.guest}</option>)}</select>
      <p style={{ fontSize: 14, color: "var(--mute)" }}>{h.bill.vatInvoice ? t("invoice") : t("receipt")}{h.bill.vatInvoice && h.pan ? ` · PAN ${h.pan}` : ""}</p>
      <table className="bill"><tbody>
        <tr><td>{t("room")} {b.room} × {b.nights}</td><td>{rs(roomAmt)}</td></tr>
        <tr><td>{t("food")}</td><td>{rs(food)}</td></tr>
        <tr><td><label htmlFor="ex">{t("extras")}</label></td><td><input id="ex" type="number" min="0" inputMode="numeric" value={extra} onChange={(x) => setExtra(x.target.value)} /></td></tr>
        {d > 0 && <tr><td>{L === "ne" ? "छुट" : "Discount"}</td><td>− {rs(Math.min(d, sub))}</td></tr>}
        {inc && <tr><td colSpan={2} style={{ color: "var(--mute)", fontSize: 13 }}>{t("taxIn")}</td></tr>}
        {h.bill.svc && <tr><td>{t("svc")} {h.bill.svcPct}%{inc ? " (incl.)" : ""}</td><td>{rs(c.svc)}</td></tr>}
        {h.bill.vatInvoice && <tr><td>VAT {h.bill.vat}%{inc ? " (incl.)" : ""}</td><td>{rs(c.vat)}</td></tr>}
        <tr className="tot"><td>{t("total")}</td><td>{rs(c.total)}</td></tr>
        <tr><td>{t("advancePaid")}</td><td>− {rs(paidSum(b))}</td></tr>
        <tr className="tot"><td>{t("due")}</td><td>{rs(due)}</td></tr>
      </tbody></table>
      {showDisc && (
        <div className="note"><label htmlFor="dsc" style={{ marginTop: 0 }}>{L === "ne" ? `छुट (Rs) · बढीमा ${rs(cap)} (${dc.maxPct}%)` : `Discount (Rs) · up to ${rs(cap)} (${dc.maxPct}%)`}</label>
          <input id="dsc" type="number" min="0" max={cap} inputMode="numeric" value={disc} onChange={(x) => { setDisc(x.target.value); setCash(null); }} />
          <div>{dc.presets.map((p) => <button key={p} className="btn sm alt" onClick={() => { setDisc(String(Math.min(cap, Math.floor((sub * p) / 100)))); setCash(null); }}>{p}%</button>)}<button className="btn sm alt" onClick={() => { setDisc("0"); setCash(null); }}>0</button></div></div>)}
      {waiting(b.id).length > 0 && (
        <div className="note"><b>{L === "ne" ? "रेस्टुरेन्टका बिल बाँकी छन्" : "Restaurant orders not on a bill yet"}</b>
          {waiting(b.id).map((o) => (
            <div className="item" key={o.id}><span>{o.to.startsWith("T") ? o.to.replace("T", t("table") + " ") : t("room") + " " + b.room}<br /><small>{o.items.map((x) => `${x.qty}× ${x.name}`).join(", ")} · {rs(sumLines(o.items))}</small></span>
              <button className="btn sm" onClick={() => void addOrderToBooking(o.id, b.id)}>{L === "ne" ? "यो बिलमा थप्ने" : "Add to this bill"}</button></div>))}
        </div>)}
      <div className="grid2">
        <div><label htmlFor="pc">{t("cash")}</label><input id="pc" type="number" min="0" inputMode="numeric" value={cashV} onChange={(x) => setCash(x.target.value)} /></div>
        <div><label htmlFor="pq">{t("qr")}</label><input id="pq" type="number" min="0" inputMode="numeric" value={qr} onChange={(x) => setQr(x.target.value)} /></div>
      </div>
      {err && <div className="warn" role="alert">{err}</div>}
      <button className="btn" onClick={() => void out()}>{t("checkout")}</button>
    </div>
    {recentCard}
    </>
  );
}

function csv(rows: (string | number)[][]) {
  return "﻿" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
}

export function Money({ h, L, bookings, orders }: P) {
  const t = useT(L);
  const ne = L === "ne";
  const today = todayISO();
  // any day can be opened: nothing is ever deleted, so the old day books stay here
  const [day, setDay] = useState(today);
  const [span, setSpan] = useState({ from: addDays(today, -30), to: today });
  const isToday = (ms: number) => todayISO(new Date(ms)) === day;
  const closed = bookings.filter((b) => b.status === "done" && b.billNo && todayISO(new Date(b.outAt ?? b.updatedAt)) === day);
  const pays = bookings.flatMap((b) => b.payments.filter((p) => isToday(p.at)).map((p) => ({ ...p, who: b.guest, room: b.room })));
  const by: Record<string, number> = {};
  for (const p of pays) by[p.method] = (by[p.method] ?? 0) + (p.kind === "refund" ? -p.amount : p.amount);
  const tableSales = orders.filter((o) => o.paid && isToday(o.paid.at));
  for (const o of tableSales) by[o.paid!.method] = (by[o.paid!.method] ?? 0) + o.paid!.amount;
  function save(rows: (string | number)[][], name: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv(rows)], { type: "text/csv" }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  const download = () => {
    const rows: (string | number)[][] = [["Bill", "Room", "Guest", "From", "Nights", "Status", "Source", "Paid"]];
    for (const b of bookings) rows.push([b.billNo ?? "", b.room, b.guest, b.from, b.nights, b.status, b.src, paidSum(b)]);
    save(rows, `bookings-${today}.csv`);
  };
  // every payment and table sale between two dates, for the accountant
  const downloadSpan = () => {
    const [a, z] = span.from <= span.to ? [span.from, span.to] : [span.to, span.from];
    const rows: (string | number)[][] = [["Date", "Time", "Type", "Room/Table", "Guest", "Method", "Amount", "Bill"]];
    const inSpan = (ms: number) => { const d = todayISO(new Date(ms)); return d >= a && d <= z; };
    const all: { at: number; row: (string | number)[] }[] = [];
    for (const b of bookings) for (const p of b.payments) if (inSpan(p.at) && p.method !== "credit") all.push({ at: p.at, row: ["", "", p.kind, b.room, b.guest, p.method, p.kind === "refund" ? -p.amount : p.amount, b.billNo ?? ""] });
    for (const o of orders) if (o.paid && inSpan(o.paid.at)) all.push({ at: o.paid.at, row: ["", "", "table", o.to.replace("T", ""), "", o.paid.method, o.paid.amount, ""] });
    for (const x of all.sort((p, q) => p.at - q.at)) { const d = new Date(x.at); x.row[0] = todayISO(d); x.row[1] = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); rows.push(x.row); }
    save(rows, `money-${a}-to-${z}.csv`);
  };
  return (
    <>
    <div className="card"><h2>{t("day")} · {shortDay(day)}{day === today ? "" : ` (${day.slice(0, 4)})`}</h2>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn sm alt" aria-label="previous day" onClick={() => setDay(addDays(day, -1))}>‹</button>
        <input aria-label={ne ? "मिति" : "Date"} type="date" max={today} value={day} onChange={(e) => e.target.value && setDay(e.target.value > today ? today : e.target.value)} />
        <button className="btn sm alt" aria-label="next day" disabled={day >= today} onClick={() => setDay(addDays(day, 1))}>›</button>
        <button className="btn sm alt" disabled={day === today} onClick={() => setDay(today)}>{t("today")}</button>
      </div>
      {closed.length > 0 && <p style={{ margin: "4px 0", fontSize: 14 }}>{ne ? "यो दिन चेक-आउट भएका बिल" : "Bills closed this day"}: {closed.map((b) => b.billNo).join(", ")}</p>}
      {Object.entries(by).map(([m, v]) => <div className="item" key={m}><span>{m}</span><b>{rs(v)}</b></div>)}
      {!pays.length && !tableSales.length && <p>{t("noPay")}</p>}
      {tableSales.map((o) => <div className="item" key={o.id}><span>{L === "ne" ? "टेबल बिक्री" : "Table sale"} · {o.to.replace("T", "")}<br /><small>{o.paid!.method}</small></span><span>{rs(o.paid!.amount)}</span></div>)}
      {pays.map((p) => <div className="item" key={p.id}><span>{p.who} · {p.room}<br /><small>{p.method} · {p.kind}</small></span><span>{rs(p.amount)}</span></div>)}
      {h.feat.excel && <button className="btn alt" onClick={download}>{t("export")}</button>}
    </div>
    <div className="card"><h3>{ne ? "पुरानो हिसाब डाउनलोड" : "Download old records"}</h3>
      <p style={{ fontSize: 14, color: "var(--mute)", margin: "0 0 6px" }}>{ne ? "डेटा आफैं मेटिँदैन, कुनै दिन पनि माथि खोलेर हेर्न मिल्छ। हिसाब किताबको लागि फाइल चाहिए यहाँबाट लिनुस्।" : "Nothing is deleted by itself, so you can open any day above. For your accountant, download a file here."}</p>
      <div className="grid2">
        <div><label htmlFor="sf">{ne ? "देखि" : "From"}</label><input id="sf" type="date" max={today} value={span.from} onChange={(e) => e.target.value && setSpan({ ...span, from: e.target.value })} /></div>
        <div><label htmlFor="st">{ne ? "सम्म" : "To"}</label><input id="st" type="date" max={today} value={span.to} onChange={(e) => e.target.value && setSpan({ ...span, to: e.target.value })} /></div>
      </div>
      <button className="btn alt" onClick={downloadSpan}>{ne ? "यी मितिको पैसाको फाइल (Excel/CSV)" : "Money in these dates (Excel/CSV)"}</button>
    </div>
    </>
  );
}

export function Clean({ L, rooms }: P) {
  const t = useT(L);
  const l = rooms.filter((r) => r.st === "clean");
  return (
    <div className="card"><h2>{t("clean")}</h2>
      {l.map((r) => <div className="item" key={r.n}><span><b>{r.n}</b> {r.type}</span><button className="btn sm" onClick={() => void db.rooms.update(r.n, { st: "free" })}>{t("markClean")}</button></div>)}
      {!l.length && <p>{t("allClean")}</p>}
    </div>
  );
}

export function SettingsScreen({ h, L, rooms, can, session, onOut }: P) {
  const t = useT(L);
  const upd = (patch: Partial<Hotel>) => void db.hotel.update("main", patch);
  const bill = (patch: Partial<Hotel["bill"]>) => upd({ bill: { ...h.bill, ...patch } });
  const [src, setSrc] = useState("");
  const [log, setLog] = useState<{ at: number; action: string; detail: string }[]>([]);
  return (
    <>
      {!session && <LocalCard L={L} onOut={onOut} />}
      {can("settings.edit") && <div className="card"><h2>{t("hotelInfo")}</h2>
        <label htmlFor="hn">{t("name")}</label><input id="hn" defaultValue={h.name} onBlur={(e) => upd({ name: e.target.value.trim() || h.name })} />
        <label htmlFor="ha">{t("address")}</label><input id="ha" defaultValue={h.address} onBlur={(e) => upd({ address: e.target.value })} />
        <div className="grid2">
          <div><label htmlFor="hp">{t("phone")}</label><input id="hp" inputMode="tel" defaultValue={h.phone} onBlur={(e) => upd({ phone: e.target.value })} /></div>
          <div><label htmlFor="hv">{t("pan")}</label><input id="hv" inputMode="numeric" defaultValue={h.pan} onBlur={(e) => upd({ pan: e.target.value })} /></div>
        </div></div>}
      {can("settings.edit") && <div className="card"><h2>{t("billing")}</h2>
        <div className="sw"><div>{t("vatSwitch")}<small>{t("vatHint")}</small></div><Toggle label={t("vatSwitch")} on={h.bill.vatInvoice} onClick={() => bill({ vatInvoice: !h.bill.vatInvoice })} /></div>
        <div className="sw"><div>{t("svcSwitch")}<small>{h.bill.svcPct}%</small></div><Toggle label={t("svcSwitch")} on={h.bill.svc} onClick={() => bill({ svc: !h.bill.svc })} /></div>
        <div className="sw"><div>{t("taxInSwitch")}<small>{t("taxInHint")}</small></div><Toggle label={t("taxInSwitch")} on={h.bill.taxIncluded} onClick={() => bill({ taxIncluded: !h.bill.taxIncluded })} /></div>
        <div className="grid2">
          <div><label htmlFor="vp">VAT %</label><input id="vp" type="number" inputMode="decimal" defaultValue={h.bill.vat} onBlur={(e) => bill({ vat: Math.max(0, Number(e.target.value) || 0) })} /></div>
          <div><label htmlFor="sp">{t("svc")} %</label><input id="sp" type="number" inputMode="decimal" defaultValue={h.bill.svcPct} onBlur={(e) => bill({ svcPct: Math.max(0, Number(e.target.value) || 0) })} /></div>
        </div>
        <div className="sw"><div>{t("keepId")}<small>{t("consent")}</small></div><Toggle label={t("keepId")} on={h.bill.idPhoto} onClick={() => bill({ idPhoto: !h.bill.idPhoto })} /></div></div>}
      {(can("prices.edit") || can("rooms.manage")) && <RoomsCard L={L} rooms={rooms} cats={catsOf(h)} can={can} local={!session} />}
      {can("rooms.manage") && <CategoriesCard L={L} h={h} />}
      {can("settings.edit") && <RulesCard L={L} h={h} />}
      {can("settings.edit") && h.feat.shifts && !!session && <ShiftSetupCard L={L} h={h} />}
      {can("settings.edit") && h.feat.restaurant && <MenuCard L={L} h={h} />}
      <PrinterCard L={L} />
      {h.feat.sources && can("settings.edit") ? (
        <div className="card"><h2>{t("sources")}</h2>
          <div>{h.sources.map((s, i) => <span className="chip" key={s}>{s}<button aria-label={"remove " + s} onClick={() => upd({ sources: h.sources.filter((_, j) => j !== i) })}>✕</button></span>)}</div>
          <div className="row" style={{ marginTop: 8 }}><input aria-label="new source" placeholder={t("newSource")} value={src} onChange={(e) => setSrc(e.target.value)} />
            <button className="btn sm" onClick={() => { const v = src.trim(); if (v && !h.sources.includes(v)) upd({ sources: [...h.sources, v] }); setSrc(""); }}>＋</button></div>
        </div>) : null}
      {session && <AccountCard L={L} session={session} onOut={onOut} />}
      {can("reports.view") && <div className="card"><h2>{t("auditLog")}</h2>
        <button className="btn alt" onClick={async () => { if (session) { const r = await api("/audit"); setLog(r.s === 200 ? r.j.audit.map((x: { at: number; action: string; detail: string; user: string | null }) => ({ at: x.at, action: x.action, detail: `${x.user ?? ""} ${x.detail}` })) : []); } else setLog(await db.audit.orderBy("at").reverse().limit(20).toArray()); }}>{t("auditLog")}</button>
        {log.map((a, i) => <div className="item" key={i}><span>{a.action}<br /><small>{a.detail}</small></span><small>{new Date(a.at).toLocaleString()}</small></div>)}
      </div>}
    </>
  );
}

