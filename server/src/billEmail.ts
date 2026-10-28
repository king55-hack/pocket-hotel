const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

/** The email that carries a bill (the PDF is attached). */
export function billEmail(hotel: string, billNo: string, summary: string) {
  const subject = `${hotel}: बिल / Bill${billNo ? " " + billNo : ""}`;
  const text =
    `${hotel}\n\n` +
    `तपाईंको बिल यो इमेलमा PDF मा संलग्न छ। धन्यवाद!\nYour bill is attached to this email as a PDF. Thank you!\n` +
    (summary ? `\n${summary}\n` : "");
  const html = `<!doctype html><html lang="ne"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"></head>
<body style="margin:0;padding:0;background:#f1efe8;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1efe8;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;"><tr><td style="background:#ffffff;border-radius:20px;padding:30px 26px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2a37;">
<div style="font-size:20px;font-weight:700;color:#0f6b5c;">${esc(hotel)}</div>
<div style="font-size:22px;line-height:1.3;font-weight:700;margin-top:14px;">तपाईंको बिल</div>
<div style="font-size:15px;color:#6b7280;margin-top:2px;">Your bill${billNo ? " · " + esc(billNo) : ""}</div>
${summary ? `<div style="margin:18px 0;padding:14px;border-radius:14px;background:#e3f2ef;font-size:16px;font-weight:600;color:#0f6b5c;">${esc(summary)}</div>` : ""}
<div style="font-size:15px;line-height:1.6;">बिल यो इमेलमा <b>PDF</b> मा संलग्न छ। धन्यवाद!<br><span style="color:#6b7280;">The bill is attached as a PDF. Thank you!</span></div>
</td></tr><tr><td style="padding:16px 8px 0;font:13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7280;text-align:center;">Pocket Hotel</td></tr></table>
</td></tr></table></body></html>`;
  return { subject, text, html };
}
