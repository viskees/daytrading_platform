import { useState } from "react";
import { saveTokens } from "../lib/auth";

export default function Login() {
  const [username, setU] = useState(""); const [password, setP] = useState("");
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const r = await fetch("/api/auth/jwt/token/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    if (!r.ok) { setErr("Login failed"); return; }
    const data = await r.json(); // {access, refresh}
    saveTokens(data);
    window.location.href = "/";  // back to dashboard
  }

  return (
    <div className="container max-w-md py-10">
      <h1 className="text-2xl font-semibold mb-4">Log in</h1>
      <form className="space-y-4" onSubmit={submit}>
        <input className="input w-full" placeholder="Username" value={username} onChange={e => setU(e.target.value)} />
        <input className="input w-full" placeholder="Password" type="password" value={password} onChange={e => setP(e.target.value)} />
        <button className="btn">Sign in</button>
        {err && <div className="text-red-600 text-sm">{err}</div>}
      </form>
        <p className="text-sm mt-2">No account? <a className="underline" href="/register">Sign up with email</a></p >
        <p className="text-sm mt-3">2FA will be prompted on your first login via the backend flow.</p>
    </div >
  );
}
