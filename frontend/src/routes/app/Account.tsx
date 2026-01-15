import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  apiFetch,
  fetchMe,
  fetchTwoFAStatus,
  setupTwoFA,
  verifyTwoFA,
  disableTwoFA,
} from "@/lib/api";


const PROFILE_ENDPOINT = "/auth/me/";

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-zinc-900 border shadow-lg">
        <div className="flex items-center justify-between border-b p-4">
          <h3 className="font-semibold">{title}</h3>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export default function Account() {
  const [me, setMe] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Display name / nickname
  const [displayName, setDisplayName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);

  // 2FA state
  const [tfaEnabled, setTfaEnabled] = useState<boolean | null>(null);
  const [tfaLoading, setTfaLoading] = useState(false);
  const [tfaError, setTfaError] = useState<string | null>(null);
  const [tfaConfigUrl, setTfaConfigUrl] = useState<string | null>(null);
  const [tfaToken, setTfaToken] = useState("");
  const [showQr, setShowQr] = useState(false);

  // Derive a human-readable secret from the otpauth URL (optional manual entry)
  const tfaSecret = useMemo(() => {
    if (!tfaConfigUrl) return null;
    const idx = tfaConfigUrl.indexOf("secret=");
    if (idx === -1) return null;
    const rest = tfaConfigUrl.slice(idx + "secret=".length);
    return rest.split("&")[0];
  }, [tfaConfigUrl]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [meData, tfaStatus] = await Promise.all([
          fetchMe(),
          fetchTwoFAStatus().catch(() => null),
        ]);

        if (cancelled) return;

        setMe(meData);

        // Try common field names (depends on your backend)
        const dn =
          meData?.display_name ??
          meData?.first_name ??
          meData?.displayName ??
          meData?.nickname ??
          meData?.nick_name ??
          "";
        setDisplayName(String(dn || ""));

        if (tfaStatus) setTfaEnabled(!!tfaStatus.enabled);
      } catch (e: any) {
        if (!cancelled) {
          console.error(e);
          setErr(e?.message ?? "Failed to load account info");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const saveDisplayName = async () => {
    setNameMsg(null);
    setErr(null);
    setNameSaving(true);
    try {
      // PATCH profile
      const res = await apiFetch(PROFILE_ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // pick one field; backend should ignore unknowns if serializer is strict it may 400
          first_name: displayName,
        }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `Failed to save display name (${res.status})`);
      }

      // Refresh me to reflect server truth
      const fresh = await fetchMe();
      setMe(fresh);

      const dn =
        fresh?.display_name ??
        fresh?.displayName ??
        fresh?.nickname ??
        fresh?.nick_name ??
        displayName;
      setDisplayName(String(dn || ""));
      setNameMsg("Saved.");
    } catch (e: any) {
      console.error(e);
      setErr(e?.message ?? "Failed to save display name");
    } finally {
      setNameSaving(false);
    }
  };

  const startTfaSetup = async () => {
    setTfaError(null);
    setTfaLoading(true);
    try {
      const data = await setupTwoFA();
      // not confirmed yet; status stays disabled until verify succeeds
      setTfaEnabled(false);
      setTfaConfigUrl(data.config_url || data.otpauth_url || null);
      setShowQr(true);
    } catch (e: any) {
      console.error(e);
      setTfaError(e?.message ?? "Failed to start 2FA setup");
    } finally {
      setTfaLoading(false);
    }
  };

  const handleTfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setTfaError(null);
    setTfaLoading(true);
    try {
      await verifyTwoFA(tfaToken.trim());
      setTfaToken("");
      setTfaEnabled(true);
      setShowQr(false);
    } catch (e: any) {
      console.error(e);
      setTfaError(e?.message ?? "Invalid 2FA code");
    } finally {
      setTfaLoading(false);
    }
  };

  const handleTfaDisable = async () => {
    if (!window.confirm("Disable two-factor authentication for this account?")) return;

    setTfaError(null);
    setTfaLoading(true);
    try {
      await disableTwoFA();
      setTfaEnabled(false);
      setTfaConfigUrl(null);
      setTfaToken("");
      setShowQr(false);
    } catch (e: any) {
      console.error(e);
      setTfaError(e?.message ?? "Failed to disable 2FA");
    } finally {
      setTfaLoading(false);
    }
  };

  return (
    <>
      {/* QR modal */}
      {showQr && tfaConfigUrl && (
        <ModalShell
          title="Scan this code with your authenticator app"
          onClose={() => setShowQr(false)}
        >
          <form className="flex flex-col items-center gap-4" onSubmit={handleTfaVerify}>
            <div className="rounded-lg border bg-white p-3">
              <QRCodeCanvas value={tfaConfigUrl} size={220} />
            </div>

            {tfaSecret && (
              <p className="text-xs text-muted-foreground text-center">
                Or enter this secret manually:{" "}
                <code className="px-1 py-0.5 rounded bg-neutral-900 text-[11px] text-white">
                  {tfaSecret}
                </code>
              </p>
            )}

            <div className="w-full max-w-xs space-y-2">
              <div className="text-xs text-muted-foreground">
                Enter the 6-digit code from your app to enable 2FA.
              </div>
              <Input
                inputMode="numeric"
                pattern="\d*"
                maxLength={8}
                value={tfaToken}
                onChange={(e) => setTfaToken(e.target.value)}
                placeholder="123456"
                className="w-full"
              />
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={tfaLoading || !tfaToken}>
                {tfaLoading ? "Verifying…" : "Verify code"}
              </Button>
              {tfaError && (
                <div className="text-xs text-red-600 max-w-xs text-center">
                  {tfaError}
                </div>
              )}
            </div>
          </form>
        </ModalShell>
      )}

      <Card>
        <CardContent className="p-6 space-y-8">
          <h2 className="text-xl font-bold mb-2">Account</h2>

          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {err && <p className="text-sm text-red-600 whitespace-pre-wrap">{err}</p>}

          {!loading && me && (
            <>
              {/* Profile */}
              <section className="space-y-3">
                <h3 className="text-lg font-semibold">Profile</h3>

                <div className="text-sm space-y-1">
                  <div>
                    <span className="text-muted-foreground">Email: </span>
                    <span className="font-medium">{me.email}</span>
                  </div>
                  {me.last_login && (
                    <div className="text-xs text-muted-foreground">
                      Last login: {new Date(me.last_login).toLocaleString()}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <div className="md:col-span-2">
                    <div className="text-xs text-muted-foreground mb-1">Display / nick name</div>
                    <Input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g. Kees"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <Button onClick={saveDisplayName} disabled={nameSaving}>
                      {nameSaving ? "Saving…" : "Save"}
                    </Button>
                    {nameMsg && <span className="text-xs text-emerald-500">{nameMsg}</span>}
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  This name is shown inside the app. (Stored on your user profile.)
                </p>
              </section>

              {/* Password */}
              <section className="space-y-3">
                <h3 className="text-lg font-semibold">Password</h3>
                <p className="text-sm text-muted-foreground">
                  To change your password, use the same flow as “Forgot password”.
                </p>
                <Button asChild variant="outline">
                  <Link to="/forgot-password">Send password reset link</Link>
                </Button>
              </section>

              {/* 2FA */}
              <section className="space-y-3">
                <h3 className="text-lg font-semibold">Two-Factor Authentication</h3>
                <p className="text-sm text-muted-foreground">
                  Protect your account with a TOTP authenticator app (Google Authenticator, 1Password, etc.).
                </p>

                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-muted-foreground">Status:</span>
                  <span className={tfaEnabled ? "font-semibold text-emerald-500" : "font-semibold text-red-500"}>
                    {tfaEnabled ? "Enabled" : "Disabled"}
                  </span>

                  {!tfaEnabled && (
                    <Button size="sm" onClick={startTfaSetup} disabled={tfaLoading}>
                      {tfaLoading ? "Starting…" : "Set up 2FA"}
                    </Button>
                  )}

                  {tfaEnabled && (
                    <Button size="sm" variant="outline" onClick={handleTfaDisable} disabled={tfaLoading}>
                      Disable 2FA
                    </Button>
                  )}
                </div>

                {tfaConfigUrl && (
                  <div className="mt-2 rounded-xl border p-3 space-y-2 text-xs">
                    <div className="font-semibold">Setup instructions</div>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Click “Set up 2FA” to open the QR modal and scan the code.</li>
                      {tfaSecret && (
                        <li>
                          Or enter this secret manually:{" "}
                          <code className="px-1 py-0.5 rounded bg-neutral-900 text-[11px] text-white">
                            {tfaSecret}
                          </code>
                        </li>
                      )}
                    </ol>
                  </div>
                )}

                <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={handleTfaVerify}>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Verify a 2FA code</div>
                    <Input
                      inputMode="numeric"
                      pattern="\d*"
                      maxLength={8}
                      value={tfaToken}
                      onChange={(e) => setTfaToken(e.target.value)}
                      placeholder="123456"
                      className="w-32"
                    />
                  </div>
                  <Button type="submit" size="sm" disabled={tfaLoading || !tfaToken}>
                    Verify code
                  </Button>
                  {tfaError && <div className="text-xs text-red-600">{tfaError}</div>}
                </form>
              </section>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}