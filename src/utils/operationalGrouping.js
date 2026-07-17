const PRIORITY_WEIGHT = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1
};

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function counterpartyForItem(item) {
  if (item.supplierName) {
    return {
      // In anagrafica possono ancora esistere record duplicati con ID diversi.
      // Nella coda operativa lo stesso nome deve comunque apparire una volta.
      key: `supplier:${normalizeKey(item.supplierName)}`,
      label: item.supplierName,
      type: "supplier"
    };
  }

  if (item.customerName) {
    return {
      key: `customer:${normalizeKey(item.customerName)}`,
      label: item.customerName,
      type: "customer"
    };
  }

  if (item.projectCode) {
    return {
      key: `project:${normalizeKey(item.projectCode)}`,
      label: `Lavoro ${item.projectCode}`,
      type: "project"
    };
  }

  // Gli elementi senza una controparte certa restano separati: unirli sotto
  // un'unica azienda fittizia renderebbe la coda fuorviante.
  return {
    key: `unassigned:${item.id}`,
    label: "Controparte da identificare",
    type: "unassigned"
  };
}

function compareItems(a, b) {
  const priorityDelta = (PRIORITY_WEIGHT[b.priority] || 0) - (PRIORITY_WEIGHT[a.priority] || 0);
  if (priorityDelta) return priorityDelta;

  const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
  const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
  if (aDate !== bDate) return aDate - bDate;

  return String(a.title || "").localeCompare(String(b.title || ""), "it");
}

export function groupOperationalItemsByCounterparty(items = []) {
  const groups = new Map();

  for (const item of items) {
    const counterparty = counterpartyForItem(item);
    const current = groups.get(counterparty.key) || {
      id: `counterparty-${counterparty.key}`,
      ...counterparty,
      priority: item.priority || "low",
      items: []
    };

    current.items.push(item);
    if ((PRIORITY_WEIGHT[item.priority] || 0) > (PRIORITY_WEIGHT[current.priority] || 0)) {
      current.priority = item.priority;
    }
    groups.set(counterparty.key, current);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort(compareItems),
      urgentCount: group.items.filter((item) => item.priority === "urgent").length,
      reviewCount: group.items.filter((item) => ["needs_review", "needs_link"].includes(item.status)).length
    }))
    .sort((a, b) => {
      const priorityDelta = (PRIORITY_WEIGHT[b.priority] || 0) - (PRIORITY_WEIGHT[a.priority] || 0);
      return priorityDelta || a.label.localeCompare(b.label, "it");
    });
}
