import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, ensureHotel } from "./db";
import { tr, type Key } from "./i18n";
import { Admin, BillScreen, Booking as BookingScreen, Chart, Clean, Food, Money, SettingsScreen, Stay, type P, type Tab } from "./screens";

type BIPEvent = Event & { prompt: () => Promise<void> };

export function App() {
  const hotel = useLiveQuery(() => db.hotel.get("main"));
  const rooms = useLiveQuery(() => db.rooms.orderBy("n").toArray());
  const bookings = useLiveQuery(() => db.bookings.toArray());
  const orders = useLiveQuery(() => db.orders.orderBy("at").toArray());
  const [tab, setTab] = useState<Tab>("rooms");
  const [sel, setSel] = useState<string>("");
  const [draft, setDraft] = useState<{ room: string; from: string } | null>(null);
  const [installEv, setInstallEv] = useState<BIPEvent | null>(null);

  useEffect(() => {
    void ensureHotel();
    const h = (e: Event) => {
      e.preventDefault();
      setInstallEv(e as BIPEvent);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  if (!hotel || !rooms || !bookings || !orders) return <main />;
  const L = hotel.lang;
  const t = (k: Key) => tr(L, k);
  const go = (x: Tab, id = "") => {
    setTab(x);
    setSel(id);
  };
  const p: P = { h: hotel, L, rooms, bookings, orders, go, sel, draft, setDraft };

  const tabs: [Tab, string][] = [["rooms", "▦"], ["book", "＋"], ["stay", "🔑"]];
  if (hotel.feat.restaurant) tabs.push(["food", "🍽"]);
  tabs.push(["bill", "🧾"], ["money", "₨"]);
  if (hotel.feat.housekeeping) tabs.push(["clean", "🧹"]);
  tabs.push(["set", "⚙"], ["admin", "🛡"]);
  const cur: Tab = tabs.some((x) => x[0] === tab) ? tab : "rooms";

  return (
    <>
      <header>
        <b>{hotel.name}</b>
        <span>
          {installEv && (
            <button className="lang" onClick={() => void installEv.prompt()}>
              {t("install")}
            </button>
          )}{" "}
          <button className="lang" onClick={() => void db.hotel.update("main", { lang: L === "ne" ? "en" : "ne" })}>
            नेपाली / EN
          </button>
        </span>
      </header>
      <main>
        {cur === "rooms" && <Chart {...p} />}
        {cur === "book" && <BookingScreen {...p} />}
        {cur === "stay" && <Stay {...p} />}
        {cur === "food" && <Food {...p} />}
        {cur === "bill" && <BillScreen {...p} />}
        {cur === "money" && <Money {...p} />}
        {cur === "clean" && <Clean {...p} />}
        {cur === "set" && <SettingsScreen {...p} />}
        {cur === "admin" && <Admin {...p} />}
        <p style={{ color: "var(--mute)", fontSize: 13 }}>{t("offline")}</p>
      </main>
      <nav>
        {tabs.map(([k, i]) => (
          <button key={k} className={cur === k ? "on" : ""} onClick={() => go(k)}>
            <span>{i}</span>
            {t(k === "rooms" ? "rooms" : k === "set" ? "set" : k)}
          </button>
        ))}
      </nav>
    </>
  );
}
