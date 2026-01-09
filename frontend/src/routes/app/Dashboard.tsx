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
  type CommissionMode,
  type NormalizedTrade,
  updateTrade,
  scaleTrade as apiScaleTrade,
} from "@/lib/api";
import { getInitialDark, hasStoredTheme, setTheme } from "@/lib/theme";
import { onTradeClosed, emitTradeClosed } from "@/lib/events";
import JournalDashboard from "@/components/journal/JournalDashboard";
import TradeEditor from "@/components/TradeEditor";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import DashboardPanel from "@/components/dashboard/DashboardPanel";

import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";

import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";

import { CSS } from "@dnd-kit/utilities";

type RiskPolicy = {
  maxRiskPerTradePct: number;
  maxDailyLossPct: number;
  maxTradesPerDay: number;
};

type CommissionPolicy = {
  commission_mode: CommissionMode;
  commission_value: number;
  commission_per_share: number;
  commission_min_per_side: number;
  commission_cap_pct_of_notional: number;
};


// Use the ONE canonical UI trade type returned by src/lib/api.ts
type Trade = NormalizedTrade;
 
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
const STRATEGY_TAGS = ["Breakout", "Pullback", "Reversal", "VWAP", "Trend", "News"];

type DashboardWidgetId = "risk" | "account" | "session" | "openTrades" | "calendar";
type DashboardWidgetState = { id: DashboardWidgetId; open: boolean };

const DASHBOARD_LAYOUT_KEY = "dashboard_layout_v1";

const DEFAULT_DASHBOARD_LAYOUT: DashboardWidgetState[] = [
  { id: "risk", open: true },
  { id: "account", open: true },
  { id: "session", open: true },
  { id: "openTrades", open: true },
  { id: "calendar", open: true },
];

const PANEL_TITLES: Record<DashboardWidgetId, string> = {
  risk: "Risk",
  account: "Account",
  session: "Session statistics",
  openTrades: "Open trades",
  calendar: "Calendar",
};

function normalizeDashboardLayout(input: unknown): DashboardWidgetState[] {
  const byId = new Map<DashboardWidgetId, DashboardWidgetState>();

  for (const d of DEFAULT_DASHBOARD_LAYOUT) byId.set(d.id, { ...d });

  if (Array.isArray(input)) {
    for (const raw of input) {
      if (!raw || typeof raw !== "object") continue;
      const obj = raw as any;
      const id = obj.id as DashboardWidgetId;
      if (!byId.has(id)) continue;
      byId.set(id, { id, open: typeof obj.open === "boolean" ? obj.open : true });
    }

    // Preserve incoming order for known ids; append any missing defaults at end
    const ordered: DashboardWidgetState[] = [];
    for (const raw of input) {
      const id = (raw as any)?.id as DashboardWidgetId;
      if (byId.has(id)) ordered.push(byId.get(id)!);
      byId.delete(id);
    }
    for (const remaining of byId.values()) ordered.push(remaining);
    return ordered;
  }

  return DEFAULT_DASHBOARD_LAYOUT;
}

function SortableDashboardItem({
  id,
  title,
  isOpen,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <DashboardPanel
        title={title}
        isOpen={isOpen}
        onToggle={onToggle}
        dragHandleProps={{
          ...attributes,
          ...listeners,
        }}
      >
        {children}
      </DashboardPanel>
    </div>
  );
}

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
  onCreated: (t: Trade) => void | Promise<void>;
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
  const [entryEmotion, setEntryEmotion] = useState<"NEUTRAL" | "BIASED">("NEUTRAL");
  const [entryEmotionNote, setEntryEmotionNote] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [shots, setShots] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function formatScaleError(e: any): { message: string; extra?: string[] } {
    // Default fallback
    const fallback = { message: String(e?.message ?? e ?? "Scale trade failed") };

    // Common case: fetch() error text is thrown, sometimes it's JSON in a string
    const rawMsg = String(e?.message ?? "");
    const tryParseJsonString = (s: string) => {
      try {
        const j = JSON.parse(s);
        return j && typeof j === "object" ? j : null;
      } catch {
        return null;
      }
    };

    const obj =
      (e && typeof e === "object" && (e.detail || e.code || e.data) ? e : null) ||
      (rawMsg ? tryParseJsonString(rawMsg) : null);

    if (!obj) return fallback;

    const detail = typeof obj.detail === "string" && obj.detail.trim() ? obj.detail.trim() : "";
    const message = detail || fallback.message;

    const d = obj.data && typeof obj.data === "object" ? obj.data : null;
    if (!d) return { message };

    const extra: string[] = [];
    const per = d.per_trade_risk_pct ?? d.perTradeRiskPct;
    const max = d.max_risk_per_trade_pct ?? d.maxRiskPerTradePct;
    const qty = d.new_quantity ?? d.newQuantity;
    const price = d.price;
    const stop = d.stop_price ?? d.stopPrice;
    const eq = d.effective_equity ?? d.effectiveEquity;

    if (per != null && max != null) extra.push(`Per-trade risk: ${per}% (max ${max}%)`);
    if (qty != null) extra.push(`New quantity: ${qty}`);
    if (price != null) extra.push(`Price: ${price}`);
    if (stop != null) extra.push(`Stop: ${stop}`);
    if (eq != null) extra.push(`Effective equity: ${eq}`);

    return { message, extra: extra.length ? extra : undefined };
  }

  const toggleTag = (tag: string) => setTags(t => t.includes(tag) ? t.filter(x => x !== tag) : [...t, tag]);

  const currentRisk$ = useMemo(() => {
    if (!size || !entryPrice || !stopLoss) return 0;
    const ep = Number(entryPrice), sp = Number(stopLoss), q = Number(size);
    const perUnit = side === "LONG" ? Math.max(0, ep - sp) : Math.max(0, sp - ep);
    return perUnit * q;
  }, [side, entryPrice, stopLoss, size]);

  const positionValue$ = useMemo(() => {
    if (!size || !entryPrice) return 0;
    return Number(entryPrice) * Number(size);
  }, [entryPrice, size]);
  
  const perUnitRisk$ = useMemo(() => {
    if (!entryPrice || !stopLoss) return 0;
    const ep = Number(entryPrice), sp = Number(stopLoss);
    return side === "LONG" ? Math.max(0, ep - sp) : Math.max(0, sp - ep);
  }, [side, entryPrice, stopLoss]);

const fmtMoney = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
        entryEmotion,
        entryEmotionNote,
      });

      for (const f of shots) await apiCreateAttachment(trade.id, f);

      await Promise.resolve(onCreated(trade));
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

        <div className="md:col-span-3 -mt-1 text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
          <div>
            Position value:{" "}
            <span className="font-medium text-foreground tabular-nums">
              ${fmtMoney(positionValue$)}
            </span>
          </div>

          <div>
            Risk at stop:{" "}
            <span className="font-medium text-foreground tabular-nums">
              ${fmtMoney(currentRisk$)}
            </span>
            <span className="ml-2 tabular-nums">
              (per-share: ${fmtMoney(perUnitRisk$)})
            </span>
          </div>
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
          <div className="text-xs mb-1">Entry emotion</div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={entryEmotion === "NEUTRAL" ? "default" : "outline"}
              onClick={() => setEntryEmotion("NEUTRAL")}
            >
              Neutral
            </Button>
            <Button
              type="button"
              size="sm"
              variant={entryEmotion === "BIASED" ? "default" : "outline"}
              onClick={() => setEntryEmotion("BIASED")}
            >
              Biased
            </Button>
          </div>

          <div className="mt-2 text-xs mb-1">Entry emotion note (optional)</div>
          <Input
            value={entryEmotionNote}
            onChange={(e) => setEntryEmotionNote(e.target.value)}
            placeholder="e.g. FOMO, revenge, must-make-money…"
          />
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
  trade,
  onClosed,
  onClose,
  commissionPolicy,
}: {
  rade: Trade;
  onClosed: (id: string) => void;
  onClose: () => void;
  commissionPolicy: CommissionPolicy | null;
}) {
  const [exitPrice, setExitPrice] = useState<number | "">("");
  const [notes, setNotes] = useState(trade.notes ?? "");
  const [exitEmotion, setExitEmotion] = useState<"NEUTRAL" | "BIASED">("NEUTRAL");
  const [exitEmotionNote, setExitEmotionNote] = useState("");
  const [shots, setShots] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const fmtMoney = (n: number) =>
    Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const calcCommissionForSide = useCallback(
    (price: number, qty: number) => {
      if (!commissionPolicy) return 0;
      if (!Number.isFinite(price) || price <= 0) return 0;
      if (!Number.isFinite(qty) || qty <= 0) return 0;

      const notional = price * qty;

      if (commissionPolicy.commission_mode === "PCT") {
        const pct = Number(commissionPolicy.commission_value || 0);
        return Math.round((notional * (pct / 100)) * 100) / 100;
      }

      if (commissionPolicy.commission_mode === "FIXED") {
        return Math.round(Number(commissionPolicy.commission_value || 0) * 100) / 100;
      }

      // PER_SHARE
      const perShare = Number(commissionPolicy.commission_per_share || 0);
      let fee = perShare * qty;
      const min = Number(commissionPolicy.commission_min_per_side || 0);
      if (min > 0) fee = Math.max(fee, min);
      const capPct = Number(commissionPolicy.commission_cap_pct_of_notional || 0);
      if (capPct > 0) fee = Math.min(fee, notional * (capPct / 100));
      return Math.round(fee * 100) / 100;
    },
    [commissionPolicy]
  );

  /**
   * If the trade has scaled, trade.size may be the original size.
   * Use current positionQty when available so commission estimates aren't wrong.
   */
  const qty = Number(trade.positionQty ?? trade.size ?? 0);
  const entryComm = Number(trade.commissionEntry || 0);
  const estExitComm = useMemo(() => {
    const px = Number(exitPrice || 0);
    return px > 0 && qty > 0 ? calcCommissionForSide(px, qty) : 0;
  }, [exitPrice, qty, calcCommissionForSide]);


  const submit = async () => {
    setSaving(true);
    try {
      await apiCloseTrade(trade.id, {
        exitPrice: exitPrice ? Number(exitPrice) : undefined,
        notes,
        exitEmotion,
        exitEmotionNote,
      });

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
          <Input
            type="number"
            value={exitPrice}
            onChange={(e) => setExitPrice(e.target.value ? Number(e.target.value) : "")}
          />
        </div>

        <div className="md:col-span-2 text-xs text-muted-foreground space-y-1">
          <div>Entry commission: ${fmtMoney(entryComm)}</div>
          <div>Exit commission (est.): ${fmtMoney(estExitComm)}</div>
          <div className="font-medium text-foreground">
            Total commission: ${fmtMoney(entryComm + estExitComm)}
          </div>
        </div>

        <div className="md:col-span-2">
          <div className="text-xs mb-1">Exit emotion</div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={exitEmotion === "NEUTRAL" ? "default" : "outline"}
              onClick={() => setExitEmotion("NEUTRAL")}
            >
              Neutral
            </Button>
            <Button
              type="button"
              size="sm"
              variant={exitEmotion === "BIASED" ? "default" : "outline"}
              onClick={() => setExitEmotion("BIASED")}
            >
              Biased
            </Button>
          </div>

          <div className="mt-2 text-xs mb-1">Exit emotion note (optional)</div>
          <Input
            value={exitEmotionNote}
            onChange={(e) => setExitEmotionNote(e.target.value)}
            placeholder="e.g. panic sell, hesitated, took profit too early…"
          />
        </div>

        <div className="md:col-span-2">
          <div className="text-xs mb-1">Notes</div>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="h-24" />
        </div>

        <div className="md:col-span-2">
          <ImagePasteDrop files={shots} setFiles={setShots} label="Click or paste exit screenshot (Ctrl/Cmd+V)" />
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={saving || !exitPrice}>
          Close trade
        </Button>
      </div>
    </ModalShell>
  );
}


function ScaleTradeDialog({
  trade,
  onScaled,
  onClose,
  perTradeCap$,
}: {
  trade: Trade;
  onScaled: (updated: Trade) => void;
  onClose: () => void;
  perTradeCap$: number;
}) {
  const [mode, setMode] = useState<"IN" | "OUT">("IN");
  const [qty, setQty] = useState<number | "">("");
  const [price, setPrice] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Current live position + cost basis (preferred after scaling)
  const currentQty = Number(trade.positionQty ?? trade.size ?? 0);
  const entryPx = Number(trade.avgEntryPrice ?? trade.entryPrice ?? 0);
  const stopPx = trade.stopLoss == null ? NaN : Number(trade.stopLoss);

  const fmtMoney = (n: number) =>
    Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Determine the effective price we will use for a scale action (same rule as submit()).
  const effectivePrice = useMemo(() => {
    const px =
      price === "" || price === null || price === undefined
        ? entryPx
        : Number(price);
    return Number.isFinite(px) ? px : NaN;
  }, [price, entryPx]);

  // Helper: per-share risk based on (avgEntry, stop) and side.
  const perShareRisk = useCallback(
    (avgEntry: number) => {
      if (!Number.isFinite(avgEntry) || !Number.isFinite(stopPx)) return NaN;
      if (trade.side === "LONG") return Math.max(0, avgEntry - stopPx);
      return Math.max(0, stopPx - avgEntry);
    },
    [trade.side, stopPx]
  );

  const currentRisk$ = useMemo(() => {
    if (!Number.isFinite(currentQty) || currentQty <= 0) return 0;
    const rps = perShareRisk(entryPx);
    if (!Number.isFinite(rps)) return NaN;
    return rps * currentQty;
  }, [currentQty, entryPx, perShareRisk]);

  // Preview next qty + next avg entry after applying this scale action.
  const preview = useMemo(() => {
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      return {
        valid: false as const,
        nextQty: currentQty,
        nextAvgEntry: entryPx,
        nextRisk$: NaN,
        deltaRisk$: NaN,
      };
    }

    // qty is always positive from the UI; direction controls in/out.
    const deltaQty = Math.round(Math.abs(q));

    let nextQty = currentQty;
    let nextAvgEntry = entryPx;

    if (mode === "IN") {
      nextQty = currentQty + deltaQty;
      // Weighted avg entry after adding at effectivePrice
      // (If currentQty is 0, avg entry becomes effectivePrice.)
      if (nextQty > 0) {
        const baseNotional = (currentQty > 0 ? entryPx * currentQty : 0);
        const addNotional = effectivePrice * deltaQty;
        nextAvgEntry = (baseNotional + addNotional) / nextQty;
      }
    } else {
      // OUT
      nextQty = Math.max(0, currentQty - deltaQty);
      // Avg entry does not change when scaling out
      nextAvgEntry = entryPx;
    }

    const rpsNext = perShareRisk(nextAvgEntry);
    const nextRisk$ = Number.isFinite(rpsNext) ? rpsNext * nextQty : NaN;

    const deltaRisk$ =
      Number.isFinite(currentRisk$) && Number.isFinite(nextRisk$) ? nextRisk$ - currentRisk$ : NaN;

    return {
      valid: true as const,
      nextQty,
      nextAvgEntry,
      nextRisk$,
      deltaRisk$,
    };
  }, [qty, mode, currentQty, entryPx, effectivePrice, perShareRisk, currentRisk$]);

  const currentRiskR = useMemo(() => {
    if (!Number.isFinite(currentRisk$) || perTradeCap$ <= 0) return NaN;
    return currentRisk$ / perTradeCap$;
  }, [currentRisk$, perTradeCap$]);

  const nextRiskR = useMemo(() => {
    if (!Number.isFinite(preview.nextRisk$) || perTradeCap$ <= 0) return NaN;
    return preview.nextRisk$ / perTradeCap$;
  }, [preview.nextRisk$, perTradeCap$]);

  const submit = async () => {
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      setErr("Enter a positive quantity.");
      return;
    }

    // Backend currently expects a price. If user leaves it empty, use a deterministic fallback.
    // We pick the current cost basis (avg entry for scaled trades, else entryPrice).

    if (!Number.isFinite(effectivePrice) || effectivePrice <= 0) {
      setErr("Enter a valid price (or make sure this trade has a valid entry price).");
      return;
    }

    // simple client guard: don't allow scaling out more than current size
    if (mode === "OUT" && currentQty > 0 && Math.abs(q) > currentQty) {
      setErr(`Cannot scale out ${q}; current position is ${currentQty}.`);
      return;
    }

    setSaving(true);
    try {
      setErr(null);
      const updated = await apiScaleTrade(trade.id, {
        direction: mode === "IN" ? "IN" : "OUT",
        quantity: Math.round(Math.abs(q)),
        price: effectivePrice,
        note,
      });
      onScaled(updated);
      onClose();
    } catch (e: any) {
      const parsed = formatScaleError(e);
      // Store a single string; we’ll render extra lines if present by encoding newlines
      const combined = parsed.extra?.length
        ? `${parsed.message}\n\n${parsed.extra.map((x) => `• ${x}`).join("\n")}`
        : parsed.message;
      setErr(combined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`Scale ${trade.ticker}`} onClose={onClose}>
      {err && (
        <div className="mb-3 text-sm text-red-600 whitespace-pre-wrap">
          {err}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-3 text-xs text-muted-foreground">
          Current position: <span className="font-medium text-foreground">{currentQty || "-"}</span>{" "}
          · Avg entry: <span className="font-medium text-foreground">{entryPx ? entryPx.toFixed(2) : "-"}</span>
        </div>
        
        <div className="md:col-span-3 -mt-1 text-xs text-muted-foreground">
          {Number.isFinite(stopPx) && stopPx > 0 ? (
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <div>
                Current risk at stop:{" "}
                <span className="font-medium text-foreground tabular-nums">
                  ${Number.isFinite(currentRisk$) ? fmtMoney(currentRisk$) : "-"}
                </span>
                {Number.isFinite(currentRiskR) ? (
                  <span className="ml-2 tabular-nums">(R: {currentRiskR.toFixed(2)})</span>
                ) : null}
              </div>

              <div>
                After scale:{" "}
                <span className="font-medium text-foreground tabular-nums">
                  ${Number.isFinite(preview.nextRisk$) ? fmtMoney(preview.nextRisk$) : "-"}
                </span>
                {Number.isFinite(nextRiskR) ? (
                  <span className="ml-2 tabular-nums">(R: {nextRiskR.toFixed(2)})</span>
                ) : null}
                {Number.isFinite(preview.deltaRisk$) ? (
                  <span className="ml-2 tabular-nums">
                    (Δ {preview.deltaRisk$ >= 0 ? "+" : "−"}${fmtMoney(Math.abs(preview.deltaRisk$))})
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="text-amber-600">
              Risk preview unavailable: this trade has no stop price.
            </div>
          )}
        </div>

        <div>
          <div className="text-xs mb-1">Action</div>
          <div className="flex gap-2">
            <Button variant={mode === "IN" ? "default" : "outline"} onClick={() => setMode("IN")}>
              Scale in
            </Button>
            <Button variant={mode === "OUT" ? "default" : "outline"} onClick={() => setMode("OUT")}>
              Scale out
            </Button>
          </div>
        </div>

        <div>
          <div className="text-xs mb-1">Quantity</div>
          <Input
            type="number"
            value={qty}
            onChange={(e) => setQty(e.target.value ? Number(e.target.value) : "")}
            placeholder="e.g. 100"
          />
        </div>

        <div>
          <div className="text-xs mb-1">Price</div>
          <Input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value ? Number(e.target.value) : "")}
            placeholder={entryPx ? `leave empty to use ${entryPx.toFixed(2)}` : "enter a price"}
          />
        </div>

        <div className="md:col-span-3">
          <div className="text-xs mb-1">Note (optional)</div>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="h-20" />
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={saving || !qty}>
          Apply
        </Button>
      </div>
    </ModalShell>
  );
}

export default function Dashboard() {
  const [risk, setRisk] = useState<RiskPolicy>({ maxRiskPerTradePct: 1, maxDailyLossPct: 3, maxTradesPerDay: 6 });
  const [openTrades, setOpenTrades] = useState<Trade[]>([]);
  const [commissionPolicy, setCommissionPolicy] = useState<CommissionPolicy | null>(null);
  const [calendarKick, setCalendarKick] = useState(0);

  const [dashboardLayout, setDashboardLayout] = useState<DashboardWidgetState[]>(() => {
    try {
      const stored = localStorage.getItem(DASHBOARD_LAYOUT_KEY);
      return stored ? normalizeDashboardLayout(JSON.parse(stored)) : DEFAULT_DASHBOARD_LAYOUT;
    } catch {
      return DEFAULT_DASHBOARD_LAYOUT;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(DASHBOARD_LAYOUT_KEY, JSON.stringify(dashboardLayout));
    } catch {
      // ignore storage errors
    }
  }, [dashboardLayout]);

  const togglePanel = (id: DashboardWidgetId) => {
    setDashboardLayout((prev) => prev.map((p) => (p.id === id ? { ...p, open: !p.open } : p)));
  };

    const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    if (active.id === over.id) return;

    setDashboardLayout((prev) => {
      const oldIndex = prev.findIndex((p) => p.id === active.id);
      const newIndex = prev.findIndex((p) => p.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

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
    const qty = Number(t.positionQty ?? t.size ?? 0);
    const entry = Number(t.avgEntryPrice ?? t.entryPrice ?? 0);
    const stop = t.stopLoss == null ? NaN : Number(t.stopLoss);

    if (!qty || !isFinite(qty) || !isFinite(entry) || !isFinite(stop)) return 0;

    const perUnit =
      t.side === "LONG" ? Math.max(0, entry - stop) : Math.max(0, stop - entry);

    return perUnit * qty;
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
          setCommissionPolicy({
            commission_mode: (settings as any).commission_mode ?? "FIXED",
            commission_value: Number((settings as any).commission_value ?? 0),
            commission_per_share: Number((settings as any).commission_per_share ?? 0),
            commission_min_per_side: Number((settings as any).commission_min_per_side ?? 0),
            commission_cap_pct_of_notional: Number((settings as any).commission_cap_pct_of_notional ?? 0),
          });
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
        setOpenTrades(Array.isArray(trades) ? trades : []);
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
    const off = onTradeClosed(() => {
      setCalendarKick(k => k + 1);
      void refreshDashboard();   // immediately refresh KPIs
    });
    return off;
  }, [refreshDashboard]);

  const [showNew, setShowNew] = useState(false);
  const [closing, setClosing] = useState<Trade | null>(null);
  const [editing, setEditing] = useState<Trade | null>(null);
  const [scaling, setScaling] = useState<Trade | null>(null);
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
                <th className="py-2 pr-2 text-right">Comm (E / X)</th>
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
                  <td className="py-2 pr-2">
                    {Number((t.avgEntryPrice ?? t.entryPrice) || 0).toFixed(2)}
                  </td>
                  <td className="py-2 pr-2">{t.stopLoss?.toFixed(2) ?? "-"}</td>
                  <td className="py-2 pr-2">{t.target?.toFixed(2) ?? "-"}</td>
                  <td className="py-2 pr-2">{t.positionQty ?? t.size ?? "-"}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {Number(t.commissionEntry || 0).toFixed(2)}
                    <span className="opacity-60"> / </span>
                    {Number(t.commissionExit || 0).toFixed(2)}
                  </td>
                  <td className="py-2 pr-2">
                    {(() => {
                      const qty = Number(t.positionQty ?? t.size ?? 0);
                      const entry = Number(t.avgEntryPrice ?? t.entryPrice ?? 0);
                      const stop = t.stopLoss == null ? NaN : Number(t.stopLoss);

                      if (!qty || !isFinite(qty) || !isFinite(entry) || !isFinite(stop)) return "-";

                      const perUnit =
                        t.side === "LONG" ? Math.max(0, entry - stop) : Math.max(0, stop - entry);

                      const riskDollar = perUnit * qty;
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
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(t)}>Edit</Button>
                    <Button size="sm" variant="outline" onClick={() => setScaling(t)}>Scale</Button>
                    <Button size="sm" variant="outline" onClick={() => setClosing(t)}>Close</Button>
                  </div>
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
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={dashboardLayout.map((p) => p.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-4">
            {dashboardLayout.map((p) => {
              if (p.id === "risk") {
                return (
                  <SortableDashboardItem
                    key={p.id}
                    id={p.id}
                    title={PANEL_TITLES[p.id]}
                    isOpen={p.open}
                    onToggle={() => togglePanel(p.id)}
                  >
                    <RiskSummary />
                  </SortableDashboardItem>
                );
              }

              if (p.id === "account") {
                return (
                  <SortableDashboardItem
                    key={p.id}
                    id={p.id}
                    title={PANEL_TITLES[p.id]}
                    isOpen={p.open}
                    onToggle={() => togglePanel(p.id)}
                  >
                    <AccountSummary />
                  </SortableDashboardItem>
                );
              }

              if (p.id === "session") {
                return (
                  <SortableDashboardItem
                    key={p.id}
                    id={p.id}
                    title={PANEL_TITLES[p.id]}
                    isOpen={p.open}
                    onToggle={() => togglePanel(p.id)}
                  >
                    <SessionStats />
                  </SortableDashboardItem>
                );
              }

              if (p.id === "openTrades") {
                return (
                  <SortableDashboardItem
                    key={p.id}
                    id={p.id}
                    title={PANEL_TITLES[p.id]}
                    isOpen={p.open}
                    onToggle={() => togglePanel(p.id)}
                  >
                    <OpenTrades />
                  </SortableDashboardItem>
                );
              }

              // calendar
              return (
                <SortableDashboardItem
                  key={p.id}
                  id={p.id}
                  title={PANEL_TITLES[p.id]}
                  isOpen={p.open}
                  onToggle={() => togglePanel(p.id)}
                >
                  <TradesCalendar
                    refreshToken={calendarKick}
                    dayStartEquity={dayStartEquity}
                    maxDailyLossPct={risk.maxDailyLossPct}
                    getMonthSummaries={getMonthSummaries}
                    getDayTrades={getDayTrades}
                  />
                </SortableDashboardItem>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {showNew && (
        <NewTradeDialog
          onClose={() => setShowNew(false)}
          onCreated={async () => {
            try {
              const fresh = await apiFetchOpenTrades();
              setOpenTrades(Array.isArray(fresh) ? fresh : []);
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
          commissionPolicy={commissionPolicy}
        />
      )}

      {editing && (
        <TradeEditor
          mode="edit"
          initial={{
            id: Number(editing.id),
            ticker: editing.ticker,
            side: editing.side,
            entryPrice: editing.entryPrice,
            stopLoss: editing.stopLoss ?? null,
            target: editing.target ?? null,
            // if trade has scaled, show current live size in the editor
            // (editing is disabled, but displayed size should be accurate)
            size: (editing.positionQty ?? editing.size ?? 1),
            notes: editing.notes ?? "",
            strategyTags: editing.strategyTags ?? [],
          }}
          onClose={() => setEditing(null)}
          onSubmit={async (values) => {
            await updateTrade(values.id as any, {
              ticker: values.ticker,
              side: values.side,
              entryPrice: Number(values.entryPrice),
              stopLoss: values.stopLoss ?? null,
              target: values.target ?? null,
              size: Number(values.size),
              notes: values.notes ?? "",
              strategyTags: values.strategyTags ?? [],
            });

            // refresh open trades table after saving
            try {
              const fresh = await apiFetchOpenTrades();
              setOpenTrades(Array.isArray(fresh) ? fresh : []);
            } catch {}
            void refreshDashboard();
          }}
        />
      )}
      {scaling && (
        <ScaleTradeDialog
          trade={scaling}
          onClose={() => setScaling(null)}
          perTradeCap$={perTradeCap$}
          onScaled={(updated) => {
            setOpenTrades((prev) => {
              const u = updated;
              // if fully closed after scaling out, remove from OPEN list
              if (String(u.status || "").toUpperCase() === "CLOSED") return prev.filter((t) => String(t.id) !== String(u.id));
              return prev.map((t) => (String(t.id) === String(u.id) ? u : t));
            });
            void refreshDashboard();
          }}
        />
      )}
    </>
  );
}