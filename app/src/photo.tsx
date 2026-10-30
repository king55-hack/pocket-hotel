import { useEffect, useState } from "react";
import { API_URL } from "./api";

const cache = new Map<string, Promise<string>>();

/**
 * A menu photo lives on the server and is fetched by its id. It is turned into a local blob first, so the page's
 * strict content policy (images only from itself) stays as it is.
 */
export function photoSrc(code: string, id: string): Promise<string> {
  const k = code + "/" + id;
  let p = cache.get(k);
  if (!p) {
    p = fetch(`${API_URL}/guest/photo/${encodeURIComponent(code)}/${encodeURIComponent(id)}`)
      .then((r) => { if (!r.ok) throw new Error("photo"); return r.blob(); })
      .then((b) => URL.createObjectURL(b));
    p.catch(() => cache.delete(k)); // try again next time
    cache.set(k, p);
  }
  return p;
}

export function Photo({ code, id, size = 64, alt = "" }: { code: string; id: string; size?: number; alt?: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    setSrc("");
    if (id) photoSrc(code, id).then((u) => live && setSrc(u), () => {});
    return () => { live = false; };
  }, [code, id]);
  const box = { width: size, height: size, borderRadius: 10, flex: "none" as const, background: "var(--pri2)", objectFit: "cover" as const };
  return src ? <img src={src} alt={alt} style={box} /> : <div style={box} aria-hidden="true" />;
}

/** Shrinks a picture from the camera or gallery to a small JPEG (base64, no prefix) that the server accepts. */
export async function shrinkPhoto(file: File, side = 640, maxBytes = 80_000): Promise<string | null> {
  if (!file.type.startsWith("image/") || file.size > 25 * 1024 * 1024) return null;
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { return null; }
  const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(bmp.width * k));
  cv.height = Math.max(1, Math.round(bmp.height * k));
  cv.getContext("2d")!.drawImage(bmp, 0, 0, cv.width, cv.height);
  for (const q of [0.78, 0.66, 0.54, 0.42, 0.3]) {
    const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, "image/jpeg", q));
    if (blob && blob.size <= maxBytes) return toBase64(new Uint8Array(await blob.arrayBuffer()));
  }
  return null;
}

function toBase64(b: Uint8Array) {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
