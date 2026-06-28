import Card from "../components/Card";

export default function SettingsView({ config, meta = {} }) {
  const activeModules = Object.entries(config.modules).filter(([, active]) => active);
  const { mode, lastUpdated, counts = {} } = meta;

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card title="Stato dati" className="col-span-2">
        <div className="grid grid-cols-5 gap-3 text-sm">
          <div className="rounded-md border p-3" style={{ borderColor: "var(--color-border)" }}>
            <div style={{ color: "var(--color-text-muted)" }}>Modalita'</div>
            <div className="mt-1 text-lg font-semibold" style={{ color: mode === "mock" ? "var(--color-warning)" : "var(--color-success)" }}>
              {mode === "mock" ? "Demo locale" : "Airtable live"}
            </div>
          </div>
          <div className="rounded-md border p-3" style={{ borderColor: "var(--color-border)" }}>
            <div style={{ color: "var(--color-text-muted)" }}>Ultimo aggiornamento</div>
            <div className="mt-1 text-lg font-semibold">
              {lastUpdated ? lastUpdated.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "-"}
            </div>
          </div>
          <div className="rounded-md border p-3" style={{ borderColor: "var(--color-border)" }}>
            <div style={{ color: "var(--color-text-muted)" }}>Record totali</div>
            <div className="mt-1 text-lg font-semibold">
              {(counts.orders || 0) +
                (counts.projects || 0) +
                (counts.suppliers || 0) +
                (counts.documents || 0) +
                (counts.processedEmails || 0)}
            </div>
          </div>
          <div className="rounded-md border p-3" style={{ borderColor: "var(--color-border)" }}>
            <div style={{ color: "var(--color-text-muted)" }}>Da verificare</div>
            <div className="mt-1 text-lg font-semibold" style={{ color: counts.review ? "var(--color-danger)" : "inherit" }}>
              {counts.review || 0}
            </div>
          </div>
          <div className="rounded-md border p-3" style={{ borderColor: "var(--color-border)" }}>
            <div style={{ color: "var(--color-text-muted)" }}>Refresh automatico</div>
            <div className="mt-1 text-lg font-semibold">Ogni 60s</div>
          </div>
        </div>
      </Card>
      <Card title="Configurazione cliente">
        <dl className="space-y-3 text-sm">
          <div className="grid grid-cols-[160px_1fr] gap-3">
            <dt style={{ color: "var(--color-text-muted)" }}>Prodotto</dt>
            <dd className="font-medium">{config.product.name}</dd>
          </div>
          <div className="grid grid-cols-[160px_1fr] gap-3">
            <dt style={{ color: "var(--color-text-muted)" }}>Azienda</dt>
            <dd className="font-medium">{config.company.name}</dd>
          </div>
          <div className="grid grid-cols-[160px_1fr] gap-3">
            <dt style={{ color: "var(--color-text-muted)" }}>Settore</dt>
            <dd className="font-medium">{config.company.sector}</dd>
          </div>
        </dl>
      </Card>
      <Card title="Moduli attivi">
        <div className="grid grid-cols-2 gap-2">
          {activeModules.map(([module]) => (
            <div key={module} className="rounded-md border px-3 py-2 text-sm font-medium" style={{ borderColor: "var(--color-border)" }}>
              {module}
            </div>
          ))}
        </div>
      </Card>
      <Card title="Soglie alert" className="col-span-2">
        <div className="grid grid-cols-5 gap-3 text-sm">
          {Object.entries(config.alertRules).map(([key, value]) => (
            <div key={key} className="rounded-md border p-3" style={{ borderColor: "var(--color-border)" }}>
              <div style={{ color: "var(--color-text-muted)" }}>{key}</div>
              <div className="mt-1 text-lg font-semibold">{value}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
