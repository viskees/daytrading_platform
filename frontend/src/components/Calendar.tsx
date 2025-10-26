// Calendar.tsx
import React, { useMemo, useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type DaySummary = {
  date: string;  // YYYY-MM-DD
  pl: number;
  trades: number;
  win_rate: number;
  avg_r: number;
  best_r: number;
  worst_loss_r: number;
  max_dd_pct: number;
};

type Props = {
  // for color intensity scaling; pass what you already have on the page
  dayStartEquity?: number;     // E0 for current day
  maxDailyLossPct?: number;    // e.g. 3
  getMonthSummaries: (year: number, month0: number) => Promise<DaySummary[]>;
  getDayTrades?: (isoDate: string) => Promise<any[]>; // for drawer
};

export default function TradesCalendar({
  dayStartEquity = 0,
  maxDailyLossPct = 3,
  getMonthSummaries,
  getDayTrades,
}: Props) {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [data, setData] = useState<Record<string, DaySummary>>({});
  const [openDay, setOpenDay] = useState<null | string>(null);
  const [openTrades, setOpenTrades] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Month labels + year options
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const years = useMemo(() => {
    const base = new Date().getFullYear();
    return Array.from({ length: 11 }, (_, i) => base - 5 + i);
  }, []);

  // Local YYYY-MM-DD (no timezone shift)
  const ymd = (d: Date) => {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return `${y}-${pad(m)}-${pad(day)}`;
  };


  const year = cursor.getFullYear();
  const month0 = cursor.getMonth(); // 0..11
  const start = new Date(year, month0, 1);
  const end   = new Date(year, month0 + 1, 0);

  const days: string[] = useMemo(() => {
    const out: string[] = [];
    const pad = start.getDay(); // 0=Sun
    for (let i = 0; i < pad; i++) out.push(""); // leading blanks
    for (let d = 1; d <= end.getDate(); d++) {
      // use local calendar date key, not UTC ISO
      const iso = ymd(new Date(year, month0, d));
      out.push(iso);
    }
    // trailing blanks to complete 7n grid
    while (out.length % 7 !== 0) out.push("");
    return out;
  }, [year, month0, start, end]);

  const pull = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getMonthSummaries(year, month0);
      const m: Record<string, DaySummary> = {};
      // Normalize keys so they always match our grid's `YYYY-MM-DD`
      for (const d of list) {
        const key = String(d.date).slice(0, 10);
        m[key] = { ...d, date: key };
      }
      setData(m);
    } finally {
      setLoading(false);
    }
  }, [year, month0, getMonthSummaries]);

  useEffect(() => { void pull(); }, [pull]);

  const riskBudget$ = useMemo(() => {
    if (dayStartEquity > 0 && maxDailyLossPct > 0) {
      return dayStartEquity * (maxDailyLossPct / 100);
    }
    return 0;
  }, [dayStartEquity, maxDailyLossPct]);

  const intensity = (pl: number) => {
    if (!riskBudget$) return "10"; // very soft if we can’t scale
    const ratio = Math.min(1, Math.abs(pl) / riskBudget$);
    if (ratio > 0.66) return "30";
    if (ratio > 0.33) return "20";
    return "10";
  };

  const tileClass = (iso?: string) => {
    if (!iso) return "bg-transparent";
    const d = data[iso];
    if (!d) return "bg-muted/10 border border-muted/20";
    if (d.pl > 0) return `bg-emerald-500/${intensity(d.pl)} border border-emerald-500/20`;
    if (d.pl < 0) return `bg-rose-500/${intensity(d.pl)} border border-rose-500/20`;
    return "bg-muted/10 border border-muted/20";
  };

  const isToday = (iso: string) => iso === ymd(today);

  const openDayDrawer = async (iso: string) => {
    setOpenDay(iso);
    if (getDayTrades) {
      try {
        const rows = await getDayTrades(iso);
        setOpenTrades(rows);

        // If the month summary didn’t include this day (e.g., just closed a trade),
        // synthesize a minimal DaySummary so the drawer header & tile have data now.
        if (!data[iso]) {
          const trades = Array.isArray(rows) ? rows.length : 0;
          if (trades > 0) {
            setData(prev => ({
              ...prev,
              [iso]: {
                date: iso,
                pl: 0,              // unknown without server agg; keep 0
                trades,
                win_rate: 0,        // leave 0; server agg will fill next pull
                avg_r: 0,
                best_r: 0,
                worst_loss_r: 0,
                max_dd_pct: 0,
              },
            }));
          }
        }
      } catch {
        setOpenTrades(null);
      }
    } else {
      setOpenTrades(null);
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">Calendar</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCursor(new Date(year, month0 - 1, 1))}
              aria-label="Previous month"
            >
              ‹
            </Button>
            <select
              className="h-9 rounded-xl border px-2 text-sm
                bg-background text-foreground
                dark:bg-zinc-900 dark:text-zinc-100 dark:border-zinc-700
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={month0}
              onChange={(e) => setCursor(new Date(year, Number(e.target.value), 1))}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i}>{m}</option>
              ))}
            </select>
            <select
              className="h-9 rounded-xl border bg-background text-foreground px-2 text-sm
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={year}
              onChange={(e) => setCursor(new Date(Number(e.target.value), month0, 1))}
            >
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCursor(new Date(year, month0 + 1, 1))}
              aria-label="Next month"
            >
              ›
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-2 text-xs text-muted-foreground mb-2">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => <div key={d} className="text-center">{d}</div>)}
        </div>

        <div className="grid grid-cols-7 gap-2">
          {days.map((iso, i) => {
            const d = iso ? Number(iso.slice(-2)) : "";
            const sum = iso ? data[iso] : undefined;
            return (
              <button
                key={i}
                disabled={!iso}
                onClick={() => iso && openDayDrawer(iso)}
                className={[
                  "h-20 rounded-xl p-2 text-left relative transition",
                  "hover:ring-2 hover:ring-white/10 focus:outline-none",
                  tileClass(iso),
                  iso && isToday(iso) ? "ring-1 ring-white/20" : "",
                  !iso ? "cursor-default" : "cursor-pointer",
                ].join(" ")}
                title={
                  iso && sum
                    ? `P/L: ${Number(sum.pl || 0).toFixed(2)} | Trades: ${Number(sum.trades || 0)} | Win: ${Number(sum.win_rate || 0).toFixed(0)}%`
                    : ""
                }
              >
                <div className="flex justify-between items-start">
                  <span className="text-[11px] opacity-80">{d}</span>
                  {sum?.trades ? (
                    <Badge variant="secondary" className="rounded-full px-1.5 py-0 text-[10px]">
                      {sum.trades}
                    </Badge>
                  ) : null}
                </div>
                {sum ? (
                  <div className="absolute bottom-1 right-2 text-[11px] font-medium opacity-90">
                    {Number(sum.pl || 0) > 0
                      ? `+${Number(sum.pl || 0).toFixed(0)}`
                      : Number(sum.pl || 0).toFixed(0)}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>

        {loading && <div className="mt-3 text-xs text-muted-foreground">Loading month…</div>}

        {/* Drawer/Modal – simple inline modal for brevity */}
        {openDay && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-3xl rounded-2xl bg-background border shadow-lg">
              <div className="flex items-center justify-between border-b p-4">
                <div className="font-semibold">{openDay}</div>
                <Button variant="outline" onClick={() => { setOpenDay(null); setOpenTrades(null); }}>Close</Button>
              </div>
              <div className="p-4 space-y-4">
                {(() => {
                  const s = data[openDay!];
                  if (!s) return <div className="text-sm text-muted-foreground">No data for this day.</div>;
                  return (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
                        <Stat label="P/L" value={s.pl.toFixed(2)} />
                        <Stat label="Trades" value={s.trades} />
                        <Stat label="Win rate" value={`${s.win_rate.toFixed(0)}%`} />
                        <Stat label="Avg R" value={s.avg_r.toFixed(2)} />
                        <Stat label="Best R" value={s.best_r.toFixed(2)} />
                        <Stat label="Max DD" value={`${s.max_dd_pct.toFixed(2)}%`} />
                      </div>
                      {openTrades?.length ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="text-left text-muted-foreground">
                              <tr className="border-b">
                                <th className="py-2 pr-2">Ticker</th>
                                <th className="py-2 pr-2">Side</th>
                                <th className="py-2 pr-2">R</th>
                                <th className="py-2 pr-2">Entry</th>
                                <th className="py-2 pr-2">Exit</th>
                                <th className="py-2 pr-2">Size</th>
                                <th className="py-2 pr-2">Tags</th>
                                <th className="py-2 pr-2">Notes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {openTrades.map((t: any) => (
                                <tr key={t.id} className="border-b last:border-none align-top">
                                  <td className="py-2 pr-2 font-medium">{t.ticker}</td>
                                  <td className="py-2 pr-2">{t.side}</td>
                                  <td className="py-2 pr-2">{t.r ?? "-"}</td>
                                  <td className="py-2 pr-2">{t.entry ?? "-"}</td>
                                  <td className="py-2 pr-2">{t.exit ?? "-"}</td>
                                  <td className="py-2 pr-2">{t.size ?? "-"}</td>
                                  <td className="py-2 pr-2">
                                    <div className="flex flex-wrap gap-1">
                                      {(t.tags ?? []).map((tag: string) => (
                                        <Badge key={tag} variant="secondary" className="rounded-full">{tag}</Badge>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="py-2 pr-2 max-w-[240px]">
                                    <div className="text-muted-foreground whitespace-pre-wrap line-clamp-2">{t.notes ?? ""}</div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">No trades loaded for this day.</div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}
