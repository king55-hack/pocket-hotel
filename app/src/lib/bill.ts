import type { BillSettings } from "./types";

export type BillResult = { base: number; svc: number; vat: number; total: number };

// All money is whole rupees. In "tax included" mode the entered prices already contain
// service charge and VAT, so the total never changes and we only show the parts.
// In "added on top" mode service charge is added first, then VAT is charged on (base + service).
export function calcBill(subtotal: number, s: BillSettings): BillResult {
  const svcRate = s.svc ? s.svcPct / 100 : 0;
  const vatRate = s.vatInvoice ? s.vat / 100 : 0;
  if (s.taxIncluded) {
    const f = (1 + svcRate) * (1 + vatRate);
    const base = Math.round(subtotal / f);
    const svc = Math.round(base * svcRate);
    const vat = subtotal - base - svc;
    return { base, svc, vat, total: subtotal };
  }
  const svc = Math.round(subtotal * svcRate);
  const vat = Math.round((subtotal + svc) * vatRate);
  return { base: subtotal, svc, vat, total: subtotal + svc + vat };
}

export function sumLines(lines: { qty: number; price: number }[]): number {
  return lines.reduce((a, l) => a + l.qty * l.price, 0);
}
