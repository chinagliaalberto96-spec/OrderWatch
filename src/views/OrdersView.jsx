import { useMemo, useState } from "react";
import Card from "../components/Card";
import DataTable from "../components/DataTable";
import OrderDetailPanel from "../components/OrderDetailPanel";
import StatusBadge from "../components/StatusBadge";
import { formatDate } from "../utils/dateUtils";
import { formatNumber, humanizeColumn } from "../utils/formatters";
import { getOrderStatus } from "../utils/statusRules";

export default function OrdersView({ config, orders }) {
  const [selectedOrder, setSelectedOrder] = useState(orders[0]);

  const rows = useMemo(
    () =>
      orders.map((order) => ({
        ...order,
        status: getOrderStatus(order, config.alertRules)
      })),
    [orders, config.alertRules]
  );

  const columns = config.tableColumns.orders.map((key) => ({
    key,
    label: humanizeColumn(key, config.terminology)
  }));

  function renderCell(row, key) {
    if (key === "status") return <StatusBadge status={row.status} />;
    if (key === "orderDate" || key === "dueDate") return formatDate(row[key]);
    if (key === "quantity") return formatNumber(row[key]);
    if (key === "daysRemaining") {
      return (
        <span className={row.daysRemaining < 0 ? "font-semibold" : ""} style={{ color: row.daysRemaining < 0 ? "var(--color-danger)" : "inherit" }}>
          {row.daysRemaining}
        </span>
      );
    }
    return row[key] || "-";
  }

  return (
    <div className="flex min-h-[calc(100vh-104px)] gap-0">
      <main className="min-w-0 flex-1 pr-4">
        <Card title={config.terminology.ordersPlural}>
          <DataTable columns={columns} rows={rows} renderCell={renderCell} onRowClick={setSelectedOrder} />
        </Card>
      </main>
      <OrderDetailPanel
        order={selectedOrder}
        status={selectedOrder ? getOrderStatus(selectedOrder, config.alertRules) : null}
        terminology={config.terminology}
        onClose={() => setSelectedOrder(null)}
      />
    </div>
  );
}
