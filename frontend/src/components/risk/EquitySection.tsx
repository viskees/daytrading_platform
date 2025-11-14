import React from 'react';
import {
  getTodayJournalDay,
  patchDayStartEquity,
  listAdjustments,
  createAdjustment,
  deleteAdjustment,
  type AdjustmentReason,
} from '@/lib/api';

export default function EquitySection() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [journalDayId, setJournalDayId] = React.useState<number | null>(null);
  // keep as string while typing to avoid flicker/reset
  const [dayStartEquity, setDayStartEquity] = React.useState<string>("");
  const [effectiveEquity, setEffectiveEquity] = React.useState<number>(0);
  const [adjustmentsTotal, setAdjustmentsTotal] = React.useState<number>(0);

  const [adjRows, setAdjRows] = React.useState<any[]>([]);
  const [adjAmount, setAdjAmount] = React.useState<string>("");
  const [adjReason, setAdjReason] = React.useState<AdjustmentReason>('DEPOSIT');
  const [adjNote, setAdjNote] = React.useState<string>('');
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await getTodayJournalDay();
      if (!d) { setError('No Journal Day for today — create it from Journal first.'); return; }
      setJournalDayId(d.id);
      // seed as string; allow blank entry if you want to type from scratch
      const seed = d.day_start_equity !== undefined && d.day_start_equity !== null
        ? String(d.day_start_equity)
        : "";
      setDayStartEquity(seed);
      setEffectiveEquity(Number(d.effective_equity || 0));
      setAdjustmentsTotal(Number(d.adjustments_total || 0));
      const rows = await listAdjustments(d.id);
      setAdjRows(rows);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load equity data');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const saveStartEquity = async () => {
    if (!journalDayId) return;
    setSaving(true);
    setError(null);
    try {
      // parse the string (allow comma decimal just in case)
      const parsed = parseFloat(String(dayStartEquity).replace(',', '.'));
      if (!Number.isFinite(parsed)) {
        setError('Please enter a valid number for day start equity.');
        setSaving(false);
        return;
      }
      const updated = await patchDayStartEquity(journalDayId, parsed);
      setEffectiveEquity(Number(updated.effective_equity || 0));
      setAdjustmentsTotal(Number(updated.adjustments_total || 0));
      // normalize displayed value from server echo
      setDayStartEquity(
        updated?.day_start_equity !== undefined && updated?.day_start_equity !== null ? String(updated.day_start_equity) : ""
      );
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save day start equity');
    } finally {
      setSaving(false);
    }
  };

  const signedByReason = (reason: AdjustmentReason, raw: number) => {
    if (!Number.isFinite(raw)) return NaN;
    if (reason === 'WITHDRAWAL' || reason === 'FEE') return -Math.abs(raw);
    if (reason === 'DEPOSIT') return Math.abs(raw);
    return raw; // CORRECTION
  };


  const addAdjustment = async () => {
    if (!journalDayId) return;
    setError(null);
    try {
      const raw = parseFloat(adjAmount);
      if (!Number.isFinite(raw)) {
        setError('Please enter a valid number for Amount.');
        return;
      }
      const signed = signedByReason(adjReason, raw);
      await createAdjustment({
        journal_day: journalDayId,
        amount: signed,
        reason: adjReason,
        note: adjNote || '',
      });
      setAdjAmount("");
      setAdjNote('');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to add adjustment');
    }
  };

  const removeAdjustment = async (id: number) => {
    setError(null);
    try {
      await deleteAdjustment(id);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete adjustment');
    }
  };

  if (loading) return <div className="mt-4">Loading equity…</div>;

  return (
    <div className="mt-6 rounded-2xl border border-neutral-700 p-4">
      <h2 className="text-xl font-semibold mb-3">Equity</h2>
      {error && <div className="mb-3 text-red-400 text-sm">{error}</div>}

      {/* Day Start Equity */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <label className="block">
          <span className="text-sm text-neutral-400">Day start equity (today)</span>
          <input
            type="text"
            inputMode="decimal"
            className="mt-1 w-full rounded-xl bg-neutral-900 border border-neutral-700 p-2"
            value={dayStartEquity}
            onChange={(e) => setDayStartEquity(e.target.value)}
            onBlur={saveStartEquity}
            placeholder="0.00"
          />
        </label>

        <div>
          <div className="text-sm text-neutral-400">Effective equity</div>
          <div className="text-xl font-semibold">{effectiveEquity.toFixed(2)}</div>
          <div className="text-xs text-neutral-500">
            Includes realized P/L + adjustments ({adjustmentsTotal.toFixed(2)})
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={saveStartEquity}
            disabled={saving || !journalDayId}
            className="rounded-xl px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Adjustments */}
      <div className="mt-6">
        <h3 className="text-lg font-medium mb-2">Adjustments</h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end mb-3">
          <label className="block md:col-span-2">
            <span className="text-sm text-neutral-400">Amount</span>
            <input
              type="text"
              inputMode="decimal"
              className="mt-1 w-full rounded-xl bg-neutral-900 border border-neutral-700 p-2"
              value={adjAmount}
              onChange={(e) => setAdjAmount(e.target.value)}
              placeholder="Amount"
            />
          </label>
          <label className="block">
            <span className="text-sm text-neutral-400">Reason</span>
            <select
              className="mt-1 w-full rounded-xl bg-neutral-900 border border-neutral-700 p-2"
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
            <span className="text-sm text-neutral-400">Note</span>
            <input
              className="mt-1 w-full rounded-xl bg-neutral-900 border border-neutral-700 p-2"
              value={adjNote}
              onChange={(e) => setAdjNote(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <div className="md:col-span-5">
            <button onClick={addAdjustment} className="rounded-xl px-4 py-2 bg-blue-600 hover:bg-blue-500">
              Add adjustment
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="text-left py-2">When</th>
                <th className="text-left">Reason</th>
                <th className="text-right">Amount</th>
                <th className="text-left">Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {adjRows.map((r) => (
                <tr key={r.id} className="border-t border-neutral-800">
                  <td className="py-2">{new Date(r.at_time).toLocaleString()}</td>
                  <td>{r.reason}</td>
                  <td className="text-right">{Number(r.amount).toFixed(2)}</td>
                  <td>{r.note}</td>
                  <td className="text-right">
                    <button
                      onClick={() => removeAdjustment(r.id)}
                      className="px-2 py-1 rounded-lg border border-neutral-700 hover:bg-neutral-800"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {adjRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-neutral-500">No adjustments yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
