import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import TradesCalendar from "@/components/Calendar";
import {
  fetchUserSettings as apiFetchUserSettings,
  saveTheme as apiSaveTheme,
  fetchOpenTrades as apiFetchOpenTrades,
  createTrade as apiCreateTrade,
  closeTrade as apiCloseTrade,
  createAttachment as apiCreateAttachment,
  fetchSessionStatusToday,
  fetchAccountSummary,
  getOrCreateJournalDay,
  listAdjustments,
  createAdjustment,
  deleteAdjustment,
  patchDayStartEquity,
  type AdjustmentReason,
  updateTrade,
} from "@/lib/api";
import { getInitialDark, hasStoredTheme, setTheme } from "@/lib/theme";
import { onTradeClosed, emitTradeClosed } from "@/lib/events";
import JournalDashboard from "@/pages/JournalDashboard";
import TradeEditor from "@/components/TradeEditor";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type RiskPolicy = {
  maxRiskPerTradePct: number;
  maxDailyLossPct: number;
  maxTradesPerDay: number;
};

export type Trade = {
  id: string | number;
  ticker: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  entryTime: string;
  stopLoss?: number;
  target?: number;
  riskR?: number;
  size?: number;
  notes?: string;
  strategyTags?: string[];
  status: "OPEN" | "CLOSED";
};

type SessionStatus = {
  trades: number;
  win_rate: number;
  avg_r: number;
  best_r: number;
  worst_r: number;
  max_dd_pct: number;
};

type DaySummary = {
  date: string;
  pl: number;
  trades: number;
  win_rate: number;
  avg_r: number;
  best_r: number;
  worst_loss_r: number;
  max_dd_pct: number;
};

const LAST_EQUITY_KEY = "equity_last_known";
const STRATEGY_TAGS = ["Breakout", "Pullback", "Reversal", "VWAP", "Trend", "Range", "News"];

function calcUsedPctOfBudget(usedDailyRiskPct: number, maxDailyLossPct: number): number {
  if (!isFinite(usedDailyRiskPct) || !isFinite(maxDailyLossPct) || maxDailyLossPct <= 0) return 0;
  const pct = (usedDailyRiskPct / maxDailyLossPct) * 100;
  return Math.min(100, Math.max(0, pct));
}

function ymdLocal(d: Date) {
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms = 300) {
  let t: any;
  return (...args: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-zinc-900 border shadow-lg">
        <div className="flex items-center justify-between border-b p-4">
          <h3 className="font-semibold">{title}</h3>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function ImagePasteDrop({
  files, setFiles, label = "Click or paste screenshot (Ctrl/Cmd+V)"
}: { files: File[]; setFiles: (f: File[]) => void; label?: string }) {
  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    setFiles([...files, ...Array.from(e.target.files)]);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    if (dropped.length) setFiles([...files, ...dropped]);
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/"));
    if (imgs.length) { e.preventDefault(); setFiles([...files, ...imgs]); }
  };
  return (
    <div
      tabIndex={0}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      onPaste={onPaste}
      className="border border-dashed rounded-xl p-3 text-xs text-muted-foreground focus:outline-none focus:ring-2"
    >
      <div className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <Input type="file" accept="image/*" multiple onChange={onInput} className="w-auto" />
      </div>
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div key={i} className="relative">
              <img
                alt={f.name}
                src={URL.createObjectURL(f)}
                className="h-16 w-24 object-cover rounded-lg border"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewTradeDialog({
  onCreated, onClose, kpiError,
  perTradeCap$, dailyRemaining$, guardsEnabled
}: {
  onCreated: (t: Trade) => void;
  onClose: () => void;
  kpiError?: string | null;
  guardsEnabled: boolean;
  perTradeCap$: number;
  dailyRemaining$: number;
}) {
  const [ticker, setTicker] = useState("");
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const [entryPrice, setEntryPrice] = useState<number | "">("");
  const [stopLoss, setStopLoss] = useState<number | "">("");
  const [target, setTarget] = useState<number | "">("");
  const [size, setSize] = useState<number | "">("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [shots, setShots] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleTag = (tag: string) => setTags(t => t.includes(tag) ? t.filter(x => x !== tag) : [...t, tag]);

  const currentRisk$ = useMemo(() => {
    if (!size || !entryPrice || !stopLoss) return 0;
    const ep = Number(entryPrice), sp = Number(stopLoss), q = Number(size);
    const perUnit = side === "LONG" ? Math.max(0, ep - sp) : Math.max(0, sp - ep);
    return perUnit * q;
  }, [side, entryPrice, stopLoss, size]);

  const exceedsPerTrade = currentRisk$ > perTradeCap$ + 1e-9;
  const exceedsDaily = currentRisk$ > dailyRemaining$ + 1e-9;

  const submit = async () => {
    if (!ticker || !entryPrice) return;

    if (!size || !stopLoss) {
      setErr("Size and Stop are required to validate risk.");
      return;
    }
    if (exceedsPerTrade) {
      setErr(`This trade risks $${currentRisk$.toFixed(2)}, above your per-trade cap of $${perTradeCap$.toFixed(2)}.`);
      return;
    }
    if (exceedsDaily) {
      setErr(`This trade would exceed today's remaining risk budget ($${dailyRemaining$.toFixed(2)}).`);
      return;
    }

    setSaving(true);
    try {
      setErr(null);

      if (guardsEnabled && exceedsPerTrade) throw new Error("Exceeds per-trade cap.");
      if (guardsEnabled && exceedsDaily) throw new Error("Exceeds daily budget.");

      const trade = await apiCreateTrade({
        ticker,
        side,
        entryPrice: Number(entryPrice),
        stopLoss: stopLoss ? Number(stopLoss) : undefined,
        target: target ? Number(target) : undefined,
        size: size ? Number(size) : undefined,
        notes,
        strategyTags: tags,
      });

      for (const f of shots) await apiCreateAttachment(trade.id, f);

      onCreated(trade);
      onClose();
    } catch (e: any) {
      setErr(String(e?.message ?? "Create trade failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="New trade" onClose={onClose}>
      {err && <div className="mb-3 text-sm text-red-600">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="text-xs mb-1">Ticker</div>
          <Input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} />
        </div>

        <div>
          <div className="text-xs mb-1">Side</div>
          <div className="flex gap-2">
            <Button variant={side === "LONG" ? "default" : "outline"} onClick={() => setSide("LONG")}>LONG</Button>
            <Button variant={side === "SHORT" ? "default" : "outline"} onClick={() => setSide("SHORT")}>SHORT</Button>
          </div>
        </div>

        <div>
          <div className="text-xs mb-1">Entry</div>
          <Input type="number" value={entryPrice} onChange={e => setEntryPrice(e.target.value ? Number(e.target.value) : "")} />
        </div>

        <div>
          <div className="text-xs mb-1">Stop</div>
          <Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value ? Number(e.target.value) : "")} />
        </div>

        <div>
          <div className="text-xs mb-1">Target</div>
          <Input type="number" value={target} onChange={e => setTarget(e.target.value ? Number(e.target.value) : "")} />
        </div>

        <div>
          <div className="text-xs mb-1">Size</div>
          <Input type="number" value={size} onChange={e => setSize(e.target.value ? Number(e.target.value) : "")} />
        </div>

        <div className="md:col-span-3">
          <div className="text-xs mb-1">Strategy</div>
          <div className="flex flex-wrap gap-2">
            {STRATEGY_TAGS.map(tag => (
              <Button key={tag} size="sm" variant={tags.includes(tag) ? "default" : "outline"} onClick={() => toggleTag(tag)}>
                {tags.includes(tag) ? `− ${tag}` : `+ ${tag}`}
              </Button>
            ))}
          </div>
        </div>

        <div className="md:col-span-3">
          <div className="text-xs mb-1">Notes</div>
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="h-24" />
        </div>

        <div className="md:col-span-3">
          <ImagePasteDrop files={shots} setFiles={setShots} />
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          onClick={submit}
          disabled={saving || !ticker || !entryPrice || !!kpiError || !size || !stopLoss || (guardsEnabled && (exceedsPerTrade || exceedsDaily))}
        >
          Create
        </Button>
      </div>

      <div className="mt-2 text-[11px] text-muted-foreground">
        Trade risk: ${currentRisk$.toFixed(2)} · Per-trade cap: ${perTradeCap$.toFixed(2)} · Daily remaining: ${dailyRemaining$.toFixed(2)}
      </div>
    </ModalShell>
  );
}

function CloseTradeDialog({
  trade, onClosed, onClose
}: { trade: Trade; onClosed: (id: string) => void; onClose: () => void }) {
  const [exitPrice, setExitPrice] = useState<number | "">("");
  const [notes, setNotes] = useState(trade.notes ?? "");
  const [shots, setShots] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await apiCloseTrade(trade.id, { exitPrice: exitPrice ? Number(exitPrice) : undefined, notes });
      for (const f of shots) await apiCreateAttachment(trade.id, f);
      emitTradeClosed({ tradeId: trade.id });
      onClosed(String(trade.id));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`Close ${trade.ticker}`} onClose={onClose}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="text-xs mb-1">Exit price</div>
          <Input type="number" value={exitPrice} onChange={e => setExitPrice(e.target.value ? Number(e.target.value) : "")} />
        </div>
        <div className="md:col-span-2">
          <div className="text-xs mb-1">Notes</div>
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="h-24" />
        </div>
        <div className="md:col-span-2">
          <ImagePasteDrop files={shots} setFiles={setShots} label="Click or paste exit screenshot (Ctrl/Cmd+V)" />
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={saving}>Close trade</Button>
      </div>
    </ModalShell>
  );
}

export default function Dashboard() {
  const [risk, setRisk] = useState<RiskPolicy>({ maxRiskPerTradePct: 1, maxDailyLossPct: 3, maxTradesPerDay: 6 });
  const [openTrades, setOpenTrades] = useState<Trade[]>([]);
  const [calendarKick, setCalendarKick] = useState(0);

  const [todaysPL, setTodaysPL] = useState(0);
  const [totalPL, setTotalPL] = useState(0);
  const [totalEquity, setTotalEquity] = useState<number>(() => {
    try {
      const v = localStorage.getItem(LAST_EQUITY_KEY);
      return v ? Number(v) : 0;
    } catch { return 0; }
  });
  const [dayStartEquity, setDayStartEquity] = useState(0);
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [usedDailyRiskPct, setUsedDailyRiskPct] = useState(0);
  const [kpiError, setKpiError] = useState<string | null>(null);

  const refreshGuard = useRef<{ inflight: boolean; nextOk: number }>({ inflight: false, nextOk: 0 });

  const perTradeRisk$ = (t: Trade) => {
    if (!t.size || !t.stopLoss || !t.entryPrice) return 0;
    const perUnit = t.side === "LONG" ? Math.max(0, t.entryPrice - t.stopLoss) : Math.max(0, t.stopLoss - t.entryPrice);
    return perUnit * t.size;
  };

  const openRisk$ = useMemo(() => openTrades.reduce((sum, t) => sum + perTradeRisk$(t), 0), [openTrades]);
  const realizedLoss$Today = useMemo(() => Math.max(0, -Number(todaysPL || 0)), [todaysPL]);

  const baseEquityForBudget = useMemo(() => {
    const e0 = Number(dayStartEquity || 0);
    if (isFinite(e0) && e0 > 0) return e0;
    const te = Number(totalEquity || 0);
    return isFinite(te) && te > 0 ? te : 0;
  }, [dayStartEquity, totalEquity]);

  const clientUsedDailyRiskPct = useMemo(() => {
    if (!isFinite(baseEquityForBudget) || baseEquityForBudget <= 0) return 0;
    const used$ = realizedLoss$Today + openRisk$;
    return (used$ / baseEquityForBudget) * 100;
  }, [baseEquityForBudget, realizedLoss$Today, openRisk$]);

  const displayUsedDailyRiskPct = Math.max(usedDailyRiskPct, clientUsedDailyRiskPct);
  const usedPctOfBudget = calcUsedPctOfBudget(displayUsedDailyRiskPct, risk.maxDailyLossPct);

  const guardsEnabled = baseEquityForBudget > 0;
  const perTradeCap$ = useMemo(() => baseEquityForBudget > 0 ? baseEquityForBudget * (risk.maxRiskPerTradePct / 100) : 0, [baseEquityForBudget, risk.maxRiskPerTradePct]);
  const dailyBudget$ = useMemo(() => baseEquityForBudget > 0 ? baseEquityForBudget * (risk.maxDailyLossPct / 100) : 0, [baseEquityForBudget, risk.maxDailyLossPct]);
  const dailyRemaining$ = Math.max(0, dailyBudget$ - (realizedLoss$Today + openRisk$));

  const getMonthSummaries = useCallback(async (year: number, month0: number): Promise<DaySummary[]> => {
    const startISO = ymdLocal(new Date(year, month0, 1));
    const endISO = ymdLocal(new Date(year, month0 + 1, 0));
    try {
      const res = await fetch(`/api/journal/pnl/daily/?start=${startISO}&end=${endISO}`, { credentials: "include" });
      if (res.ok) {
        const rows = await res.json();
        return (rows || []).map((r: any) => ({
          date: String(r.date ?? r.day ?? ""),
          pl: Number(r.pl ?? r.pnl ?? 0),
          trades: Number(r.trades ?? 0),
          win_rate: Number(r.win_rate ?? 0),
          avg_r: Number(r.avg_r ?? 0),
          best_r: Number(r.best_r ?? 0),
          worst_loss_r: Number(r.worst_loss_r ?? r.worst_r ?? 0),
          max_dd_pct: Number(r.max_dd_pct ?? 0),
        }));
      }
    } catch { /* fall back */ }
    return [];
  }, []);

  const getDayTrades = useCallback(async (isoDate: string) => {
    try {
      const res = await fetch(`/api/journal/trades/?status=CLOSED&journal_day__date=${isoDate}&ordering=entry_time`, { credentials: "include" });
      const payload = await res.json();
      const items: any[] = Array.isArray(payload) ? payload : (payload.results ?? []);
      return items.map((t) => ({
        id: t.id,
        ticker: t.ticker,
        side: t.side,
        r: t.r ?? null,
        entry: t.entry_price ?? null,
        exit: t.exit_price ?? null,
        size: t.size ?? null,
        tags: t.strategy_tags ?? t.strategyTags ?? [],
        notes: t.notes ?? "",
      }));
    } catch {
      return [];
    }
  }, []);

  const refreshDashboard = useCallback(async () => {
    const now = Date.now();
    if (refreshGuard.current.inflight || now < refreshGuard.current.nextOk) return;
    refreshGuard.current.inflight = true;
    try {
      const st = await fetchSessionStatusToday();
      setUsedDailyRiskPct(Number(st?.used_daily_risk_pct ?? 0));
      setSession({
        trades: Number(st?.trades ?? 0),
        win_rate: Number(st?.win_rate ?? 0),
        avg_r: Number(st?.avg_r ?? 0),
        best_r: Number(st?.best_r ?? 0),
        worst_r: Number(st?.worst_r ?? 0),
        max_dd_pct: Number(st?.max_dd_pct ?? st?.max_dd ?? 0),
      });
      setKpiError(null);
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.includes("User settings not configured")) setKpiError("User settings not configured.");
      if (msg.toLowerCase().includes("throttled") || msg.includes("429")) refreshGuard.current.nextOk = now + 60_000;
    }

    try {
      const acct = await fetchAccountSummary();
      const nextTodayPL = Number(acct?.pl_today ?? 0);
      const nextTotalPL = Number(acct?.pl_total ?? 0);
      const candidateEquity = Number(acct?.equity_today ?? acct?.equity_last_close ?? NaN);

      setTodaysPL(nextTodayPL);
      setTotalPL(nextTotalPL);
      setTotalEquity((prev) => {
        const ok = isFinite(candidateEquity) && candidateEquity > 0;
        const val = ok ? candidateEquity : prev;
        try { localStorage.setItem(LAST_EQUITY_KEY, String(val)); } catch {}
        return val;
      });
    } catch (e: any) {
      if (String(e?.message ?? "").includes("429")) refreshGuard.current.nextOk = Date.now() + 60_000;
    }

    try {
      const todayISO = ymdLocal(new Date());
      const day = await getOrCreateJournalDay(todayISO);
      const nextE0 = Number((day as any)?.day_start_equity ?? (day as any)?.effective_equity ?? 0);
      setDayStartEquity((prev) => (isFinite(nextE0) && nextE0 > 0 ? nextE0 : prev));
    } catch {
      // ignore
    } finally {
      refreshGuard.current.inflight = false;
    }
  }, []);

  // pull settings + trades once on mount
  useEffect(() => {
    (async () => {
      try {
        const settings = await apiFetchUserSettings();
        if (settings) {
          if (!hasStoredTheme()) setTheme(!!settings.dark_mode);
          setRisk((r) => ({
            ...r,
            maxRiskPerTradePct: Number(settings.max_risk_per_trade_pct ?? r.maxRiskPerTradePct),
            maxDailyLossPct: Number(settings.max_daily_loss_pct ?? r.maxDailyLossPct),
            maxTradesPerDay: Number(settings.max_trades_per_day ?? r.maxTradesPerDay),
          }));
        }
      } catch {}

      try {
        const trades = await apiFetchOpenTrades();
        setOpenTrades(Array.isArray(trades) ? (trades as Trade[]) : []);
      } catch {}

      void refreshDashboard();
    })();
  }, [refreshDashboard]);

  // KPI poll + tab visibility refresh
  useEffect(() => {
    let handle: any;
    const pull = () => void refreshDashboard();
    handle = setInterval(pull, 30000);
    const onVis = () => { if (document.visibilityState === "visible") pull(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(handle);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshDashboard]);

  useEffect(() => {
    const off = onTradeClosed(() => setCalendarKick(k => k + 1));
    return off;
  }, []);

  const [showNew, setShowNew] = useState(false);
  const [closing, setClosing] = useState<Trade | null>(null);

  const RiskSummary = () => (
    <Card>
      <CardContent className="p-4">
        <h2 className="font-bold mb-2">Risk settings & status</h2>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Max risk / trade</div>
            <div className="font-medium">{risk.maxRiskPerTradePct}%</div>
          </div>
          <div>
            <div className="text-muted-foreground">Max loss / day</div>
            <div className="font-medium">{risk.maxDailyLossPct}%</div>
          </div>
          <div>
            <div className="text-muted-foreground">Max trades / day</div>
            <div className="font-medium">{risk.maxTradesPerDay}</div>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Daily risk used</span>
            <span className="font-medium">
              {displayUsedDailyRiskPct.toFixed(2)}% / {risk.maxDailyLossPct}%
            </span>
          </div>
          <Progress value={usedPctOfBudget} />
          <div className="mt-1 text-[11px] text-muted-foreground">
            Open risk: ${openRisk$.toFixed(2)} · Realized loss: ${realizedLoss$Today.toFixed(2)} · Budget: ${(baseEquityForBudget * (risk.maxDailyLossPct / 100)).toFixed(2)}
          </div>
        </div>

        {kpiError && (
          <div className="mt-3 text-xs text-amber-600">
            {kpiError} — set your account/risk in <span className="underline">Risk</span>.
          </div>
        )}
      </CardContent>
    </Card>
  );

  const AccountSummary = () => (
    <Card>
      <CardContent className="p-4">
        <h2 className="font-bold mb-2">Account Summary</h2>
        <ul className="grid grid-cols-3 gap-4 text-sm">
          <li>
            <div className="text-muted-foreground">P/L (today)</div>
            <div className="font-semibold">{todaysPL.toFixed(2)}</div>
          </li>
          <li>
            <div className="text-muted-foreground">P/L (total)</div>
            <div className="font-semibold">{totalPL.toFixed(2)}</div>
          </li>
          <li>
            <div className="text-muted-foreground">Total equity</div>
            <div className="font-semibold">{totalEquity.toFixed(2)}</div>
          </li>
        </ul>
      </CardContent>
    </Card>
  );

  const SessionStats = () => (
    <Card>
      <CardContent className="p-4">
        <h2 className="font-bold mb-2">Session Stats</h2>
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
          <div><div className="text-xs text-muted-foreground">Trades</div><div className="text-base font-semibold">{session?.trades ?? 0}</div></div>
          <div><div className="text-xs text-muted-foreground">Win rate</div><div className="text-base font-semibold">{(session?.win_rate ?? 0).toFixed(1)}%</div></div>
          <div><div className="text-xs text-muted-foreground">Avg R</div><div className="text-base font-semibold">{(session?.avg_r ?? 0).toFixed(2)}</div></div>
          <div><div className="text-xs text-muted-foreground">Best R</div><div className="text-base font-semibold">{(session?.best_r ?? 0).toFixed(2)}</div></div>
          <div><div className="text-xs text-muted-foreground">Worst R</div><div className="text-base font-semibold">{(session?.worst_r ?? 0).toFixed(2)}</div></div>
          <div><div className="text-xs text-muted-foreground">Max DD</div><div className="text-base font-semibold">{(session?.max_dd_pct ?? 0).toFixed(2)}%</div></div>
        </div>
      </CardContent>
    </Card>
  );

  const OpenTrades = () => (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold">Open Trades</h2>
          <Button variant="outline" size="sm" onClick={() => setShowNew(true)}>New trade</Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b">
                <th className="py-2 pr-2">Ticker</th>
                <th className="py-2 pr-2">Side</th>
                <th className="py-2 pr-2">Entry</th>
                <th className="py-2 pr-2">Stop</th>
                <th className="py-2 pr-2">Target</th>
                <th className="py-2 pr-2">Size</th>
                <th className="py-2 pr-2">Risk (R)</th>
                <th className="py-2 pr-2">Strategy</th>
                <th className="py-2 pr-2">Notes</th>
                <th className="py-2 pr-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {openTrades.map((t) => (
                <tr key={t.id} className="border-b last:border-none align-top">
                  <td className="py-2 pr-2 font-medium">{t.ticker}</td>
                  <td className="py-2 pr-2">{t.side}</td>
                  <td className="py-2 pr-2">{t.entryPrice.toFixed(2)}</td>
                  <td className="py-2 pr-2">{t.stopLoss?.toFixed(2) ?? "-"}</td>
                  <td className="py-2 pr-2">{t.target?.toFixed(2) ?? "-"}</td>
                  <td className="py-2 pr-2">{t.size ?? "-"}</td>
                  <td className="py-2 pr-2">
                    {(() => {
                      const perUnit =
                        t.stopLoss == null || t.size == null
                          ? 0
                          : (t.side === "LONG"
                              ? Math.max(0, t.entryPrice - t.stopLoss)
                              : Math.max(0, t.stopLoss - t.entryPrice));
                      const riskDollar = perUnit * (t.size ?? 0);
                      const r = perTradeCap$ > 0 ? riskDollar / perTradeCap$ : 0;
                      return riskDollar ? r.toFixed(2) : "-";
                    })()}
                  </td>
                  <td className="py-2 pr-2 max-w-[200px]">
                    <div className="flex flex-wrap gap-1">
                      {(t.strategyTags ?? []).map((tag) => (
                        <Badge key={tag} variant="secondary" className="rounded-full">{tag}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 pr-2 max-w-[240px]">
                    <div className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-3">
                      {t.notes || ""}
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    <Button size="sm" variant="outline" onClick={() => setClosing(t)}>Close</Button>
                  </td>
                </tr>
              ))}
              {openTrades.length === 0 && (
                <tr><td colSpan={11} className="py-3 text-muted-foreground">No open trades.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <>
      <div className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <RiskSummary />
            <AccountSummary />
            <SessionStats />
          </div>
          <div className="space-y-4">
            <OpenTrades />
          </div>
        </div>

        <TradesCalendar
          refreshToken={calendarKick}
          dayStartEquity={dayStartEquity}
          maxDailyLossPct={risk.maxDailyLossPct}
          getMonthSummaries={getMonthSummaries}
          getDayTrades={getDayTrades}
        />
      </div>

      {showNew && (
        <NewTradeDialog
          onClose={() => setShowNew(false)}
          onCreated={async () => {
            try {
              const fresh = await apiFetchOpenTrades();
              setOpenTrades(Array.isArray(fresh) ? (fresh as Trade[]) : []);
            } catch {}
            void refreshDashboard();
          }}
          kpiError={kpiError}
          perTradeCap$={perTradeCap$}
          dailyRemaining$={dailyRemaining$}
          guardsEnabled={guardsEnabled}
        />
      )}

      {closing && (
        <CloseTradeDialog
          trade={closing}
          onClose={() => setClosing(null)}
          onClosed={(id) => {
            setOpenTrades(prev => prev.filter(t => String(t.id) !== String(id)));
            void refreshDashboard();
          }}
        />
      )}
    </>
  );
}