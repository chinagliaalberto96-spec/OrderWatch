import { AlertTriangle, Boxes, Inbox, Send, TrendingUp } from "lucide-react";
import ActivityFeed from "../components/ActivityFeed";
import Card from "../components/Card";
import ChartCard from "../components/ChartCard";
import KpiCard from "../components/KpiCard";
import StatusBadge from "../components/StatusBadge";
import { formatPercent } from "../utils/formatters";
import { getOrderStatus } from "../utils/statusRules";

// KPI richiesti da Graphic Center Group (sezione 4.7 onboarding):
// Lavori aperti, Azioni richieste, Solleciti inviati, Tasso risposta fornitori.
export default function DashboardView({ config, data }) {
  const ordersWithStatus = data.orders.map((order) => ({
    ...order,
    status: getOrderStatus(order, config.alertRules)
  }));

  const openProjects = data.projects.filter((project) => project.status !== "Concluso").length;

  const actionsNeeded = ordersWithStatus.filter((order) =>
    ["OVERDUE", "CRITICAL", "TO_VERIFY"].includes(order.status)
  ).length;

  const remindersSent = ordersWithStatus.reduce((sum, order) => sum + (order.reminderCount || 0), 0);
  const processedEmails = [...(data.processedEmails || [])].sort((a, b) => {
    const aDate = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
    const bDate = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
    return bDate - aDate;
  });
  const importErrors = processedEmails.filter((email) => email.status === "Error").length;
  const importsInProgress = processedEmails.filter((email) => email.status?.trim() === "Processing").length;

  const solicitedOrders = ordersWithStatus.filter((order) => order.reminderCount > 0);
  const respondedOrders = solicitedOrders.filter(
    (order) => order.supplierResponse && !/nessuna risposta/i.test(order.supplierResponse)
  );
  const responseRate = solicitedOrders.length ? respondedOrders.length / solicitedOrders.length : null;

  const statusMeta = {
    OVERDUE: { name: "Scaduti", tone: "danger" },
    CRITICAL: { name: "Critici", tone: "critical" },
    WARNING: { name: "Attenzione", tone: "warning" },
    OK: { name: "OK", tone: "success" },
    TO_VERIFY: { name: "Da verificare", tone: "muted" }
  };

  const chartData = ["OVERDUE", "CRITICAL", "WARNING", "OK", "TO_VERIFY"].map((status) => ({
    name: statusMeta[status].name,
    tone: statusMeta[status].tone,
    value: ordersWithStatus.filter((order) => order.status === status).length
  }));

  const mostUrgent = ordersWithStatus.find((order) => ["OVERDUE", "CRITICAL", "TO_VERIFY"].includes(order.status));

  return (
    <div className="mx-auto max-w-[1540px] space-y-5">
      <section className="rounded-lg border bg-white px-5 py-4 shadow-soft" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              Quadro operativo giornaliero
            </div>
            <div className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
              Monitoraggio ordini materiali, lavori aperti e azioni richieste.
            </div>
          </div>
          <div className="rounded-md border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--color-border)", color: actionsNeeded ? "var(--color-danger)" : "var(--color-success)", backgroundColor: "var(--color-muted)" }}>
            {actionsNeeded ? `${actionsNeeded} azioni richieste` : "Nessuna azione critica"}
          </div>
        </div>
      </section>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          label={`${config.terminology.projectsPlural} aperti`}
          value={openProjects}
          hint="Lavori non ancora conclusi"
          icon={Boxes}
        />
        <KpiCard
          label="Azioni richieste"
          value={actionsNeeded}
          tone={actionsNeeded ? "danger" : "success"}
          hint="Scaduti, critici o da verificare"
          icon={AlertTriangle}
        />
        <KpiCard
          label="Solleciti inviati"
          value={remindersSent}
          tone="warning"
          hint="Totale solleciti su ordini aperti"
          icon={Send}
        />
        <KpiCard
          label="Tasso risposta fornitori"
          value={responseRate === null ? "-" : formatPercent(responseRate)}
          tone={responseRate !== null && responseRate < 0.5 ? "danger" : "primary"}
          hint="Risposte ricevute su solleciti inviati"
          icon={TrendingUp}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <ChartCard
          title={`${config.terminology.ordersPlural} per stato`}
          data={chartData}
          insight={mostUrgent ? `Priorita: ${mostUrgent.orderCode} - ${mostUrgent.material}` : "Nessuna priorita critica al momento."}
        />
        <Card title="Activity log">
          {/* Altezza limitata + scroll interno: tenuta in pari col chart a
              fianco, cosi' le card sotto (Importazioni, Ordini in evidenza)
              restano visibili senza dover scrollare la pagina. */}
          <div className="max-h-[252px] overflow-y-auto pr-1">
            <ActivityFeed activities={data.activities.slice(0, 6)} />
          </div>
        </Card>
      </div>
      <Card title="Importazioni recenti">
        <div className="grid gap-3 lg:grid-cols-[220px_220px_1fr]">
          <div className="rounded-md border p-3" style={{ borderColor: "var(--color-border)" }}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Inbox className="h-4 w-4" />
              Email lette
            </div>
            <div className="mt-2 text-2xl font-semibold">{processedEmails.length}</div>
          </div>
          <div className="rounded-md border p-3" style={{ borderColor: "var(--color-border)" }}>
            <div className="text-sm font-semibold">Stato importazione</div>
            <div className="mt-2 text-sm" style={{ color: importErrors ? "var(--color-danger)" : "var(--color-success)" }}>
              {importErrors ? `${importErrors} errori da controllare` : "Nessun errore"}
            </div>
            <div className="mt-1 text-sm" style={{ color: importsInProgress ? "var(--color-warning)" : "var(--color-text-muted)" }}>
              {importsInProgress ? `${importsInProgress} in lavorazione` : "Nessun blocco in Processing"}
            </div>
          </div>
          <div className="min-w-0 rounded-md border p-3" style={{ borderColor: "var(--color-border)" }}>
            <div className="mb-2 text-sm font-semibold">Ultime email processate</div>
            <div className="space-y-2">
              {processedEmails.slice(0, 3).map((email) => (
                <div key={email.id} className="flex min-w-0 items-center justify-between gap-3 text-sm">
                  <div className="min-w-0 truncate">{email.subject || email.messageId || "Email senza oggetto"}</div>
                  <div className="shrink-0 font-semibold" style={{ color: email.status === "Error" ? "var(--color-danger)" : "var(--color-text-muted)" }}>
                    {email.classification || email.status || "-"}
                  </div>
                </div>
              ))}
              {!processedEmails.length && (
                <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                  Nessuna email importata.
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>
      <Card title={`${config.terminology.ordersPlural} in evidenza`}>
        <div className="space-y-3">
          {ordersWithStatus.slice(0, 4).map((order) => (
            <div key={order.id} className="grid grid-cols-[130px_1fr_160px_110px] items-center gap-3 border-b pb-3 last:border-b-0 last:pb-0" style={{ borderColor: "var(--color-border)" }}>
              <div className="text-sm font-semibold">{order.orderCode}</div>
              <div className="text-sm">{order.material}</div>
              <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                {order.supplierName}
              </div>
              <StatusBadge status={order.status} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
