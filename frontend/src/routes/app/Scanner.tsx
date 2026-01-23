import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
  vol_1m?: number | null;
  pct_change_1m?: number | null;
  score?: number | null;
  candle_color?: "GREEN" | "RED" | "DOJI" | null;
  candle_pct?: number | null;
  hod_distance_pct?: number | null;
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
    const [c, u, p] = await Promise.all([
      fetchScannerConfig(),
      listScannerUniverse(),
      fetchScannerPreferences(),
    ]);
    setCfg(c);
    setUniverse(u);
    setPrefs(p);
  }

  async function refreshTriggers() {
    const t = await listScannerTriggers(25);
    setTriggers(t);
  }

  // ---- WS connect + reconnect loop ----
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

      // Exponential backoff with cap
      const delay = Math.min(backoffRef.current, 30000);
      backoffRef.current = Math.min(backoffRef.current * 1.8, 30000);

      reconnectTimerRef.current = window.setTimeout(() => {
        connect();
      }, delay);
    };

    const connect = () => {
      if (!aliveRef.current) return;

      // Avoid multiple sockets
      cleanupWs();

      setWsStatus("connecting");

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (e) {
        setWsStatus("error");
        scheduleReconnect();
        return;
      }

      wsRef.current = ws;

      ws.onopen = () => {
        if (!aliveRef.current) return;
        backoffRef.current = 1000; // reset after success
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

        // hello
        if ((msg as any).type === "hello") {
          return;
        }

        // trigger payloads
        if ((msg as any).type === "trigger") {
          const t = msg as WsTrigger;
          if (typeof t.id === "number") {
            setTriggers((prev) => prependDedupeLimit(prev, t, 25));
          }
          return;
        }
      };

      ws.onerror = () => {
        if (!aliveRef.current) return;
        setWsStatus("error");
        // errors usually followed by close; but just in case:
      };

      ws.onclose = () => {
        if (!aliveRef.current) return;
        setWsStatus("closed");
        scheduleReconnect();
      };
    };

    // Boot: config/universe/prefs + initial REST triggers once
    refreshAll();
    refreshTriggers();

    // Start WS
    connect();

    return () => {
      aliveRef.current = false;
      cleanupWs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  return (
    <div className="space-y-6">
      {/* Trigger feed */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-row items-center justify-between">
            <div className="text-lg font-semibold flex items-center gap-3">
              <span>Triggered tickers</span>
              <span className="text-xs opacity-70">
                WS: {wsStatus}
              </span>
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
                <div
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-2 border rounded-md p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="font-semibold">{e.symbol}</div>
                    <div className="text-xs opacity-70">
                      {new Date(e.triggered_at).toLocaleString()}
                    </div>
                    <div className="text-xs opacity-70">{(e.reason_tags || []).join(", ")}</div>
                  </div>
                  <div className="text-xs opacity-70 flex gap-3">
                    {e.rvol_1m != null && <span>rVol1m: {Number(e.rvol_1m).toFixed(2)}</span>}
                    {e.vol_1m != null && <span>Vol1m: {Math.round(Number(e.vol_1m))}</span>}
                    {e.pct_change_1m != null && (
                      <span>%1m: {Number(e.pct_change_1m).toFixed(2)}%</span>
                    )}
                    {e.score != null && <span>Score: {Number(e.score).toFixed(0)}</span>}
                    {e.candle_color && <span>Candle: {e.candle_color}</span>}
                    {e.candle_pct != null && <span>Cndl%: {Number(e.candle_pct).toFixed(2)}%</span>}
                    {e.hod_distance_pct != null && <span>to HOD: {Number(e.hod_distance_pct).toFixed(2)}%</span>}
                    {e.trigger_age_seconds != null && <span>Age: {Math.round(Number(e.trigger_age_seconds) / 60)}m</span>}
                  </div>
                </div>
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
                  setTriggers([]);          // instant UX
                  // optional safety:
                  // await refreshTriggers(); // should return empty after clear
                }}
              >
                Clear
              </Button>
            </div>
        </CardContent>
      </Card>

      {/* Universe + Config */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Universe */}
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

        {/* Config */}
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
                    onSave={async (v) =>
                      setCfg(await updateScannerConfig({ rvol_lookback_minutes: v }))
                    }
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
                    onCheckedChange={async (v) =>
                      setCfg(await updateScannerConfig({ require_green_candle: v }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-sm">Require HOD break</div>
                  <Switch
                    checked={cfg.require_hod_break}
                    disabled={!canEdit}
                    onCheckedChange={async (v) =>
                      setCfg(await updateScannerConfig({ require_hod_break: v }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-sm">Re-alert on new HOD</div>
                  <Switch
                    checked={cfg.realert_on_new_hod}
                    disabled={!canEdit}
                    onCheckedChange={async (v) =>
                      setCfg(await updateScannerConfig({ realert_on_new_hod: v }))
                    }
                  />
                </div>

                {!canEdit && (
                  <div className="text-xs opacity-70">Config is visible but only editable by admin.</div>
                )}
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