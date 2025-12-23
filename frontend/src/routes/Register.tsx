import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getInitialDark, setTheme } from "@/lib/theme";
import { register as apiRegister } from "@/lib/api";

export default function Register() {
  const navigate = useNavigate();
  const [dark, setDark] = useState<boolean>(getInitialDark());

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");

  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setTheme(dark);
  }, [dark]);

  const doRegister = async () => {
    setErr(null);
    setLoading(true);
    try {
      await apiRegister(email, password, displayName || undefined);

      // ✅ Route to login and show a “check your email” banner there
      navigate("/login", {
        replace: true,
        state: { registered: true, registeredEmail: email },
      });
    } catch (e: any) {
      setErr(String(e?.message ?? "Register failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!loading) void doRegister();
  };

  return (
    <div className="max-w-2xl mx-auto py-10 space-y-6">
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">Create account</h1>
            <div className="flex items-center gap-2 text-sm">
              <span>Dark mode</span>
              <Switch checked={dark} onCheckedChange={setDark} />
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Create an account. You’ll receive an activation email to complete registration.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <form className="space-y-2" onSubmit={handleSubmit}>
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

              <div className="text-sm font-medium">Display name (optional)</div>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
                disabled={loading}
              />

              <div className="text-sm font-medium">Password</div>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                disabled={loading}
                required
              />

              <div className="flex gap-2 mt-3">
                <Button type="submit" disabled={loading || !email || !password}>
                  Create account
                </Button>

                <Button type="button" variant="outline" asChild disabled={loading}>
                  <Link to="/login">Back to login</Link>
                </Button>
              </div>

              {err && <div className="text-red-600 text-sm mt-2">{err}</div>}
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}