import Card from "../components/Card";

export default function SettingsView({ config }) {
  const activeModules = Object.entries(config.modules).filter(([, active]) => active);

  return (
    <div className="grid grid-cols-2 gap-4">
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
