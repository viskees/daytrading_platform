
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getInitialDark, setTheme } from "@/lib/theme";

export default function Landing() {
  const [dark, setDark] = useState<boolean>(getInitialDark());

  useEffect(() => {
    setTheme(dark);
  }, [dark]);

  return (
    <div className="min-h-screen">
      {/* Top bar (matches app feel) */}
      <header className="border-b">
        <div className="container py-4 flex items-center justify-between">
          <div className="font-semibold tracking-tight">Trade Journal</div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <span>Dark mode</span>
              <Switch checked={dark} onCheckedChange={setDark} />
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/login">Log in</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/register">Create account</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left: hero */}
          <div className="space-y-4">
            <h1 className="text-4xl font-bold tracking-tight">
              Journal your trades. Improve your edge.
            </h1>
            <p className="text-muted-foreground text-lg max-w-xl">
              A fast, privacy-first trading journal with stats, calendar insights,
              and (soon) best-trade highlights.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button asChild>
                <Link to="/register">Get started</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/login">I already have an account</Link>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground pt-3">
              Tip: once you&apos;re logged in, you&apos;ll be redirected into <code>/app</code>.
            </p>
          </div>

          {/* Right: feature cards (same visual language as the app) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-5 space-y-2">
                <div className="font-semibold">Calendar overview</div>
                <p className="text-sm text-muted-foreground">
                  See your month at a glance: P/L, win-rate, drawdown, and best/worst sessions.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 space-y-2">
                <div className="font-semibold">Clean workflow</div>
                <p className="text-sm text-muted-foreground">
                  Log trades quickly, attach screenshots, and keep your process consistent.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 space-y-2">
                <div className="font-semibold">Risk guardrails</div>
                <p className="text-sm text-muted-foreground">
                  Keep risk tight with per-trade caps and daily budget visibility.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 space-y-2">
                <div className="font-semibold">2FA-ready</div>
                <p className="text-sm text-muted-foreground">
                  Optional two-factor authentication support for safer accounts.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
