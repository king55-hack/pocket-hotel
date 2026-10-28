export const toBlob = (bytes: Uint8Array, mime: string) => new Blob([bytes as unknown as BlobPart], { type: mime })

export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/**
 * Hands a file to the phone's share sheet (mail, WhatsApp, Drive, Save to Files) when it has one,
 * and otherwise saves it. On a PC it simply downloads.
 */
export async function shareOrSave(blob: Blob, filename: string, title: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const file = new File([blob], filename, { type: blob.type })
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean }
  const phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  if (phone && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title }); return 'shared' } catch (e) { if ((e as { name?: string })?.name === 'AbortError') return 'cancelled' }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 30000)
  return 'saved'
}

/** Saves to the computer without opening the share sheet (used when the person asked for a download). */
export function saveFile(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 30000)
}
