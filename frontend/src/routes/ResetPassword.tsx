import { useParams } from "react-router-dom";
import { useState } from "react";
import api from "../lib/api";

export default function ResetPassword() {
  const { uid, token } = useParams();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post("/accounts/password-reset-confirm/", {
      uid,
      token,
      password,
    });
    setDone(true);
  };

  if (done) {
    return <p>Password reset successful. You may now log in.</p>;
  }

  return (
    <form onSubmit={submit}>
      <input
        type="password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="submit">Reset password</button>
    </form>
  );
}