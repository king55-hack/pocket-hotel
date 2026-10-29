import { useState } from "react";
import { db, uid } from "./db";
import type { Lang } from "./i18n";
import { DEFAULT_DISC, DEFAULT_POLICY, catsOf, discOf, policyOf, tplOf } from "./lib/policy";
import type { Hotel, RoomCat, ShiftTpl } from "./lib/types";

const T = (L: Lang) => (ne: string, en: string) => (L === "ne" ? ne : en);
const Tg = ({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) => <button className={"tg" + (on ? " on" : "")} aria-label={label} aria-pressed={on} onClick={onClick} />;
const num = (v: string, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));

/** Room categories: the owner decides the names (Single, Triple, Quad, VIP ...), how many people fit, and the usual price. */
export function CategoriesCard({ L, h }: { L: Lang; h: Hotel }) {
  const t = T(L);
  const cats = catsOf(h);
  const save = (c: RoomCat[]) => void db.hotel.update("main", { cats: c });
  const [nw, setNw] = useState({ name: "", cap: "3", price: "3000" });
  const [msg, setMsg] = useState("");
  const edit = (id: string, patch: Partial<RoomCat>) => save(cats.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  async function rename(c: RoomCat, name: string) {
    const n = name.trim();
    if (!n || n === c.name) return;
    if (cats.some((x) => x.id !== c.id && x.name.toLowerCase() === n.toLowerCase())) return setMsg(t("यो नाम पहिल्यै छ।", "This name already exists."));
    setMsg("");
    edit(c.id, { name: n });
    // rooms of this category follow the new name
    await db.rooms.filter((r) => r.type === c.name).modify({ type: n });
  }
  return (
    <div className="card"><h2>{t("कोठाका किसिम", "Room categories")}</h2>
      <p style={{ fontSize: 14, color: "var(--mute)", margin: "0 0 8px" }}>{t("आफ्नो होटल अनुसार किसिम बनाउनुस् (जस्तै ट्रिपल, क्वाड, VIP)। 'कति जना' भन्दा बढी मान्छे चेक-इन गर्न मिल्दैन।", "Make the kinds of rooms your hotel has (Triple, Quad, VIP ...). More people than 'fits' cannot be checked in.")}</p>
      {cats.map((c) => (
        <div key={c.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8, marginBottom: 8 }}>
          <input aria-label={`category name ${c.name}`} defaultValue={c.name} onBlur={(e) => void rename(c, e.target.value)} />
          <div className="row" style={{ marginTop: 6 }}>
            <div style={{ flex: 1 }}><label htmlFor={"cc" + c.id} style={{ marginTop: 0 }}>{t("कति जना", "Fits (people)")}</label><input id={"cc" + c.id} type="number" inputMode="numeric" defaultValue={c.cap} onBlur={(e) => edit(c.id, { cap: num(e.target.value, 1, 50) })} /></div>
            <div style={{ flex: 1 }}><label htmlFor={"cp" + c.id} style={{ marginTop: 0 }}>{t("सामान्य मूल्य", "Usual price")}</label><input id={"cp" + c.id} type="number" inputMode="numeric" defaultValue={c.price} onBlur={(e) => edit(c.id, { price: num(e.target.value, 0, 10_000_000) })} /></div>
            <button className="btn sm bad" style={{ alignSelf: "flex-end" }} aria-label={`delete category ${c.name}`} onClick={() => save(cats.filter((x) => x.id !== c.id))}>🗑</button>
          </div>
        </div>))}
      {msg && <div className="warn" role="alert">{msg}</div>}
      <h3>＋ {t("नयाँ किसिम", "New category")}</h3>
      <input aria-label="new category name" placeholder={t("नाम, जस्तै VIP", "Name, e.g. VIP")} value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} />
      <div className="grid2">
        <div><label htmlFor="ncc">{t("कति जना", "Fits (people)")}</label><input id="ncc" type="number" inputMode="numeric" value={nw.cap} onChange={(e) => setNw({ ...nw, cap: e.target.value })} /></div>
        <div><label htmlFor="ncp">{t("मूल्य", "Price")}</label><input id="ncp" type="number" inputMode="numeric" value={nw.price} onChange={(e) => setNw({ ...nw, price: e.target.value })} /></div>
      </div>
      <button className="btn" onClick={() => {
        const name = nw.name.trim();
        if (!name) return setMsg(t("नाम लेख्नुस्।", "Please write a name."));
        if (cats.some((x) => x.name.toLowerCase() === name.toLowerCase())) return setMsg(t("यो नाम पहिल्यै छ।", "This name already exists."));
        if (cats.length >= 40) return setMsg(t("४० भन्दा बढी किसिम हुँदैन।", "40 categories at most."));
        setMsg("");
        save([...cats, { id: uid(), name, cap: num(nw.cap, 1, 50), price: num(nw.price, 0, 10_000_000) }]);
        setNw({ name: "", cap: nw.cap, price: nw.price });
      }}>＋</button>
    </div>
  );
}

/** What happens at check-in (confirm the price with the guest) and at check-out (discounts). */
export function RulesCard({ L, h }: { L: Lang; h: Hotel }) {
  const t = T(L);
  const pol = policyOf(h), dc = discOf(h);
  const setPol = (p: Partial<typeof DEFAULT_POLICY>) => void db.hotel.update("main", { policy: { ...pol, ...p } });
  const setDisc = (p: Partial<typeof DEFAULT_DISC>) => void db.hotel.update("main", { disc: { ...dc, ...p } });
  return (
    <div className="card"><h2>{t("चेक-इन र छुटको नियम", "Check-in and discount rules")}</h2>
      <div className="sw"><div>{t("चेक-इनमा मूल्य ग्राहकसँग पक्का गर्ने", "Confirm the price with the guest at check-in")}<small>{t("स्टाफले मूल्य देख्छ र ग्राहकले मन्जुर गरेपछि मात्र चेक-इन हुन्छ", "Staff see the price, and check-in is only possible after the guest agrees")}</small></div><Tg label="confirm price" on={pol.confirmPrice} onClick={() => setPol({ confirmPrice: !pol.confirmPrice })} /></div>
      <div className="sw"><div>{t("चेक-इनमा मूल्य बदल्न दिने", "Allow changing the price at check-in")}<small>{t("मूल्य बदल्ने अधिकार (मूल्य वा छुट) भएका स्टाफलाई मात्र", "Only for staff who may change prices or give discounts")}</small></div><Tg label="edit rate" on={pol.editRate} onClick={() => setPol({ editRate: !pol.editRate })} /></div>
      <h3>{t("बिलमा छुट", "Discount on the bill")}</h3>
      <div className="sw"><div>{t("छुट दिन मिल्ने", "Discounts allowed")}<small>{t("'छुट' अधिकार भएका स्टाफले मात्र दिन्छन्", "Only staff with the 'discount' right can give it")}</small></div><Tg label="discount on" on={dc.on} onClick={() => setDisc({ on: !dc.on })} /></div>
      {dc.on && (
        <>
          <label htmlFor="dmx">{t("बढीमा कति % छुट", "Highest discount (%)")}</label>
          <input id="dmx" type="number" inputMode="numeric" min="0" max="100" defaultValue={dc.maxPct} onBlur={(e) => setDisc({ maxPct: num(e.target.value, 0, 100) })} />
          <label htmlFor="dpr">{t("छिटो बटन (% , कमाले छुट्याएर)", "Quick buttons (%, separated by commas)")}</label>
          <input id="dpr" defaultValue={dc.presets.join(", ")} onBlur={(e) => {
            const p = [...new Set(e.target.value.split(/[,\s]+/).map((x) => Number(x)).filter((x) => x > 0 && x <= 100))].slice(0, 8);
            setDisc({ presets: p.length ? p : DEFAULT_DISC.presets });
          }} />
        </>)}
    </div>
  );
}

/** The shifts the hotel works: names and times. Staff are put on these in the Shifts tab. */
export function ShiftSetupCard({ L, h }: { L: Lang; h: Hotel }) {
  const t = T(L);
  const list = tplOf(h);
  const save = (s: ShiftTpl[]) => void db.hotel.update("main", { shiftTpl: s });
  const edit = (id: string, patch: Partial<ShiftTpl>) => save(list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const [nw, setNw] = useState({ name: "", start: "09:00", end: "17:00" });
  return (
    <div className="card"><h2>{t("सिफ्टका किसिम", "Shift types")}</h2>
      <p style={{ fontSize: 14, color: "var(--mute)", margin: "0 0 8px" }}>{t("आफ्नो होटलको काम गर्ने समय बनाउनुस्। त्यसपछि 'सिफ्ट' ट्याबमा स्टाफलाई राख्नुस्।", "Set the working times of your hotel. Then put staff on them in the Shifts tab.")}</p>
      {list.map((s) => (
        <div key={s.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8, marginBottom: 8 }}>
          <input aria-label={`shift name ${s.name}`} defaultValue={s.name} onBlur={(e) => e.target.value.trim() && edit(s.id, { name: e.target.value.trim().slice(0, 30) })} />
          <div className="row" style={{ marginTop: 6 }}>
            <input aria-label={`start ${s.name}`} type="time" defaultValue={s.start} onBlur={(e) => e.target.value && edit(s.id, { start: e.target.value })} />
            <span>→</span>
            <input aria-label={`end ${s.name}`} type="time" defaultValue={s.end} onBlur={(e) => e.target.value && edit(s.id, { end: e.target.value })} />
            <button className="btn sm bad" aria-label={`delete shift ${s.name}`} onClick={() => save(list.filter((x) => x.id !== s.id))}>🗑</button>
          </div>
        </div>))}
      <input aria-label="new shift name" placeholder={t("नयाँ सिफ्टको नाम", "New shift name")} value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} />
      <div className="row" style={{ marginTop: 6 }}>
        <input aria-label="new shift start" type="time" value={nw.start} onChange={(e) => setNw({ ...nw, start: e.target.value })} /><span>→</span>
        <input aria-label="new shift end" type="time" value={nw.end} onChange={(e) => setNw({ ...nw, end: e.target.value })} />
      </div>
      <button className="btn" onClick={() => {
        const name = nw.name.trim();
        if (!name || !nw.start || !nw.end || list.length >= 12) return;
        save([...list, { id: uid(), name: name.slice(0, 30), start: nw.start, end: nw.end }]);
        setNw({ ...nw, name: "" });
      }}>＋</button>
    </div>
  );
}
