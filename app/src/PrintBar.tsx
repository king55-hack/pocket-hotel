import { useState } from "react";
import type { Lang } from "./i18n";
import { btSupported, btWidthFor, connectPrinter, connectedName, getPaper, printBluetooth, printSystem, printerConnected, rememberBtWidth, setPaper, type Paper, type Row } from "./print";

/** Two print buttons: a Bluetooth thermal printer, and any other printer (or PDF) through the browser. */
export function PrintBar({ L, rows }: { L: Lang; rows: () => Row[] }) {
  const ne = L === "ne";
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const bt = btSupported();
  const [paper, setP] = useState<Paper>(getPaper());
  const [btw, setBtw] = useState<"58" | "80">(printerConnected() ? btWidthFor(connectedName()) : "58");

  async function viaBluetooth() {
    setMsg("");
    setBusy(true);
    try {
      if (!printerConnected()) { await connectPrinter(); setBtw(btWidthFor(connectedName())); }
      await printBluetooth(rows(), btWidthFor(connectedName(), paper));
      setMsg(ne ? `${connectedName()} मा पठाइयो।` : `Sent to ${connectedName()}.`);
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      if (/cancel|chosen|NotFound/i.test(m)) setMsg(ne ? "प्रिन्टर रोजिएन।" : "No printer was chosen.");
      else if (m === "no-write") setMsg(ne ? "यो डिभाइसमा छाप्ने सुविधा भेटिएन। यो प्रिन्टर Bluetooth LE मा चल्दैन होला। तलको 'कुनै पनि प्रिन्टर' प्रयोग गर्नुस्।" : "This device has no printable channel. It may be a classic-Bluetooth printer. Use 'Any printer' below.");
      else setMsg(ne ? "प्रिन्टरसँग जोडिएन। प्रिन्टर खोल्नुस्, नजिक राख्नुस्, फेरि थिच्नुस्।" : "Could not reach the printer. Switch it on, bring it close and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="noprint">
      {bt && <button className="btn" disabled={busy} onClick={() => void viaBluetooth()}>🖨 {printerConnected() ? (ne ? `प्रिन्ट: ${connectedName()}` : `Print: ${connectedName()}`) : ne ? "Bluetooth प्रिन्टर जोडेर प्रिन्ट" : "Connect Bluetooth printer and print"}</button>}
      <label htmlFor="pap">{ne ? "कागजको साइज (अरू प्रिन्टरको लागि)" : "Paper size (other printers)"}</label>
      <select id="pap" value={paper} onChange={(e) => { const v = e.target.value as Paper; setP(v); setPaper(v); }}>
        <option value="auto">{ne ? "प्रिन्टरको आफ्नै कागज (स्वचालित)" : "Printer's own paper (auto)"}</option>
        <option value="58">{ne ? "थर्मल ५८ mm" : "Thermal 58 mm"}</option><option value="80">{ne ? "थर्मल ८० mm" : "Thermal 80 mm"}</option>
        <option value="a5">A5</option><option value="a4">A4</option>
      </select>
      {printerConnected() && (paper === "auto" || paper === "a4" || paper === "a5") && (
        <><label htmlFor="btw">{ne ? `${connectedName()} को चौडाइ` : `Width of ${connectedName()}`}</label>
          <select id="btw" value={btw} onChange={(e) => { const v = e.target.value as "58" | "80"; setBtw(v); rememberBtWidth(connectedName(), v); }}><option value="58">58 mm</option><option value="80">80 mm</option></select></>
      )}
      <button className="btn alt" style={{ marginTop: 8 }} onClick={() => printSystem(rows(), paper)}>🖨 {ne ? "कुनै पनि प्रिन्टर / PDF" : "Any printer / PDF"}</button>
      {!bt && <p style={{ fontSize: 14, color: "var(--mute)" }}>{ne ? "यो ब्राउजरमा Bluetooth प्रिन्टर चल्दैन (iPhone/Safari)। Android वा कम्प्युटरको Chrome प्रयोग गर्नुस्, वा माथिको 'कुनै पनि प्रिन्टर'।" : "Bluetooth printing does not work in this browser (iPhone/Safari). Use Chrome on Android or a computer, or 'Any printer'."}</p>}
      {msg && <div className="note" role="status">{msg}</div>}
    </div>
  );
}
