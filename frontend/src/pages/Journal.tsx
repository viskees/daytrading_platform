import React, { useEffect, useState } from "react";
import { API } from "../lib/api";

export default function Journal() {
  const [today, setToday] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      const iso = new Date().toISOString().slice(0,10);
      const days = await API.get(`/journal/days/?search=${iso}`);
      setToday(days?.results?.[0] ?? null);
    })();
  }, []);

  if (!today) return <div>No Journal Day yet. Create one via “New Trade” — the form can auto-create today.</div>;

  return (
    <div>
      <h1 className="text-xl font-semibold">Journal — {today.date}</h1>
      <div className="mt-2">Start Equity: €{today.day_start_equity}</div>
      <div>Realized PnL: €{today.realized_pnl}</div>
      <div>Max Daily Loss: {today.max_daily_loss_pct}% {today.breach_daily_loss && <strong>(BREACHED)</strong>}</div>
      <h2 className="mt-4 font-semibold">Trades</h2>
      <ul className="list-disc pl-5">
        {today.trades.map((t:any) => (
          <li key={t.id}>{t.ticker} {t.side} x{t.quantity} — PnL €{t.realized_pnl} (R {t.r_multiple})</li>
        ))}
      </ul>
    </div>
  );
}
