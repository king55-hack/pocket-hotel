import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "../api";
import { Photo } from "../photo";

type Dish = { id: string; name: string; price: number; cat: string; photo: string; off: boolean };
type Line = { name: string; qty: number; price: number };
type Stage = "pending" | "approved" | "cooking" | "ready" | "delivered" | "rejected";
type Ord = { id: string; items: Line[]; stage: Stage; at: number; note: string; reason: string };
type Data = { hotel: string; room: string; checkedIn: boolean; guest: string; menu: Dish[]; orders: Ord[] };
type Ref = { code: string; room: string; key: string };

type Lang = "ne" | "en";
const W: Record<string, [string, string]> = {
  menu: ["Menu", "मेनु"], orders: ["My orders", "मेरा अर्डर"], room: ["Room", "कोठा"],
  add: ["Add", "थप्ने"], soldOut: ["Sold out", "सकियो"], view: ["View order", "अर्डर हेर्ने"], total: ["Total", "जम्मा"],
  note: ["Note for the kitchen (optional)", "भान्छाका लागि सन्देश (चाहिए मात्र)"], place: ["Place order", "अर्डर पठाउने"], back: ["Keep browsing", "मेनुमा फर्कने"],
  none: ["You have not ordered yet.", "अहिलेसम्म अर्डर गर्नुभएको छैन।"], recv: ["I received it ✓", "मैले पाएँ ✓"], cancel: ["Cancel this order", "यो अर्डर रद्द गर्ने"],
  pending: ["Waiting for the restaurant to accept", "रेस्टुरेन्टले स्वीकार गर्न पर्खँदै"], approved: ["Accepted — sent to the kitchen", "स्वीकार भयो — भान्छामा पठाइयो"],
  cooking: ["Being cooked", "पकाउँदै छ"], ready: ["Ready — on its way to your room", "तयार — तपाईंको कोठातिर आउँदै"], delivered: ["Delivered. Enjoy your meal!", "पुग्यो। मीठो मानेर खानुहोस्!"],
  rejected: ["Not accepted", "स्वीकार भएन"], sent: ["Order sent. The restaurant will accept it soon.", "अर्डर पठाइयो। रेस्टुरेन्टले छिट्टै स्वीकार गर्छ।"],
  notIn: ["Ordering opens when your stay starts. Please ask at the reception.", "तपाईंको बसाइ सुरु भएपछि मात्र अर्डर गर्न मिल्छ। रिसेप्सनमा सोध्नुहोस्।"],
  badQr: ["This QR code does not work. Please ask at the reception.", "यो QR चल्दैन। रिसेप्सनमा सोध्नुहोस्।"],
  off: ["Room food ordering is not available now. Please call the reception.", "कोठामा खाना अर्डर अहिले उपलब्ध छैन। रिसेप्सनलाई फोन गर्नुहोस्।"],
  offline: ["No internet. Please check and try again.", "इन्टरनेट छैन। जाँचेर फेरि प्रयास गर्नुहोस्।"],
  many: ["You already have several orders in progress. Please wait for them first.", "तपाईंका धेरै अर्डर चलिरहेका छन्। पहिले ती पूरा हुन दिनुहोस्।"],
  gone: ["One dish is no longer available. The menu was refreshed.", "एउटा परिकार अब उपलब्ध छैन। मेनु नयाँ गरियो।"],
  locked: ["Too many tries. Please wait a few minutes.", "धेरै पटक भयो। केही मिनेट पर्खनुहोस्।"],
  error: ["Something went wrong. Please try again.", "केही गडबड भयो। फेरि प्रयास गर्नुहोस्।"],
  empty: ["The menu is empty.", "मेनु खाली छ।"], loading: ["Loading…", "लोड हुँदै…"],
  cashNote: ["You pay when you check out. The food is added to your room bill.", "पैसा चेक-आउट गर्दा तिर्ने हो। खाना कोठाको बिलमा जोडिन्छ।"],
  refused: ["Reason", "कारण"], you: ["You cancelled it", "तपाईंले रद्द गर्नुभयो"],
};
const rs = (n: number) => "Rs " + Math.round(n).toLocaleString("en-IN");

function parse(): Ref | null {
  const m = /^#\/([A-Za-z0-9]{4,12})\/([^/]+)\/([A-Za-z0-9]{10,40})$/.exec(location.hash);
  if (!m) return null;
  try { return { code: m[1].toUpperCase(), room: decodeURIComponent(m[2]), key: m[3] }; } catch { return null; }
}

async function call(path: string, body: unknown): Promise<{ s: number; j: any }> {
  try {
    const r = await fetch(API_URL + "/guest" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { s: r.status, j: await r.json().catch(() => ({})) };
  } catch { return { s: 0, j: { error: "offline" } }; }
}

const STAGES: Stage[] = ["pending", "approved", "cooking", "ready", "delivered"];

export function GuestApp() {
  const ref = useMemo(parse, []);
  const [L, setL] = useState<Lang>(() => { try { const s = localStorage.getItem("ph.glang"); if (s === "ne" || s === "en") return s; } catch { /* ignore */ } return navigator.language.toLowerCase().startsWith("ne") ? "ne" : "en"; });
  const w = (k: string) => W[k][L === "ne" ? 1 : 0];
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [fatal, setFatal] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [view, setView] = useState<"menu" | "cart" | "orders">("menu");
  const [busy, setBusy] = useState(false);
  const [sentMsg, setSentMsg] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!ref) return;
    const r = await call("/open", ref);
    if (!alive.current) return;
    if (r.s === 200) { setData(r.j); setErr(""); return; }
    const e = r.j?.error;
    if (r.s === 0) { setErr("offline"); return; }
    setFatal(e === "off" ? "off" : e === "locked" || e === "rate" ? "locked" : "badQr");
  }, [ref]);

  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  // while an order is on its way, check for news every 12 seconds (only while the page is in front)
  const active = !!data?.orders.some((o) => o.stage !== "delivered" && o.stage !== "rejected");
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { if (!document.hidden) void load(); }, 12000);
    const v = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", v);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", v); };
  }, [active, load]);

  const flip = () => { const n: Lang = L === "ne" ? "en" : "ne"; setL(n); try { localStorage.setItem("ph.glang", n); } catch { /* ignore */ } };
  const head = (
    <div className="g-head"><div><b>{data?.hotel ?? "…"}</b><small>{data ? `${w("room")} ${data.room}` : ""}</small></div><button className="g-lang" onClick={flip} aria-label="language">{L === "ne" ? "EN" : "नेपाली"}</button></div>
  );
  if (!ref || fatal) return <>{head}<main><div className="warn" role="alert">{w(fatal || "badQr")}</div></main></>;
  if (!data) return <>{head}<main>{err ? <div className="warn" role="alert">{w("offline")} <button className="btn" onClick={() => void load()}>OK</button></div> : <p>{w("loading")}</p>}</main></>;

  const dishes = data.menu;
  const byId = new Map(dishes.map((d) => [d.id, d]));
  const lines = Object.entries(cart).filter(([id, q]) => q > 0 && byId.has(id) && !byId.get(id)!.off);
  const count = lines.reduce((s, [, q]) => s + q, 0);
  const total = lines.reduce((s, [id, q]) => s + q * byId.get(id)!.price, 0);
  const set = (id: string, q: number) => setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(20, q)) }));
  const cats = [...new Set(dishes.map((d) => d.cat || ""))];
  const open = data.orders.filter((o) => o.stage !== "delivered" && o.stage !== "rejected").length;

  async function place() {
    setBusy(true); setErr("");
    const r = await call("/order", { ...ref, items: lines.map(([id, qty]) => ({ id, qty })), note });
    setBusy(false);
    if (r.s === 200) { setCart({}); setNote(""); setSentMsg(true); setView("orders"); await load(); return; }
    const e = r.j?.error;
    setErr(e === "not_checked_in" ? "notIn" : e === "too_many_open" ? "many" : e === "not_available" ? "gone" : e === "locked" || e === "rate" ? "locked" : r.s === 0 ? "offline" : "error");
    if (e === "not_available") { setView("menu"); await load(); }
  }
  async function act(path: string, id: string) {
    setBusy(true);
    await call(path, { ...ref, id });
    setBusy(false);
    await load();
  }

  return (
    <>
      {head}
      <main>
        <div className="g-tabs">
          <button className={view !== "orders" ? "on" : ""} onClick={() => setView("menu")}>{w("menu")}</button>
          <button className={view === "orders" ? "on" : ""} onClick={() => { setView("orders"); setSentMsg(false); void load(); }}>{w("orders")}{open > 0 && <span className="badge">{open}</span>}</button>
        </div>
        {!data.checkedIn && <div className="warn" role="status">{w("notIn")}</div>}
        {err && <div className="warn" role="alert">{w(err)}</div>}

        {view === "menu" && (
          <div className="card">
            {!dishes.length && <p>{w("empty")}</p>}
            {cats.map((c) => (
              <div key={c}>{c && <h3>{c}</h3>}
                {dishes.filter((d) => (d.cat || "") === c).map((d) => (
                  <div key={d.id} className={"g-dish" + (d.off ? " g-off" : "")}>
                    {d.photo && <Photo code={ref.code} id={d.photo} size={72} alt={d.name} />}
                    <div className="g-info"><b>{d.name}</b><span>{rs(d.price)}</span>{d.off && <div><span className="pill s-out">{w("soldOut")}</span></div>}</div>
                    {!d.off && data.checkedIn && ((cart[d.id] ?? 0) > 0
                      ? <div className="g-step"><button aria-label="less" onClick={() => set(d.id, (cart[d.id] ?? 0) - 1)}>−</button><span>{cart[d.id]}</span><button className="add" aria-label="more" onClick={() => set(d.id, (cart[d.id] ?? 0) + 1)}>+</button></div>
                      : <button className="btn sm" style={{ margin: 0 }} onClick={() => set(d.id, 1)}>{w("add")}</button>)}
                  </div>))}
              </div>))}
          </div>)}

        {view === "cart" && (
          <div className="card"><h2>{w("view")}</h2>
            {lines.map(([id, q]) => { const d = byId.get(id)!; return (
              <div key={id} className="g-dish"><div className="g-info"><b>{d.name}</b><span>{rs(d.price)}</span></div>
                <div className="g-step"><button aria-label="less" onClick={() => set(id, q - 1)}>−</button><span>{q}</span><button className="add" aria-label="more" onClick={() => set(id, q + 1)}>+</button></div></div>); })}
            <div className="g-total"><span>{w("total")}</span><span>{rs(total)}</span></div>
            <label htmlFor="gn">{w("note")}</label><input id="gn" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            <p style={{ fontSize: 14, color: "var(--mute)" }}>{w("cashNote")}</p>
            <button className="btn" disabled={busy || !lines.length} onClick={() => void place()}>{w("place")}</button>
            <button className="btn alt" onClick={() => setView("menu")}>{w("back")}</button>
          </div>)}

        {view === "orders" && (
          <>
            {sentMsg && <div className="note" role="status">✓ {w("sent")}</div>}
            {!data.orders.length && <div className="card"><p>{w("none")}</p></div>}
            {data.orders.map((o) => {
              const at = STAGES.indexOf(o.stage);
              return (
                <div className="card" key={o.id}>
                  <div className="row"><b>{new Date(o.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</b><b>{rs(o.items.reduce((s, l) => s + l.qty * l.price, 0))}</b></div>
                  {o.items.map((l) => <div key={l.name}>{l.qty} × {l.name}</div>)}
                  {o.note && <small>📝 {o.note}</small>}
                  {o.stage === "rejected" ? (
                    <div className="warn" role="status">{w("rejected")}{o.reason === "guest" ? ` — ${w("you")}` : o.reason ? ` — ${w("refused")}: ${o.reason}` : ""}</div>
                  ) : (
                    <>
                      <div className="g-steps" aria-hidden="true">{STAGES.map((s, i) => <i key={s} className={i <= at ? "on" : ""} />)}</div>
                      <b role="status">{w(o.stage)}</b>
                    </>)}
                  {o.stage === "ready" && <button className="btn" disabled={busy} onClick={() => void act("/received", o.id)}>{w("recv")}</button>}
                  {o.stage === "pending" && <button className="btn alt" disabled={busy} onClick={() => void act("/cancel", o.id)}>{w("cancel")}</button>}
                </div>);
            })}
          </>)}
      </main>
      {view === "menu" && count > 0 && (
        <div className="g-bar"><button className="btn" onClick={() => setView("cart")}>{w("view")} · {count} · {rs(total)}</button></div>)}
    </>
  );
}
