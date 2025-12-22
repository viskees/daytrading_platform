import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getInitialDark, setTheme } from "@/lib/theme";

export default function ResetPassword() {
  const { uid, token } = useParams();

  const [dark, setDark] = useState<boolean>(getInitialDark());

  const [newPw1, setNewPw1] = useState("");
  const [newPw2, setNewPw2] = useState("");

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

    if (!uid || !token) {
      setErr("Invalid reset link.");
      return;
    }
    if (!newPw1 || newPw1 !== newPw2) {
      setErr("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/auth/password-reset-confirm/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, token, password: newPw1 }),
      });

      if (!r.ok) {
        const data = await r.json().catch(() => null);
        setErr(data?.detail || "Failed to reset password.");
        return;
      }

      setDoneMsg("Password has been reset successfully. You can now log in.");
      setNewPw1("");
      setNewPw2("");
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
            <h1 className="text-xl font-bold">Choose a new password</h1>
            <div className="flex items-center gap-2 text-sm">
              <span>Dark mode</span>
              <Switch checked={dark} onCheckedChange={setDark} />
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Enter a new password for your account.
          </p>

          <form className="space-y-3" onSubmit={submit}>
            <div className="text-sm font-medium">New password</div>
            <Input
              type="password"
              value={newPw1}
              onChange={(e) => setNewPw1(e.target.value)}
              autoComplete="new-password"
              disabled={loading}
              required
            />

            <div className="text-sm font-medium">Repeat new password</div>
            <Input
              type="password"
              value={newPw2}
              onChange={(e) => setNewPw2(e.target.value)}
              autoComplete="new-password"
              disabled={loading}
              required
            />

            <div className="flex gap-2">
              <Button type="submit" disabled={loading || !newPw1 || !newPw2}>
                {loading ? "Resetting…" : "Reset password"}
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