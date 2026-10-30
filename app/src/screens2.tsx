import { useEffect, useState } from "react";
import { adminApi, api, device, publicApi, saveSession, type Session } from "./api";
import { setMeta, wipeAll } from "./db";
import type { Lang } from "./i18n";
import { signOut } from "./sync";

const ERR: Record<string, [string, string]> = {
  bad_login: ["Wrong details. Check and try again.", "विवरण मिलेन। फेरि जाँच्नुहोस्।"],
  bad_code: ["Wrong or old code.", "कोड गलत वा पुरानो छ।"],
  locked: ["Too many tries. Wait 15 minutes.", "धेरै पटक गलत भयो। १५ मिनेट पर्खनुहोस्।"],
  exists: ["This email already has an account. Use Sign in.", "यो इमेलमा खाता छ। साइन इन गर्नुहोस्।"],
  mail: ["Email is not set up on the server, so no code can be sent. Tell the person who runs the server.", "सर्भरमा इमेल मिलाइएको छैन, त्यसैले कोड पठाउन सकिएन।"],
  rate: ["Too many codes asked. Try later.", "धेरै पटक कोड मागियो। पछि प्रयास गर्नुहोस्।"],
  offline: ["No connection to the server. Check internet.", "सर्भरसँग जोडिएन। इन्टरनेट जाँच्नुहोस्।"],
  device_revoked: ["This phone was switched off by the owner.", "मालिकले यो फोन बन्द गरिदिएको छ।"],
  device_conflict: ["This device is already used by another hotel.", "यो डिभाइस अर्को होटलमा प्रयोग भइसकेको छ।"],
  invalid: ["Please fill all boxes correctly.", "सबै ठाउँ ठीकसँग भर्नुहोस्।"],
};
export const errMsg = (L: Lang, e?: string) => (ERR[e ?? ""] ?? ["Something went wrong.", "केही गडबड भयो।"])[L === "ne" ? 1 : 0];

const ROLES = ["manager", "reception", "housekeeping", "restaurant", "kitchen", "other"] as const;
const ROLE_NE: Record<string, string> = { owner: "मालिक", manager: "व्यवस्थापक", reception: "रिसेप्सन", housekeeping: "सफाई", restaurant: "रेस्टुरेन्ट", kitchen: "भान्छा", other: "अन्य" };
export const PERM_LABEL: Record<string, [string, string]> = {
  "rooms.manage": ["Add/change rooms", "कोठा थप्ने/बदल्ने"], "prices.edit": ["Change prices", "मूल्य बदल्ने"], "booking.create": ["Make bookings", "बुकिङ गर्ने"],
  "booking.cancel": ["Cancel bookings", "बुकिङ रद्द गर्ने"], checkin: ["Check-in", "चेक-इन"], checkout: ["Check-out and bill", "चेक-आउट र बिल"], discount: ["Give discount", "छुट दिने"],
  restaurant: ["Restaurant orders and approving room orders", "रेस्टुरेन्ट अर्डर र कोठाको अर्डर स्वीकार"], kitchen: ["Kitchen (cook room orders)", "भान्छा (अर्डर पकाउने)"], housekeeping: ["Cleaning", "सफाई"], "money.view": ["See money", "पैसा हेर्ने"], "reports.view": ["Reports and log", "रिपोर्ट र लग"],
  "staff.manage": ["Manage staff", "स्टाफ मिलाउने"], "settings.edit": ["Hotel settings", "होटल सेटिङ"], delete: ["Reopen closed bills", "बन्द बिल फेरि खोल्ने"],
};

/* ---------- sign in / sign up ---------- */
export function Login({ L, onLocal, onDone, setLang }: { L: Lang; onLocal: () => void; onDone: (s: Session) => void; setLang: () => void }) {
  const ne = L === "ne";
  const [mode, setMode] = useState<"owner" | "staff" | "new">("owner");
  const [f, setF] = useState({ email: "", password: "", code: "", hotelName: "", name: "", hotelCode: "", username: "", pin: "" });
  const [needCode, setNeedCode] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const up = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const dev = device();

  async function finish(r: { s: number; j: any }) {
    if (r.s === 200) {
      try {
        const prev = localStorage.getItem("ph.last");
        const keep = localStorage.getItem("ph.keep") === "1"; // chosen in Settings when leaving test mode
        // A different person (or the test hotel) on this device: start clean, so nothing of it is sent to the new hotel.
        if (prev !== r.j.user.id && !keep) await wipeAll();
        localStorage.removeItem("ph.keep");
        localStorage.setItem("ph.last", r.j.user.id);
      } catch { /* ignore */ }
      await setMeta("hotelId", r.j.hotel.id);
      saveSession(r.j);
      onDone(r.j);
    } else setMsg(errMsg(L, r.j?.error));
  }
  async function go() {
    setMsg("");
    setBusy(true);
    try {
      if (mode === "staff") return await finish(await publicApi("/auth/staff", { hotelCode: f.hotelCode, username: f.username, pin: f.pin, device: dev }));
      if (mode === "owner") {
        const r = await publicApi("/auth/login", { email: f.email, password: f.password, device: dev, ...(f.code ? { code: f.code } : {}) });
        if (r.s === 401 && r.j.error === "otp_required") { setNeedCode(true); setMsg(ne ? "इमेलमा ६ अंकको कोड पठाइयो। तल लेख्नुहोस्।" : "A 6-digit code was sent to your email. Type it below."); return; }
        return await finish(r);
      }
      if (!needCode) {
        const r = await publicApi("/auth/otp", { email: f.email, purpose: "signup" });
        if (r.s !== 200) return setMsg(errMsg(L, r.j?.error));
        setNeedCode(true);
        return setMsg(ne ? "इमेलमा ६ अंकको कोड पठाइयो। तल लेख्नुहोस्।" : "A 6-digit code was sent to your email. Type it below.");
      }
      await finish(await publicApi("/auth/signup", { email: f.email, code: f.code, password: f.password, name: f.name, hotelName: f.hotelName, device: dev }));
    } finally { setBusy(false); }
  }
  const tab = (m: typeof mode, label: string) => <button className={"btn sm " + (mode === m ? "" : "alt")} onClick={() => { setMode(m); setNeedCode(false); setMsg(""); }}>{label}</button>;
  return (
    <>
      <header><b style={{ display: "flex", alignItems: "center", gap: 8 }}><img src="/favicon.png" alt="" width="28" height="28" style={{ borderRadius: 6 }} />Pocket Hotel</b><button className="lang" onClick={setLang}>नेपाली / EN</button></header>
      <main>
        <div className="card" style={{ textAlign: "center" }}><img src="/icon-192.png" alt="Pocket Hotel" width="120" height="120" style={{ borderRadius: 24 }} /></div>
        {forgot ? <ForgotCard L={L} email0={f.email} onBack={() => setForgot(false)} /> : (
        <div className="card">
          <div>{tab("owner", ne ? "मालिक" : "Owner")}{tab("staff", ne ? "स्टाफ" : "Staff")}{tab("new", ne ? "नयाँ होटल" : "New hotel")}</div>
          {mode === "staff" ? (
            <>
              <label htmlFor="hc">{ne ? "होटल कोड (मालिकसँग माग्नुहोस्)" : "Hotel code (ask the owner)"}</label><input id="hc" autoCapitalize="characters" value={f.hotelCode} onChange={up("hotelCode")} />
              <label htmlFor="un">{ne ? "लगइन नाम" : "Login name"}</label><input id="un" autoCapitalize="none" value={f.username} onChange={up("username")} />
              <label htmlFor="pn">PIN</label><input id="pn" type="password" inputMode="numeric" value={f.pin} onChange={up("pin")} />
            </>
          ) : (
            <>
              {mode === "new" && (<><label htmlFor="hn">{ne ? "होटलको नाम" : "Hotel name"}</label><input id="hn" value={f.hotelName} onChange={up("hotelName")} />
                <label htmlFor="yn">{ne ? "तपाईंको नाम" : "Your name"}</label><input id="yn" value={f.name} onChange={up("name")} /></>)}
              <label htmlFor="em">Email</label><input id="em" type="email" autoCapitalize="none" value={f.email} onChange={up("email")} />
              <label htmlFor="pw">{ne ? "पासवर्ड (कम्तीमा ८ अक्षर)" : "Password (at least 8 characters)"}</label><input id="pw" type="password" value={f.password} onChange={up("password")} />
              {needCode && (<><label htmlFor="cd">{ne ? "इमेलको ६ अंकको कोड" : "6-digit code from email"}</label><input id="cd" inputMode="numeric" value={f.code} onChange={up("code")} /></>)}
            </>
          )}
          {msg && <div className="warn" role="alert">{msg}</div>}
          <button className="btn" disabled={busy} onClick={() => void go()}>{mode === "new" && !needCode ? (ne ? "कोड पठाउनुहोस्" : "Send code") : mode === "new" ? (ne ? "होटल बनाउनुहोस्" : "Create hotel") : ne ? "साइन इन" : "Sign in"}</button>
          {mode === "owner" && <button className="btn alt" onClick={() => { setForgot(true); setMsg(""); }}>{ne ? "पासवर्ड बिर्सनुभयो?" : "Forgot password?"}</button>}
          {mode === "staff" && <p style={{ fontSize: 14, color: "var(--mute)" }}>{ne ? "PIN बिर्सनुभयो भने मालिकलाई नयाँ PIN राख्न लगाउनुहोस्।" : "Forgot your PIN? Ask the owner to set a new one."}</p>}
        </div>)}
        <div className="card">
          <p style={{ margin: 0, fontSize: 14, color: "var(--mute)" }}>{ne ? "सर्भर बिना यही डिभाइसमा मात्र चलाउन पनि मिल्छ (डाटा अरू फोनमा जाँदैन)।" : "You can also use it on this device only, without a server (data does not go to other phones)."}</p>
          <button className="btn alt" onClick={onLocal}>{ne ? "यही डिभाइसमा मात्र चलाउने" : "Use on this device only"}</button>
        </div>
      </main>
    </>
  );
}

/** The owner (or a manager) sets a new PIN for somebody who forgot theirs. It signs that person out of every phone. */
function PinReset({ L, onSave }: { L: Lang; onSave: (pin: string) => Promise<boolean> }) {
  const ne = L === "ne";
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  return (
    <div className="note"><label htmlFor="np" style={{ marginTop: 0 }}>{ne ? "PIN बिर्सेको भए नयाँ PIN (६-१० अंक)" : "Forgot the PIN? New PIN (6-10 digits)"}</label>
      <div className="row"><input id="np" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />
        <button className="btn sm" onClick={async () => { const ok = /^\d{6,10}$/.test(pin) && (await onSave(pin)); setMsg(ok ? { ok, t: ne ? "नयाँ PIN राखियो। उनीहरू सबै फोनबाट साइन आउट भए। नयाँ PIN उनीहरूलाई भन्नुहोस्।" : "New PIN saved. They were signed out everywhere. Tell them the new PIN." } : { ok, t: ne ? "PIN ६-१० अंकको र सजिलो नभएको हुनुपर्छ (जस्तै १२३४५६ हुँदैन)।" : "The PIN must be 6-10 digits and not an easy one (like 123456)." }); if (ok) setPin(""); }}>{ne ? "राख्नुहोस्" : "Set"}</button></div>
      {msg && <div className={msg.ok ? "" : "warn"} role="status">{msg.t}</div>}
    </div>
  );
}

/* ---------- staff, devices, account (owner side) ---------- */
type StaffRow = { id: string; name: string; username: string | null; role: string; perms: string[]; active: boolean; email: string | null };

export function StaffScreen({ L, session }: { L: Lang; session: Session }) {
  const ne = L === "ne";
  const [list, setList] = useState<StaffRow[]>([]);
  const [devs, setDevs] = useState<{ id: string; name: string; revoked: number; last_seen: number; user: string | null }[]>([]);
  const [open, setOpen] = useState("");
  const [nf, setNf] = useState({ name: "", username: "", pin: "", role: "reception" });
  const [msg, setMsg] = useState("");
  const myPerms = new Set(session.user.perms);
  async function load() {
    const a = await api("/staff");
    if (a.s === 200) setList(a.j.staff);
    const d = await api("/devices");
    if (d.s === 200) setDevs(d.j.devices);
  }
  useEffect(() => { void load(); }, []);
  async function add() {
    setMsg("");
    const r = await api("/staff", "POST", nf);
    if (r.s !== 200) return setMsg(r.j.error === "exists" ? (ne ? "यो लगइन नाम पहिल्यै छ।" : "This login name is taken.") : r.j.error === "invalid" ? (ne ? "नाम, लगइन नाम (३+ अक्षर, सानो) र ६-१० अंकको सजिलो नभएको PIN चाहिन्छ।" : "Need a name, a login name (3+ letters, small) and a 6-10 digit PIN that is not easy to guess.") : errMsg(L, r.j.error));
    setNf({ name: "", username: "", pin: "", role: "reception" });
    void load();
  }
  const patch = async (id: string, b: object) => { const r = await api("/staff/" + id, "POST", b); if (r.s !== 200) setMsg(errMsg(L, r.j.error)); void load(); };
  return (
    <>
      <div className="card"><h2>{ne ? "स्टाफ" : "Staff"}</h2>
        <div className="note">{ne ? "होटल कोड" : "Hotel code"}: <b style={{ fontSize: 20, letterSpacing: 2 }}>{session.hotel.code}</b><br /><small>{ne ? "स्टाफले साइन इन गर्दा यो कोड, आफ्नो लगइन नाम र PIN लेख्छन्।" : "Staff type this code, their login name and PIN to sign in."}</small></div>
        {list.map((u) => (
          <div key={u.id} className="item" style={{ display: "block" }}>
            <div className="row"><div><b>{u.name}</b> <small>{u.username ?? u.email} · {ne ? ROLE_NE[u.role] : u.role}</small>{!u.active && <span className="pill s-out"> off</span>}</div>
              {u.role !== "owner" && <button className="btn sm alt" onClick={() => setOpen(open === u.id ? "" : u.id)}>{open === u.id ? "▲" : "▼"}</button>}</div>
            {open === u.id && (
              <div>
                {Object.entries(PERM_LABEL).map(([p, lab]) => (
                  <div className="sw" key={p}><div>{lab[ne ? 1 : 0]}</div>
                    <button className={"tg" + (u.perms.includes(p) ? " on" : "")} aria-label={p} disabled={!myPerms.has(p)} onClick={() => void patch(u.id, { perms: u.perms.includes(p) ? u.perms.filter((x) => x !== p) : [...u.perms, p] })} /></div>))}
                <div className="grid2">
                  <button className="btn alt" onClick={() => void patch(u.id, { active: !u.active })}>{u.active ? (ne ? "बन्द गर्ने" : "Switch off") : (ne ? "खोल्ने" : "Switch on")}</button>
                  </div>
                <PinReset L={L} onSave={async (pin) => { const r = await api("/staff/" + u.id, "POST", { pin }); return r.s === 200; }} />
              </div>)}
          </div>))}
        <h3>＋ {ne ? "नयाँ स्टाफ" : "Add staff"}</h3>
        <label htmlFor="sn">{ne ? "नाम" : "Name"}</label><input id="sn" value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} />
        <div className="grid2">
          <div><label htmlFor="su">{ne ? "लगइन नाम" : "Login name"}</label><input id="su" autoCapitalize="none" value={nf.username} onChange={(e) => setNf({ ...nf, username: e.target.value })} /></div>
          <div><label htmlFor="sp">PIN</label><input id="sp" inputMode="numeric" value={nf.pin} onChange={(e) => setNf({ ...nf, pin: e.target.value })} /></div>
        </div>
        <label htmlFor="sr">{ne ? "भूमिका" : "Role"}</label>
        <select id="sr" value={nf.role} onChange={(e) => setNf({ ...nf, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ne ? ROLE_NE[r] : r}</option>)}</select>
        {msg && <div className="warn" role="alert">{msg}</div>}
        <button className="btn" onClick={() => void add()}>＋</button>
      </div>
      {session.user.role === "owner" && <LoginHistory L={L} />}
      <div className="card"><h2>{ne ? "फोन / कम्प्युटर" : "Phones and computers"}</h2>
        {devs.map((d) => <div className="item" key={d.id}><span>{d.name} · {d.user ?? "-"}<br /><small>{new Date(d.last_seen).toLocaleString()}</small></span>
          {d.revoked ? <span className="pill s-out">off</span> : <button className="btn sm bad" onClick={async () => { await api(`/devices/${d.id}/revoke`, "POST", {}); void load(); }}>{ne ? "बन्द" : "Switch off"}</button>}</div>)}
      </div>
    </>
  );
}

export function AccountCard({ L, session, onOut }: { L: Lang; session: Session; onOut: () => void }) {
  const ne = L === "ne";
  const [msg, setMsg] = useState("");
  const [req, setReq] = useState<any>(null);
  const [f, setF] = useState({ reasonCode: "not_using", reasonText: "", password: "" });
  const owner = session.user.role === "owner";
  useEffect(() => { if (owner) void api("/account/closure").then((r) => r.s === 200 && setReq(r.j.request)); }, [owner]);
  async function out() {
    if ((await signOut()) === "ok") return onOut();
    if (window.confirm(ne ? "केही परिवर्तन सर्भरमा पुगेको छैन (इन्टरनेट छैन)। साइन आउट गरे ती हराउँछन्। साइन आउट गर्ने?" : "Some changes are not on the server yet (no internet). Signing out will lose them. Sign out anyway?")) {
      await signOut(true);
      onOut();
    }
  }
  return (
    <div className="card"><h2>{ne ? "खाता" : "Account"}</h2>
      <p>{session.user.name} · {ne ? ROLE_NE[session.user.role] : session.user.role}</p>
      <button className="btn alt" onClick={() => void out()}>{ne ? "साइन आउट" : "Sign out"}</button>
      {owner && (
        <>
          <h3>{ne ? "खाता बन्द गर्ने अनुरोध" : "Ask to close the account"}</h3>
          {req && ["pending", "approved"].includes(req.status) ? (
            <div className="note">{req.status === "pending" ? (ne ? "अनुरोध जाँचिँदै छ।" : "Request is being checked.") : `${ne ? "स्वीकृत। डाटा मेटिने मिति" : "Approved. Data is erased on"} ${new Date(req.scheduledAt).toLocaleDateString()}`}
              <button className="btn alt" onClick={async () => { await api("/account/closure/cancel", "POST", {}); setReq(null); }}>{ne ? "रद्द गर्ने" : "Cancel request"}</button></div>
          ) : (
            <>
              <label htmlFor="rc">{ne ? "कारण" : "Reason"}</label>
              <select id="rc" value={f.reasonCode} onChange={(e) => setF({ ...f, reasonCode: e.target.value })}>{["not_using", "too_expensive", "missing_features", "hard_to_use", "other_app", "closing_business", "privacy", "problems", "other"].map((x) => <option key={x}>{x}</option>)}</select>
              <label htmlFor="rt">{ne ? "थप लेख्नुहोस्" : "More details"}</label><input id="rt" value={f.reasonText} onChange={(e) => setF({ ...f, reasonText: e.target.value })} />
              <label htmlFor="rp">{ne ? "पासवर्ड" : "Password"}</label><input id="rp" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
              {msg && <div className="warn" role="alert">{msg}</div>}
              <button className="btn bad" onClick={async () => { const r = await api("/account/closure", "POST", f); if (r.s === 200) { setReq(r.j.request); setMsg(""); } else setMsg(r.j.error === "bad_password" ? (ne ? "पासवर्ड मिलेन।" : "Wrong password.") : errMsg(L, r.j.error)); }}>{ne ? "अनुरोध पठाउने" : "Send request"}</button>
              <p style={{ fontSize: 13, color: "var(--mute)" }}>{ne ? "तुरुन्तै केही मेटिँदैन। एडमिनले स्वीकृत गरेको १४ दिनपछि सर्भरको डाटा मेटिन्छ। फोनमा रहेको डाटा मेटिँदैन।" : "Nothing is erased now. 14 days after the admin approves, the server data is erased. Data on phones is not touched."}</p>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- the seller's admin page (#/admin) ---------- */
const FEATS: [string, string, string][] = [["restaurant", "Restaurant", "रेस्टुरेन्ट"], ["housekeeping", "Housekeeping", "सफाई"], ["sources", "Own booking sources", "आफ्ना बुकिङ स्रोत"], ["excel", "Excel export", "एक्सेल"], ["email", "Email bills", "इमेल बिल"], ["publicLink", "Book-here link (later)", "बुक लिङ्क (पछि)"], ["ical", "Calendar sync (later)", "क्यालेन्डर (पछि)"], ["shifts", "Staff shifts", "स्टाफ सिफ्ट"], ["attendance", "Clock in/out + salary (premium)", "हाजिरी र तलब (प्रिमियम)"], ["backup", "Backup / restore (premium)", "ब्याकअप (प्रिमियम)"], ["smart", "Smart staff suggestion (premium)", "स्मार्ट सुझाव (प्रिमियम)"], ["guestOrder", "Guests order food by room QR (premium)", "कोठाको QR बाट खाना अर्डर (प्रिमियम)"]];

export function AdminPage({ L, setLang }: { L: Lang; setLang: () => void }) {
  const ne = L === "ne";
  const [key, setKey] = useState(() => { try { return sessionStorage.getItem("ph.adminkey") ?? ""; } catch { return ""; } });
  const [ok, setOk] = useState(false);
  const [msg, setMsg] = useState("");
  const [stats, setStats] = useState<Record<string, number>>({});
  const [hotels, setHotels] = useState<any[]>([]);
  const [reqs, setReqs] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [logins, setLogins] = useState<{ id: string; rows: LoginRow[] } | null>(null);
  const [recovery, setRecovery] = useState<{ id: string; code: string; email: string } | null>(null);
  async function load(k = key) {
    const s = await adminApi(k, "/stats");
    if (s.s !== 200) { setOk(false); return setMsg(s.s === 429 ? errMsg(L, "locked") : s.s === 0 ? errMsg(L, "offline") : ne ? "कुञ्जी मिलेन।" : "Wrong key."); }
    try { sessionStorage.setItem("ph.adminkey", k); } catch { /* ignore */ }
    setOk(true); setMsg(""); setStats(s.j);
    setHotels((await adminApi(k, "/hotels?q=" + encodeURIComponent(q))).j.hotels ?? []);
    setReqs((await adminApi(k, "/closures")).j.requests ?? []);
  }
  useEffect(() => { if (key) void load(); /* eslint-disable-next-line */ }, []);
  if (!ok)
    return (<><header><b>Pocket Hotel · Admin</b><button className="lang" onClick={setLang}>नेपाली / EN</button></header><main><div className="card">
      <label htmlFor="ak">{ne ? "एडमिन कुञ्जी" : "Admin key"}</label><input id="ak" type="password" value={key} onChange={(e) => setKey(e.target.value)} />
      {msg && <div className="warn" role="alert">{msg}</div>}<button className="btn" onClick={() => void load()}>OK</button></div></main></>);
  const toggle = async (h: any, k: string) => { await adminApi(key, `/hotels/${h.id}/features`, { feat: { [k]: !h.feat[k] } }); void load(); };
  return (
    <>
      <header><b>Pocket Hotel · Admin</b><span><button className="lang" onClick={setLang}>नेपाली / EN</button> <button className="lang" onClick={() => { try { sessionStorage.removeItem("ph.adminkey"); } catch { /* ignore */ } setOk(false); setKey(""); }}>{ne ? "बाहिर" : "Log out"}</button></span></header>
      <main>
        <div className="card"><div className="grid2">{Object.entries(stats).map(([k, v]) => <div className="note" key={k}>{k}: <b>{v}</b></div>)}</div></div>
        <div className="card"><h2>{ne ? "होटलहरू" : "Hotels"}</h2>
          <div className="row"><input aria-label="search" value={q} placeholder={ne ? "खोज्नुहोस्" : "Search"} onChange={(e) => setQ(e.target.value)} /><button className="btn sm" onClick={() => void load()}>🔍</button></div>
          {hotels.map((h) => (
            <div key={h.id} style={{ borderTop: "1px solid var(--line)", marginTop: 8 }}>
              <p><b>{h.name}</b> <small>{h.email} · {h.code} · staff {h.staff} · devices {h.devices} · records {h.records}</small></p>
              <button className="btn sm alt" onClick={async () => { if (!window.confirm(ne ? "पक्का मालिक नै हो भनेर पहिले चिन्नुहोस्। कोड बनाउने?" : "Make sure it really is the owner first. Make the code?")) return; const r = await adminApi(key, `/hotels/${h.id}/recovery`, {}); setRecovery(r.s === 200 ? { id: h.id, ...r.j } : null); }}>{ne ? "मालिकको पासवर्ड कोड" : "Owner password code"}</button>
              {recovery && recovery.id === h.id && <div className="note">{ne ? "यो कोड मालिकलाई फोन/सन्देशमा भन्नुहोस्। उनले ‘पासवर्ड बिर्सनुभयो?’ मा कोड लेखेर आफैं नयाँ पासवर्ड राख्छन्। २४ घण्टा चल्छ, एक पटक मात्र।" : "Give this code to the owner. They type it under ‘Forgot password?’ and choose their own new password. Works 24 hours, once."}<br /><b style={{ fontSize: 26, letterSpacing: 4 }}>{recovery.code}</b><br /><small>{recovery.email}</small></div>}
              <button className="btn sm alt" onClick={async () => { const r = await adminApi(key, `/hotels/${h.id}/logins`); setLogins({ id: h.id, rows: r.j.logins ?? [] }); }}>{ne ? "लगइन इतिहास" : "Login history"}</button>
              {logins && logins.id === h.id && <LoginList L={L} rows={logins.rows} />}
              {FEATS.map(([k, en, np]) => <div className="sw" key={k}><div>{ne ? np : en}</div><button className={"tg" + (h.feat[k] ? " on" : "")} aria-label={h.name + " " + k} onClick={() => void toggle(h, k)} /></div>)}
            </div>))}
        </div>
        <div className="card"><h2>{ne ? "खाता बन्द अनुरोध" : "Closing requests"}</h2>
          {reqs.map((r) => (
            <div className="item" key={r.id} style={{ display: "block" }}>
              <b>{r.hotel_name}</b> <small>{r.owner_email} · {r.reason_code} · {r.status}</small>{r.reason_text && <p>{r.reason_text}</p>}
              {r.status === "pending" && <div className="grid2"><button className="btn" onClick={async () => { await adminApi(key, `/closures/${r.id}/approve`, {}); void load(); }}>{ne ? "स्वीकृत" : "Approve"}</button><button className="btn alt" onClick={async () => { await adminApi(key, `/closures/${r.id}/reject`, { note: window.prompt("Note") ?? "" }); void load(); }}>{ne ? "अस्वीकृत" : "Reject"}</button></div>}
            </div>))}
          {!reqs.length && <p>–</p>}
          <button className="btn alt" onClick={async () => { const r = await adminApi(key, "/run-deletions", {}); setMsg(`deleted: ${r.j.deleted}`); void load(); }}>{ne ? "समय भएका मेटाउने" : "Run due deletions now"}</button>
          {msg && <p>{msg}</p>}
        </div>
      </main>
    </>
  );
}



/** Shown only in test mode (no server): how to start a real hotel. */
export function LocalCard({ L, onOut }: { L: Lang; onOut: () => void }) {
  const ne = L === "ne";
  const go = (keep: boolean) => {
    try { localStorage.setItem("ph.keep", keep ? "1" : "0"); } catch { /* ignore */ }
    onOut();
  };
  return (
    <div className="card"><h2>{ne ? "असली होटल दर्ता गर्नुस्" : "Start your real hotel"}</h2>
      <p>{ne ? "अहिले तपाईं यही डिभाइसमा मात्र चलाइरहनुभएको छ (परीक्षण, \"My Hotel\")। असली होटल दर्ता गरेपछि डाटा सर्भरमा सुरक्षित हुन्छ, र अरू फोन/कम्प्युटरमा पनि चल्छ।" : "You are using this device only (test mode, \"My Hotel\"). When you register a real hotel, its data is kept safe on the server and works on other phones and computers too."}</p>
      <button className="btn" onClick={() => go(false)}>{ne ? "नयाँ होटल दर्ता / साइन इन (यहाँको नमुना डाटा मेटिन्छ)" : "Register a new hotel / sign in (test data here is deleted)"}</button>
      <button className="btn alt" onClick={() => go(true)}>{ne ? "यहाँको डाटा राखेर दर्ता गर्ने" : "Register and keep the data from here"}</button>
    </div>
  );
}

type LoginRow = { id: number; who: string; kind: string; ok: number; reason: string | null; device_name: string | null; ip: string | null; country: string | null; at: number };

export function LoginList({ L, rows }: { L: Lang; rows: LoginRow[] }) {
  const ne = L === "ne";
  if (!rows.length) return <p>–</p>;
  return (
    <>
      {rows.map((r) => (
        <div className="item" key={r.id}>
          <span><b>{r.who}</b> <span className={"pill " + (r.ok ? "s-free" : "s-out")}>{r.ok ? (ne ? "सफल" : "ok") : (ne ? "असफल" : "failed")}</span><br />
            <small>{r.kind === "signup" ? (ne ? "होटल बनाउँदा" : "created the hotel") : r.kind === "staff" ? (ne ? "स्टाफ" : "staff") : (ne ? "मालिक" : "owner")} · {r.device_name ?? "?"}{r.reason ? " · " + r.reason : ""}<br />{r.country ?? ""} {r.ip ?? ""}</small></span>
          <small style={{ textAlign: "right" }}>{new Date(r.at).toLocaleString()}</small>
        </div>))}
    </>
  );
}

function LoginHistory({ L }: { L: Lang }) {
  const ne = L === "ne";
  const [rows, setRows] = useState<LoginRow[] | null>(null);
  return (
    <div className="card"><h2>{ne ? "लगइन इतिहास" : "Login history"}</h2>
      <p style={{ fontSize: 14, color: "var(--mute)" }}>{ne ? "कसले, कुन फोन/कम्प्युटरबाट, कहिले साइन इन गर्यो (गलत प्रयास पनि)। ३ महिनासम्म राखिन्छ।" : "Who signed in, from which phone or computer, and when (wrong tries too). Kept for 3 months."}</p>
      <button className="btn alt" onClick={async () => { const r = await api("/logins"); setRows(r.s === 200 ? r.j.logins : []); }}>{rows ? (ne ? "फेरि लोड" : "Reload") : (ne ? "इतिहास हेर्ने" : "Show history")}</button>
      {rows && <LoginList L={L} rows={rows} />}
    </div>
  );
}

/** The owner forgot the password: a code goes to the email, and the code allows a new password. */
function ForgotCard({ L, email0, onBack }: { L: Lang; email0: string; onBack: () => void }) {
  const ne = L === "ne";
  const [email, setEmail] = useState(email0);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send() {
    setMsg("");
    setBusy(true);
    const r = await publicApi("/auth/reset/otp", { email });
    setBusy(false);
    if (r.s !== 200) return setMsg(errMsg(L, r.j?.error));
    setSent(true);
    setMsg(ne ? "यो इमेलमा खाता छ भने ६ अंकको कोड पठाइयो। इमेल (Spam पनि) हेर्नुहोस्।" : "If this email has an account, a 6-digit code was sent. Check your email (and Spam).");
  }
  async function save() {
    setMsg("");
    if (pw.length < 8) return setMsg(ne ? "पासवर्ड कम्तीमा ८ अक्षरको हुनुपर्छ।" : "The password must have at least 8 characters.");
    if (pw !== pw2) return setMsg(ne ? "दुई पटक लेखेको पासवर्ड मिलेन।" : "The two passwords are not the same.");
    setBusy(true);
    const r = await publicApi("/auth/reset", { email, code, password: pw });
    setBusy(false);
    if (r.s !== 200) return setMsg(errMsg(L, r.j?.error));
    setDone(true);
  }
  if (done)
    return (
      <div className="card"><h2>{ne ? "पासवर्ड बदलियो ✓" : "Password changed ✓"}</h2>
        <p>{ne ? "अब नयाँ पासवर्डले साइन इन गर्नुहोस्। अरू सबै फोन/कम्प्युटरबाट तपाईं साइन आउट हुनुभयो।" : "Now sign in with the new password. You were signed out of all other phones and computers."}</p>
        <button className="btn" onClick={onBack}>{ne ? "साइन इन" : "Sign in"}</button></div>
    );
  return (
    <div className="card"><h2>{ne ? "पासवर्ड बिर्सनुभयो?" : "Forgot password?"}</h2>
      <label htmlFor="fe">Email</label><input id="fe" type="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
      {!sent ? (
        <>
          <button className="btn" disabled={busy} onClick={() => void send()}>{ne ? "कोड पठाउनुहोस्" : "Send code"}</button>
          <button className="btn alt" onClick={() => { setSent(true); setMsg(ne ? "एडमिनले दिएको ६ अंकको कोड तल लेख्नुहोस्।" : "Type the 6-digit code the admin gave you."); }}>{ne ? "इमेल चल्दैन — एडमिनले कोड दिएको छ" : "No access to my email — the admin gave me a code"}</button>
        </>
      ) : (
        <>
          <label htmlFor="fc">{ne ? "इमेलको ६ अंकको कोड" : "6-digit code from email"}</label><input id="fc" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
          <label htmlFor="fp">{ne ? "नयाँ पासवर्ड (कम्तीमा ८ अक्षर)" : "New password (at least 8 characters)"}</label><input id="fp" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <label htmlFor="fq">{ne ? "नयाँ पासवर्ड फेरि लेख्नुहोस्" : "New password again"}</label><input id="fq" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          <button className="btn" disabled={busy} onClick={() => void save()}>{ne ? "पासवर्ड बदल्नुहोस्" : "Change password"}</button>
        </>
      )}
      {msg && <div className="warn" role="alert">{msg}</div>}
      <button className="btn alt" onClick={onBack}>{ne ? "पछाडि" : "Back"}</button>
    </div>
  );
}
