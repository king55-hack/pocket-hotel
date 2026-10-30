import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import qrcode from "qrcode-generator";
import { api } from "./api";
import { db, STARTER_MENU } from "./db";
import type { Hotel } from "./lib/types";
import type { Lang } from "./i18n";

type Rm = { n: string; key: string };

/** The link inside one room's QR code. The key is a fragment (#), so it is never sent to a server by the browser itself. */
export const guestLink = (origin: string, code: string, room: string, key: string) => `${origin}/guest.html#/${code}/${encodeURIComponent(room)}/${key}`;

function Qr({ text, px }: { text: string; px: number }) {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  const n = q.getModuleCount(), cells: string[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) cells.push(`M${c + 4} ${r + 4}h1v1h-1z`);
  return (
    <svg viewBox={`0 0 ${n + 8} ${n + 8}`} width={px} height={px} role="img" aria-label="QR code" shapeRendering="crispEdges">
      <rect width={n + 8} height={n + 8} fill="#fff" /><path d={cells.join("")} fill="#000" />
    </svg>
  );
}

/** Owner: print a QR code for every room, so guests can order food from their phone. */
export function GuestOrderCard({ L, h }: { L: Lang; h: Hotel }) {
  const t = (n: string, e: string) => (L === "ne" ? n : e);
  const [qr, setQr] = useState<{ code: string; rooms: Rm[] } | null>(null);
  const [msg, setMsg] = useState("");
  const [root, setRoot] = useState<HTMLElement | null>(null);

  // the server reads the menu from the shared hotel record, so the starter menu must be saved there once
  useEffect(() => { if (!h.menu) void db.hotel.update("main", { menu: STARTER_MENU }); }, [h.menu]);
  useEffect(() => {
    const el = document.createElement("div");
    el.id = "qr-print";
    document.body.appendChild(el);
    setRoot(el);
    return () => { el.remove(); };
  }, []);

  async function load() {
    setMsg("");
    const r = await api("/menu/qr");
    if (r.s === 200) setQr(r.j);
    else setMsg(r.j?.error === "off" ? t("यो सुविधा एडमिनले खोलेको छैन।", "The admin has not switched this on.") : r.s === 0 ? t("इन्टरनेट चाहिन्छ।", "Needs internet.") : t("केही गडबड भयो।", "Something went wrong."));
  }
  function print() {
    document.body.classList.add("qr-print");
    const done = () => { document.body.classList.remove("qr-print"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    setTimeout(() => window.print(), 50);
  }
  async function renew() {
    if (!window.confirm(t("पुराना छापिएका सबै QR चल्न छोड्छन्। नयाँ छाप्नुपर्छ। पक्का?", "All printed QR codes will stop working and you must print new ones. Sure?"))) return;
    const r = await api("/menu/qr/renew", "POST", {});
    if (r.s === 200) { setQr(null); await load(); setMsg(t("नयाँ QR बने। अब नयाँ छाप्नुहोस्।", "New codes made. Print them now.")); }
  }
  const origin = location.origin;
  return (
    <div className="card"><h2>📲 {t("कोठाबाट खाना अर्डर (QR)", "Food orders from rooms (QR)")}</h2>
      <p style={{ fontSize: 14, color: "var(--mute)", margin: "0 0 8px" }}>{t("हरेक कोठाको QR छापेर कोठामा राख्नुहोस्। ग्राहकले स्क्यान गरेर फोटो सहितको मेनु हेर्छन् र अर्डर गर्छन्। अर्डर रेस्टुरेन्टमा आउँछ → स्वीकार → भान्छा → कोठामा पुग्छ → ग्राहकले ‘पाएँ’ थिच्छन्। कोठामा ग्राहक बसेको (चेक-इन भएको) बेला मात्र अर्डर चल्छ।", "Print each room's QR and put it in the room. Guests scan it, see the menu with photos and order. The order goes to the restaurant → approve → kitchen → room → the guest taps ‘Received’. It works only while a guest is checked in to the room.")}</p>
      {!qr ? <button className="btn" onClick={() => void load()}>{t("QR देखाउने / छाप्ने", "Show / print QR codes")}</button> : (
        <>
          <div className="note">{t("हरेक कोठाको QR तल छ। कागजमा छाप्न ‘प्रिन्ट’ थिच्नुहोस् (A4 मा ६ वटा)।", "Each room's QR is below. Press Print for paper (6 per A4 page).")}</div>
          <button className="btn" onClick={print}>🖨 {t("प्रिन्ट", "Print")}</button>
          <div className="grid2" style={{ marginTop: 8 }}>
            {qr.rooms.slice(0, 4).map((r) => <div key={r.n} className="note" style={{ textAlign: "center" }}><b>{t("कोठा", "Room")} {r.n}</b><br /><Qr text={guestLink(origin, qr.code, r.n, r.key)} px={120} /></div>)}
          </div>
          {qr.rooms.length > 4 && <p style={{ fontSize: 13, color: "var(--mute)" }}>+ {qr.rooms.length - 4} {t("अरू कोठा (प्रिन्टमा सबै आउँछन्)", "more rooms (all are in the print)")}</p>}
          {!qr.rooms.length && <p>{t("पहिले कोठा थप्नुहोस्।", "Add rooms first.")}</p>}
          <button className="btn alt" onClick={() => { const r = qr.rooms[0]; if (r) window.open(guestLink(origin, qr.code, r.n, r.key), "_blank", "noopener"); }}>{t("ग्राहकले देख्ने पेज हेर्ने", "See the guest page")}</button>
          <button className="btn alt" onClick={() => void renew()}>{t("QR लीक भए नयाँ बनाउने", "Make new codes (if one leaked)")}</button>
        </>)}
      {msg && <div className="note" role="status">{msg}</div>}
      {root && qr && createPortal(
        <div className="qr-sheet">
          {qr.rooms.map((r) => (
            <div className="qr-card" key={r.n}>
              <div className="qr-hotel">{h.name}</div>
              <div className="qr-room">{t("कोठा", "Room")} {r.n}</div>
              <Qr text={guestLink(origin, qr.code, r.n, r.key)} px={260} />
              <div className="qr-how">{t("खाना अर्डर गर्न स्क्यान गर्नुहोस्", "Scan to order food")}<br />Scan to order food</div>
            </div>))}
        </div>, root)}
    </div>
  );
}
