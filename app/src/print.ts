import { calcBill, sumLines } from "./lib/bill";
import { shortDay } from "./lib/dates";
import type { Booking, Hotel, Room } from "./lib/types";

/**
 * Two ways to print a bill, both from the same picture of the bill:
 *  1. Bluetooth thermal printer (58 mm or 80 mm, plain ESC/POS). The bill is sent as a raster image, so Nepali letters
 *     print correctly even on printers that have no Devanagari font.
 *  2. Any printer the computer or phone already knows (USB, Wi-Fi, A4 laser, thermal with a driver) or "Save as PDF",
 *     through the browser's print window.
 */
export type Paper = "auto" | "58" | "80" | "a5" | "a4";
export type Row = { l: string; r?: string; bold?: boolean; center?: boolean; big?: boolean; rule?: boolean };

const PAPER_KEY = "ph.paper";
export function getPaper(): Paper {
  try {
    const p = localStorage.getItem(PAPER_KEY);
    if (p === "auto" || p === "58" || p === "80" || p === "a5" || p === "a4") return p;
  } catch { /* ignore */ }
  return "auto"; // let the printer's own paper decide
}
export function setPaper(p: Paper) {
  try { localStorage.setItem(PAPER_KEY, p); } catch { /* ignore */ }
}
/** Dots across the paper. 58 mm printers have 384, 80 mm have 576. */
export const widthPx = (p: Paper) => (p === "80" ? 576 : p === "58" ? 384 : p === "a5" ? 560 : 700);

/**
 * Width of a Bluetooth thermal printer: 58 or 80. A paper choice of 58/80 wins. Otherwise what was chosen for this
 * printer before, otherwise a guess from its name (many carry 58 or 80 in the name), otherwise 58 (the common small one).
 */
export function guessBtWidth(name: string): "58" | "80" {
  if (/(^|[^0-9])80([^0-9]|$)|pos-?8|rpp-?3|xp-?80|tm-?t|mht-?p80/i.test(name)) return "80";
  return "58";
}
export function btWidthFor(name: string, paper: Paper = getPaper()): "58" | "80" {
  if (paper === "58" || paper === "80") return paper;
  try {
    const v = localStorage.getItem("ph.btw:" + name);
    if (v === "58" || v === "80") return v;
  } catch { /* ignore */ }
  return guessBtWidth(name);
}
export function rememberBtWidth(name: string, w: "58" | "80") {
  try { localStorage.setItem("ph.btw:" + name, w); } catch { /* ignore */ }
}

export function drawRows(rows: Row[], w: number, scale = 1): HTMLCanvasElement {
  const k = scale;
  const size = (w > 400 ? 26 : 22) * k;
  const lh = size + 8 * k;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = (r: Row) => `${r.bold || r.big ? "700 " : ""}${r.big ? size + 6 * k : size}px "Noto Sans Devanagari", "Nirmala UI", system-ui, sans-serif`;
  const full = Math.round(w * k);

  // Long text is wrapped onto more lines instead of being squeezed.
  const wrap = (text: string, maxW: number): string[] => {
    const out: string[] = [];
    let line = "";
    const put = (word: string) => {
      const t = line ? line + " " + word : word;
      if (ctx.measureText(t).width <= maxW || !line) line = t;
      else { out.push(line); line = word; }
    };
    for (const word of text.split(" ")) {
      if (ctx.measureText(word).width <= maxW) { put(word); continue; }
      for (const ch of word) { // a single very long word: break it
        if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ""; }
        line += ch;
      }
    }
    if (line) out.push(line);
    return out.length ? out : [""];
  };

  const laid = rows.map((r) => {
    if (r.rule) return { r, lines: [] as string[], h: 12 * k };
    ctx.font = font(r);
    const maxW = r.center ? full - 4 * k : r.r ? full - 4 * k - ctx.measureText(r.r).width - 12 * k : full - 4 * k;
    const lines = wrap(r.l, Math.max(maxW, 40 * k));
    return { r, lines, h: lines.length * lh + (r.big ? 10 * k : 0) };
  });
  c.width = full;
  c.height = Math.round(laid.reduce((s, x) => s + x.h, 12 * k));
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#000";
  g.textBaseline = "top";
  let y = 4 * k;
  for (const { r, lines, h } of laid) {
    if (r.rule) {
      g.fillRect(0, y + 5 * k, c.width, 2 * k);
      y += h;
      continue;
    }
    g.font = font(r);
    lines.forEach((ln, i) => {
      const yy = y + i * lh;
      if (r.center) { g.textAlign = "center"; g.fillText(ln, c.width / 2, yy); }
      else {
        g.textAlign = "left";
        g.fillText(ln, 2 * k, yy);
        if (r.r && i === 0) { g.textAlign = "right"; g.fillText(r.r, c.width - 2 * k, yy); }
      }
    });
    y += h;
  }
  return c;
}

/** ESC/POS bytes for a picture: reset, raster bands, feed, cut. `img` is any RGBA image (canvas pixels). */
export function toEscPos(img: { width: number; height: number; data: ArrayLike<number> }): Uint8Array {
  const { width, height, data } = img;
  const wb = Math.ceil(width / 8);
  const out: number[] = [0x1b, 0x40]; // ESC @ : reset
  const band = 128;
  for (let y0 = 0; y0 < height; y0 += band) {
    const h = Math.min(band, height - y0);
    out.push(0x1d, 0x76, 0x30, 0x00, wb & 255, wb >> 8, h & 255, h >> 8); // GS v 0 : raster bit image
    for (let y = y0; y < y0 + h; y++)
      for (let xb = 0; xb < wb; xb++) {
        let byte = 0;
        for (let b = 0; b < 8; b++) {
          const x = xb * 8 + b;
          const i = (y * width + x) * 4;
          if (x < width && data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11 < 140) byte |= 0x80 >> b;
        }
        out.push(byte);
      }
  }
  out.push(0x1b, 0x64, 0x04); // feed 4 lines
  out.push(0x1d, 0x56, 0x42, 0x00); // partial cut (ignored when there is no cutter)
  return Uint8Array.from(out);
}

/* ---------- Bluetooth (Web Bluetooth, low-energy printers) ---------- */
type Chr = { properties: { write: boolean; writeWithoutResponse: boolean }; writeValue(v: Uint8Array): Promise<void>; writeValueWithoutResponse(v: Uint8Array): Promise<void> };
let chr: Chr | null = null;
let printerName = "";
const SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
];
export const btSupported = () => typeof navigator !== "undefined" && "bluetooth" in navigator;
export const printerConnected = () => !!chr;
export const connectedName = () => printerName;

export async function connectPrinter(): Promise<string> {
  const bt = (navigator as unknown as { bluetooth: { requestDevice(o: object): Promise<any> } }).bluetooth;
  const dev = await bt.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  const srv = await dev.gatt.connect();
  for (const sv of await srv.getPrimaryServices())
    for (const ch of await sv.getCharacteristics())
      if (ch.properties.write || ch.properties.writeWithoutResponse) {
        chr = ch;
        printerName = dev.name || "Printer";
        dev.addEventListener("gattserverdisconnected", () => { chr = null; });
        return printerName;
      }
  throw new Error("no-write");
}

export async function sendBytes(bytes: Uint8Array) {
  if (!chr) throw new Error("not-connected");
  for (let i = 0; i < bytes.length; i += 100) {
    const part = bytes.slice(i, i + 100);
    if (chr.properties.writeWithoutResponse) await chr.writeValueWithoutResponse(part);
    else await chr.writeValue(part);
    await new Promise((r) => setTimeout(r, 15));
  }
}

export async function printBluetooth(rows: Row[], width: "58" | "80" = btWidthFor(printerName)) {
  const c = drawRows(rows, widthPx(width));
  await sendBytes(toEscPos(c.getContext("2d")!.getImageData(0, 0, c.width, c.height)));
}

/* ---------- any printer, through the browser's print window ---------- */
export function printSystem(rows: Row[], paper: Paper = getPaper()) {
  const c = drawRows(rows, widthPx(paper), 2); // twice the dots: sharper on laser and on screen
  const old = document.getElementById("print-area");
  old?.remove();
  const area = document.createElement("div");
  area.id = "print-area";
  const img = document.createElement("img");
  img.alt = "bill";
  img.src = c.toDataURL("image/png");
  img.className = "paper-" + paper;
  area.appendChild(img);
  document.body.appendChild(area);
  let st = document.getElementById("print-page-style");
  if (!st) {
    st = document.createElement("style");
    st.id = "print-page-style";
    document.head.appendChild(st);
  }
  const thermal = paper === "58" || paper === "80";
  // auto: no paper size is forced, so the printer's own paper (chosen in the print window) is used
  st.textContent = `@page{${paper === "a4" ? "size:A4;" : paper === "a5" ? "size:A5;" : thermal ? `size:${paper}mm auto;` : ""}margin:${thermal ? "2mm" : "12mm"}}`;
  const done = () => { area.remove(); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  // open the print window once the picture is ready (or after two seconds at the latest)
  let fired = false;
  const go = () => { if (!fired) { fired = true; window.print(); } };
  img.onload = go;
  img.onerror = go;
  setTimeout(go, 2000);
  if (img.complete) go();
}

/* ---------- what is on the bill ---------- */
/** The three numbers people ask about: total, money received, still due. */
export function billTotals(h: Hotel, b: Booking, room: Room | undefined) {
  const total = calcBill((room?.price ?? 0) * b.nights + sumLines(b.food) + b.extra, h.bill).total;
  const paid = b.payments.reduce((a, x) => a + (x.method === "credit" ? 0 : x.kind === "refund" ? -x.amount : x.amount), 0);
  return { total, paid, due: Math.max(0, total - paid) };
}

export function receiptRows(h: Hotel, b: Booking, room: Room | undefined, L: "ne" | "en", opts: { copy?: boolean } = {}): Row[] {
  const t = (ne: string, en: string) => (L === "ne" ? ne : en);
  const rs = (n: number) => "Rs " + Math.round(n).toLocaleString("en-IN");
  const roomAmt = (room?.price ?? 0) * b.nights;
  const food = sumLines(b.food);
  const sub = roomAmt + food + b.extra;
  const c = calcBill(sub, h.bill);
  const inc = h.bill.taxIncluded;
  // money really received: the "credit" line only records what was left unpaid
  const paid = b.payments.reduce((a, x) => a + (x.method === "credit" ? 0 : x.kind === "refund" ? -x.amount : x.amount), 0);
  const rows: Row[] = [
    { l: h.name, center: true, big: true },
    ...(h.address ? [{ l: h.address, center: true } as Row] : []),
    ...(h.phone ? [{ l: h.phone, center: true } as Row] : []),
    ...(h.bill.vatInvoice && h.pan ? [{ l: "PAN: " + h.pan, center: true } as Row] : []),
    { l: h.bill.vatInvoice ? t("कर बीजक", "TAX INVOICE") : t("रसिद", "RECEIPT"), center: true, bold: true },
    ...(opts.copy ? [{ l: t("(प्रतिलिपि)", "(COPY)"), center: true } as Row] : []),
    { l: "", rule: true },
    { l: t("बिल नं. ", "Bill no. ") + (b.billNo ?? "-") },
    { l: t("कोठा ", "Room ") + b.room + " · " + b.guest },
    { l: `${shortDay(b.from)} · ${b.nights} ${t("रात", "nights")}` },
    { l: "", rule: true },
    { l: `${t("कोठा", "Room")} ${b.room} × ${b.nights}`, r: rs(roomAmt) },
    ...b.food.flatMap((f) => [{ l: f.name } as Row, { l: `  ${f.qty} × ${f.price}`, r: rs(f.qty * f.price) } as Row]),
    ...(b.extra ? [{ l: t("अरू", "Extras"), r: rs(b.extra) } as Row] : []),
    { l: "", rule: true },
    ...(inc ? [{ l: t("कर समावेश", "Tax included") } as Row] : []),
    ...(h.bill.svc ? [{ l: `${t("सर्भिस", "Service")} ${h.bill.svcPct}%`, r: rs(c.svc) } as Row] : []),
    ...(h.bill.vatInvoice ? [{ l: `VAT ${h.bill.vat}%`, r: rs(c.vat) } as Row] : []),
    { l: t("जम्मा", "TOTAL"), r: rs(c.total), big: true },
    { l: t("तिरेको", "Paid"), r: rs(paid) },
    ...(c.total - paid > 0 ? [{ l: t("बाँकी", "Due"), r: rs(c.total - paid), bold: true } as Row] : []),
    { l: "", rule: true },
    { l: t("धन्यवाद! फेरि आउनुहोला।", "Thank you! Visit again."), center: true },
  ];
  return rows;
}
