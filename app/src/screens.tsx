import { useState } from "react";
import { addToRoomBill, cancelBooking, changePrice, checkIn, checkOut, createBooking, loadSampleRooms, moveBooking, type Result } from "./actions";
import { db, uid } from "./db";
import { calcBill, sumLines } from "./lib/bill";
import { bookingAt, findConflicts, paidSum } from "./lib/booking";
import { addDays, shortDay, todayISO } from "./lib/dates";
import type { Booking, Hotel, Line, Order, Room } from "./lib/types";
import { tr, type Key, type Lang } from "./i18n";
import { api, type Session } from "./api";
import { AccountCard } from "./screens2";

export type Tab = "rooms" | "book" | "stay" | "food" | "bill" | "money" | "clean" | "set" | "staff";
export type P = {
  h: Hotel; L: Lang; rooms: Room[]; bookings: Booking[]; orders: Order[];
  go: (t: Tab, id?: string) => void; sel: string; can: (p: string) => boolean; session: Session | null; onOut: () => void;
  draft: { room: string; from: string } | null; setDraft: (d: { room: string; from: string } | null) => void;
};

const rs = (n: number) => "Rs " + Math.round(n).toLocaleString("en-IN");
const MENU: [string, number][] = [["Dal Bhat set", 350], ["Momo (10)", 250], ["Chowmein", 220], ["Tea", 40], ["Coffee", 90], ["Fried rice", 260]];
const useT = (L: Lang) => (k: Key) => tr(L, k);
const errText = (L: Lang, e: string) => (e === "name" ? tr(L, "needName") : e === "taken" ? tr(L, "taken") : L === "ne" ? "यो काम गर्न मिलेन। फेरि जाँच्नुहोस्।" : "Could not do this. Please check and try again.");

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return <button className={"tg" + (on ? " on" : "")} aria-label={label} aria-pressed={on} onClick={onClick} />;
}

function stateOf(r: Room, bookings: Booking[], day: string): "free" | "booked" | "occupied" | "clean" | "out" {
  if (r.st === "out") return "out";
  const b = bookingAt(bookings, r.n, day);
  if (b) return b.status === "occupied" ? "occupied" : "booked";
  return r.st === "clean" ? "clean" : "free";
}

export function Chart({ h, L, rooms, bookings, go, setDraft }: P) {
  const t = useT(L);
  const [off, setOff] = useState(0);
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
        <button className="btn" onClick={() => void loadSampleRooms()}>{t("sample")}</button>
        <button className="btn alt" onClick={() => go("set")}>{t("set")}</button>
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
        <div className="leg"><span className="pill s-free">{t("free")}</span> <span className="pill s-booked">{t("booked")}</span> <span className="pill s-occupied">{t("occupied")}</span> <span className="pill s-clean">{t("toClean")}</span></div>
        <p style={{ color: "var(--mute)", fontSize: 14, margin: "6px 0" }}>{t("tapFree")}</p>
        <div className="tbl"><table>
          <thead><tr><th />{days.map((d) => <th key={d}>{shortDay(d)}</th>)}</tr></thead>
          <tbody>{rooms.map((r) => (
            <tr key={r.n}>
              <td className="rn"><b>{r.n}</b> <small>{r.type}</small></td>
              {days.map((d) => {
                if (r.st === "out") return <td key={d} style={{ background: "var(--out)" }}>✕</td>;
                const b = bookingAt(bookings, r.n, d);
                if (b) return <td key={d} className={b.status === "occupied" ? "o" : "b"} onClick={() => go(b.status === "occupied" ? "bill" : "stay", b.id)}>{b.guest.split(" ")[0]}</td>;
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
  const [err, setErr] = useState("");
  async function save() {
    const r = await createBooking({ room, from, nights: Number(nights), guest, phone, src, advance: Number(adv) });
    if (!r.ok) return setErr(errText(L, r.error));
    setDraft(null);
    go("rooms");
  }
  return (
    <div className="card"><h2>{t("book")}</h2>
      <label htmlFor="bg">{t("guestName")}</label><input id="bg" value={guest} onChange={(e) => setGuest(e.target.value)} autoComplete="off" />
      <label htmlFor="bp">{t("phone")}</label><input id="bp" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <div className="grid2">
        <div><label htmlFor="br">{t("room")}</label><select id="br" value={room} onChange={(e) => setRoom(e.target.value)}>{open.map((r) => <option key={r.n}>{r.n}</option>)}</select></div>
        <div><label htmlFor="bn">{t("nights")}</label><input id="bn" type="number" min="1" inputMode="numeric" value={nights} onChange={(e) => setNights(e.target.value)} /></div>
      </div>
      <label htmlFor="bd">{t("arrival")}</label><input id="bd" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      <label htmlFor="bs">{t("from")}</label><select id="bs" value={src} onChange={(e) => setSrc(e.target.value)}>{h.sources.map((s) => <option key={s}>{s}</option>)}</select>
      <label htmlFor="ba">{t("advance")}</label><input id="ba" type="number" min="0" inputMode="numeric" value={adv} onChange={(e) => setAdv(e.target.value)} />
      {err && <div className="warn" role="alert">{err}</div>}
      <button className="btn" onClick={() => void save()}>{t("saveBooking")}</button>
    </div>
  );
}

export function Stay({ L, bookings, sel, go }: P) {
  const t = useT(L);
  const list = bookings.filter((b) => b.status === "booked" || b.status === "occupied").sort((a, b) => a.from.localeCompare(b.from));
  const [ci, setCi] = useState(sel);
  const [why, setWhy] = useState<{ id: string; noShow: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [f, setF] = useState({ nationality: "Nepali", persons: "1", idNo: "", visa: "", extraBeds: "0" });
  const b = bookings.find((x) => x.id === ci && x.status === "booked");
  return (
    <>
      <div className="card"><h2>{t("stay")}</h2>
        {list.map((x) => (
          <div className="item" key={x.id}>
            <div><b>{x.guest}</b><br /><small>{x.room} · {shortDay(x.from)} · {x.nights} {t("nights")} · {x.src}</small></div>
            {x.status === "booked" ? (
              <span><button className="btn sm" onClick={() => setCi(x.id)}>{t("stay")}</button><button className="btn sm alt" onClick={() => setWhy({ id: x.id, noShow: false })}>✕</button></span>
            ) : <button className="pill s-occupied" style={{ border: 0 }} onClick={() => go("bill", x.id)}>{t("occupied")}</button>}
          </div>))}
        {!list.length && <p>–</p>}
      </div>
      {why && (
        <div className="card">
          <label htmlFor="rs">{t("reason")}</label><input id="rs" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="grid2">
            <button className="btn bad" onClick={async () => { await cancelBooking(why.id, reason || "-"); setWhy(null); setReason(""); }}>{t("cancel")}</button>
            <button className="btn alt" onClick={async () => { await cancelBooking(why.id, reason || "-", true); setWhy(null); setReason(""); }}>{t("noshow")}</button>
          </div>
        </div>)}
      {b && (
        <div className="card"><h2>{b.guest}</h2>
          <div className="grid2">
            <div><label htmlFor="nat">{t("nationality")}</label><select id="nat" value={f.nationality} onChange={(e) => setF({ ...f, nationality: e.target.value })}><option>Nepali</option><option>Indian</option><option>Other</option></select></div>
            <div><label htmlFor="per">{t("persons")}</label><input id="per" type="number" min="1" value={f.persons} onChange={(e) => setF({ ...f, persons: e.target.value })} /></div>
          </div>
          <label htmlFor="idn">{t("idNo")}</label><input id="idn" value={f.idNo} onChange={(e) => setF({ ...f, idNo: e.target.value })} />
          <label htmlFor="vs">{t("visa")}</label><input id="vs" value={f.visa} onChange={(e) => setF({ ...f, visa: e.target.value })} />
          <label htmlFor="eb">{t("extraBed")}</label><select id="eb" value={f.extraBeds} onChange={(e) => setF({ ...f, extraBeds: e.target.value })}><option>0</option><option>1</option><option>2</option></select>
          <button className="btn" onClick={async () => { await checkIn(b.id, { nationality: f.nationality, persons: Math.max(1, Number(f.persons) || 1), idNo: f.idNo.trim(), visa: f.visa.trim(), extraBeds: Number(f.extraBeds) }); setCi(""); go("rooms"); }}>{t("done")}</button>
        </div>)}
    </>
  );
}

export function Food({ h, L, bookings, orders }: P) {
  const t = useT(L);
  const [cart, setCart] = useState<Line[]>([]);
  const occupied = bookings.filter((b) => b.status === "occupied");
  const [to, setTo] = useState("T1");
  const add = (name: string, price: number) => setCart((c) => (c.find((l) => l.name === name) ? c.map((l) => (l.name === name ? { ...l, qty: l.qty + 1 } : l)) : [...c, { name, qty: 1, price }]));
  return (
    <>
      <div className="card"><h2>{t("food")}</h2>
        <div className="grid2">{MENU.map(([n, p]) => <button key={n} className="btn alt" style={{ margin: 0 }} onClick={() => add(n, p)}>{n}<br /><small>{rs(p)}</small></button>)}</div></div>
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
                : <button className="btn sm" onClick={() => void db.orders.update(o.id, { billed: true })}>{t("atTable")}</button>}
            </div>);
        })}
        <p style={{ display: "none" }}>{h.name}</p>
      </div>
    </>
  );
}

export function BillScreen({ h, L, rooms, bookings, sel }: P) {
  const t = useT(L);
  const occ = bookings.filter((b) => b.status === "occupied");
  const [pick, setPick] = useState(sel);
  const [extra, setExtra] = useState("0");
  const [cash, setCash] = useState<string | null>(null);
  const [qr, setQr] = useState("0");
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ billNo: string; due: number } | null>(null);
  const b = occ.find((x) => x.id === pick) ?? occ[0];
  if (done) return <div className="card"><h2>{t("bill")} {done.billNo}</h2>{done.due > 0 && <div className="warn">{t("due")}: {rs(done.due)}</div>}<button className="btn" onClick={() => setDone(null)}>OK</button></div>;
  if (!b) return <div className="card"><h2>{t("bill")}</h2><p>{t("noOcc")}</p></div>;
  const room = rooms.find((r) => r.n === b.room);
  const e = Math.max(0, Math.round(Number(extra) || 0));
  const roomAmt = (room?.price ?? 0) * b.nights, food = sumLines(b.food);
  const c = calcBill(roomAmt + food + e, h.bill);
  const due = c.total - paidSum(b);
  const cashV = cash ?? String(Math.max(0, due));
  const inc = h.bill.taxIncluded;
  async function out() {
    if (!b) return;
    const r: Result<{ billNo: string; due: number }> = await checkOut(b.id, e, { cash: Number(cashV) || 0, qr: Number(qr) || 0 });
    if (!r.ok) return setErr(r.error === "amount" ? (L === "ne" ? "भुक्तानी तिर्न बाँकी भन्दा बढी छ।" : "Payment is more than the amount due.") : errText(L, r.error));
    setDone(r.value);
  }
  return (
    <div className="card"><h2>{t("bill")}</h2>
      <label htmlFor="bsel">{t("room")}</label>
      <select id="bsel" value={b.id} onChange={(e2) => { setPick(e2.target.value); setCash(null); setErr(""); }}>{occ.map((x) => <option key={x.id} value={x.id}>{x.room} · {x.guest}</option>)}</select>
      <p style={{ fontSize: 14, color: "var(--mute)" }}>{h.bill.vatInvoice ? t("invoice") : t("receipt")}{h.bill.vatInvoice && h.pan ? ` · PAN ${h.pan}` : ""}</p>
      <table className="bill"><tbody>
        <tr><td>{t("room")} {b.room} × {b.nights}</td><td>{rs(roomAmt)}</td></tr>
        <tr><td>{t("food")}</td><td>{rs(food)}</td></tr>
        <tr><td><label htmlFor="ex">{t("extras")}</label></td><td><input id="ex" type="number" min="0" inputMode="numeric" value={extra} onChange={(x) => setExtra(x.target.value)} /></td></tr>
        {inc && <tr><td colSpan={2} style={{ color: "var(--mute)", fontSize: 13 }}>{t("taxIn")}</td></tr>}
        {h.bill.svc && <tr><td>{t("svc")} {h.bill.svcPct}%{inc ? " (incl.)" : ""}</td><td>{rs(c.svc)}</td></tr>}
        {h.bill.vatInvoice && <tr><td>VAT {h.bill.vat}%{inc ? " (incl.)" : ""}</td><td>{rs(c.vat)}</td></tr>}
        <tr className="tot"><td>{t("total")}</td><td>{rs(c.total)}</td></tr>
        <tr><td>{t("advancePaid")}</td><td>− {rs(paidSum(b))}</td></tr>
        <tr className="tot"><td>{t("due")}</td><td>{rs(due)}</td></tr>
      </tbody></table>
      <div className="grid2">
        <div><label htmlFor="pc">{t("cash")}</label><input id="pc" type="number" min="0" inputMode="numeric" value={cashV} onChange={(x) => setCash(x.target.value)} /></div>
        <div><label htmlFor="pq">{t("qr")}</label><input id="pq" type="number" min="0" inputMode="numeric" value={qr} onChange={(x) => setQr(x.target.value)} /></div>
      </div>
      {err && <div className="warn" role="alert">{err}</div>}
      <button className="btn" onClick={() => void out()}>{t("checkout")}</button>
    </div>
  );
}

function csv(rows: (string | number)[][]) {
  return "﻿" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
}

export function Money({ h, L, bookings }: P) {
  const t = useT(L);
  const day = todayISO();
  const isToday = (ms: number) => todayISO(new Date(ms)) === day;
  const pays = bookings.flatMap((b) => b.payments.filter((p) => isToday(p.at)).map((p) => ({ ...p, who: b.guest, room: b.room })));
  const by: Record<string, number> = {};
  for (const p of pays) by[p.method] = (by[p.method] ?? 0) + (p.kind === "refund" ? -p.amount : p.amount);
  function download() {
    const rows: (string | number)[][] = [["Bill", "Room", "Guest", "From", "Nights", "Status", "Source", "Paid"]];
    for (const b of bookings) rows.push([b.billNo ?? "", b.room, b.guest, b.from, b.nights, b.status, b.src, paidSum(b)]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv(rows)], { type: "text/csv" }));
    a.download = `bookings-${day}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <div className="card"><h2>{t("day")} · {shortDay(day)}</h2>
      {Object.entries(by).map(([m, v]) => <div className="item" key={m}><span>{m}</span><b>{rs(v)}</b></div>)}
      {!pays.length && <p>{t("noPay")}</p>}
      {pays.map((p) => <div className="item" key={p.id}><span>{p.who} · {p.room}<br /><small>{p.method} · {p.kind}</small></span><span>{rs(p.amount)}</span></div>)}
      {h.feat.excel && <button className="btn alt" onClick={download}>{t("export")}</button>}
    </div>
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
  const [nr, setNr] = useState({ n: "", type: "Double", floor: "1", beds: "2", price: "2500" });
  const [log, setLog] = useState<{ at: number; action: string; detail: string }[]>([]);
  return (
    <>
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
      {(can("prices.edit") || can("rooms.manage")) && <div className="card"><h2>{t("roomPrices")}</h2>
        {rooms.map((r) => (
          <div className="row" style={{ marginBottom: 6 }} key={r.n}>
            <b style={{ width: 96 }}>{r.n} {r.type}</b>
            <input aria-label={`price ${r.n}`} type="number" inputMode="numeric" defaultValue={r.price} onBlur={(e) => void changePrice(r.n, Number(e.target.value))} />
            <button className={"btn sm " + (r.st === "out" ? "bad" : "alt")} onClick={() => void db.rooms.update(r.n, { st: r.st === "out" ? "free" : "out" })}>{r.st === "out" ? "✕" : "✓"}</button>
          </div>))}
        <h3>＋ {t("room")}</h3>
        <div className="grid2">
          <input aria-label="room no" placeholder="No." value={nr.n} onChange={(e) => setNr({ ...nr, n: e.target.value })} />
          <select aria-label="type" value={nr.type} onChange={(e) => setNr({ ...nr, type: e.target.value })}>{["Single", "Double", "Deluxe", "Family", "Dorm"].map((x) => <option key={x}>{x}</option>)}</select>
          <input aria-label="floor" type="number" placeholder="Floor" value={nr.floor} onChange={(e) => setNr({ ...nr, floor: e.target.value })} />
          <input aria-label="beds" type="number" placeholder="Beds" value={nr.beds} onChange={(e) => setNr({ ...nr, beds: e.target.value })} />
        </div>
        <input aria-label="new price" type="number" style={{ marginTop: 8 }} value={nr.price} onChange={(e) => setNr({ ...nr, price: e.target.value })} />
        <button className="btn" onClick={async () => { const n = nr.n.trim(); if (!n || (await db.rooms.get(n))) return; await db.rooms.add({ n, type: nr.type, floor: Number(nr.floor) || 1, beds: Number(nr.beds) || 1, price: Math.max(0, Number(nr.price) || 0), st: "free" }); setNr({ ...nr, n: "" }); }}>＋</button>
        {!rooms.length && <button className="btn alt" onClick={() => void loadSampleRooms()}>{t("sample")}</button>}
      </div>}
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

