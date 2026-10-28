const enc = new TextEncoder()

/** A one-page PDF that is just a picture (a JPEG). Used for bills, so any phone, PC or mail app can open it. */
export function pdfFromJpeg(jpeg: Uint8Array, imgW: number, imgH: number, pageW: number, pageH: number): Uint8Array {
  const n = (x: number) => x.toFixed(2)
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let size = 0
  const push = (b: Uint8Array | string) => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); size += u.length }
  const obj = (i: number, body: Uint8Array | string, stream?: Uint8Array) => {
    offsets[i] = size
    push(`${i} 0 obj\n`)
    push(body)
    if (stream) { push('\nstream\n'); push(stream); push('\nendstream') }
    push('\nendobj\n')
  }
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(pageW)} ${n(pageH)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`)
  obj(4, `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg)
  const content = enc.encode(`q ${n(pageW)} 0 0 ${n(pageH)} 0 0 cm /Im0 Do Q`)
  obj(5, `<< /Length ${content.length} >>`, content)
  const xref = size
  let table = `xref\n0 6\n0000000000 65535 f \n`
  for (let i = 1; i <= 5; i++) table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  push(table + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(size)
  let p = 0
  for (const b of parts) { out.set(b, p); p += b.length }
  return out
}

export function dataUrlBytes(url: string): Uint8Array {
  const b = atob(url.slice(url.indexOf(',') + 1))
  const out = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i)
  return out
}

/** Bill drawn on a canvas, as a PDF. A4 gets a full-width page; thermal widths keep their natural size. */
export function pdfFromCanvas(c: HTMLCanvasElement, a4: boolean): Uint8Array {
  const pageW = a4 ? 595.28 : c.width * 0.75
  const pageH = pageW * (c.height / c.width)
  return pdfFromJpeg(dataUrlBytes(c.toDataURL('image/jpeg', 0.92)), c.width, c.height, pageW, pageH)
}
