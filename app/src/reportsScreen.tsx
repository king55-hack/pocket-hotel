import { useMemo, useState } from "react";
import { Bars, HBars } from "./charts";
import { addDays, daysBetween, shortDay, todayISO } from "./lib/dates";
import { bucket, daysIn, occupancyByDay, salesByDay, short, summarize } from "./lib/report";
import type { P } from "./screens";

type Preset = "7" | "30" | "month" | "next30" | "custom";
const rs = (n: number) => "Rs " + Math.round(n).toLocaleString("en-IN");

export function Reports({ h, L, rooms, bookings, orders, can, go }: P) {
  const ne = L === "ne";
  const t = (n: string, e: string) => (ne ? n : e);
  const today = todayISO();
  const [preset, setPreset] = useState<Preset>("30");
  const [cust, setCust] = useState({ from: addDays(today, -30), to: today });
  const money = can("money.view");

  const range = useMemo(() => {
    if (preset === "7") return { from: addDays(today, -6), to: today };
    if (preset === "30") return { from: addDays(today, -29), to: today };
    if (preset === "month") return { from: today.slice(0, 8) + "01", to: today };
    if (preset === "next30") return { from: today, to: addDays(today, 29) };
    return cust.from <= cust.to ? cust : { from: cust.to, to: cust.from };
  }, [preset, cust, today]);
  const days = useMemo(() => daysIn(range.from, range.to), [range]);
  const size = days.length > 120 ? 7 : days.length > 45 ? 3 : 1;
  const labels = days.map(shortDay);

  const sales = useMemo(() => bucket(salesByDay(bookings, orders, days), labels, size), [bookings, orders, days, size]);
  const occ = useMemo(() => occupancyByDay(bookings, rooms, days), [bookings, rooms, days]);
  // an occupancy bar is a day's count, so a bucket shows the busiest day in it, not the sum
  const peak = (v: number[]) => (size <= 1 ? v : Array.from({ length: Math.ceil(v.length / size) }, (_, i) => Math.max(...v.slice(i * size, i * size + size))));
  const lab2 = size <= 1 ? labels : bucket(days.map(() => 0), labels, size).l;
  const sum = useMemo(() => summarize(h, bookings, orders, rooms, days, today), [h, bookings, orders, rooms, days, today]);

  const chip = (p: Preset, label: string) => <button key={p} className={"btn sm " + (preset === p ? "" : "alt")} onClick={() => setPreset(p)}>{label}</button>;
  const future = preset === "next30" || range.to > today;
  const tile = (label: string, value: string, sub?: string) => (
    <div className="note" style={{ margin: 0 }}><small style={{ color: "var(--mute)" }}>{label}</small><div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>{sub && <small>{sub}</small>}</div>
  );

  return (
    <>
      <div className="card"><h2>{t("रिपोर्ट", "Reports")}</h2>
        <div>{chip("7", t("७ दिन", "7 days"))}{chip("30", t("३० दिन", "30 days"))}{chip("month", t("यो महिना", "This month"))}{chip("next30", t("अबको ३० दिन", "Next 30 days"))}{chip("custom", t("आफैं मिति", "Own dates"))}</div>
        {preset === "custom" && (
          <div className="grid2">
            <div><label htmlFor="rf">{t("देखि", "From")}</label><input id="rf" type="date" value={cust.from} onChange={(e) => e.target.value && setCust({ ...cust, from: e.target.value })} /></div>
            <div><label htmlFor="rt">{t("सम्म", "To")}</label><input id="rt" type="date" value={cust.to} onChange={(e) => e.target.value && setCust({ ...cust, to: e.target.value })} /></div>
          </div>)}
        <p style={{ color: "var(--mute)", fontSize: 14, margin: "8px 0 0" }}>{shortDay(range.from)} → {shortDay(range.to)} · {days.length} {t("दिन", "days")}{size > 1 ? t(` (${size} दिन जोडेर)`, ` (${size} days per bar)`) : ""}</p>
      </div>

      <div className="grid2" style={{ marginBottom: 12 }}>
        {money && tile(t("आएको पैसा", "Money received"), rs(sum.received))}
        {money && tile(t("बिल जम्मा", "Billed"), rs(sum.billed), `${sum.bills} ${t("बिल", "bills")}${sum.unpaid ? ` · ${t("बाँकी", "due")} ${rs(sum.unpaid)}` : ""}`)}
        {tile(t("आगमन", "Arrivals"), String(sum.arrivals), `${t("रद्द", "cancelled")} ${sum.cancelled} · ${t("आएन", "no-show")} ${sum.noShow}`)}
        {tile(t("अहिले भित्र", "In house now"), `${sum.inHouse}/${rooms.length}`)}
      </div>

      {money && (
        <div className="card"><h3>{t("बिक्री (प्राप्त पैसा)", "Sales (money received)")}</h3>
          <Bars title={t("दैनिक बिक्री", "Daily sales")} labels={sales.l} series={[{ name: t("पैसा", "Money"), color: "var(--pri)", v: sales.v }]} fmt={short} />
          <small style={{ color: "var(--mute)" }}>{t("उधारो (credit) जोडिएको छैन, पैसा हातमा आएको मात्र।", "Credit (unpaid) is not counted, only money that came in.")}</small>
        </div>)}

      <div className="card"><h3>{future ? t("कोठा: बसेका र बुक भएका", "Rooms: stayed and booked") : t("भरिएका कोठा", "Rooms in use")}</h3>
        <Bars title={t("दैनिक कोठा", "Rooms per day")} labels={lab2} max={Math.max(1, rooms.length)} fmt={(n) => String(Math.round(n))}
          series={[{ name: t("बसेका / भित्र", "Stayed / in house"), color: "var(--pri)", v: peak(occ.stayed) }, { name: t("बुक भएको (आउन बाँकी)", "Booked (not arrived)"), color: "var(--warn)", v: peak(occ.booked) }]} />
        <small style={{ color: "var(--mute)" }}>{t(`जम्मा कोठा ${rooms.length}। प्रत्येक बारले त्यो दिनको कोठा संख्या देखाउँछ।`, `${rooms.length} rooms in all. Each bar is the number of rooms that day.`)}</small>
      </div>

      <div className="card"><h3>{t("पहिल्यै बुक भएका (आउन बाँकी)", "Already booked (still to come)")}</h3>
        <div className="grid2">
          {tile(t("बुकिङ", "Bookings"), String(sum.futureCount))}
          {money && tile(t("कोठा भाडा", "Room value"), rs(sum.futureValue))}
        </div>
        <button className="btn alt" onClick={() => go("stay")}>{t("बुकिङ सूची हेर्नुस्", "Open booking list")}</button>
      </div>

      {sum.bySource.length > 0 && <div className="card"><h3>{t("बुकिङ कहाँबाट आयो", "Where bookings came from")}</h3><HBars rows={sum.bySource} /></div>}
      {sum.byCategory.length > 0 && <div className="card"><h3>{t("कोठाको किसिम अनुसार (रात)", "By room category (nights)")}</h3><HBars rows={sum.byCategory} /></div>}
      {money && sum.byMethod.length > 0 && <div className="card"><h3>{t("तिरेको तरिका", "How people paid")}</h3><HBars rows={sum.byMethod} fmt={rs} /></div>}
      <p style={{ color: "var(--mute)", fontSize: 13 }}>{t("पुरानो डेटा आफैं मेटिँदैन। कुनै पनि मिति रोजेर हेर्न मिल्छ।", "Old data is never deleted. You can look at any dates.")}{daysBetween(range.from, range.to) > 399 ? t(" (एकपटकमा ४०० दिन मात्र देखिन्छ।)", " (400 days at a time.)") : ""}</p>
    </>
  );
}
