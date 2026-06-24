import { BadgeCheck, CircleArrowRight, ClipboardList, Eye, EyeOff, Factory, FileLock2, LockKeyhole, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import Button from "../components/Button";

export default function LoginView({ config, onLogin }) {
  const accessCode = import.meta.env.VITE_ORDERWATCH_ACCESS_CODE || "graphic-demo-2026";
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const previousMinWidth = document.body.style.minWidth;
    document.body.style.minWidth = "0";
    return () => {
      document.body.style.minWidth = previousMinWidth;
    };
  }, []);

  function handleSubmit(event) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setError("Inserisci una email valida.");
      return;
    }

    if (code.trim() !== accessCode) {
      setError("Codice di accesso non corretto.");
      return;
    }

    setError("");
    onLogin({ email: normalizedEmail });
  }

  return (
    <div className="min-h-screen overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8" style={{ backgroundColor: "var(--color-background)" }}>
      <main className="mx-auto grid min-h-[calc(100vh-48px)] w-full max-w-[1720px] items-center gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(400px,0.78fr)] xl:gap-24">
        <section className="flex min-h-[660px] min-w-0 flex-col justify-between rounded-[32px] border bg-white p-7 shadow-soft sm:p-9 lg:p-11" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex min-h-[140px] items-center">
            <div className="inline-flex rounded-[22px] bg-[#0F1726] px-10 py-8 shadow-soft">
              {config.company.logoUrl ? (
                <img className="h-32 w-auto max-w-[520px] object-contain" src={config.company.logoUrl} alt={config.company.name} />
              ) : (
                <div className="text-lg font-semibold text-white">{config.company.name}</div>
              )}
            </div>
          </div>

          <div className="max-w-[780px]">
            <div className="inline-flex items-center gap-3 rounded-full border px-4 py-2 text-[15px] font-semibold" style={{ borderColor: "color-mix(in srgb, var(--color-accent) 24%, white)", backgroundColor: "color-mix(in srgb, var(--color-accent) 9%, white)", color: "var(--color-primary)" }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "var(--color-accent)" }} />
              Pilota operativo OrderWatch
            </div>

            <h1 className="mt-8 max-w-[760px] text-[42px] font-semibold leading-[1.04] tracking-[-0.02em] sm:text-[54px] xl:text-[64px]" style={{ color: "var(--color-primary)" }}>
              Ogni mattina sai quali materiali sono a rischio.
            </h1>

            <p className="mt-7 max-w-[610px] text-[20px] leading-8" style={{ color: "var(--color-text-muted)" }}>
              OrderWatch monitora ordini materiali, fornitori, PDF, DDT e scadenze dei lavori in corso.
            </p>

            <div className="mt-10 grid max-w-[760px] gap-4 sm:grid-cols-3">
              {[
                { icon: ClipboardList, label: "Ordini sotto controllo" },
                { icon: Factory, label: "Fornitori monitorati" },
                { icon: BadgeCheck, label: "Documenti verificati" }
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="min-h-[136px] rounded-[22px] border bg-white p-5" style={{ borderColor: "var(--color-border)" }}>
                    <Icon className="h-7 w-7" strokeWidth={2.2} style={{ color: "var(--color-accent)" }} />
                    <div className="mt-6 max-w-[150px] text-[16px] font-semibold leading-5" style={{ color: "var(--color-primary)" }}>
                      {item.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3 text-[15px] font-medium" style={{ color: "var(--color-text-muted)" }}>
            <FileLock2 className="h-5 w-5" />
            Accesso riservato agli utenti autorizzati.
          </div>
        </section>

        <aside className="flex min-w-0 justify-center lg:justify-start">
          <form className="w-full max-w-[560px] rounded-[32px] border bg-white px-8 py-10 shadow-[0_22px_70px_rgba(17,24,39,0.10)] sm:px-10 lg:px-12 lg:py-12" style={{ borderColor: "var(--color-border)" }} onSubmit={handleSubmit}>
            <div className="flex items-start justify-between gap-5">
              {config.brand?.orderWatchLogoUrl ? (
                <img className="h-24 w-auto max-w-[340px] object-contain" src={config.brand.orderWatchLogoUrl} alt={config.product.name} />
              ) : (
                <div className="text-xl font-semibold" style={{ color: "var(--color-primary)" }}>
                  {config.product.name}
                </div>
              )}
              <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full border text-[13px] font-semibold" style={{ borderColor: "var(--color-border)", backgroundColor: "#F8F8F7", color: "var(--color-primary)" }}>
                <FileLock2 className="h-4 w-4" />
                Pilot
              </div>
            </div>

            <div className="mt-12">
              <h2 className="text-[34px] font-semibold leading-tight tracking-[-0.01em] sm:text-[40px]" style={{ color: "var(--color-primary)" }}>
                Accedi alla dashboard
              </h2>
              <p className="mt-4 text-[18px] leading-7" style={{ color: "var(--color-text-muted)" }}>
                Inserisci email aziendale e codice pilota.
              </p>
            </div>

            <label className="mt-9 block text-[15px] font-semibold" htmlFor="email" style={{ color: "var(--color-primary)" }}>
              Email aziendale
            </label>
            <div className="mt-3 flex h-16 items-center gap-3 rounded-[18px] border px-5" style={{ borderColor: "var(--color-border)" }}>
              <Mail className="h-5 w-5" style={{ color: "var(--color-text-muted)" }} />
              <input
                id="email"
                className="min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-slate-400"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="nome@graphiccentergroup.it"
              />
            </div>

            <label className="mt-6 block text-[15px] font-semibold" htmlFor="access-code" style={{ color: "var(--color-primary)" }}>
              Codice pilota
            </label>
            <div className="mt-3 flex h-16 items-center gap-3 rounded-[18px] border px-5" style={{ borderColor: "var(--color-border)" }}>
              <LockKeyhole className="h-5 w-5" style={{ color: "var(--color-text-muted)" }} />
              <input
                id="access-code"
                className="min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-slate-400"
                type={showCode ? "text" : "password"}
                autoComplete="current-password"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="OW-GC-••••"
              />
              <button
                className="inline-flex h-9 w-9 items-center justify-center rounded-md"
                type="button"
                onClick={() => setShowCode((value) => !value)}
                aria-label={showCode ? "Nascondi codice" : "Mostra codice"}
              >
                {showCode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {error && (
              <p className="mt-5 rounded-[14px] border px-4 py-3 text-sm font-medium" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
                {error}
              </p>
            )}

            <Button className="mt-8 h-16 w-full rounded-[18px] text-[18px]" type="submit">
              Entra
              <CircleArrowRight className="h-5 w-5" />
            </Button>

            <p className="mt-8 text-[15px] font-medium leading-6" style={{ color: "var(--color-text-muted)" }}>
              Versione pilota collegata ai dati operativi Graphic Center.
            </p>

            <div className="mt-8 border-t pt-7" style={{ borderColor: "var(--color-border)" }}>
              <div className="flex items-center justify-center gap-3 text-[15px] font-semibold" style={{ color: "var(--color-primary)" }}>
                <span className="h-5 w-5 rounded-md" style={{ backgroundColor: "var(--color-primary)" }} />
                Powered by OrderWatch
              </div>
            </div>
          </form>
        </aside>
      </main>
    </div>
  );
}
