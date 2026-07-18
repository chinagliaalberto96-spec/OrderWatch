export function isCustomerRequirement(line) {
  return line?.entityKind === "project_requirement" || line?.sourceType === "customer_request";
}

export function isProcurementRequirement(line) {
  return line?.entityKind === "procurement_requirement" || line?.sourceType === "procurement_requirement";
}

export function isPurchaseOrderLine(line) {
  return line?.entityKind === "purchase_order_line" || line?.sourceType === "supplier_order";
}

export function canPrepareSupplierOrderFromLine(line) {
  if (!isProcurementRequirement(line)) return false;
  if (line?.needsReview) return false;
  if (!/^(Da ordinare|approved)$/i.test(String(line?.status || ""))) return false;
  return Boolean(line?.description && Number(line?.quantity) > 0 && line?.unit);
}

export function splitProjectOperationalLines(lines = []) {
  return {
    customerRequirements: lines.filter(isCustomerRequirement),
    procurementRequirements: lines.filter(isProcurementRequirement),
    purchaseOrderLines: lines.filter(isPurchaseOrderLine),
    otherLines: lines.filter((line) =>
      !isCustomerRequirement(line) && !isProcurementRequirement(line) && !isPurchaseOrderLine(line)
    )
  };
}
