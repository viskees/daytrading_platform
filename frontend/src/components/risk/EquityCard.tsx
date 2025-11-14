import React from 'react';
import { getTodayJournalDay, patchDayStartEquity } from '@/lib/api';

export default function EquityCard() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [journalDayId, setJournalDayId] = React.useState<number | null>(null);
  const [startEquity, setStartEquity] = React.useState<number>(0);
  const [effectiveEquity, setEffectiveEquity] = React.useState<number>(0);
  const [adjustmentsTotal, setAdjustmentsTotal] = React.useState<number>(0);

  React.useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    setLoading(true);
    getTodayJournalDay(today)
      .then((d) => {
        if (!d) { setError('No Journal Day for today. Create one from Journal.'); return; }
        setJournalDayId(d.id);
        setStartEquity(Number(d.day_start_equity || 0));
        setEffectiveEquity(Number(d.effective_equity || 0));
        setAdjustmentsTotal(Number(d.adjustments_total || 0));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!journalDayId) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await patchDayStartEquity(journalDayId, Number(startEquity));
      setEffectiveEquity(Number(updated.effective_equity || 0));
      setAdjustmentsTotal(Number(updated.adjustments_total || 0));
    } catch (e:any) {
      setError(e?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-4">Loading equity…</div>;

  return (
    <div className="p-4 rounded-2xl border border-neutral-700">
      <h3 className="text-lg font-semibold mb-3">Equity</h3>
      {error && <div className="mb-3 text-red-400 text-sm">{error}</div>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <label className="block">
          <span className="text-sm text-neutral-400">Day Start Equity (today)</span>
          <input
            type="number"
            step="0.01"
            className="mt-1 w-full rounded-xl bg-neutral-900 border border-neutral-700 p-2"
            value={startEquity}
            onChange={(e) => setStartEquity(Number(e.target.value))}
          />
        </label>
        <div>
          <div className="text-sm text-neutral-400">Effective Equity</div>
          <div className="text-xl font-semibold">{effectiveEquity.toFixed(2)}</div>
          <div className="text-xs text-neutral-500">Includes realized P/L + adjustments ({adjustmentsTotal.toFixed(2)})</div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={saving || !journalDayId}
            className="rounded-xl px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
