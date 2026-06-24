import Card from "../components/Card";
import DataTable from "../components/DataTable";
import { formatDate } from "../utils/dateUtils";

export default function ProjectsView({ config, projects }) {
  const columns = [
    { key: "projectCode", label: config.terminology.projectSingular },
    { key: "customer", label: config.terminology.customer },
    { key: "owner", label: config.terminology.owner },
    { key: "status", label: "Stato" },
    { key: "dueDate", label: "Scadenza" },
    { key: "openOrders", label: config.terminology.ordersPlural }
  ];

  return (
    <Card title={config.terminology.projectsPlural}>
      <DataTable
        columns={columns}
        rows={projects}
        renderCell={(row, key) => (key === "dueDate" ? formatDate(row[key]) : row[key])}
      />
    </Card>
  );
}
