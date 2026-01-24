// frontend/src/routes/app/Scanner.tsx
// Adds: click-to-expand per trigger row, showing 5m values + hides raw "Why" behind expand.
// Also auto-expands rows that triggered primarily on 5m conditions.
// Adds: live "Age" updating WITHOUT refreshing and WITHOUT re-rendering whole rows (single shared ticker).

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  scannerTriggersWsUrl,
  clearScannerTriggers,
} from "@/lib/api";

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

// WS message shape you’re sending from backend
type WsHello = { type: "hello"; user_id: number };
type WsTrigger = { type: "trigger"; ts?: number } & TriggerEvent;
type WsMsg = WsHello | WsTrigger | Record<string, any>;

function prependDedupeLimit(prev: TriggerEvent[], nextEv: TriggerEvent, limit: number) {
  const id = nextEv?.id;
  if (typeof id !== "number") return prev;

  // If we already have it, replace in place (keeps ordering stable)
  const idx = prev.findIndex((x) => x.id === id);
  if (idx >= 0) {
    const copy = prev.slice();
    copy[idx] = nextEv;
    return copy.slice(0, limit);
  }

  // New event: prepend
  return [nextEv, ...prev].slice(0, limit);
}

/* =========================
   Trader-friendly helpers
   (frontend-only interpretation)
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

function hasTag(e: TriggerEvent, tag: string) {
  return Array.isArray(e?.reason_tags) && e.reason_tags.includes(tag);
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

/**
 * HOD proximity status:
 * hod_distance_pct = (HOD - last)/last * 100
 * small => near HOD (breakout context)
 * large => far below HOD (pullback/room)
 */
function hodStatus(e: TriggerEvent): { label: string; variant: any } {
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
   - avoids re-rendering the full page/list
   - only components subscribing to the ticker update
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
  // Server-side fallback not relevant here; but keep stable anyway
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

const AgeText = React.memo(function AgeText(props: {
  triggeredAt: string;
  fallbackAgeSeconds?: number | null;
}) {
  const nowMs = useNowMs();

  // Primary source of truth: triggered_at timestamp (frontend computes live)
  const tsMs = Date.parse(props.triggeredAt);
  let ageSeconds: number | null = null;

  if (Number.isFinite(tsMs)) {
    ageSeconds = Math.max(0, (nowMs - tsMs) / 1000);
  } else if (props.fallbackAgeSeconds != null) {
    ageSeconds = Math.max(0, Number(props.fallbackAgeSeconds));
  }

  // tabular + fixed-ish width so it doesn't "dance" while updating
  return (
    <span className="font-semibold tabular-nums inline-block min-w-[4.5rem] text-right">
      {ageSeconds == null ? "—" : formatAgeFromSeconds(ageSeconds)}
    </span>
  );
});

/**
 * If the trigger was primarily due to 5m conditions,
 * we want to auto-expand it so the trader immediately sees %5m + rVol5m.
 */
function shouldAutoExpand(e: TriggerEvent): boolean {
  const tags = e.reason_tags || [];
  const has5m = tags.includes("PCT_5M_THR") || tags.includes("RVOL_5M_THR") || tags.includes("RVOL_5M");
  const has1m = tags.includes("PCT_1M_THR") || tags.includes("RVOL_1M_THR") || tags.includes("RVOL_1M");

  // auto-expand if 5m present and 1m not strongly present
  return !!has5m && !has1m;
}

function TriggerRow({ e }: { e: TriggerEvent }) {
  const [expanded, setExpanded] = useState<boolean>(() => shouldAutoExpand(e));

  // If a WS update replaces this row with same id but different tags,
  // we don't want to constantly collapse/expand. So we only auto-expand
  // if it was previously collapsed AND now qualifies.
  useEffect(() => {
    if (!expanded && shouldAutoExpand(e)) setExpanded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.id]);

  const ts = new Date(e.triggered_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

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
      {/* top line */}
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

      {/* middle line (always visible) */}
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

      {/* expand panel */}
      {expanded && (
        <div className="rounded-md border border-slate-800/60 bg-slate-950/40 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="outline">5m context</Badge>

            <span className="opacity-80">
              rVol 5m:{" "}
              <span className="font-semibold">{r5 != null ? `${r5.toFixed(2)}x` : "—"}</span>
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

export default function Scanner() {
  const [cfg, setCfg] = useState<ScannerConfig | null>(null);
  const [prefs, setPrefs] = useState<{ follow_alerts: boolean } | null>(null);
  const [universe, setUniverse] = useState<UniverseTicker[]>([]);
  const [triggers, setTriggers] = useState<TriggerEvent[]>([]);
  const [newSymbol, setNewSymbol] = useState("");

  const [wsStatus, setWsStatus] = useState<"connecting" | "open" | "closed" | "error">("closed");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const backoffRef = useRef<number>(1000);
  const aliveRef = useRef<boolean>(true);

  const canEdit = !!cfg?.can_edit;
  const wsUrl = useMemo(() => scannerTriggersWsUrl(), []);

  async function refreshAll() {
    const [c, u, p] = await Promise.all([fetchScannerConfig(), listScannerUniverse(), fetchScannerPreferences()]);
    setCfg(c);
    setUniverse(u);
    setPrefs(p);
  }

  async function refreshTriggers() {
    const t = await listScannerTriggers(25);
    setTriggers(t);
  }

  useEffect(() => {
    aliveRef.current = true;

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

        if ((msg as any).type === "trigger") {
          const t = msg as WsTrigger;
          if (typeof t.id === "number") {
            setTriggers((prev) => prependDedupeLimit(prev, t, 25));
          }
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
    connect();

    return () => {
      aliveRef.current = false;
      cleanupWs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-row items-center justify-between">
            <div className="text-lg font-semibold flex items-center gap-3">
              <span>Triggered tickers</span>
              <span className="text-xs opacity-70">WS: {wsStatus}</span>
            </div>

            <div className="flex items-center gap-3 text-sm">
              <span>Follow alerts</span>
              <Switch
                checked={!!prefs?.follow_alerts}
                onCheckedChange={async (v) => {
                  const next = await updateScannerPreferences({ follow_alerts: v });
                  setPrefs(next);
                }}
              />
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

          <div className="pt-3 flex gap-2">
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
                await clearScannerTriggers();
                setTriggers([]);
              }}
            >
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Universe + Config */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardContent className="space-y-3">
            <div className="flex flex-row items-center justify-between">
              <div className="text-lg font-semibold">Universe (MVP ~50 tickers)</div>
            </div>

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

        <Card>
          <CardContent className="space-y-3">
            <div className="flex flex-row items-center justify-between">
              <div className="text-lg font-semibold">Trigger configuration</div>
            </div>

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

                {!canEdit && <div className="text-xs opacity-70">Config is visible but only editable by admin.</div>}
              </>
            )}
          </CardContent>
        </Card>
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
            const n = props.float ? Number(local) : parseInt(local, 10);
            if (!Number.isFinite(n)) return;
            await props.onSave(n);
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}