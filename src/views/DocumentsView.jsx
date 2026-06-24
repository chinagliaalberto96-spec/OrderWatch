import Card from "../components/Card";
import DataTable from "../components/DataTable";
import { formatDate } from "../utils/dateUtils";
import { formatPercent } from "../utils/formatters";

export default function DocumentsView({ config, documents }) {
  const columns = [
    { key: "name", label: "File" },
    { key: "type", label: "Tipo" },
    { key: "supplierName", label: config.terminology.supplierSingular },
    { key: "linkedOrder", label: config.terminology.orderSingular },
    { key: "confidence", label: "AI confidence" },
    { key: "receivedAt", label: "Ricevuto il" }
  ];

  return (
    <Card title={config.terminology.documentsPlural}>
      <DataTable
        columns={columns}
        rows={documents}
        renderCell={(row, key) => {
          if (key === "confidence") return formatPercent(row.confidence);
          if (key === "receivedAt") return formatDate(row.receivedAt);
          return row[key];
        }}
      />
    </Card>
  );
}
