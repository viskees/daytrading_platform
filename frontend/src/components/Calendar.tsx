// frontend/src/components/Calendar.tsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchClosedTrades } from "@/lib/api";
import { onTradeClosed } from "@/lib/events"; // supports payload { dateISO, ... } or a full Trade-like

type DaySummary = {
  date: string; // YYYY-MM-DD
  pl: number;
  trades: number;
  /** percent 0..100 */
  winRate: number;
  /** R multiples */
  avgR: number;
  bestR: number;
  worstR: number;
};

type TradeLike = {
  exitTime?: string; // from normalizeTrade
  entryTime?: string;
  side?: "LONG" | "SHORT";
  entryPrice?: number;
  exitPrice?: number;
  size?: number;
  realizedPnl?: number; // normalized field if backend provides
  rMultiple?: number | null;
  journal_day?: number;
};

function computeRealizedPnl(t: TradeLike): number {
  if (typeof t.realizedPnl === "number") return t.realizedPnl;
  if (
    (t.side === "LONG" || t.side === "SHORT") &&
    Number.isFinite(t.entryPrice as number) &&
    Number.isFinite(t.exitPrice as number) &&
    Number.isFinite(t.size as number)
  ) {
    const qty = Number(t.size);
    const diff =
      t.side === "LONG"
        ? Number(t.exitPrice) - Number(t.entryPrice)
        : Number(t.entryPrice) - Number(t.exitPrice);
    return Number((diff * qty).toFixed(2));
  }
  return 0;
}

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthRange(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start, end };
}

async function getMonthSummaries(cursor: Date): Promise<Record<string, DaySummary>> {
  const { start, end } = monthRange(cursor);
  const from = ymd(start);
  const to = ymd(end);

  const page1 = await fetchClosedTrades({ from, to });
  const trades: TradeLike[] = Array.isArray(page1?.results)
    ? page1.results
    : Array.isArray(page1)
    ? page1
    : [];

  const map = new Map<string, { pl: number; trades: number; wins: number; rVals: number[] }>();

  for (const t of trades) {
    // Use exit date primarily; if missing, fall back to entry date
    const dt = t.exitTime?.slice(0, 10) ?? t.entryTime?.slice(0, 10) ?? null;
    if (!dt) continue;
    const realized = computeRealizedPnl(t);
    const r = t.rMultiple == null ? null : Number(t.rMultiple);

    if (!map.has(dt)) map.set(dt, { pl: 0, trades: 0, wins: 0, rVals: [] });
    const agg = map.get(dt)!;
    agg.pl += realized;
    agg.trades += 1;
    if (realized > 0) agg.wins += 1;
    if (typeof r === "number" && Number.isFinite(r)) agg.rVals.push(r);
  }

  const out: Record<string, DaySummary> = {};
  for (const [date, v] of map.entries()) {
    const avgR = v.rVals.length ? v.rVals.reduce((a, b) => a + b, 0) / v.rVals.length : 0;
    const bestR = v.rVals.length ? Math.max(...v.rVals) : 0;
    const worstR = v.rVals.length ? Math.min(...v.rVals) : 0;
    out[date] = {
      date,
      pl: Number(v.pl.toFixed(2)),
      trades: v.trades,
      winRate: v.trades ? (v.wins / v.trades) * 100 : 0,
      avgR: Number(avgR.toFixed(2)),
      bestR: Number(bestR.toFixed(2)),
      worstR: Number(worstR.toFixed(2)),
    };
  }
  return out;
}

function isoFromTrade(t: TradeLike): string | null {
  return t.exitTime?.slice(0, 10) ?? t.entryTime?.slice(0, 10) ?? null;
}

// Optimistically patch the visible month's day aggregate so tiles & colors flip instantly.
function optimisticApply(
  prev: Record<string, DaySummary>,
  trade: TradeLike,
  visibleMonth0: number
): Record<string, DaySummary> {
  const iso = isoFromTrade(trade);
  if (!iso) return prev;
  const dt = new Date(iso + "T00:00:00");
  if (!Number.isFinite(dt.getTime()) || dt.getMonth() !== visibleMonth0) return prev;

  const realized = computeRealizedPnl(trade);
  const r = Number.isFinite(Number(trade.rMultiple)) ? Number(trade.rMultiple) : 0;
  const s = prev[iso];

  if (!s) {
    return {
      ...prev,
      [iso]: {
        date: iso,
        pl: Number(realized.toFixed(2)),
        trades: 1,
        winRate: realized > 0 ? 100 : 0,
        avgR: Number(r.toFixed(2)),
        bestR: Number(r.toFixed(2)),
        worstR: Number(r.toFixed(2)),
      },
    };
  }

  const prevWins = Math.round((s.winRate / 100) * s.trades);
  const wins = prevWins + (realized > 0 ? 1 : 0);
  const trades = s.trades + 1;
  const pl = Number((s.pl + realized).toFixed(2));
  const winRate = trades ? (wins / trades) * 100 : 0;
  const avgR = Number(((s.avgR * s.trades + r) / trades).toFixed(2));
  const bestR = Number(Math.max(s.bestR, r).toFixed(2));
  const worstR = Number(Math.min(s.worstR, r).toFixed(2));

  return {
    ...prev,
    [iso]: { ...s, pl, trades, winRate, avgR, bestR, worstR },
  };
}

/* ===========================
   Vivid outline + soft fill
   =========================== */
function tileClasses(pl: number, hasTrades: boolean, inMonth: boolean, isToday: boolean) {
  if (!inMonth) return "bg-muted/30 border text-zinc-500";
  if (!hasTrades) return "bg-white dark:bg-zinc-900 border border-zinc-300/60 dark:border-zinc-700/60";

  if (pl > 0) {
    return [
      "bg-emerald-50 dark:bg-emerald-900/20",               // soft fill
      "border border-emerald-500 ring-1 ring-emerald-500/30", // vivid outline
      "text-emerald-800 dark:text-emerald-200",
      isToday ? "ring-2 ring-offset-1 ring-offset-background ring-emerald-500/60" : "",
    ].join(" ");
  }
  if (pl < 0) {
    return [
      "bg-rose-50 dark:bg-rose-900/20",
      "border border-rose-500 ring-1 ring-rose-500/30",
      "text-rose-800 dark:text-rose-200",
      isToday ? "ring-2 ring-offset-1 ring-offset-background ring-rose-500/60" : "",
    ].join(" ");
  }
  // trades but flat P&L
  return [
    "bg-zinc-50 dark:bg-zinc-900/30",
    "border border-zinc-400 ring-1 ring-zinc-400/20",
    "text-zinc-800 dark:text-zinc-200",
    isToday ? "ring-2 ring-offset-1 ring-offset-background ring-zinc-500/50" : "",
  ].join(" ");
}

function plTextClass(pl: number) {
  if (pl > 0) return "text-emerald-900 dark:text-emerald-200";
  if (pl < 0) return "text-rose-900 dark:text-rose-200";
  return "text-zinc-700 dark:text-zinc-300";
}

export default function TradesCalendar({
  onDayClick,
  /** bump this (number) to force a visible-month refetch */
  refreshToken,
}: {
  onDayClick?: (dateISO: string) => void;
  refreshToken?: number | string;
}) {
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [data, setData] = useState<Record<string, DaySummary>>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (d: Date) => {
    setLoading(true);
    try {
      const res = await getMonthSummaries(d);
      setData(res);
    } finally {
      setLoading(false);
    }
  }, []);

  // initial + when month changes
  useEffect(() => {
    void refresh(cursor);
  }, [cursor, refresh]);

  // refetch the visible month whenever the parent bumps refreshToken
  useEffect(() => {
    if (refreshToken === undefined) return;
    void refresh(new Date(cursor));
  }, [refreshToken, cursor, refresh]);

  // live update when a trade is closed
  useEffect(() => {
    // Support two emitter shapes:
    //  A) Full trade-like object (we'll optimistic-apply)
    //  B) { dateISO: "YYYY-MM-DD" } only (refetch if within current month)
    const unsubscribe = onTradeClosed?.((payload?: any) => {
      const thisMonth = cursor.getMonth();
      if (!payload) {
        void refresh(new Date(cursor));
        return;
      }

      // If we received a full trade-like, try optimistic apply first
      const maybeTrade = payload as TradeLike;
      const isoFromFull = isoFromTrade(maybeTrade);
      if (isoFromFull) {
        const monthOfTrade = new Date(isoFromFull + "T00:00:00").getMonth();
        if (monthOfTrade === thisMonth) {
          setData((prev) => optimisticApply(prev, maybeTrade, thisMonth));
          return; // lightweight update; server will soon confirm via next interaction
        }
      }

      // Else use the date hint to selectively refetch
      const dateISO: string | undefined = payload?.dateISO;
      if (dateISO) {
        const monthOfHint = new Date(dateISO + "T00:00:00").getMonth();
        if (monthOfHint === thisMonth) {
          void refresh(new Date(cursor));
          return;
        }
      }
      // Fallback: conservative refetch
      void refresh(new Date(cursor));
    });
    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [cursor, refresh]);

  const year = cursor.getFullYear();
  const month0 = cursor.getMonth();
  const startOfMonth = new Date(year, month0, 1);
  const endOfMonth = new Date(year, month0 + 1, 0);

  // build 6-week view starting on Monday
  const firstDayIdx = (startOfMonth.getDay() + 6) % 7; // 0=Mon .. 6=Sun
  const gridStart = new Date(startOfMonth);
  gridStart.setDate(1 - firstDayIdx);

  const days = useMemo(() => {
    const arr: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, [gridStart.toISOString()]);

  // month totals for the header
  const monthTotals = useMemo(() => {
    let pl = 0,
      trades = 0,
      wins = 0;
    for (let d = new Date(startOfMonth); d <= endOfMonth; d.setDate(d.getDate() + 1)) {
      const k = ymd(d);
      const s = data[k];
      if (!s) continue;
      pl += s.pl;
      trades += s.trades;
      wins += Math.round((s.winRate / 100) * s.trades);
    }
    const winRate = trades ? (wins / trades) * 100 : 0;
    return {
      pl: Number(pl.toFixed(2)),
      trades,
      winRate: Number(winRate.toFixed(1)),
    };
  }, [data, startOfMonth, endOfMonth]);

  const monthName = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(cursor);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-lg font-semibold">{monthName}</div>
            <div className="text-xs text-muted-foreground">{loading ? "Refreshing…" : " "}</div>
          </div>
          <div className="flex items-center gap-2">
            <Stat label="Month P&L" value={monthTotals.pl} />
            <Stat label="# Trades" value={monthTotals.trades} />
            <Stat label="Win rate" value={`${monthTotals.winRate}%`} />
            <div className="ml-4 flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              >
                Prev
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-xs mb-1 text-muted-foreground">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="px-2 py-1">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {days.map((d, idx) => {
            const key = ymd(d);
            const inMonth = d.getMonth() === month0;
            const s = data[key];
            const isToday = key === ymd(new Date());
            const pl = Number(s?.pl ?? 0);

            const tileStyle = tileClasses(pl, !!s?.trades, inMonth, isToday);

            return (
              <button
                key={idx}
                type="button"
                onClick={() => onDayClick?.(key)}
                className={[
                  "text-left rounded-lg p-2 transition",
                  "hover:border-primary/50 hover:ring-1 hover:ring-primary/20",
                  tileStyle,
                ].join(" ")}
                title={
                  s
                    ? `P&L: ${s.pl}\nTrades: ${s.trades}\nWin rate: ${s.winRate.toFixed(
                        1
                      )}%\nAvg R: ${s.avgR}  (Best: ${s.bestR} / Worst: ${s.worstR})`
                    : "No closed trades"
                }
              >
                <div className={`flex items-center justify-between ${inMonth ? "" : "opacity-50"}`}>
                  <div className="text-sm font-medium">{d.getDate()}</div>
                  {s?.trades ? <Badge variant="outline">{s.trades}</Badge> : null}
                </div>
                <div className="mt-1 text-[11px]">
                  {s ? (
                    <span className={plTextClass(pl)}>
                      {pl > 0 ? "▲ " : pl < 0 ? "▼ " : "– "}
                      {pl.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-2 py-1 rounded-md border bg-white dark:bg-zinc-900">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}