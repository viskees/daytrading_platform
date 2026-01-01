import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  apiFetch,
  fetchUserSettings,
  getOrCreateJournalDay,
  patchDayStartEquity,
  listAdjustments,
  createAdjustment,
  deleteAdjustment,
  type AdjustmentReason,
  type CommissionMode,
} from "@/lib/api";

type RiskPolicy = {
  maxRiskPerTradePct: number;
  maxDailyLossPct: number;
  maxTradesPerDay: number;
  commissionMode: CommissionMode;
  commissionValue: number;
  commissionPerShare: number;
  commissionMinPerSide: number;
  commissionCapPctOfNotional: number;
};

export default function RiskPage() {
  // ----------------------------
  // Risk policy (settings)
  // ----------------------------
  const [risk, setRisk] = useState<RiskPolicy>({
    maxRiskPerTradePct: 1,
    maxDailyLossPct: 3,
    maxTradesPerDay: 6,
    commissionMode: "FIXED",
    commissionValue: 0,
    commissionPerShare: 0,
    commissionMinPerSide: 0,
    commissionCapPctOfNotional: 0,
  });
  const [riskLoading, setRiskLoading] = useState(true);
  const [riskSaving, setRiskSaving] = useState(false);
  const [riskMsg, setRiskMsg] = useState<string | null>(null);

  // ----------------------------
  // Equity + adjustments
  // ----------------------------
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [journalDayId, setJournalDayId] = useState<number | null>(null);
  const [dayStartEquity, setDayStartEquity] = useState<number>(0);
  const [effectiveEquity, setEffectiveEquity] = useState<number>(0);
  const [adjustmentsTotal, setAdjustmentsTotal] = useState<number>(0);

  const [rows, setRows] = useState<any[]>([]);
  const [adjAmount, setAdjAmount] = useState<number>(0);
  const [adjReason, setAdjReason] = useState<AdjustmentReason>("DEPOSIT");
  const [adjNote, setAdjNote] = useState<string>("");
  const [savingEquity, setSavingEquity] = useState(false);

  // ----------------------------
  // Load risk settings
  // ----------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setRiskLoading(true);
      try {
        const s = await fetchUserSettings();
        if (!cancelled && s) {
          setRisk({
            maxRiskPerTradePct: Number(s.max_risk_per_trade_pct ?? 1),
            maxDailyLossPct: Number(s.max_daily_loss_pct ?? 3),
            maxTradesPerDay: Number(s.max_trades_per_day ?? 6),
            commissionMode: (s as any).commission_mode ?? "FIXED",
            commissionValue: Number((s as any).commission_value ?? 0),
            commissionPerShare: Number((s as any).commission_per_share ?? 0),
            commissionMinPerSide: Number((s as any).commission_min_per_side ?? 0),
            commissionCapPctOfNotional: Number((s as any).commission_cap_pct_of_notional ?? 0),
          });
        }
      } catch {
        // ignore; keep defaults
      } finally {
        if (!cancelled) setRiskLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const saveRisk = async () => {
    setRiskMsg(null);
    setErr(null);
    setRiskSaving(true);
    try {
      const res = await apiFetch("/journal/settings/me/", {
        method: "PATCH",
        body: JSON.stringify({
          max_risk_per_trade_pct: Number(risk.maxRiskPerTradePct),
          max_daily_loss_pct: Number(risk.maxDailyLossPct),
          max_trades_per_day: Number(risk.maxTradesPerDay),
          commission_mode: risk.commissionMode,
          commission_value: Number(risk.commissionValue),
          commission_per_share: Number(risk.commissionPerShare),
          commission_min_per_side: Number(risk.commissionMinPerSide),
          commission_cap_pct_of_notional: Number(risk.commissionCapPctOfNotional),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setRiskMsg("Risk settings saved.");
    } catch (e: any) {
      setErr(String(e?.message ?? "Failed to save risk settings"));
    } finally {
      setRiskSaving(false);
    }
  };

  // ----------------------------
  // Load equity + adjustments
  // ----------------------------
  const loadEquity = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const todayISO = new Date().toISOString().slice(0, 10);
      const d = await getOrCreateJournalDay(todayISO);

      const id = Number(d?.id);
      if (!Number.isInteger(id) || id <= 0) throw new Error("Failed to load today's Journal Day");

      setJournalDayId(id);

      const e0 = Number((d as any)?.day_start_equity ?? 0);
      const eff = Number((d as any)?.effective_equity ?? 0);
      const adjTot = Number((d as any)?.adjustments_total ?? 0);

      setDayStartEquity(isFinite(e0) ? e0 : 0);
      setEffectiveEquity(isFinite(eff) ? eff : 0);
      setAdjustmentsTotal(isFinite(adjTot) ? adjTot : 0);

      const list = await listAdjustments(id);
      setRows(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setErr(String(e?.message ?? "Failed to load equity"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEquity();
  }, [loadEquity]);

  const saveStartEquity = async () => {
    if (!journalDayId) return;
    setSavingEquity(true);
    setErr(null);
    try {
      const updated = await patchDayStartEquity(journalDayId, Number(dayStartEquity));
      setEffectiveEquity(Number((updated as any)?.effective_equity ?? 0));
      setAdjustmentsTotal(Number((updated as any)?.adjustments_total ?? 0));
      await loadEquity();
    } catch (e: any) {
      setErr(String(e?.message ?? "Failed to save day start equity"));
    } finally {
      setSavingEquity(false);
    }
  };

  const addAdj = async () => {
    if (!journalDayId) return;
    setErr(null);
    try {
      await createAdjustment({
        journal_day: journalDayId,
        amount: Number(adjAmount),
        reason: adjReason,
        note: adjNote || "",
      });
      setAdjAmount(0);
      setAdjNote("");
      await loadEquity();
    } catch (e: any) {
      setErr(String(e?.message ?? "Failed to add adjustment"));
    }
  };

  const delAdj = async (id: number) => {
    setErr(null);
    try {
      await deleteAdjustment(id);
      await loadEquity();
    } catch (e: any) {
      setErr(String(e?.message ?? "Failed to delete adjustment"));
    }
  };

  // ----------------------------
  // Render
  // ----------------------------
  const isPerShare = useMemo(() => risk.commissionMode === "PER_SHARE", [risk.commissionMode]);
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6 space-y-6">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-xl font-bold">Risk Settings</h2>
            <div className="flex items-center gap-2">
              <Button onClick={saveRisk} disabled={riskLoading || riskSaving}>
                {riskSaving ? "Saving…" : "Save risk settings"}
              </Button>
            </div>
          </div>

          {riskMsg && <div className="text-sm text-emerald-500">{riskMsg}</div>}
          {err && <div className="text-sm text-red-600">{err}</div>}

          {/* ✅ These were missing */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Max risk per trade (%)</div>
              <Input
                type="number"
                step="0.1"
                value={risk.maxRiskPerTradePct}
                onChange={(e) => setRisk((r) => ({ ...r, maxRiskPerTradePct: Number(e.target.value) }))}
                disabled={riskLoading}
              />
            </div>

            <div>
              <div className="text-xs text-muted-foreground mb-1">Max daily loss (%)</div>
              <Input
                type="number"
                step="0.1"
                value={risk.maxDailyLossPct}
                onChange={(e) => setRisk((r) => ({ ...r, maxDailyLossPct: Number(e.target.value) }))}
                disabled={riskLoading}
              />
            </div>

            <div>
              <div className="text-xs text-muted-foreground mb-1">Max trades per day</div>
              <Input
                type="number"
                step="1"
                value={risk.maxTradesPerDay}
                onChange={(e) => setRisk((r) => ({ ...r, maxTradesPerDay: Number(e.target.value) }))}
                disabled={riskLoading}
              />
            </div>
          </div>

          {/* Commission */}
          <div className="rounded-2xl border border-neutral-700 p-4 space-y-3">
            <h3 className="text-lg font-semibold">Commission</h3>
            <div className="text-xs text-muted-foreground">
              Commission is applied <b>per side</b> (entry + exit) and subtracted from trade P/L.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <label className="block">
                <span className="text-xs text-muted-foreground">Mode</span>
                <select
                  className="mt-1 w-full rounded-xl border bg-background text-foreground p-2
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={risk.commissionMode}
                  onChange={(e) =>
                    setRisk((r) => ({ ...r, commissionMode: e.target.value as CommissionMode }))
                  }
                  disabled={riskLoading}
                >
                  <option value="FIXED">Fixed amount</option>
                  <option value="PCT">Percentage of notional</option>
                  <option value="PER_SHARE">Per share (IBKR fixed-style)</option>
                </select>
              </label>

              {!isPerShare && (
                <label className="block md:col-span-2">
                  <span className="text-xs text-muted-foreground">
                    {risk.commissionMode === "PCT"
                      ? "Percent (%) per side"
                      : "Amount (€/$) per side"}
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    value={risk.commissionValue}
                    onChange={(e) =>
                      setRisk((r) => ({ ...r, commissionValue: Number(e.target.value) }))
                    }
                    disabled={riskLoading}
                  />
                </label>
              )}
            </div>
            {isPerShare && (
              <div className="text-xs text-muted-foreground">
                In <b>Per share</b> mode, the “Amount per side” field is not used.
              </div>
            )}
            {risk.commissionMode === "PER_SHARE" && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Commission per share</div>
                  <Input
                    type="number"
                    step="0.0001"
                    value={risk.commissionPerShare}
                    onChange={(e) =>
                      setRisk((r) => ({ ...r, commissionPerShare: Number(e.target.value) }))
                    }
                    disabled={riskLoading}
                  />
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">Minimum per side</div>
                  <Input
                    type="number"
                    step="0.01"
                    value={risk.commissionMinPerSide}
                    onChange={(e) =>
                      setRisk((r) => ({ ...r, commissionMinPerSide: Number(e.target.value) }))
                    }
                    disabled={riskLoading}
                  />
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">Cap (% of notional)</div>
                  <Input
                    type="number"
                    step="0.1"
                    value={risk.commissionCapPctOfNotional}
                    onChange={(e) =>
                      setRisk((r) => ({ ...r, commissionCapPctOfNotional: Number(e.target.value) }))
                    }
                    disabled={riskLoading}
                  />
                </div>
              </div>
            )}

          </div>

          {/* Equity */}
          <div className="rounded-2xl border border-neutral-700 p-4 space-y-4">
            <h3 className="text-lg font-semibold">Equity</h3>

            {loading ? (
              <div className="text-sm text-muted-foreground">Loading equity…</div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <label className="block md:col-span-2">
                    <span className="text-xs text-muted-foreground">Day start equity (today)</span>
                    <Input
                      type="number"
                      step="0.01"
                      value={dayStartEquity}
                      onChange={(e) => setDayStartEquity(Number(e.target.value))}
                    />
                  </label>

                  <div>
                    <div className="text-xs text-muted-foreground">Effective equity</div>
                    <div className="text-2xl font-semibold">
                      {Number(effectiveEquity || 0).toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Includes realized P/L + adjustments ({Number(adjustmentsTotal || 0).toFixed(2)})
                    </div>
                  </div>

                  <div className="md:col-span-3 flex justify-end">
                    <Button onClick={saveStartEquity} disabled={savingEquity || !journalDayId}>
                      {savingEquity ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>

                {/* Adjustments */}
                <div className="pt-2 space-y-3">
                  <h4 className="font-semibold">Adjustments</h4>

                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                    <label className="block md:col-span-2">
                      <span className="text-xs text-muted-foreground">Amount</span>
                      <Input
                        type="number"
                        step="0.01"
                        value={adjAmount}
                        onChange={(e) => setAdjAmount(Number(e.target.value))}
                      />
                    </label>

                    <label className="block">
                      <span className="text-xs text-muted-foreground">Reason</span>
                      <select
                        className="mt-1 w-full rounded-xl border bg-background text-foreground p-2
                                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={adjReason}
                        onChange={(e) => setAdjReason(e.target.value as AdjustmentReason)}
                      >
                        <option value="DEPOSIT">Deposit</option>
                        <option value="WITHDRAWAL">Withdrawal</option>
                        <option value="FEE">Fee</option>
                        <option value="CORRECTION">Correction</option>
                      </select>
                    </label>

                    <label className="block md:col-span-2">
                      <span className="text-xs text-muted-foreground">Note</span>
                      <Input
                        value={adjNote}
                        onChange={(e) => setAdjNote(e.target.value)}
                        placeholder="Optional"
                      />
                    </label>

                    <div className="md:col-span-5">
                      <Button onClick={addAdj} disabled={!journalDayId || journalDayId <= 0}>
                        Add adjustment
                      </Button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-muted-foreground">
                        <tr className="border-b">
                          <th className="text-left py-2">When</th>
                          <th className="text-left">Reason</th>
                          <th className="text-right">Amount</th>
                          <th className="text-left">Note</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.id} className="border-b last:border-none">
                            <td className="py-2">{new Date(r.at_time).toLocaleString()}</td>
                            <td>{r.reason}</td>
                            <td className="text-right">{Number(r.amount).toFixed(2)}</td>
                            <td>{r.note}</td>
                            <td className="text-right">
                              <Button variant="outline" size="sm" onClick={() => delAdj(r.id)}>
                                Delete
                              </Button>
                            </td>
                          </tr>
                        ))}
                        {rows.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-3 text-muted-foreground">
                              No adjustments yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}