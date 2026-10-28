export const REPO_URL = "https://github.com/king55-hack/pocket-hotel";

/**
 * The sign-in code email. Inline styles and tables only, because mail apps ignore most other CSS.
 * The code is plain digits with no spaces, so one tap or double-tap selects all of it for copying.
 */
export function otpEmail(code: string, appUrl: string) {
  const subject = `${code} · Pocket Hotel कोड / code`;
  const text =
    `Pocket Hotel\n\n` +
    `तपाईंको प्रमाणीकरण कोड / Your verification code:\n\n${code}\n\n` +
    `यो कोड १० मिनेटसम्म मान्य छ। कसैलाई नदिनुस्।\nThis code is valid for 10 minutes. Do not share it with anyone.\n\n` +
    `एप / App: ${appUrl}\nGitHub: ${REPO_URL}\n\n` +
    `यो कोड तपाईंले मागेको होइन भने यो इमेल बेवास्ता गर्नुस्, वा एडमिनलाई सम्पर्क गर्नुस्।\n` +
    `If you did not ask for this code, ignore this email or contact the admin.\n`;

  const html = `<!doctype html>
<html lang="ne"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>Pocket Hotel</title>
<style>
@media (prefers-color-scheme: dark){
  .bg{background:#14181c !important}.card{background:#1d2328 !important}.ink{color:#eef1f4 !important}.mute{color:#9aa4af !important}
  .codebox{background:#173a35 !important}.code{color:#7fe0cc !important}.line{border-color:#2c353d !important}
}
</style></head>
<body class="bg" style="margin:0;padding:0;background:#f1efe8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">तपाईंको कोड ${code} · Your code ${code}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:#f1efe8;"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;">
    <tr><td style="padding:0 4px 14px 4px;font:700 18px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f6b5c;">
      <span style="display:inline-block;background:#0f6b5c;color:#fff;border-radius:9px;padding:7px 9px;margin-right:8px;font-size:16px;">🏨</span>Pocket Hotel
    </td></tr>
    <tr><td class="card" style="background:#ffffff;border-radius:20px;padding:30px 26px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
      <div class="ink" style="font-size:22px;line-height:1.3;font-weight:700;color:#1f2a37;">तपाईंको प्रमाणीकरण कोड</div>
      <div class="mute" style="font-size:15px;line-height:1.5;color:#6b7280;margin-top:4px;">Your verification code</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 10px 0;"><tr><td align="center" class="codebox" style="background:#e3f2ef;border-radius:16px;padding:22px 10px;">
        <span class="code" style="display:inline-block;font:700 42px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:10px;color:#0f6b5c;-webkit-user-select:all;user-select:all;padding-left:10px;">${code}</span>
      </td></tr></table>
      <div class="mute" style="text-align:center;font-size:13px;color:#6b7280;margin-bottom:22px;">कोडमा थिच्नुस् र कपी गर्नुस् · Tap the code to select and copy</div>
      <div class="ink" style="font-size:15px;line-height:1.6;color:#1f2a37;">
        यो कोड <b>१० मिनेट</b> सम्म मान्य छ। कसैलाई नदिनुस्।<br>
        <span class="mute" style="color:#6b7280;">Valid for 10 minutes. Never share it with anyone.</span>
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px 0;"><tr><td style="background:#0f6b5c;border-radius:12px;">
        <a href="${appUrl}" style="display:inline-block;padding:13px 22px;font:600 16px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;">Pocket Hotel खोल्नुस् / Open app</a>
      </td></tr></table>
    </td></tr>
    <tr><td class="mute" style="padding:18px 8px 0 8px;font:13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7280;text-align:center;">
      यो कोड तपाईंले मागेको होइन भने यो इमेल बेवास्ता गर्नुस्, वा एडमिनलाई सम्पर्क गर्नुस्।<br>
      If you did not ask for this code, ignore this email or contact the admin.<br><br>
      <a href="${appUrl}" style="color:#0f6b5c;text-decoration:none;">Website</a> &nbsp;·&nbsp;
      <a href="${REPO_URL}" style="color:#0f6b5c;text-decoration:none;">GitHub</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
  return { subject, text, html };
}

