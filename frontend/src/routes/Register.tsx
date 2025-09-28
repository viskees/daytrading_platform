import { useState } from "react";

export default function Register() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const r = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, display_name: displayName }),
    });
    if (r.ok) { setOk(true); return; }
    const data = await r.json().catch(() => ({}));
    setErr(data?.detail || "Registration failed");
  }

  if (ok) {
    return <div className="container max-w-md py-10">
      <h1 className="text-2xl font-semibold mb-2">Check your email</h1>
      <p className="text-sm">Your account has been created. You can now log in.</p>
      <a className="underline mt-4 inline-block" href="/login">Go to login</a>
    </div>
  }

  return (
    <div className="container max-w-md py-10">
      <h1 className="text-2xl font-semibold mb-4">Create your account</h1>
      <form className="space-y-4" onSubmit={submit}>
        <input className="input w-full" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
        <input className="input w-full" placeholder="Display name (optional)" value={displayName} onChange={e=>setDisplayName(e.target.value)} />
        <input className="input w-full" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
        <button className="btn">Sign up</button>
        {err && <div className="text-red-600 text-sm">{err}</div>}
      </form>
    </div>
  );
}
