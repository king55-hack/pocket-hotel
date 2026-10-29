import { short } from "./lib/report";

const W = 640, H = 240, PL = 62, PR = 8, PT = 16, PB = 38;

/** Nice round top for the axis: 1, 2, 5 times a power of ten. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

type Series = { name: string; color: string; v: number[] };

/**
 * Bars drawn as SVG (no chart library, so nothing is loaded from outside). Several series are stacked.
 * The numbers are also written as text under the chart, so the chart is never the only way to read them.
 */
export function Bars({ title, labels, series, fmt = short, max }: { title: string; labels: string[]; series: Series[]; fmt?: (n: number) => string; max?: number }) {
  const n = labels.length;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.v[i] ?? 0), 0));
  const top = niceMax(max ?? Math.max(0, ...totals));
  const bw = (W - PL - PR) / Math.max(1, n);
  const y = (v: number) => PT + (H - PT - PB) * (1 - v / top);
  const every = Math.ceil(n / 6);
  const desc = labels.map((l, i) => `${l}: ${fmt(totals[i])}`).join(", ");
  return (
    <figure style={{ margin: "8px 0" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title}. ${desc}`} style={{ display: "block", maxHeight: 260 }}>
        <title>{title}</title>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={y(top * t)} y2={y(top * t)} stroke="var(--line)" strokeWidth="1" />
            <text x={PL - 6} y={y(top * t) + 4} textAnchor="end" fontSize="22" fill="var(--mute)">{fmt(top * t)}</text>
          </g>
        ))}
        {labels.map((l, i) => {
          let acc = 0;
          return (
            <g key={i}>
              {series.map((s) => {
                const v = s.v[i] ?? 0;
                if (v <= 0) return null;
                const y1 = y(acc + v), y0 = y(acc);
                acc += v;
                return <rect key={s.name} x={PL + i * bw + bw * 0.12} width={bw * 0.76} y={y1} height={Math.max(1, y0 - y1)} rx={Math.min(3, bw * 0.15)} fill={s.color}><title>{`${l} · ${s.name}: ${fmt(v)}`}</title></rect>;
              })}
              {i % every === 0 && <text x={PL + i * bw + bw / 2} y={H - 10} textAnchor="middle" fontSize="22" fill="var(--mute)">{l}</text>}
            </g>
          );
        })}
      </svg>
      {series.length > 1 && (
        <figcaption style={{ fontSize: 14 }}>
          {series.map((s) => <span key={s.name} style={{ marginRight: 12, whiteSpace: "nowrap" }}><span aria-hidden style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: s.color, marginRight: 4 }} />{s.name}</span>)}
        </figcaption>
      )}
    </figure>
  );
}

/** A list of labelled horizontal bars, for splits like "by booking source". */
export function HBars({ rows, fmt = (n: number) => String(n) }: { rows: [string, number][]; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ margin: "6px 0" }}>
          <div className="row" style={{ fontSize: 14 }}><span>{k}</span><b>{fmt(v)}</b></div>
          <div aria-hidden style={{ background: "var(--pri2)", borderRadius: 6, height: 10 }}><div style={{ width: `${Math.max(2, (v / max) * 100)}%`, background: "var(--pri)", height: 10, borderRadius: 6 }} /></div>
        </div>
      ))}
    </div>
  );
}
