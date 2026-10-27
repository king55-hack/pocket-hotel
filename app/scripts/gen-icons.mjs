// Makes plain PNG icons (green square, white house) with no extra packages.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

function crc(buf) {
  let c, crcT = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  let r = 0xffffffff;
  for (const b of buf) r = crcT[(r ^ b) & 255] ^ (r >>> 8);
  return (r ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const roof = v > 0.25 && v < 0.5 && Math.abs(u - 0.5) < (v - 0.25) * 1.6;
      const body = v >= 0.5 && v < 0.78 && u > 0.28 && u < 0.72;
      const door = v >= 0.6 && v < 0.78 && u > 0.45 && u < 0.55;
      const white = (roof || body) && !door;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = white ? 255 : 15; raw[o + 1] = white ? 255 : 107; raw[o + 2] = white ? 255 : 92; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
for (const s of [192, 512]) writeFileSync(new URL(`../public/icon-${s}.png`, import.meta.url), png(s));
