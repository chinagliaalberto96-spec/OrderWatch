import Card from "../components/Card";
import DataTable from "../components/DataTable";
import SupplierScorePill from "../components/SupplierScorePill";
import { formatPercent, humanizeColumn } from "../utils/formatters";

const riskTone = {
  alto: "danger",
  critico: "danger",
  medio: "warning",
  attenzione: "warning",
  basso: "success"
};

function RiskPill({ risk }) {
  const tone = riskTone[String(risk).toLowerCase()] || "muted";
  return (
    <span
      className="inline-flex min-w-14 items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        backgroundColor: `color-mix(in srgb, var(--color-${tone}) 13%, white)`,
        color: `var(--color-${tone})`
      }}
    >
      {risk}
    </span>
  );
}

export default function SuppliersView({ config, suppliers }) {
  const columns = (config.tableColumns.suppliers || []).map((key) => ({
    key,
    label: key === "name" ? config.terminology.supplierSingular : humanizeColumn(key, config.terminology)
  }));

  return (
    <Card title={config.terminology.suppliersPlural}>
      <DataTable
        columns={columns}
        rows={suppliers}
        renderCell={(row, key) => {
          if (key === "score") return <SupplierScorePill score={row.score} />;
          if (key === "risk") return <RiskPill risk={row.risk} />;
          if (key === "onTimeRate") return formatPercent(row.onTimeRate);
          return row[key];
        }}
      />
    </Card>
  );
}
