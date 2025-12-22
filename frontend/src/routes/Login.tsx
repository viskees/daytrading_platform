import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getInitialDark, setTheme } from "@/lib/theme";
import { login as apiLogin } from "@/lib/api";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation() as any;
  const registered = !!location?.state?.registered;
  const registeredEmail = String(location?.state?.registeredEmail ?? "");

  // Registration success banner is shown when redirected from /register
  // via navigate("/login", { state: { registered: true, registeredEmail } })

  const [dark, setDark] = useState<boolean>(getInitialDark());

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setTheme(dark);
  }, [dark]);

  const afterLoginPath =
    (location?.state?.from && typeof location.state.from === "string"
      ? location.state.from
      : location?.state?.from?.pathname) || "/app";

  const doLogin = async () => {
    setErr(null);
    setLoading(true);
    try {
      await apiLogin(email, password, mfaCode || undefined);
      navigate(afterLoginPath, { replace: true });
    } catch (e: any) {
      const msg = String(e?.message ?? "Login failed");
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!loading) void doLogin();
  };

  return (
    <div className="max-w-2xl mx-auto py-10 space-y-6">
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">Login</h1>
            <div className="flex items-center gap-2 text-sm">
              <span>Dark mode</span>
              <Switch checked={dark} onCheckedChange={setDark} />
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Please log in to access the trading app.
          </p>
          {registered && (
            <div className="text-emerald-600 text-sm">
              Account created{registeredEmail ? ` for ${registeredEmail}` : ""}. Please check your email and click the
              activation link to complete registration before logging in.
            </div>
          )}
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
              />

              <div className="text-sm font-medium">Password</div>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                disabled={loading}
              />

              <div className="text-sm font-medium mt-2">2FA code (if enabled)</div>
              <Input
                type="text"
                inputMode="numeric"
                pattern="\d*"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="123456"
                disabled={loading}
              />

              <div className="text-sm text-right">
                <Link className="underline" to="/forgot-password">
                  Forgot your password?
                </Link>
              </div>

              <div className="flex gap-2 mt-3">
                <Button type="submit" disabled={loading}>
                  Log in
                </Button>

                <Button type="button" variant="outline" asChild disabled={loading}>
                  <Link to="/register">Create account</Link>
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