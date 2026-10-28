import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { loadSession, onSession } from "./api";
import { db, ensureHotel, setLang } from "./db";
import { tr, type Key, type Lang } from "./i18n";
import { BillScreen, Booking as BookingScreen, Chart, Clean, Food, Money, SettingsScreen, type P, type Tab } from "./screens";
import { Bookings } from "./bookingsScreen";
import { Header } from "./header";
import { AdminPage, Login, StaffScreen } from "./screens2";
import { countPending, getSyncState, onSync, startAutoSync, syncNow } from "./sync";

type BIPEvent = Event & { prompt: () => Promise<void> };
const LOCAL = "ph.local";
const flag = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

export function App() {
  const [hash, setHash] = useState(location.hash);
  const [session, setSession] = useState(loadSession());
  const [local, setLocal] = useState(flag(LOCAL) === "1");
  const [lang, setLang] = useState<Lang>((flag("ph.lang") as Lang) || "ne");
  useEffect(() => {
    const h = () => setHash(location.hash);
    window.addEventListener("hashchange", h);
    const off = onSession(() => setSession(loadSession()));
    return () => { window.removeEventListener("hashchange", h); off(); };
  }, []);
  const flip = () => {
    const n: Lang = lang === "ne" ? "en" : "ne";
    setLang(n);
    try { localStorage.setItem("ph.lang", n); } catch { /* ignore */ }
  };
  if (hash === "#/admin") return <AdminPage L={lang} setLang={flip} />;
  if (!session && !local)
    return <Login L={lang} setLang={flip} onLocal={() => { try { localStorage.setItem(LOCAL, "1"); } catch { /* ignore */ } setLocal(true); }} onDone={(s) => setSession(s)} />;
  return <Main session={session} onOut={() => { try { localStorage.removeItem(LOCAL); } catch { /* ignore */ } setLocal(false); setSession(null); }} />;
}

function Main({ session, onOut }: { session: ReturnType<typeof loadSession>; onOut: () => void }) {
  const hotel = useLiveQuery(() => db.hotel.get("main"));
  const rooms = useLiveQuery(() => db.rooms.orderBy("n").filter((r) => !r.deleted).toArray());
  const bookings = useLiveQuery(() => db.bookings.toArray());
  const orders = useLiveQuery(() => db.orders.orderBy("at").toArray());
  const [tab, setTab] = useState<Tab>("rooms");
  const [sel, setSel] = useState<string>("");
  const [draft, setDraft] = useState<{ room: string; from: string } | null>(null);
  const [installEv, setInstallEv] = useState<BIPEvent | null>(null);
  const [sync, setSync] = useState(getSyncState());
  const [pending, setPending] = useState(0);

  useEffect(() => {
    void ensureHotel();
    const h = (e: Event) => { e.preventDefault(); setInstallEv(e as BIPEvent); };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  useEffect(() => {
    if (!session) return;
    startAutoSync();
    return onSync((s) => { setSync(s); void countPending().then(setPending); });
  }, [session]);

  if (!hotel || !rooms || !bookings || !orders) return <main />;
  const L = hotel.lang;
  const t = (k: Key) => tr(L, k);
  const can = (p: string) => !session || session.user.perms.includes(p);
  const go = (x: Tab, id = "") => { setTab(x); setSel(id); };
  const p: P = { h: hotel, L, rooms, bookings, orders, go, sel, draft, setDraft, can, session, onOut };

  const tabs: [Tab, string][] = [["rooms", "▦"]];
  if (can("booking.create")) tabs.push(["book", "＋"]);
  if (can("checkin") || can("booking.cancel") || can("booking.create")) tabs.push(["stay", "📋"]);
  if (hotel.feat.restaurant && can("restaurant")) tabs.push(["food", "🍽"]);
  if (can("checkout")) tabs.push(["bill", "🧾"]);
  if (can("money.view")) tabs.push(["money", "₨"]);
  if (hotel.feat.housekeeping && can("housekeeping")) tabs.push(["clean", "🧹"]);
  if (session && can("staff.manage")) tabs.push(["staff", "👥"]);
  tabs.push(["set", "⚙"]);
  const cur: Tab = tabs.some((x) => x[0] === tab) ? tab : "rooms";

  return (
    <>
      <Header name={hotel.name} L={L} signedIn={!!session} sync={sync} pending={pending} canInstall={!!installEv} onInstall={() => void installEv?.prompt()} onSync={() => void syncNow()} onLang={() => void setLang(L === "ne" ? "en" : "ne")} />
      <main>
        {!session && cur !== "set" && (
          <div className="note" role="status">{L === "ne" ? "परीक्षण मोड: डाटा यही डिभाइसमा मात्र छ।" : "Test mode: data stays on this device only."}{" "}
            <button className="btn sm" onClick={() => go("set")}>{L === "ne" ? "असली होटल दर्ता गर्नुस्" : "Register a real hotel"}</button></div>
        )}
        {cur === "rooms" && <Chart {...p} />}
        {cur === "book" && <BookingScreen {...p} />}
        {cur === "stay" && <Bookings {...p} />}
        {cur === "food" && <Food {...p} />}
        {cur === "bill" && <BillScreen {...p} />}
        {cur === "money" && <Money {...p} />}
        {cur === "clean" && <Clean {...p} />}
        {cur === "staff" && session && <StaffScreen L={L} session={session} />}
        {cur === "set" && <SettingsScreen {...p} />}
        {sync.status === "error" && <div className="warn" role="alert">{sync.error === "device_revoked" ? (L === "ne" ? "यो फोन बन्द गरिएको छ।" : "This phone was switched off.") : L === "ne" ? "सर्भरसँग सिंक हुन सकेन। तपाईंका परिवर्तन यो फोनमा सुरक्षित छन्।" : "Could not sync. Your changes are safe on this phone."}</div>}
        <p style={{ color: "var(--mute)", fontSize: 13 }}>{t("offline")}</p>
      </main>
      <nav>
        {tabs.map(([k, i]) => (
          <button key={k} className={cur === k ? "on" : ""} onClick={() => go(k)}>
            <span>{i}</span>
            {t(k)}
          </button>
        ))}
      </nav>
    </>
  );
}
