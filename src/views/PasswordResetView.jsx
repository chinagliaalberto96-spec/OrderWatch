import { useState } from "react";
import Button from "../components/Button";
import OrderWatchMark from "../components/OrderWatchMark";

export default function PasswordResetView({ onUpdatePassword }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (password.length < 10) {
      setError("La password deve contenere almeno 10 caratteri.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Le due password non coincidono.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await onUpdatePassword(password);
    } catch (updateError) {
      setError(updateError.message || "Aggiornamento password non riuscito.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6" style={{ backgroundColor: "var(--color-background)" }}>
      <form className="w-full max-w-[480px] rounded-[24px] border bg-white p-9 shadow-soft" style={{ borderColor: "var(--color-border)" }} onSubmit={handleSubmit}>
        <div className="flex justify-center"><OrderWatchMark size="lg" /></div>
        <h1 className="mt-8 text-[30px] font-semibold" style={{ color: "var(--color-primary)" }}>Imposta una nuova password</h1>
        <p className="mt-3 text-sm leading-6" style={{ color: "var(--color-text-muted)" }}>Scegli una password personale di almeno 10 caratteri.</p>
        <label className="mt-7 block text-sm font-semibold">Nuova password</label>
        <input className="mt-2 h-14 w-full rounded-[14px] border px-4 outline-none" style={{ borderColor: "var(--color-border)" }} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <label className="mt-5 block text-sm font-semibold">Conferma password</label>
        <input className="mt-2 h-14 w-full rounded-[14px] border px-4 outline-none" style={{ borderColor: "var(--color-border)" }} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        {error && <p className="mt-5 text-sm font-medium" style={{ color: "var(--color-danger)" }}>{error}</p>}
        <Button className="mt-7 h-14 w-full" type="submit" disabled={submitting}>{submitting ? "Aggiornamento..." : "Salva password"}</Button>
      </form>
    </div>
  );
}
