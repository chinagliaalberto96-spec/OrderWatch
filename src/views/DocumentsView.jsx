import Card from "../components/Card";
import DataTable from "../components/DataTable";
import { formatDate } from "../utils/dateUtils";
import { formatPercent, humanizeColumn } from "../utils/formatters";

export default function DocumentsView({ config, documents }) {
  const columns = (config.tableColumns.documents || []).map((key) => ({
    key,
    label: key === "name" ? "File" : humanizeColumn(key, config.terminology)
  }));

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
