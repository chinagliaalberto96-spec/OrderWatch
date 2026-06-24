import Card from "../components/Card";
import DataTable from "../components/DataTable";
import SupplierScorePill from "../components/SupplierScorePill";
import { formatPercent } from "../utils/formatters";

export default function SuppliersView({ config, suppliers }) {
  const columns = [
    { key: "name", label: config.terminology.supplierSingular },
    { key: "email", label: "Email" },
    { key: "onTimeRate", label: "Puntualita" },
    { key: "openOrders", label: config.terminology.ordersPlural },
    { key: "risk", label: "Rischio" },
    { key: "score", label: "Score" }
  ];

  return (
    <Card title={config.terminology.suppliersPlural}>
      <DataTable
        columns={columns}
        rows={suppliers}
        renderCell={(row, key) => {
          if (key === "score") return <SupplierScorePill score={row.score} />;
          if (key === "onTimeRate") return formatPercent(row.onTimeRate);
          return row[key];
        }}
      />
    </Card>
  );
}
