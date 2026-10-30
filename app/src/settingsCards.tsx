import { useState } from "react";
import { api } from "./api";
import { Photo, shrinkPhoto } from "./photo";
import { addRoom, addRoomRange, changePrice, deleteRoom, loadSampleRooms, setRoomCat } from "./actions";
import { db, STARTER_MENU, uid } from "./db";
import type { Lang } from "./i18n";
import { capOf } from "./lib/policy";
import type { Hotel, MenuItem, Room, RoomCat } from "./lib/types";
import { PrintBar } from "./PrintBar";
import { getPaper, setPaper, type Paper, type Row } from "./print";

const T = (L: Lang) => (ne: string, en: string) => (L === "ne" ? ne : en);

export function RoomsCard({ L, rooms, cats, can, local }: { L: Lang; rooms: Room[]; cats: RoomCat[]; can: (p: string) => boolean; local: boolean }) {
  const t = T(L);
  const first = cats.find((c) => c.name === "Double") ?? cats[0];
  const [nr, setNr] = useState({ n: "", type: first?.name ?? "Double", floor: "1", price: String(first?.price ?? 2500) });
  const [rg, setRg] = useState({ from: "101", to: "110" });
  const [msg, setMsg] = useState("");
  const manage = can("rooms.manage");
  const chosen = cats.find((c) => c.name === nr.type);
  const base = () => ({ type: nr.type, floor: Number(nr.floor) || 1, beds: chosen?.cap ?? 1, cap: chosen?.cap, price: Number(nr.price) || 0 });
  return (
    <div className="card"><h2>{t("कोठा र मूल्य", "Rooms and prices")}</h2>
      {rooms.map((r) => (
        <div className="row" style={{ marginBottom: 6, flexWrap: "wrap" }} key={r.n}>
          <b style={{ minWidth: 70 }}>{r.n}</b>
          {manage && cats.length > 0 ? (
            <select aria-label={`category ${r.n}`} style={{ flex: 1, minWidth: 110 }} value={cats.some((c) => c.name === r.type) ? r.type : ""} onChange={(e) => { const c = cats.find((x) => x.name === e.target.value); if (c) void setRoomCat(r.n, c); }}>
              {!cats.some((c) => c.name === r.type) && <option value="">{r.type}</option>}
              {cats.map((c) => <option key={c.id} value={c.name}>{c.name} · {c.cap} {t("जना", "ppl")}</option>)}
            </select>
          ) : <small>{r.type} · {capOf(r, cats)} {t("जना", "ppl")}</small>}
          <input aria-label={`price ${r.n}`} type="number" inputMode="numeric" defaultValue={r.price} disabled={!can("prices.edit")} onBlur={(e) => void changePrice(r.n, Number(e.target.value))} />
          {manage && <button className={"btn sm " + (r.st === "out" ? "bad" : "alt")} aria-label={`out of order ${r.n}`} title={t("बिग्रेको", "Out of order")} onClick={() => void db.rooms.update(r.n, { st: r.st === "out" ? "free" : "out" })}>{r.st === "out" ? "✕" : "✓"}</button>}
          {manage && <button className="btn sm bad" aria-label={`delete room ${r.n}`} onClick={async () => {
            if (!window.confirm(t(`कोठा ${r.n} मेट्ने? पुराना बिल र बुकिङ बाँकी रहन्छन्।`, `Delete room ${r.n}? Old bookings and bills stay.`))) return;
            const x = await deleteRoom(r.n);
            setMsg(x.ok ? "" : x.error === "inuse" ? t(`कोठा ${r.n} मा बुकिङ वा पाहुना छ। पहिले रद्द वा चेक-आउट गर्नुस्।`, `Room ${r.n} has a booking or a guest. Cancel or check out first.`) : t("मेट्न मिलेन।", "Could not delete."));
          }}>🗑</button>}
        </div>))}
      {!rooms.length && <p style={{ color: "var(--mute)" }}>{t("अहिले कोठा छैन। तल थप्नुस्।", "No rooms yet. Add them below.")}</p>}
      {msg && <div className="warn" role="alert">{msg}</div>}
      {manage && (
        <>
          <h3>＋ {t("कोठा थप्ने", "Add rooms")}</h3>
          <div className="grid2">
            <div><label htmlFor="nt">{t("किसिम", "Type")}</label><select id="nt" value={nr.type} onChange={(e) => { const c = cats.find((x) => x.name === e.target.value); setNr({ ...nr, type: e.target.value, price: c ? String(c.price) : nr.price }); }}>{cats.map((c) => <option key={c.id} value={c.name}>{c.name} · {c.cap} {t("जना", "ppl")}</option>)}</select></div>
            <div><label htmlFor="np">{t("मूल्य (Rs)", "Price (Rs)")}</label><input id="np" type="number" inputMode="numeric" value={nr.price} onChange={(e) => setNr({ ...nr, price: e.target.value })} /></div>
            <div><label htmlFor="nf">{t("तल्ला", "Floor")}</label><input id="nf" type="number" inputMode="numeric" value={nr.floor} onChange={(e) => setNr({ ...nr, floor: e.target.value })} /></div>
          </div>
          <label htmlFor="nn">{t("एउटा कोठा: नम्बर", "One room: number")}</label>
          <div className="row"><input id="nn" value={nr.n} onChange={(e) => setNr({ ...nr, n: e.target.value })} />
            <button className="btn sm" onClick={async () => { const x = await addRoom({ n: nr.n, ...base() }); setMsg(x.ok ? "" : x.error === "taken" ? t("यो नम्बर पहिल्यै छ।", "This number already exists.") : t("नम्बर लेख्नुस्।", "Please write a number.")); if (x.ok) setNr({ ...nr, n: "" }); }}>＋</button></div>
          <label>{t("धेरै कोठा एकैचोटि (जस्तै १०१ देखि ११०)", "Many rooms at once (for example 101 to 110)")}</label>
          <div className="row"><input aria-label="from" type="number" inputMode="numeric" value={rg.from} onChange={(e) => setRg({ ...rg, from: e.target.value })} />
            <span>→</span><input aria-label="to" type="number" inputMode="numeric" value={rg.to} onChange={(e) => setRg({ ...rg, to: e.target.value })} />
            <button className="btn sm" onClick={async () => { const k = await addRoomRange(Number(rg.from), Number(rg.to), base()); setMsg(k ? "" : t("नम्बर जाँच्नुस् (अधिकतम २०० कोठा)।", "Check the numbers (200 rooms at most).")); }}>＋</button></div>
          {local && !rooms.length && <button className="btn alt" onClick={() => void loadSampleRooms()}>{t("नमुना कोठा हाल्नुस् (परीक्षण)", "Load sample rooms (testing)")}</button>}
        </>)}
    </div>
  );
}

export function MenuCard({ L, h, code }: { L: Lang; h: Hotel; code?: string }) {
  const t = T(L);
  const menu = h.menu ?? STARTER_MENU;
  const save = (m: MenuItem[]) => void db.hotel.update("main", { menu: m });
  const [nw, setNw] = useState({ name: "", price: "", cat: "" });
  const cats = [...new Set(menu.map((m) => m.cat).filter(Boolean))];
  const edit = (id: string, patch: Partial<MenuItem>) => save(menu.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const [err, setErr] = useState("");
  async function pick(m: MenuItem, file: File | undefined) {
    setErr("");
    if (!file) return;
    const data = await shrinkPhoto(file);
    if (!data) return setErr(t("फोटो पढ्न वा सानो बनाउन सकिएन। अर्को फोटो रोज्नुहोस्।", "Could not use this photo. Try another one."));
    const r = await api("/menu/photo", "POST", { data });
    if (r.s !== 200) return setErr(r.j?.error === "limit" ? t("फोटो धेरै भए (१००)। केही हटाउनुहोस्।", "Too many photos (100). Remove some.") : r.s === 0 ? t("इन्टरनेट चाहिन्छ।", "Needs internet.") : t("फोटो राख्न सकिएन।", "Could not save the photo."));
    if (m.photo) void api("/menu/photo/delete", "POST", { id: m.photo });
    edit(m.id, { photo: r.j.id });
  }
  const unphoto = (m: MenuItem) => { if (m.photo) void api("/menu/photo/delete", "POST", { id: m.photo }); edit(m.id, { photo: undefined }); };
  return (
    <div className="card"><h2>{t("रेस्टुरेन्ट मेनु", "Restaurant menu")}</h2>
      <datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
      {menu.map((m) => (
        <div key={m.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8, marginBottom: 8 }}>
          <input aria-label={`name ${m.name}`} defaultValue={m.name} onBlur={(e) => e.target.value.trim() && edit(m.id, { name: e.target.value.trim() })} />
          <div className="row" style={{ marginTop: 6 }}>
            <input aria-label={`price ${m.name}`} type="number" inputMode="numeric" defaultValue={m.price} onBlur={(e) => edit(m.id, { price: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
            <input aria-label={`category ${m.name}`} list="cats" defaultValue={m.cat} placeholder={t("किसिम", "Category")} onBlur={(e) => edit(m.id, { cat: e.target.value.trim() })} />
            <button className="btn sm bad" aria-label={`delete ${m.name}`} onClick={() => { if (m.photo) void api("/menu/photo/delete", "POST", { id: m.photo }); save(menu.filter((x) => x.id !== m.id)); }}>🗑</button>
          </div>
          {h.feat.guestOrder && code && (
            <div className="row" style={{ marginTop: 6, justifyContent: "flex-start", flexWrap: "wrap" }}>
              {m.photo ? <Photo code={code} id={m.photo} size={56} alt={m.name} /> : <div style={{ width: 56, height: 56, borderRadius: 10, background: "var(--pri2)", display: "grid", placeItems: "center", flex: "none" }} aria-hidden="true">🍽</div>}
              <label className="btn sm alt" style={{ margin: 0, color: "var(--pri)", fontSize: 15 }}>📷 {m.photo ? t("फोटो बदल्ने", "Change photo") : t("फोटो", "Photo")}
                <input type="file" accept="image/*" aria-label={`photo ${m.name}`} style={{ display: "none" }} onChange={(e) => { void pick(m, e.target.files?.[0]); e.target.value = ""; }} /></label>
              {m.photo && <button className="btn sm alt" onClick={() => unphoto(m)}>{t("फोटो हटाउने", "Remove photo")}</button>}
              <span className="row" style={{ gap: 6, marginLeft: "auto" }}>{t("सकियो", "Sold out")}<button className={"tg" + (m.off ? " on" : "")} aria-label={`sold out ${m.name}`} onClick={() => edit(m.id, { off: !m.off })} /></span>
            </div>)}
        </div>))}
      {err && <div className="warn" role="alert">{err}</div>}
      {!menu.length && <p style={{ color: "var(--mute)" }}>{t("मेनु खाली छ।", "The menu is empty.")}</p>}
      <h3>＋ {t("नयाँ परिकार", "New item")}</h3>
      <input aria-label="new item name" placeholder={t("नाम", "Name")} value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} />
      <div className="row" style={{ marginTop: 6 }}>
        <input aria-label="new item price" type="number" inputMode="numeric" placeholder="Rs" value={nw.price} onChange={(e) => setNw({ ...nw, price: e.target.value })} />
        <input aria-label="new item category" list="cats" placeholder={t("किसिम", "Category")} value={nw.cat} onChange={(e) => setNw({ ...nw, cat: e.target.value })} />
      </div>
      <button className="btn" onClick={() => { const name = nw.name.trim(); if (!name) return; save([...menu, { id: uid(), name, price: Math.max(0, Math.round(Number(nw.price) || 0)), cat: nw.cat.trim() }]); setNw({ name: "", price: "", cat: nw.cat }); }}>＋</button>
    </div>
  );
}

export function PrinterCard({ L }: { L: Lang }) {
  const t = T(L);
  const [paper, setP] = useState<Paper>(getPaper());
  const test = (): Row[] => [
    { l: "Pocket Hotel", center: true, big: true },
    { l: t("परीक्षण प्रिन्ट", "Test print"), center: true, bold: true },
    { l: "", rule: true },
    { l: t("कोठा १०१ × २", "Room 101 × 2"), r: "Rs 5,000" },
    { l: "नेपाली अक्षर ठीक छन्? ✓", center: true },
    { l: "", rule: true },
    { l: t("धन्यवाद!", "Thank you!"), center: true },
  ];
  return (
    <div className="card"><h2>{t("प्रिन्टर", "Printer")}</h2>
      <label htmlFor="pp">{t("कागजको चौडाइ", "Paper")}</label>
      <select id="pp" value={paper} onChange={(e) => { const v = e.target.value as Paper; setP(v); setPaper(v); }}>
        <option value="auto">{t("प्रिन्टरको आफ्नै कागज (स्वचालित, सिफारिस)", "Printer's own paper (auto, recommended)")}</option>
        <option value="58">{t("साना थर्मल प्रिन्टर (५८ mm)", "Small thermal printer (58 mm)")}</option>
        <option value="80">{t("ठूला थर्मल प्रिन्टर (८० mm)", "Big thermal printer (80 mm)")}</option>
        <option value="a5">A5</option>
        <option value="a4">A4</option>
      </select>
      <p style={{ fontSize: 14, color: "var(--mute)" }}>{t("Bluetooth प्रिन्टर: Android वा कम्प्युटरको Chrome मा चल्छ। USB/Wi-Fi/A4 प्रिन्टर: 'कुनै पनि प्रिन्टर' बाट छाप्नुस्।", "Bluetooth printer: works in Chrome on Android or a computer. USB, Wi-Fi or A4 printers: use 'Any printer'.")}</p>
      <PrintBar L={L} rows={test} />
    </div>
  );
}
