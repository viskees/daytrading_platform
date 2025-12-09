// frontend/src/pages/Account.tsx
import React, { useEffect, useState } from "react";
import {
  fetchMe,
  fetchTwoFAStatus,
  startTwoFASetup,
  confirmTwoFA,
  disableTwoFA,
} from "../lib/api";

type Me = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  is_staff: boolean;
  is_active: boolean;
  date_joined: string;
  last_login: string | null;
};

type TwoFAState =
  | { enabled: false; loading: boolean }
  | { enabled: true; loading: boolean };

type SetupState =
  | null
  | {
      otpauth_url: string;
      issuer: string;
      label: string;
    };

const AccountPage: React.FC = () => {
  const [me, setMe] = useState<Me | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [twoFA, setTwoFA] = useState<TwoFAState>({
    enabled: false,
    loading: true,
  });

  const [setup, setSetup] = useState<SetupState>(null);
  const [code, setCode] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [disableLoading, setDisableLoading] = useState(false);

  // -------------------------------------------------------------------
  // Load current user + 2FA status
  // -------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoadingMe(true);
        setError(null);

        const [meResp, twoFAResp] = await Promise.all([
          fetchMe(),
          fetchTwoFAStatus(),
        ]);
        if (cancelled) return;

        setMe(meResp);
        setTwoFA({ enabled: !!twoFAResp.enabled, loading: false });
      } catch (err: any) {
        if (cancelled) return;
        console.error(err);
        setError("Failed to load account info");
        setTwoFA((prev) => ({ ...prev, loading: false }));
      } finally {
        if (!cancelled) setLoadingMe(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshTwoFAStatus = async () => {
    try {
      setTwoFA((prev) => ({ ...prev, loading: true }));
      const s = await fetchTwoFAStatus();
      setTwoFA({ enabled: !!s.enabled, loading: false });
    } catch (err) {
      console.error(err);
      setTwoFA((prev) => ({ ...prev, loading: false }));
    }
  };

  // -------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------
  const handleStartSetup = async () => {
    try {
      setError(null);
      setConfirming(false);
      setCode("");
      const s = await startTwoFASetup();
      setSetup(s);
    } catch (err: any) {
      console.error(err);
      setError("Could not start 2FA setup: " + (err?.message || ""));
    }
  };

  const handleConfirm = async () => {
    if (!code.trim()) {
      setError("Please enter the 6-digit code from your authenticator app.");
      return;
    }
    try {
      setConfirming(true);
      setError(null);
      await confirmTwoFA(code.trim());
      setSetup(null);
      setCode("");
      await refreshTwoFAStatus();
    } catch (err: any) {
      console.error(err);
      setError("Could not confirm code: " + (err?.message || ""));
    } finally {
      setConfirming(false);
    }
  };

  const handleDisable = async () => {
    if (!window.confirm("Disable two-factor authentication?")) return;
    try {
      setDisableLoading(true);
      setError(null);
      await disableTwoFA();
      await refreshTwoFAStatus();
    } catch (err: any) {
      console.error(err);
      setError("Could not disable 2FA: " + (err?.message || ""));
    } finally {
      setDisableLoading(false);
    }
  };

  // -------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------
  const renderQRModal = () => {
    if (!setup) return null;

    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
      setup.otpauth_url
    )}`;

    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
        <div className="bg-neutral-900 text-neutral-100 rounded-2xl shadow-xl w-full max-w-md p-6 relative">
          <h2 className="text-xl font-semibold mb-3">Set up two-factor authentication</h2>
          <p className="text-sm text-neutral-300 mb-4">
            Scan this QR code with your authenticator app (Google Authenticator, 1Password,
            Authy, etc.), then enter the 6-digit code to confirm.
          </p>

          <div className="flex flex-col items-center gap-3 mb-4">
            <img
              src={qrUrl}
              alt="2FA QR code"
              className="rounded-lg bg-white p-2"
            />
            <p className="text-xs text-neutral-400 break-all">
              If you can&apos;t scan the QR code, add this secret manually in your app:
              <br />
              <span className="font-mono text-[11px]">
                {setup.otpauth_url}
              </span>
            </p>
          </div>

          <div className="mb-4">
            <label className="block text-sm mb-1">6-digit code</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="flex justify-end gap-3 mt-2">
            <button
              type="button"
              onClick={() => {
                setSetup(null);
                setCode("");
              }}
              className="px-4 py-2 rounded-lg border border-neutral-600 text-sm hover:bg-neutral-800"
              disabled={confirming}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="px-4 py-2 rounded-lg bg-emerald-500 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-60"
              disabled={confirming}
            >
              {confirming ? "Confirming…" : "Confirm 2FA"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // -------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-6">Account</h1>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500 bg-red-950/40 px-4 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* User info */}
      <div className="mb-6 rounded-2xl border border-neutral-700 bg-neutral-900/80 p-4">
        <h2 className="text-lg font-semibold mb-3">Profile</h2>
        {loadingMe ? (
          <p className="text-sm text-neutral-400">Loading account info…</p>
        ) : me ? (
          <div className="text-sm text-neutral-200 space-y-1">
            <div>
              <span className="text-neutral-400">Email: </span>
              <span className="font-mono">{me.email}</span>
            </div>
            <div>
              <span className="text-neutral-400">Joined: </span>
              <span>{new Date(me.date_joined).toLocaleString()}</span>
            </div>
            {me.last_login && (
              <div>
                <span className="text-neutral-400">Last login: </span>
                <span>{new Date(me.last_login).toLocaleString()}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-neutral-400">No account data.</p>
        )}
      </div>

      {/* 2FA card */}
      <div className="mb-6 rounded-2xl border border-neutral-700 bg-neutral-900/80 p-4">
        <div className="flex items-center justify-between gap-4 mb-2">
          <h2 className="text-lg font-semibold">Two-Factor Authentication (TOTP)</h2>
          <span
            className={
              "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium " +
              (twoFA.enabled
                ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/50"
                : "bg-neutral-800 text-neutral-300 border border-neutral-600")
            }
          >
            {twoFA.loading
              ? "Checking…"
              : twoFA.enabled
              ? "Enabled"
              : "Disabled"}
          </span>
        </div>
        <p className="text-sm text-neutral-300 mb-4">
          Protect your account by requiring a one-time code from an authenticator app
          when logging in.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          {!twoFA.enabled ? (
            <button
              type="button"
              onClick={handleStartSetup}
              className="px-4 py-2 rounded-lg bg-emerald-500 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-60"
              disabled={twoFA.loading}
            >
              {twoFA.loading ? "Loading…" : "Enable 2FA"}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDisable}
              className="px-4 py-2 rounded-lg border border-red-500/70 text-sm font-semibold text-red-200 hover:bg-red-900/40 disabled:opacity-60"
              disabled={disableLoading || twoFA.loading}
            >
              {disableLoading ? "Disabling…" : "Disable 2FA"}
            </button>
          )}
        </div>
      </div>

      {renderQRModal()}
    </div>
  );
};

export default AccountPage;