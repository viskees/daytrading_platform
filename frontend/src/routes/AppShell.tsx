import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getInitialDark, setTheme } from "@/lib/theme";
import { logout as apiLogout, setUnauthorizedHandler } from "@/lib/api";
import { initAccessTokenFromRefresh } from "@/lib/auth";

export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();

  const [dark, setDark] = useState<boolean>(getInitialDark());

  // Apply theme to DOM
  useEffect(() => {
    setTheme(dark);
  }, [dark]);

  // Try mint access token from refresh cookie on initial mount (only once)
  useEffect(() => {
    (async () => {
      await initAccessTokenFromRefresh().catch(() => false);
    })();
  }, []);

  // Global 401 handler -> route to login
  useEffect(() => {
    setUnauthorizedHandler(() => {
      navigate("/login", { replace: true, state: { from: location.pathname } });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate, location.pathname]);

  // Idle timeout -> auto logout -> login
  useEffect(() => {
    const IDLE_MS = 15 * 60 * 1000;
    let timer: number | undefined;

    const reset = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        try {
          await apiLogout();
        } finally {
          navigate("/login", { replace: true, state: { from: location.pathname } });
        }
      }, IDLE_MS);
    };

    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "visibilitychange"] as const;
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true } as AddEventListenerOptions));
    reset();

    return () => {
      if (timer) window.clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, reset as any));
    };
  }, [navigate, location.pathname]);

  return (
    <div className="p-6 space-y-6">
      <nav className="flex items-center justify-between border-b pb-3">
        <div className="flex flex-wrap gap-2">
          {[
            { to: "/app", label: "Dashboard", end: true },
            { to: "/app/stocks", label: "Stocks" },
            { to: "/app/risk", label: "Risk" },
            { to: "/app/journal", label: "Journal" },
            { to: "/app/account", label: "Account" },
          ].map((tab) => (
            <NavLink key={tab.to} to={tab.to} end={tab.end as any} className="no-underline">
              {({ isActive }) => (
                <Button variant={isActive ? "default" : "outline"}>{tab.label}</Button>
              )}
            </NavLink>
          ))}
        </div>

        <div className="flex items-center gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span>Dark mode</span>
            <Switch checked={dark} onCheckedChange={setDark} />
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await apiLogout();
              } finally {
                navigate("/login", { replace: true, state: { from: location.pathname } });
              }
            }}
          >
            Logout
          </Button>
        </div>
      </nav>

      <Outlet />
    </div>
  );
}