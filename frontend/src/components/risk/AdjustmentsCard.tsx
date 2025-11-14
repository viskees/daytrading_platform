import React from 'react';
import { getTodayJournalDay, listAdjustments, createAdjustment, deleteAdjustment, AdjustmentReason } from '@/lib/api';

export default function AdjustmentsCard() {
  const [journalDayId, setJournalDayId] = React.useState<number | null>(null);
  const [rows, setRows] = React.useState<any[]>([]);
  const [amount, setAmount] = React.useState<string>("");
  const [reason, setReason] = React.useState<AdjustmentReason>('DEPOSIT');
  const [note, setNote] = React.useState<string>('');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const signByReason = (r: string, v: number) =>
    r === "WITHDRAWAL" || r === "FEE" ? -Math.abs(v) : (r === "DEPOSIT" ? Math.abs(v) : v);

  const load = React.useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    setLoading(true);
    setError(null);
    try {
      const d = await getTodayJournalDay(today);
      if (!d) { setError('No Journal Day for today.'); return; }
      setJournalDayId(d.id);
      const items = await listAdjustments(d.id);
      setRows(items);
    } catch (e:any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!journalDayId) return;
    try {
      const raw = parseFloat(amount);
      if (!Number.isFinite(raw)) {
        setError('Please enter a valid amount.');
        return;
      }
      const signed = signByReason(reason, raw);
      await createAdjustment({ journal_day: journalDayId, amount: signed, reason, note });
      setAmount(""); 
      setNote('');
      await load();
    } catch (e:any) {
      setError(e?.message ?? 'Failed to add adjustment');
    }
  };

  const remove = async (id: number) => {
    try {
      await deleteAdjustment(id);
      await load();
    } catch (e:any) {
      setError(e?.message ?? 'Failed to delete adjustment');
    }
  };

  if (loading) return <div className="p-4">Loading adjustments…</div>;

  return (
    <div className="p-4 rounded-2xl border border-neutral-700">
      <h3 className="text-lg font-semibold mb-3">Adjustments</h3>
      {error && <div className="mb-3 text-red-400 text-sm">{error}</div>}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end mb-4">
        <label className="block md:col-span-2">
          <span className="text-sm text-neutral-400">Amount</span>
          <input
            type="text"
            inputMode="decimal"
            className="mt-1 w-full rounded-xl bg-neutral-900 border border-neutral-700 p-2"
            value={amount}
            onChange={(e)=>setAmount(e.target.value)}
            placeholder="0.00"
          />
        </label>
        <label className="block">
          <span className="text-sm text-neutral-400">Reason</span>
          <select className="mt-1 w-full rounded-xl bg-neutral-900 border border-neutral-700 p-2"
                  value={reason} onChange={(e)=>setReason(e.target.value as AdjustmentReason)}>
            <option value="DEPOSIT">Deposit</option>
            <option value="WITHDRAWAL">Withdrawal</option>
            <option value="FEE">Fee</option>
            <option value="CORRECTION">Correction</option>
          </select>
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm text-neutral-400">Note</span>
          <input className="mt-1 w-full rounded-xl bg-neutral-900 border border-neutral-700 p-2"
                 value={note} onChange={(e)=>setNote(e.target.value)} placeholder="Optional"/>
        </label>
        <div className="md:col-span-5">
          <button onClick={add} className="rounded-xl px-4 py-2 bg-blue-600 hover:bg-blue-500">Add</button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-neutral-400">
            <tr><th className="text-left py-2">When</th><th className="text-left">Reason</th><th className="text-right">Amount</th><th className="text-left">Note</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-neutral-800">
                <td className="py-2">{new Date(r.at_time).toLocaleString()}</td>
                <td>{r.reason}</td>
                <td className="text-right">{Number(r.amount).toFixed(2)}</td>
                <td>{r.note}</td>
                <td className="text-right">
                  <button onClick={()=>remove(r.id)} className="px-2 py-1 rounded-lg border border-neutral-700 hover:bg-neutral-800">Delete</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="py-3 text-neutral-500">No adjustments yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
