import { describe, expect, it } from "vitest";
import { waNumber } from "../BillActions";
import { pdfFromJpeg } from "../pdf";
import { bytesToBase64 } from "../share";

describe("WhatsApp number", () => {
  it("adds Nepal's code to a normal mobile number and leaves international numbers alone", () => {
    expect(waNumber("9812345678")).toBe("9779812345678");
    expect(waNumber("98-1234 5678")).toBe("9779812345678");
    expect(waNumber("09812345678")).toBe("9779812345678");
    expect(waNumber("+977 981 2345678")).toBe("9779812345678");
    expect(waNumber("+91 98765 43210")).toBe("919876543210");
    expect(waNumber("")).toBe("");
  });
});

describe("bill PDF", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const pdf = pdfFromJpeg(jpeg, 384, 500, 288, 375);
  const text = new TextDecoder("latin1").decode(pdf);
  it("is a real one-page PDF with the picture inside", () => {
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/DCTDecode");
    expect(text).toContain("/MediaBox [0 0 288.00 375.00]");
    expect(text).toContain("/Count 1");
  });
  it("its table of offsets points at the objects", () => {
    const start = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(start, start + 4)).toBe("xref");
    const offs = [...text.slice(start).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    expect(offs).toHaveLength(5);
    offs.forEach((o, i) => expect(text.slice(o, o + 7)).toBe(`${i + 1} 0 obj`));
  });
  it("survives the trip to base64 that the email upload uses, and still starts with the PDF marker", () => {
    expect(atob(bytesToBase64(pdf).slice(0, 8)).startsWith("%PDF")).toBe(true);
  });
});
