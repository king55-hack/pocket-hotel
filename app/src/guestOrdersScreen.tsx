import { useState } from "react";
import { kitchenQueue, pendingGuest, readyList, setStage, stageOf } from "./guestOrders";
import type { Booking, Order, OrderStage } from "./lib/types";
import type { Lang } from "./i18n";

const rs = (n: number) => "Rs " + Math.round(n).toLocaleString("en-IN");
const sum = (o: Order) => o.items.reduce((s, l) => s + l.qty * l.price, 0);

export const STAGE_WORD: Record<OrderStage, [string, string]> = {
  pending: ["Waiting for approval", "स्वीकृतिको पर्खाइमा"],
  approved: ["Approved", "स्वीकृत भयो"],
  cooking: ["Being cooked", "पकाउँदै"],
  ready: ["Ready, on the way", "तयार, ल्याउँदै"],
  delivered: ["Delivered", "पुग्यो"],
  rejected: ["Not accepted", "स्वीकार भएन"],
};
export const stageWord = (s: OrderStage, L: Lang) => STAGE_WORD[s][L === "ne" ? 1 : 0];

const ago = (at: number) => { const m = Math.max(0, Math.round((Date.now() - at) / 60000)); return m < 1 ? "now" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`; };

/** The room (or table) and the dishes of one order, written so the person can read it at a glance. */
function Lines({ o, bookings, L }: { o: Order; bookings: Booking[]; L: Lang }) {
  const bk = o.to.startsWith("R") ? bookings.find((b) => b.id === o.to.slice(1)) : undefined;
  return (
    <div>
      <b style={{ fontSize: 18 }}>{bk ? `${L === "ne" ? "कोठा" : "Room"} ${bk.room}` : o.to.replace("T", (L === "ne" ? "टेबल" : "Table") + " ")}</b> <small>{ago(o.at)}</small>
      <div>{o.items.map((x) => <div key={x.name}>{x.qty} × {x.name}</div>)}</div>
      {o.note && <div className="note" style={{ margin: "6px 0" }}>📝 {o.note}</div>}
    </div>
  );
}

const REASONS: [string, string][] = [["Sold out", "सकियो"], ["Kitchen is closed", "भान्छा बन्द छ"], ["Cannot send to this room", "यो कोठामा पठाउन मिल्दैन"]];

/** The restaurant desk: new orders from the rooms wait here until somebody approves or refuses them. */
export function GuestApprovals({ L, orders, bookings }: { L: Lang; orders: Order[]; bookings: Booking[] }) {
  const ne = L === "ne";
  const list = pendingGuest(orders);
  const [why, setWhy] = useState<Record<string, string>>({});
  return (
    <div className="card"><h2>📲 {ne ? "कोठाबाट आएका अर्डर" : "Orders from rooms"} {list.length > 0 && <span className="pill s-booked">{list.length}</span>}</h2>
      {!list.length && <p style={{ color: "var(--mute)" }}>{ne ? "नयाँ अर्डर छैन। अर्डर आउँदा यहाँ देखिन्छ।" : "No new orders. They show here when a guest orders."}</p>}
      {list.map((o) => (
        <div key={o.id} className="item" style={{ display: "block" }}>
          <Lines o={o} bookings={bookings} L={L} />
          <div className="row"><b>{rs(sum(o))}</b></div>
          <button className="btn" onClick={() => void setStage(o.id, "approved")}>✓ {ne ? "स्वीकार — भान्छामा पठाउने" : "Approve — send to kitchen"}</button>
          <div className="row" style={{ marginTop: 6 }}>
            <select aria-label={ne ? "नमान्ने कारण" : "Reason"} value={why[o.id] ?? REASONS[0][0]} onChange={(e) => setWhy({ ...why, [o.id]: e.target.value })}>
              {REASONS.map(([en, np]) => <option key={en} value={en}>{ne ? np : en}</option>)}</select>
            <button className="btn sm bad" onClick={() => void setStage(o.id, "rejected", why[o.id] ?? REASONS[0][0])}>{ne ? "नमान्ने" : "Refuse"}</button>
          </div>
        </div>))}
    </div>
  );
}

/** The kitchen: what to cook now, and what is ready for room service to carry. */
export function KitchenScreen({ L, orders, bookings, canDeliver }: { L: Lang; orders: Order[]; bookings: Booking[]; canDeliver: boolean }) {
  const ne = L === "ne";
  const queue = kitchenQueue(orders), ready = readyList(orders);
  return (
    <>
      <div className="card"><h2>🍳 {ne ? "पकाउनुपर्ने" : "To cook"} {queue.length > 0 && <span className="pill s-booked">{queue.length}</span>}</h2>
        {!queue.length && <p style={{ color: "var(--mute)" }}>{ne ? "अहिले पकाउने अर्डर छैन।" : "Nothing to cook right now."}</p>}
        {queue.map((o) => (
          <div key={o.id} className="item" style={{ display: "block" }}>
            <Lines o={o} bookings={bookings} L={L} />
            <span className={"pill " + (stageOf(o) === "cooking" ? "s-occupied" : "s-booked")}>{stageWord(stageOf(o), L)}</span>
            <div className="grid2">
              {stageOf(o) === "approved" && <button className="btn alt" onClick={() => void setStage(o.id, "cooking")}>{ne ? "पकाउन थालें" : "Start cooking"}</button>}
              <button className="btn" style={stageOf(o) === "approved" ? undefined : { gridColumn: "1 / -1" }} onClick={() => void setStage(o.id, "ready")}>✓ {ne ? "तयार भयो" : "Ready"}</button>
            </div>
          </div>))}
      </div>
      <div className="card"><h2>🛎 {ne ? "रुम सर्भिसले लैजाने" : "Ready for room service"} {ready.length > 0 && <span className="pill s-clean">{ready.length}</span>}</h2>
        {!ready.length && <p style={{ color: "var(--mute)" }}>–</p>}
        {ready.map((o) => (
          <div key={o.id} className="item" style={{ display: "block" }}>
            <Lines o={o} bookings={bookings} L={L} />
            <small>{ne ? "ग्राहकले ‘पाएँ’ थिचेपछि पूरा हुन्छ।" : "It completes when the guest taps ‘Received’."}</small>
            {canDeliver && <button className="btn alt" onClick={() => void setStage(o.id, "delivered")}>{ne ? "पुर्‍याइयो (ग्राहकले थिचेन भने)" : "Delivered (if the guest did not tap)"}</button>}
          </div>))}
      </div>
    </>
  );
}
