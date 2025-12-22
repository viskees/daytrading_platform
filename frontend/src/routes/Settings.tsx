import { useEffect, useState } from "react";
import { fetchUserSettings, saveTheme } from "../lib/api";
import { getTokens } from "../lib/auth";

export default function Settings() {
  const [dark, setDark] = useState(false);
  const loggedIn = !!getTokens();

  useEffect(() => {
    if (!loggedIn) return;
      fetchUserSettings()
      .then((s) => {
        if (!s) return;
        setDark(!!s.dark_mode);
      })
      .catch(() => {});
  }, [loggedIn]);

  async function toggleDark(v: boolean) {
    setDark(v);
    if (loggedIn) {
      await saveTheme(v ? "dark" : "light").catch(() => {});
    }
    // Still update DOM theme immediately (your App.tsx already handles theme toggle)
    document.documentElement.classList.toggle("dark", v);
    localStorage.setItem("theme", v ? "dark" : "light");
  }

  return (
    <div className="container py-6">
      <h1 className="text-2xl font-semibold mb-4">User Settings</h1>
      <div className="flex items-center gap-3">
        <span>Dark mode</span>
        <input type="checkbox" checked={dark} onChange={e=>toggleDark(e.target.checked)} />
      </div>
      {!loggedIn && <p className="text-sm text-zinc-500 mt-2">
        You’re not logged in. Settings save locally. <a className="underline" href="/login">Log in</a> to sync to your profile.
      </p>}
    </div>
  );
}
