import { useEffect, useRef, useState } from "react";
import type { Lang } from "./i18n";
import type { SyncState } from "./sync";

type Props = {
  name: string;
  L: Lang;
  signedIn: boolean;
  sync: SyncState;
  pending: number;
  canInstall: boolean;
  onInstall: () => void;
  onSync: () => void;
  onLang: () => void;
};

const WORDS: Record<string, [string, string]> = {
  idle: ["सिंक भयो", "Synced"],
  syncing: ["सिंक हुँदै…", "Syncing…"],
  offline: ["अफलाइन", "Offline"],
  error: ["सिंकमा समस्या", "Sync problem"],
  "signed-out": ["साइन आउट", "Signed out"],
};

/**
 * One tidy row: logo, a small sync button (its status floats under it as a short note), then the hotel name
 * (long names are cut with "…", tap for the full name floating below), a tiny language button, and install.
 */
export function Header({ name, L, signedIn, sync, pending, canInstall, onInstall, onSync, onLang }: Props) {
  const ne = L === "ne";
  const [note, setNote] = useState(false);
  const [full, setFull] = useState(false);
  const first = useRef(true);

  // the status note floats for a few seconds whenever the status changes (and when the button is pressed)
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setNote(true);
    const t = setTimeout(() => setNote(false), 2600);
    return () => clearTimeout(t);
  }, [sync.status, sync.last]);
  useEffect(() => {
    if (!full) return;
    const t = setTimeout(() => setFull(false), 4000);
    return () => clearTimeout(t);
  }, [full]);

  const word = (WORDS[sync.status] ?? WORDS.idle)[ne ? 0 : 1];
  const icon = sync.status === "syncing" ? "⟳" : sync.status === "idle" ? "✓" : "!";

  return (
    <header className="top">
      <img src="/favicon.png" alt="" width="32" height="32" className="top-logo" />
      {signedIn && (
        <span className="top-sync">
          <button className={"top-btn st-" + sync.status} aria-label={`${word}${pending ? ", " + pending : ""}`} onClick={() => { onSync(); setNote(true); setTimeout(() => setNote(false), 2600); }}>
            <span className={sync.status === "syncing" ? "spin" : ""}>{icon}</span>
            {pending > 0 && <span className="badge">{pending}</span>}
          </button>
          {note && <span className="float-note" role="status">{word}{pending > 0 ? ` · ${pending}` : ""}</span>}
        </span>
      )}
      <span className="top-gap" />
      <span className="top-name-wrap">
        <button className="top-name" onClick={() => setFull(!full)} aria-label={name}>{name}</button>
        {full && <span className="float-note name-full" role="status">{name}</span>}
      </span>
      {canInstall && <button className="top-btn" aria-label={ne ? "एप इन्स्टल" : "Install app"} onClick={onInstall}>⬇</button>}
      <button className="top-btn lang-btn" aria-label={ne ? "English" : "नेपाली"} onClick={onLang}>{ne ? "EN" : "ने"}</button>
    </header>
  );
}
