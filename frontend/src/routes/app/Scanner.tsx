// frontend/src/routes/app/Scanner.tsx
// Dashboard-style Scanner page:
// - 3 reorderable/collapsible panels (Trigger feed, Heatmap/Top-5, Settings)
// - WS supports: trigger (existing), hot5 (top 5 scored), universe (optional per-symbol stats)
// - Keeps your TriggerRow UI + live Age ticker

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import DashboardPanel from "@/components/dashboard/DashboardPanel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  fetchScannerConfig,
  updateScannerConfig,
  listScannerUniverse,
  addScannerUniverseTicker,
  deleteScannerUniverseTicker,
  listScannerTriggers,
  fetchScannerPreferences,
  updateScannerPreferences,
  emitScannerTestEvent,
  emitScannerTestHot5,
  scannerTriggersWsUrl,
  clearScannerTriggers,
  fetchScannerAdminStatus,
} from "@/lib/api";

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

type ScannerConfig = {
  id: number;
  enabled: boolean;
  timeframe: string;
  min_vol_1m: number;
  rvol_lookback_minutes: number;
  rvol_1m_threshold: number;
  rvol_5m_threshold: number;
  min_pct_change_1m: number;
  min_pct_change_5m: number;
  require_green_candle: boolean;
  require_hod_break: boolean;
  cooldown_minutes: number;
  realert_on_new_hod: boolean;
  can_edit: boolean;
};

type UniverseTicker = { id: number; symbol: string; enabled: boolean; created_at: string };

type TriggerEvent = {
  id: number;
  symbol: string;
  triggered_at: string;
  reason_tags: string[];

  last_price?: number | null;

  rvol_1m?: number | null;
  rvol_5m?: number | null;

  vol_1m?: number | null;
  vol_5m?: number | null;

  pct_change_1m?: number | null;
  pct_change_5m?: number | null;

  hod_distance_pct?: number | null;
  broke_hod?: boolean | null;

  score?: number | null;

  candle_color?: "GREEN" | "RED" | "DOJI" | null;
  candle_pct?: number | null;
  trigger_age_seconds?: number | null;
};

type ScannerPrefs = {
  follow_alerts?: boolean;
  live_feed_enabled?: boolean;

  pushover_enabled?: boolean;
  pushover_user_key?: string | null;
  pushover_device?: string | null;
  pushover_sound?: string | null;
  pushover_priority?: number | null;

  notify_min_score?: number | null;
  notify_only_hod_break?: boolean;
};

type HotTicker = {
  symbol: string;
  score?: number | null;
  last_price?: number | null;
  rvol_1m?: number | null;
  rvol_5m?: number | null;
  pct_change_1m?: number | null;
  pct_change_5m?: number | null;
  vol_1m?: number | null;
  vol_5m?: number | null;
  hod?: number | null;
  hod_distance_pct?: number | null;
  broke_hod?: boolean | null;
  reason_tags?: string[];
};

// WS message shapes
type WsHello = { type: "hello"; user_id: number };
type WsTrigger = { type: "trigger"; ts?: number } & TriggerEvent;
type WsHot5 = { type: "hot5"; ts?: number; items: HotTicker[] };
type WsUniverse = { type: "universe"; ts?: number } & HotTicker; // per-symbol updates (optional)
type WsMsg = WsHello | WsTrigger | WsHot5 | WsUniverse | Record<string, any>;

function prependDedupeLimit(prev: TriggerEvent[], nextEv: TriggerEvent, limit: number) {
  const id = nextEv?.id;
  if (typeof id !== "number") return prev;

  const idx = prev.findIndex((x) => x.id === id);
  if (idx >= 0) {
    const copy = prev.slice();
    copy[idx] = nextEv;
    return copy.slice(0, limit);
  }

  return [nextEv, ...prev].slice(0, limit);
}

/* =========================
   Trader-friendly helpers
   ========================= */

function n(x: any): number | null {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

function fmtK(v: number | null) {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${Math.round(v / 1_000)}k`;
  return `${Math.round(v)}`;
}

function fmtPct(v: number | null, digits = 2) {
  if (v == null) return "—";
  const s = v >= 0 ? "+" : "";
  return `${s}${v.toFixed(digits)}%`;
}

function fmtPx(v: number | null) {
  if (v == null) return "—";
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
}

function hasTag(e: { reason_tags?: string[] }, tag: string) {
  return Array.isArray(e?.reason_tags) && e.reason_tags.includes(tag);
}

function statusVariant(ok: boolean | null | undefined): any {
  if (ok === true) return "success";
  if (ok === false) return "danger";
  return "outline";
}

function hbVariant(ageSeconds: number | null | undefined): any {
  if (ageSeconds == null) return "outline";
  if (ageSeconds <= 60) return "success";
  if (ageSeconds <= 180) return "warn";
  return "danger";
}

function hbLabel(ageSeconds: number | null | undefined): string {
  if (ageSeconds == null) return "Ingestor: —";
  if (ageSeconds < 60) return `Ingestor: ${ageSeconds}s`;
  const m = Math.floor(ageSeconds / 60);
  const s = ageSeconds % 60;
  if (m < 60) return `Ingestor: ${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `Ingestor: ${h}h ${mm}m`;
}

/**
 * Flames should mean “hot”.
 * 0 flames for < 1.0x is important (don’t hype dead rVol).
 */
function rvolFlames(rvol1m: number | null): { flames: number; text: string } {
  if (rvol1m == null) return { flames: 0, text: "—" };
  const flames = rvol1m >= 4.0 ? 3 : rvol1m >= 2.0 ? 2 : rvol1m >= 1.0 ? 1 : 0;
  return { flames, text: `${rvol1m.toFixed(2)}x` };
}

function headlineLabel(e: TriggerEvent): string {
  if (e.broke_hod || hasTag(e, "HOD_BREAK")) return "HOD Breakout";

  const r1 = n(e.rvol_1m);
  const p1 = n(e.pct_change_1m);
  const p5 = n(e.pct_change_5m);

  if (r1 != null && p1 != null && r1 >= 3.0 && p1 >= 2.0) return "Momentum ignition";
  if (p5 != null && p5 >= 5.0) return "Momentum run";
  return "Volume pop";
}

function hodStatus(e: { hod_distance_pct?: number | null }): { label: string; variant: any } {
  const d = n(e.hod_distance_pct);
  if (d == null) return { label: "HOD: —", variant: "outline" };

  if (d <= 0.75) return { label: "NEAR HOD", variant: "success" };
  if (d <= 2.0) return { label: "IN RANGE", variant: "secondary" };
  if (d <= 5.0) return { label: "PULLBACK", variant: "info" };
  return { label: "FAR FROM HOD", variant: "warn" };
}

function candleVariant(c: TriggerEvent["candle_color"]): any {
  if (c === "GREEN") return "success";
  if (c === "RED") return "danger";
  if (c === "DOJI") return "outline";
  return "secondary";
}

function FlameRow({ rvol1m }: { rvol1m: number | null }) {
  const { flames, text } = rvolFlames(rvol1m);
  const icons = flames <= 0 ? "—" : "🔥".repeat(flames);
  return (
    <span className="flex items-center gap-2">
      <span className="text-base leading-none">{icons}</span>
      <span className="opacity-80">
        rVol: <span className="font-semibold">{text}</span>
      </span>
    </span>
  );
}

/* =========================
   Live "now" ticker (single shared timer)
   ========================= */

const NOW_TICK_MS = 5000;

const nowStore = (() => {
  let now = Date.now();
  let timer: number | null = null;
  const listeners = new Set<() => void>();

  const start = () => {
    if (timer != null) return;
    timer = window.setInterval(() => {
      now = Date.now();
      listeners.forEach((fn) => fn());
    }, NOW_TICK_MS);
  };

  const stop = () => {
    if (timer == null) return;
    window.clearInterval(timer);
    timer = null;
  };

  return {
    getSnapshot: () => now,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
  };
})();

function useNowMs(): number {
  return useSyncExternalStore(nowStore.subscribe, nowStore.getSnapshot, nowStore.getSnapshot);
}

function formatAgeFromSeconds(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const s = Math.floor(totalSeconds);

  if (s < 60) return `${s}s`;

  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;

  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

const AgeText = React.memo(function AgeText(props: { triggeredAt: string; fallbackAgeSeconds?: number | null }) {
  const nowMs = useNowMs();

  const tsMs = Date.parse(props.triggeredAt);
  let ageSeconds: number | null = null;

  if (Number.isFinite(tsMs)) {
    ageSeconds = Math.max(0, (nowMs - tsMs) / 1000);
  } else if (props.fallbackAgeSeconds != null) {
    ageSeconds = Math.max(0, Number(props.fallbackAgeSeconds));
  }

  return (
    <span className="font-semibold tabular-nums inline-block min-w-[4.5rem] text-right">
      {ageSeconds == null ? "—" : formatAgeFromSeconds(ageSeconds)}
    </span>
  );
});

/**
 * If trigger was primarily due to 5m conditions, auto-expand it.
 */
function shouldAutoExpand(e: TriggerEvent): boolean {
  const tags = e.reason_tags || [];
  const has5m = tags.includes("PCT_5M_THR") || tags.includes("RVOL_5M_THR") || tags.includes("RVOL_5M");
  const has1m = tags.includes("PCT_1M_THR") || tags.includes("RVOL_1M_THR") || tags.includes("RVOL_1M");
  return !!has5m && !has1m;
}

function TriggerRow({ e }: { e: TriggerEvent }) {
  const [expanded, setExpanded] = useState<boolean>(() => shouldAutoExpand(e));

  useEffect(() => {
    if (!expanded && shouldAutoExpand(e)) setExpanded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.id, (e.reason_tags || []).join("|")]);

  const ts = new Date(e.triggered_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const label = headlineLabel(e);

  const r1 = n(e.rvol_1m);
  const r5 = n(e.rvol_5m);

  const v1 = n(e.vol_1m);
  const v5 = n(e.vol_5m);

  const p1 = n(e.pct_change_1m);
  const p5 = n(e.pct_change_5m);

  const cndlPct = n(e.candle_pct);
  const toHod = n(e.hod_distance_pct);
  const score = n(e.score);
  const px = n(e.last_price);

  const hod = hodStatus(e);
  const why = (e.reason_tags || []).filter(Boolean);

  const expandText = expanded ? "Less" : "More";

  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-lg font-semibold">{e.symbol}</div>
          <div className="text-xs opacity-70">{ts}</div>

          <Badge variant="info">{label}</Badge>

          <span className="text-sm opacity-80">
            Px: <span className="font-semibold">{fmtPx(px)}</span>
          </span>

          {score != null && (
            <span className="text-sm opacity-80">
              Score: <span className="font-semibold">{Math.round(score)}</span>
            </span>
          )}

          <span className="text-sm opacity-80">
            Age: <AgeText triggeredAt={e.triggered_at} fallbackAgeSeconds={e.trigger_age_seconds} />
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={hod.variant}>{hod.label}</Badge>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setExpanded((v) => !v)}
            className="h-7 px-2 text-xs"
          >
            {expandText}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <FlameRow rvol1m={r1} />

        <span className="opacity-80">
          Vol 1m: <span className="font-semibold">{fmtK(v1)}</span>
        </span>

        <span className="opacity-80">
          %1m: <span className="font-semibold">{fmtPct(p1, 2)}</span>
        </span>

        {e.candle_color && (
          <span className="flex items-center gap-2">
            <Badge variant={candleVariant(e.candle_color)}>{e.candle_color}</Badge>
            <span className="opacity-80">({cndlPct != null ? fmtPct(cndlPct, 2) : "—"})</span>
          </span>
        )}

        <span className="opacity-80">
          To HOD: <span className="font-semibold">{toHod != null ? fmtPct(toHod, 2) : "—"}</span>
        </span>
      </div>

      {expanded && (
        <div className="rounded-md border border-slate-800/60 bg-slate-950/40 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="outline">5m context</Badge>

            <span className="opacity-80">
              rVol 5m: <span className="font-semibold">{r5 != null ? `${r5.toFixed(2)}x` : "—"}</span>
            </span>

            <span className="opacity-80">
              Vol 5m: <span className="font-semibold">{fmtK(v5)}</span>
            </span>

            <span className="opacity-80">
              %5m: <span className="font-semibold">{fmtPct(p5, 2)}</span>
            </span>
          </div>

          {why.length > 0 && <div className="text-xs opacity-60">Why: {why.join(", ")}</div>}
        </div>
      )}
    </div>
  );
}

/* =========================
   Dashboard-style layout for Scanner
   ========================= */

type ScannerWidgetId = "triggers" | "heatmap" | "settings";
type ScannerWidgetState = { id: ScannerWidgetId; open: boolean };

const SCANNER_LAYOUT_KEY = "scanner_layout_v1";

const DEFAULT_SCANNER_LAYOUT: ScannerWidgetState[] = [
  { id: "triggers", open: true },
  { id: "heatmap", open: true },
  { id: "settings", open: true },
];

const PANEL_TITLES: Record<ScannerWidgetId, string> = {
  triggers: "Triggered tickers",
  heatmap: "Heatmap (Top 5 scored)",
  settings: "Scanner settings",
};

function normalizeScannerLayout(input: unknown): ScannerWidgetState[] {
  const byId = new Map<ScannerWidgetId, ScannerWidgetState>();
  for (const d of DEFAULT_SCANNER_LAYOUT) byId.set(d.id, { ...d });

  if (Array.isArray(input)) {
    for (const raw of input) {
      if (!raw || typeof raw !== "object") continue;
      const obj = raw as any;
      const id = obj.id as ScannerWidgetId;
      if (!byId.has(id)) continue;
      byId.set(id, { id, open: typeof obj.open === "boolean" ? obj.open : true });
    }

    const ordered: ScannerWidgetState[] = [];
    for (const raw of input) {
      const id = (raw as any)?.id as ScannerWidgetId;
      if (byId.has(id)) ordered.push(byId.get(id)!);
      byId.delete(id);
    }
    for (const remaining of byId.values()) ordered.push(remaining);
    return ordered;
  }

  return DEFAULT_SCANNER_LAYOUT;
}

function SortableScannerItem({
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

function HeatmapList({
  wsStatus,
  hot5,
  universeMap,
}: {
  wsStatus: string;
  hot5: HotTicker[];
  universeMap: Record<string, HotTicker>;
}) {
  const rows = (hot5 || []).map((x) => {
    const sym = String(x.symbol || "").toUpperCase();
    const merged = { ...universeMap[sym], ...x, symbol: sym };
    return merged;
  });

  if (!rows.length) {
    return (
      <div className="text-sm opacity-70">
        No heatmap data yet.{" "}
        <span className="opacity-70">
          (Waiting for <code>type: "hot5"</code> on WS. Current WS: {wsStatus})
        </span>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left">
          <tr className="border-b">
            <th className="py-2 pr-2">#</th>
            <th className="py-2 pr-2">Symbol</th>
            <th className="py-2 pr-2">Score</th>
            <th className="py-2 pr-2">Px</th>
            <th className="py-2 pr-2">rVol 1m</th>
            <th className="py-2 pr-2">%1m</th>
            <th className="py-2 pr-2">%5m</th>
            <th className="py-2 pr-2">Vol 1m</th>
            <th className="py-2 pr-2">To HOD</th>
            <th className="py-2 pr-2">Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => {
            const score = n(t.score);
            const px = n(t.last_price);
            const r1 = n(t.rvol_1m);
            const p1 = n(t.pct_change_1m);
            const p5 = n(t.pct_change_5m);
            const v1 = n(t.vol_1m);
            const toHod = n(t.hod_distance_pct);
            const hod = hodStatus({ hod_distance_pct: toHod });

            return (
              <tr key={t.symbol} className="border-b last:border-none">
                <td className="py-2 pr-2 tabular-nums">{i + 1}</td>
                <td className="py-2 pr-2 font-semibold">{t.symbol}</td>
                <td className="py-2 pr-2 tabular-nums">{score != null ? Math.round(score) : "—"}</td>
                <td className="py-2 pr-2 tabular-nums">{fmtPx(px)}</td>
                <td className="py-2 pr-2 tabular-nums">{r1 != null ? `${r1.toFixed(2)}x` : "—"}</td>
                <td className="py-2 pr-2 tabular-nums">{fmtPct(p1, 2)}</td>
                <td className="py-2 pr-2 tabular-nums">{fmtPct(p5, 2)}</td>
                <td className="py-2 pr-2 tabular-nums">{fmtK(v1)}</td>
                <td className="py-2 pr-2">
                  <Badge variant={hod.variant}>{hod.label}</Badge>
                </td>
                <td className="py-2 pr-2">
                  <div className="flex flex-wrap gap-1">
                    {t.broke_hod ? <Badge variant="success">HOD</Badge> : null}
                    {r1 != null && r1 >= 4 ? <Badge variant="info">HOT</Badge> : null}
                    {p1 != null && p1 >= 2 ? <Badge variant="secondary">MOMO</Badge> : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-2 text-xs opacity-60">
        Tip: once backend sends <code>universe</code> updates, we’ll merge them into the Top-5 rows for “every new bar” UX.
      </div>
    </div>
  );
}

function Field(props: {
  label: string;
  value: number;
  disabled?: boolean;
  float?: boolean;
  onSave: (v: number) => Promise<void>;
}) {
  const [local, setLocal] = useState(String(props.value ?? ""));

  useEffect(() => setLocal(String(props.value ?? "")), [props.value]);

  return (
    <div className="space-y-1">
      <div className="text-xs opacity-70">{props.label}</div>
      <div className="flex gap-2">
        <Input value={local} disabled={props.disabled} onChange={(e) => setLocal(e.target.value)} />
        <Button
          variant="outline"
          disabled={props.disabled}
          onClick={async () => {
            const nn = props.float ? Number(local) : parseInt(local, 10);
            if (!Number.isFinite(nn)) return;
            await props.onSave(nn);
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

export default function Scanner() {
  const [cfg, setCfg] = useState<ScannerConfig | null>(null);
  const [prefs, setPrefs] = useState<ScannerPrefs | null>(null);
  const [universe, setUniverse] = useState<UniverseTicker[]>([]);
  const [triggers, setTriggers] = useState<TriggerEvent[]>([]);
  const [newSymbol, setNewSymbol] = useState("");

  const [hot5, setHot5] = useState<HotTicker[]>([]);
  const [universeMap, setUniverseMap] = useState<Record<string, HotTicker>>({});

  const [adminStatus, setAdminStatus] = useState<ScannerAdminStatus | null>(null);
  const [adminStatusErr, setAdminStatusErr] = useState<string | null>(null);

  const [wsStatus, setWsStatus] = useState<"connecting" | "open" | "closed" | "error">("closed");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const backoffRef = useRef<number>(1000);
  const aliveRef = useRef<boolean>(true);

  const canEdit = !!cfg?.can_edit;
  const wsUrl = useMemo(() => scannerTriggersWsUrl(), []);

  const [scannerLayout, setScannerLayout] = useState<ScannerWidgetState[]>(() => {
    try {
      const stored = localStorage.getItem(SCANNER_LAYOUT_KEY);
      return stored ? normalizeScannerLayout(JSON.parse(stored)) : DEFAULT_SCANNER_LAYOUT;
    } catch {
      return DEFAULT_SCANNER_LAYOUT;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SCANNER_LAYOUT_KEY, JSON.stringify(scannerLayout));
    } catch {
      // ignore
    }
  }, [scannerLayout]);

  const togglePanel = (id: ScannerWidgetId) => {
    setScannerLayout((prev) => prev.map((p) => (p.id === id ? { ...p, open: !p.open } : p)));
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    if (active.id === over.id) return;

    setScannerLayout((prev) => {
      const oldIndex = prev.findIndex((p) => p.id === active.id);
      const newIndex = prev.findIndex((p) => p.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  async function refreshAll() {
    const [c, u, p] = await Promise.all([fetchScannerConfig(), listScannerUniverse(), fetchScannerPreferences()]);
    setCfg(c);
    setUniverse(u);
    setPrefs(p);
  }

  async function refreshAdminStatus() {
    try {
      const s = await fetchScannerAdminStatus();
      // s === null -> not admin (403), hide it quietly
      setAdminStatus(s);
      setAdminStatusErr(null);
    } catch (e: any) {
      setAdminStatusErr(String(e?.message || e || "status error"));
      // keep last known status (don’t wipe) so UI doesn't flicker
    }
  }

  async function refreshTriggers() {
    const t = await listScannerTriggers(25);
    setTriggers(t);
  }

  useEffect(() => {
    aliveRef.current = true;
    let statusTimer: number | null = null;

    const clearReconnect = () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const cleanupWs = () => {
      clearReconnect();
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        try {
          ws.onopen = null;
          ws.onclose = null;
          ws.onerror = null;
          ws.onmessage = null;
          ws.close();
        } catch {}
      }
    };

    const scheduleReconnect = () => {
      if (!aliveRef.current) return;
      clearReconnect();

      const delay = Math.min(backoffRef.current, 30000);
      backoffRef.current = Math.min(backoffRef.current * 1.8, 30000);

      reconnectTimerRef.current = window.setTimeout(() => {
        connect();
      }, delay);
    };

    const connect = () => {
      if (!aliveRef.current) return;
      cleanupWs();

      setWsStatus("connecting");

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        setWsStatus("error");
        scheduleReconnect();
        return;
      }

      wsRef.current = ws;

      ws.onopen = () => {
        if (!aliveRef.current) return;
        backoffRef.current = 1000;
        setWsStatus("open");
      };

      ws.onmessage = (ev) => {
        if (!aliveRef.current) return;

        let msg: WsMsg | null = null;
        try {
          msg = JSON.parse(String(ev.data || ""));
        } catch {
          return;
        }
        if (!msg || typeof msg !== "object") return;

        if ((msg as any).type === "hello") return;

        // Existing: trigger event
        if ((msg as any).type === "trigger") {
          const t = msg as WsTrigger;
          if (typeof t.id === "number") {
            setTriggers((prev) => prependDedupeLimit(prev, t, 25));
          }
          return;
        }

        // New: hot5 list push
        if ((msg as any).type === "hot5") {
          const h = msg as WsHot5;
          const items = Array.isArray(h.items) ? h.items : [];
          setHot5(
            items
              .map((x) => ({ ...x, symbol: String(x.symbol || "").toUpperCase() }))
              .filter((x) => !!x.symbol)
          );
          return;
        }

        // Optional: universe per-symbol updates
        if ((msg as any).type === "universe") {
          const u = msg as WsUniverse;
          const sym = String((u as any).symbol || "").toUpperCase();
          if (!sym) return;
          setUniverseMap((prev) => ({
            ...prev,
            [sym]: { ...(prev[sym] || {}), ...u, symbol: sym },
          }));
          return;
        }
      };

      ws.onerror = () => {
        if (!aliveRef.current) return;
        setWsStatus("error");
      };

      ws.onclose = () => {
        if (!aliveRef.current) return;
        setWsStatus("closed");
        scheduleReconnect();
      };
    };

    refreshAll();
    refreshTriggers();
    refreshAdminStatus();
    connect();

    // Poll scanner status (admin-only endpoint). Non-admins just get null and we hide it.
    statusTimer = window.setInterval(() => {
      if (!aliveRef.current) return;
      refreshAdminStatus();
    }, 10000);

    return () => {
      aliveRef.current = false;
      if (statusTimer) {
        window.clearInterval(statusTimer);
        statusTimer = null;
      }
      cleanupWs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  const pushReady = !!(prefs?.pushover_user_key && String(prefs.pushover_user_key).trim().length > 10);
  const pushOn = !!prefs?.pushover_enabled;

  const liveFeedEnabled = prefs?.live_feed_enabled;
  const followAlerts = prefs?.follow_alerts;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={scannerLayout.map((p) => p.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-4">
          {scannerLayout.map((p) => {
            // 1) Triggers
            if (p.id === "triggers") {
              return (
                <SortableScannerItem
                  key={p.id}
                  id={p.id}
                  title={PANEL_TITLES[p.id]}
                  isOpen={p.open}
                  onToggle={() => togglePanel(p.id)}
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-lg font-semibold flex flex-wrap items-center gap-3">
                        <span>Triggered tickers</span>
                        <span className="text-xs opacity-70">WS: {wsStatus}</span>

                        {/* Admin health badges (hidden for non-admins) */}
                        {adminStatus ? (
                          <>
                            <Badge variant={statusVariant(adminStatus.db_ok)}>DB</Badge>
                            <Badge variant={statusVariant(adminStatus.redis_ok)}>Redis</Badge>
                            <Badge variant={statusVariant(adminStatus.channels_ok)}>Channels</Badge>
                            <Badge variant={hbVariant(adminStatus?.ingestor?.age_seconds)}>
                              {hbLabel(adminStatus?.ingestor?.age_seconds)}
                            </Badge>
                        
                            {/* Optional: show scanner enabled */}
                            {typeof adminStatus.scanner_enabled === "boolean" ? (
                              adminStatus.scanner_enabled ? (
                                <Badge variant="info">Scanner: enabled</Badge>
                              ) : (
                                <Badge variant="outline">Scanner: disabled</Badge>
                              )
                            ) : null}

                            {/* Optional: surface fetch errors without being noisy */}
                            {adminStatusErr ? (
                              <span className="text-xs opacity-60">status err</span>
                            ) : null}
                          </>
                        ) : null}

                        {!pushReady ? (
                          <Badge variant="outline">Push: needs setup</Badge>
                        ) : pushOn ? (
                          <Badge variant="success">Push: on</Badge>
                        ) : (
                          <Badge variant="secondary">Push: off</Badge>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-5 text-sm">
                        <div className="flex items-center gap-3">
                          <span>Follow alerts</span>
                          <Switch
                            checked={!!followAlerts}
                            onCheckedChange={async (v) => {
                              const next = await updateScannerPreferences({ follow_alerts: v });
                              setPrefs(next);
                            }}
                          />
                        </div>

                        <div className="flex items-center gap-3">
                          <span>Push</span>
                          <Switch
                            checked={!!prefs?.pushover_enabled}
                            disabled={!pushReady}
                            onCheckedChange={async (v) => {
                              const next = await updateScannerPreferences({ pushover_enabled: v });
                              setPrefs(next);
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {triggers.length === 0 ? (
                      <div className="text-sm opacity-70">No triggers yet.</div>
                    ) : (
                      <div className="space-y-2">
                        {triggers.map((e) => (
                          <TriggerRow key={e.id} e={e} />
                        ))}
                      </div>
                    )}

                    <div className="pt-3 flex flex-wrap gap-2">
                      {canEdit && (
                        <Button
                          variant="outline"
                          onClick={async () => {
                            await emitScannerTestEvent("TEST");
                          }}
                        >
                          Emit test event
                        </Button>
                      )}

                      <Button
                        variant="outline"
                        onClick={async () => {
                          await refreshTriggers();
                        }}
                      >
                        Refresh (REST)
                      </Button>
                      <Button
                        variant="outline"
                        onClick={async () => {
                          await refreshAdminStatus();
                        }}
                      >
                        Refresh status
                      </Button>

                      <Button
                        variant="outline"
                        onClick={async () => {
                          await clearScannerTriggers();
                          setTriggers([]);
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                </SortableScannerItem>
              );
            }

            // 2) Heatmap
            if (p.id === "heatmap") {
              return (
                <SortableScannerItem
                  key={p.id}
                  id={p.id}
                  title={PANEL_TITLES[p.id]}
                  isOpen={p.open}
                  onToggle={() => togglePanel(p.id)}
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm opacity-80">
                        Shows the top 5 “most eligible” tickers by score. (WS-driven)
                      </div>

                      <div className="flex items-center gap-3 text-sm">
                        <span>Realtime heatmap</span>
                        <Switch
                          checked={!!liveFeedEnabled}
                          onCheckedChange={async (v) => {
                            // Works once backend adds live_feed_enabled; until then it will be ignored server-side.
                            const next = await updateScannerPreferences({ live_feed_enabled: v });
                            setPrefs(next);
                          }}
                        />
                      </div>
                    </div>

                    <HeatmapList wsStatus={wsStatus} hot5={hot5} universeMap={universeMap} />

                    <div className="pt-3 flex flex-wrap gap-2">
                      {canEdit && (
                        <Button
                          variant="outline"
                          onClick={async () => {
                            await emitScannerTestHot5();
                          }}
                        >
                          Emit test HOT5
                        </Button>
                      )}

                      <Button
                        variant="outline"
                        onClick={() => {
                          setHot5([]);
                          setUniverseMap({});
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                </SortableScannerItem>
              );
            }

            // 3) Settings
            return (
              <SortableScannerItem
                key={p.id}
                id={p.id}
                title={PANEL_TITLES[p.id]}
                isOpen={p.open}
                onToggle={() => togglePanel(p.id)}
              >
                <div className="grid lg:grid-cols-2 gap-6">
                  {/* Universe */}
                  <Card>
                    <CardContent className="space-y-3 p-4">
                      <div className="text-lg font-semibold">Universe (MVP ~50 tickers)</div>

                      {canEdit ? (
                        <div className="flex gap-2">
                          <Input
                            value={newSymbol}
                            placeholder="Add symbol (e.g. AAPL)"
                            onChange={(e) => setNewSymbol(e.target.value)}
                          />
                          <Button
                            onClick={async () => {
                              const sym = newSymbol.trim().toUpperCase();
                              if (!sym) return;
                              await addScannerUniverseTicker(sym);
                              setNewSymbol("");
                              setUniverse(await listScannerUniverse());
                            }}
                          >
                            Add
                          </Button>
                        </div>
                      ) : (
                        <div className="text-sm opacity-70">Universe is managed by admin.</div>
                      )}

                      <div className="space-y-2">
                        {universe.map((t) => (
                          <div key={t.id} className="flex items-center justify-between border rounded-md p-2">
                            <div className="font-medium">{t.symbol}</div>
                            {canEdit && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                  await deleteScannerUniverseTicker(t.id);
                                  setUniverse(await listScannerUniverse());
                                }}
                              >
                                Remove
                              </Button>
                            )}
                          </div>
                        ))}
                        {universe.length === 0 && <div className="text-sm opacity-70">No universe tickers yet.</div>}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Config + user gating */}
                  <Card>
                    <CardContent className="space-y-4 p-4">
                      <div className="text-lg font-semibold">Trigger configuration</div>

                      {!cfg ? (
                        <div className="text-sm opacity-70">Loading…</div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between">
                            <div className="text-sm">Scanner enabled</div>
                            <Switch
                              checked={cfg.enabled}
                              disabled={!canEdit}
                              onCheckedChange={async (v) => {
                                const next = await updateScannerConfig({ enabled: v });
                                setCfg(next);
                              }}
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <Field
                              label="Min vol 1m"
                              value={cfg.min_vol_1m}
                              disabled={!canEdit}
                              onSave={async (v) => setCfg(await updateScannerConfig({ min_vol_1m: v }))}
                            />
                            <Field
                              label="Lookback (min)"
                              value={cfg.rvol_lookback_minutes}
                              disabled={!canEdit}
                              onSave={async (v) => setCfg(await updateScannerConfig({ rvol_lookback_minutes: v }))}
                            />
                            <Field
                              label="rVol 1m thr"
                              value={cfg.rvol_1m_threshold}
                              disabled={!canEdit}
                              float
                              onSave={async (v) => setCfg(await updateScannerConfig({ rvol_1m_threshold: v }))}
                            />
                            <Field
                              label="rVol 5m thr"
                              value={cfg.rvol_5m_threshold}
                              disabled={!canEdit}
                              float
                              onSave={async (v) => setCfg(await updateScannerConfig({ rvol_5m_threshold: v }))}
                            />
                            <Field
                              label="% 1m min"
                              value={cfg.min_pct_change_1m}
                              disabled={!canEdit}
                              float
                              onSave={async (v) => setCfg(await updateScannerConfig({ min_pct_change_1m: v }))}
                            />
                            <Field
                              label="% 5m min"
                              value={cfg.min_pct_change_5m}
                              disabled={!canEdit}
                              float
                              onSave={async (v) => setCfg(await updateScannerConfig({ min_pct_change_5m: v }))}
                            />
                            <Field
                              label="Cooldown (min)"
                              value={cfg.cooldown_minutes}
                              disabled={!canEdit}
                              onSave={async (v) => setCfg(await updateScannerConfig({ cooldown_minutes: v }))}
                            />
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="text-sm">Require green candle</div>
                            <Switch
                              checked={cfg.require_green_candle}
                              disabled={!canEdit}
                              onCheckedChange={async (v) => setCfg(await updateScannerConfig({ require_green_candle: v }))}
                            />
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="text-sm">Require HOD break</div>
                            <Switch
                              checked={cfg.require_hod_break}
                              disabled={!canEdit}
                              onCheckedChange={async (v) => setCfg(await updateScannerConfig({ require_hod_break: v }))}
                            />
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="text-sm">Re-alert on new HOD</div>
                            <Switch
                              checked={cfg.realert_on_new_hod}
                              disabled={!canEdit}
                              onCheckedChange={async (v) => setCfg(await updateScannerConfig({ realert_on_new_hod: v }))}
                            />
                          </div>

                          <div className="border-t pt-4 space-y-3">
                            <div className="text-sm font-semibold">Push gating (per-user)</div>

                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm">Notify only on HOD break</div>
                              <Switch
                                checked={!!prefs?.notify_only_hod_break}
                                onCheckedChange={async (v) => {
                                  const next = await updateScannerPreferences({ notify_only_hod_break: v });
                                  setPrefs(next);
                                }}
                              />
                            </div>

                            <div className="space-y-1">
                              <div className="text-xs opacity-70">Minimum score to push (optional)</div>
                              <div className="flex gap-2">
                                <Input
                                  type="number"
                                  value={prefs?.notify_min_score ?? ""}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    const vv = raw === "" ? null : Number(raw);
                                    setPrefs((prev) => ({
                                      ...(prev || {}),
                                      notify_min_score: Number.isFinite(vv as any) ? (vv as any) : null,
                                    }));
                                  }}
                                />
                                <Button
                                  variant="outline"
                                  onClick={async () => {
                                    const v = prefs?.notify_min_score;
                                    const next = await updateScannerPreferences({ notify_min_score: v ?? null });
                                    setPrefs(next);
                                  }}
                                >
                                  Save
                                </Button>
                              </div>
                              <div className="text-[11px] opacity-60">
                                If set, push fires only when <code>event.score &gt;= min</code>.
                              </div>
                            </div>
                          </div>

                          {!canEdit && (
                            <div className="text-xs opacity-70">Config is visible but only editable by admin.</div>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </SortableScannerItem>
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}