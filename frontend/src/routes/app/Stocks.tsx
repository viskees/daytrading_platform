import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const MOCK_TICKERS = [
  { symbol: "AAPL", last: 191.02, volume: 12_450_000, relVol: 1.8, changePct: 1.24 },
  { symbol: "TSLA", last: 243.88, volume: 9_210_000, relVol: 2.3, changePct: -0.75 },
  { symbol: "AMD", last: 128.44, volume: 6_100_000, relVol: 1.2, changePct: 0.42 },
];

export default function Stocks() {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">Watchlist</h2>
            <div className="flex gap-2">
              <Input placeholder="Add symbol (e.g. NVDA)" className="w-40" />
              <Button>Add</Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr className="border-b">
                  <th className="py-2 pr-2">Symbol</th>
                  <th className="py-2 pr-2">Last</th>
                  <th className="py-2 pr-2">Volume</th>
                  <th className="py-2 pr-2">Rel Vol</th>
                  <th className="py-2 pr-2">Change%</th>
                  <th className="py-2 pr-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_TICKERS.map((t) => (
                  <tr key={t.symbol} className="border-b last:border-none">
                    <td className="py-2 pr-2 font-medium">{t.symbol}</td>
                    <td className="py-2 pr-2">{t.last.toFixed(2)}</td>
                    <td className="py-2 pr-2">{t.volume.toLocaleString()}</td>
                    <td className="py-2 pr-2">{t.relVol?.toFixed(2)}</td>
                    <td className={`py-2 pr-2 ${t.changePct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {t.changePct.toFixed(2)}%
                    </td>
                    <td className="py-2 pr-2 space-x-2">
                      <Button size="sm" variant="outline">Chart</Button>
                      <Button size="sm" variant="outline">Track</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            Later replace with <code>/api/market/movers</code>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="font-bold mb-2">Realtime Chart (placeholder)</h2>
          <div className="h-64 w-full border rounded-xl flex items-center justify-center text-sm text-muted-foreground">
            Embed chart library and drive via WebSocket <code>/ws/prices</code>.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}