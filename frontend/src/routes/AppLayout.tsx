import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getInitialDark, setTheme } from "@/lib/theme";
import { useEffect, useState } from "react";
import { logout as apiLogout, setUnauthorizedHandler } from "@/lib/api";

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [dark, setDark] = useState<boolean>(getInitialDark());

  // theme → DOM + localStorage
  useEffect(() => {
    setTheme(dark);
  }, [dark]);

  // If backend reports 401 and refresh fails -> go login
  useEffect(() => {
    setUnauthorizedHandler(() => {
      navigate("/login", { replace: true, state: { from: location } });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate, location]);

  return (
    <div className="min-h-screen">
      <div className="p-6 space-y-6">
        <nav className="flex items-center justify-between border-b pb-3">
          <div className="flex flex-wrap gap-2">
            {[
              { to: "/app", label: "Dashboard", end: true },
              { to: "/app/risk", label: "Risk" },
              { to: "/app/journal", label: "Journal" },
              { to: "/app/feedback", label: "Feedback" },
              { to: "/app/account", label: "Account" },
            ].map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end as any}
                className="no-underline"
              >
                {({ isActive }) => (
                  <Button variant={isActive ? "default" : "outline"}>
                    {tab.label}
                  </Button>
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
                  navigate("/login", { replace: true, state: { from: "/app" } });
                }
              }}
            >
              Logout
            </Button>
          </div>
        </nav>

        {/* ✅ This is where the 5 pages render */}
        <Outlet />
      </div>
    </div>
  );
}