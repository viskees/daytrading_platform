import { useState } from "react";
import { register as apiRegister } from "@/lib/api";

export default function Register() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await apiRegister(email, password, displayName || undefined);
      setOk(true);
    } catch (e: any) {
      setErr(e?.message ?? "Registration failed");
    }
  }

  if (ok) {
    return (
      <div className="container max-w-md py-10">
        <h1 className="text-2xl font-semibold mb-2">Check your email</h1>
        <p className="text-sm">
          We&apos;ve created your account. Please confirm it using the
          activation link we just emailed you. After that, you can log in.
        </p>
        <a className="underline mt-4 inline-block" href="/login">
          Go to login
        </a>
      </div>
    );
  }

  return (
    <div className="container max-w-md py-10">
      <h1 className="text-2xl font-semibold mb-4">Create your account</h1>
      <form className="space-y-4" onSubmit={submit}>
        <input
          className="input w-full"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="input w-full"
          placeholder="Display name (optional)"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <input
          className="input w-full"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="btn">Sign up</button>
        {err && <div className="text-red-600 text-sm">{err}</div>}
      </form>
    </div>
  );
}