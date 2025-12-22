import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getInitialDark, setTheme } from "@/lib/theme";

export default function ForgotPassword() {
  const [dark, setDark] = useState<boolean>(getInitialDark());

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setTheme(dark);
  }, [dark]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setDoneMsg(null);
    setLoading(true);

    try {
      const r = await fetch("/api/auth/password-reset/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      // Backend commonly returns 200 even if email doesn't exist.
      if (!r.ok) {
        const data = await r.json().catch(() => null);
        setErr(data?.detail || "Failed to request password reset.");
        return;
      }

      setDoneMsg("If the email exists, a reset link has been sent.");
    } catch {
      setErr("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-10 space-y-6">
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">Reset password</h1>
            <div className="flex items-center gap-2 text-sm">
              <span>Dark mode</span>
              <Switch checked={dark} onCheckedChange={setDark} />
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Enter your email and we’ll send you a password reset link.
          </p>

          <form className="space-y-3" onSubmit={submit}>
            <div className="text-sm font-medium">Email</div>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              disabled={loading}
              required
            />

            <div className="flex gap-2">
              <Button type="submit" disabled={loading || !email}>
                {loading ? "Sending…" : "Send reset link"}
              </Button>

              <Button type="button" variant="outline" asChild disabled={loading}>
                <Link to="/login">Back to login</Link>
              </Button>
            </div>

            {doneMsg && <div className="text-emerald-600 text-sm">{doneMsg}</div>}
            {err && <div className="text-red-600 text-sm">{err}</div>}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}