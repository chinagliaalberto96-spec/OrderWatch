import Card from "../components/Card";
import DataTable from "../components/DataTable";
import StatusBadge from "../components/StatusBadge";
import { formatDate } from "../utils/dateUtils";
import { humanizeColumn } from "../utils/formatters";

export default function ProjectsView({ config, projects }) {
  const columns = (config.tableColumns.projects || []).map((key) => ({
    key,
    label: key === "projectCode" ? config.terminology.projectSingular : humanizeColumn(key, config.terminology)
  }));

  return (
    <Card title={config.terminology.projectsPlural}>
      <DataTable
        columns={columns}
        rows={projects}
        renderCell={(row, key) => {
          if (key === "status") return <StatusBadge status={row.status} />;
          if (key === "dueDate") return formatDate(row[key]);
          return row[key];
        }}
      />
    </Card>
  );
}
