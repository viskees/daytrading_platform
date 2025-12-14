import { useState } from "react";
import api from "../lib/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post("/accounts/password-reset/", { email });
    setDone(true);
  };

  if (done) {
    return <p>If the email exists, a reset link has been sent.</p>;
  }

  return (
    <form onSubmit={submit}>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button type="submit">Send reset link</button>
    </form>
  );
}