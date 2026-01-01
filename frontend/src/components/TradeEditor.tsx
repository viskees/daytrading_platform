import { useState } from "react";

type Props = {
  mode: "create" | "edit";
  initial?: {
    id?: number | string;
    ticker?: string;
    side?: "LONG" | "SHORT";
    entryPrice?: number;
    stopLoss?: number | null;
    target?: number | null;
    size?: number;
    notes?: string;
    strategyTags?: string[];
  };
  onSubmit(values: Required<Props>["initial"]): Promise<void>;
  onClose(): void;
};

const DEFAULT_TAGS = ["Breakout", "Pullback", "Trend", "Range", "News"];

export default function TradeEditor({ mode, initial = {}, onSubmit, onClose }: Props) {
  const isEdit = mode === "edit";
  const [form, setForm] = useState({
    id: initial.id,
    ticker: initial.ticker ?? "",
    side: initial.side ?? "LONG",
    entryPrice: initial.entryPrice ?? 0,
    stopLoss: initial.stopLoss ?? null,
    target: initial.target ?? null,
    size: initial.size ?? 0,
    notes: initial.notes ?? "",
    strategyTags: initial.strategyTags ?? [],
  });

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fmtMoney = (n: number) =>
    (Number.isFinite(n) ? n : 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const fmtPrice = (n: number) =>
    (Number.isFinite(n) ? n : 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });

  // --- Derived values ---
  const entry = Number(form.entryPrice) || 0;
  const size = Number(form.size) || 0;
  const stop = form.stopLoss === null || form.stopLoss === undefined ? null : Number(form.stopLoss);

  const positionValue = entry * size;

  const hasStop = stop !== null && Number.isFinite(stop);
  const perShareRisk = hasStop ? Math.abs(entry - (stop as number)) : 0;
  const riskAtStop = hasStop ? perShareRisk * size : 0;

  const update = (k: keyof typeof form) => (e: any) =>
    setForm(f => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const toggleTag = (tag: string) =>
    setForm(f => {
      const cur = new Set(f.strategyTags ?? []);
      if (cur.has(tag)) cur.delete(tag);
      else cur.add(tag);
      return { ...f, strategyTags: Array.from(cur) };
    });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="w-[640px] max-w-[96vw] rounded-2xl bg-neutral-900 border border-white/10 p-4">
        <div className="text-lg font-semibold mb-2">
          {mode === "edit" ? "Edit trade" : "New trade"}
        </div>

        {err && <div className="mb-2 text-red-400 text-sm">{err}</div>}

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm opacity-80">
            Ticker
            <input
              className="w-full mt-1 bg-black/30 rounded px-2 py-1 uppercase"
              value={form.ticker}
              onChange={e => update("ticker")(e.target.value.toUpperCase())}
              disabled={isEdit}
            />
          </label>

          <label className="text-sm opacity-80">
            Side
            <select
              className="w-full mt-1 bg-black/30 rounded px-2 py-1"
              value={form.side}
              onChange={e => update("side")(e.target.value)}
              disabled={isEdit}
            >
              <option value="LONG">LONG</option>
              <option value="SHORT">SHORT</option>
            </select>
          </label>

          <label className="text-sm opacity-80">
            Entry
            <input
              type="number"
              step="0.01"
              className="w-full mt-1 bg-black/30 rounded px-2 py-1"
              value={form.entryPrice}
              onChange={e => update("entryPrice")(Number(e.target.value))}
              disabled={isEdit}
            />
          </label>

          <label className="text-sm opacity-80">
            Size
            <input
              type="number"
              step="1"
              className="w-full mt-1 bg-black/30 rounded px-2 py-1"
              value={form.size}
              onChange={e => update("size")(Number(e.target.value))}
              disabled={isEdit}
            />
          </label>

          {/* Position value */}
          <div className="col-span-2 -mt-1 text-sm opacity-80">
            Position value (Entry × Size):
            <span className="ml-2 font-semibold tabular-nums">{fmtMoney(positionValue)}</span>
          </div>

          <label className="text-sm opacity-80">
            Stop
            <input
              type="number"
              step="0.01"
              className="w-full mt-1 bg-black/30 rounded px-2 py-1"
              value={form.stopLoss ?? ""}
              placeholder="—"
              onChange={e => update("stopLoss")(e.target.value === "" ? null : Number(e.target.value))}
            />
          </label>

          <label className="text-sm opacity-80">
            Target
            <input
              type="number"
              step="0.01"
              className="w-full mt-1 bg-black/30 rounded px-2 py-1"
              value={form.target ?? ""}
              placeholder="—"
              onChange={e => update("target")(e.target.value === "" ? null : Number(e.target.value))}
            />
          </label>

          {/* NEW: Risk at stop */}
          <div className="col-span-2 -mt-1 text-sm opacity-80">
            Risk at stop:
            <span className="ml-2 font-semibold tabular-nums">
              {hasStop ? fmtMoney(riskAtStop) : "—"}
            </span>
            <span className="ml-3 opacity-70 tabular-nums">
              (per-share: {hasStop ? fmtPrice(perShareRisk) : "—"})
            </span>
          </div>

          <label className="col-span-2 text-sm opacity-80">
            Notes
            <textarea
              className="w-full mt-1 bg-black/30 rounded px-2 py-1 min-h-[72px]"
              value={form.notes}
              onChange={e => update("notes")(e.target.value)}
            />
          </label>

          <div className="col-span-2 text-sm opacity-80">
            Strategy tags
            <div className="mt-2 flex flex-wrap gap-2">
              {DEFAULT_TAGS.map(tag => {
                const active = (form.strategyTags ?? []).includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`px-2 py-1 rounded border text-xs ${
                      active ? "bg-white/15 border-white/25" : "bg-black/20 border-white/10"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded bg-white/10 hover:bg-white/15"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setErr(null);
              try {
                setBusy(true);
                await onSubmit(form as any);
                onClose();
              } catch (e: any) {
                setErr(e?.message ?? "Failed");
              } finally {
                setBusy(false);
              }
            }}
            className="px-3 py-1 rounded bg-white/20 disabled:opacity-50"
          >
            {mode === "edit" ? "Save changes" : "Create trade"}
          </button>
        </div>
      </div>
    </div>
  );
}