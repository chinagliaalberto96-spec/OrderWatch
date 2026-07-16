import PDFDocument from "pdfkit";

// Genera il PDF dell'ordine d'acquisto verso il fornitore.
// Layout GENERICO v1: intestazione azienda a sinistra, riferimenti ordine a
// destra, tabella righe materiale, note. Quando Alberto fornira' il template
// definitivo (logo in alto a destra + riferimenti interni), questo file va
// sostituito mantenendo la stessa firma buildSupplierOrderPdf(dispatch, company)
// cosi' il resto del workflow (drawer, invio SMTP) non cambia.
export function buildSupplierOrderPdf(dispatch, company = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const companyName = company.name || "Azienda";
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // --- Intestazione ---
    doc.font("Helvetica-Bold").fontSize(14).text(companyName, { continued: false });
    if (company.address) doc.font("Helvetica").fontSize(9).fillColor("#555555").text(company.address);
    doc.fillColor("#000000");

    doc.moveUp(company.address ? 2 : 1);
    doc.font("Helvetica-Bold").fontSize(18).text("ORDINE DI ACQUISTO", doc.page.margins.left, doc.y, {
      width: pageWidth,
      align: "right"
    });
    doc.font("Helvetica").fontSize(10).text(`Rif. ${dispatch.orderCode || "-"}`, { width: pageWidth, align: "right" });
    doc.text(`Data: ${new Date().toLocaleDateString("it-IT")}`, { width: pageWidth, align: "right" });
    if (dispatch.projectCode) {
      doc.text(`Lavoro collegato: ${dispatch.projectCode}`, { width: pageWidth, align: "right" });
    }

    doc.moveDown(1.5);
    drawRule(doc, pageWidth);
    doc.moveDown(0.8);

    // --- Fornitore ---
    doc.font("Helvetica-Bold").fontSize(11).text("Spett.le fornitore");
    doc.font("Helvetica").fontSize(10);
    doc.text(dispatch.supplierName || "Fornitore da definire");
    if (dispatch.contactName) doc.text(`Alla cortese attenzione di: ${dispatch.contactName}`);
    if (dispatch.supplierEmail) doc.text(dispatch.supplierEmail);

    doc.moveDown(1.2);
    drawRule(doc, pageWidth);
    doc.moveDown(0.8);

    // --- Tabella righe materiale ---
    doc.font("Helvetica-Bold").fontSize(11).text("Materiali richiesti");
    doc.moveDown(0.4);

    const lines = Array.isArray(dispatch.lines) ? dispatch.lines : [];
    const colX = { desc: doc.page.margins.left, qty: doc.page.margins.left + pageWidth * 0.55, date: doc.page.margins.left + pageWidth * 0.75 };
    const rowStartY = doc.y;

    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Descrizione", colX.desc, rowStartY, { width: pageWidth * 0.53 });
    doc.text("Quantita'", colX.qty, rowStartY, { width: pageWidth * 0.18 });
    doc.text("Data richiesta", colX.date, rowStartY, { width: pageWidth * 0.25 });
    doc.moveDown(0.3);
    drawRule(doc, pageWidth);
    doc.moveDown(0.3);

    doc.font("Helvetica").fontSize(9.5);
    if (!lines.length) {
      doc.text("Nessuna riga materiale specificata.");
    }
    for (const line of lines) {
      const y = doc.y;
      const qty = [line.quantity, line.unit].filter(Boolean).join(" ") || "-";
      const desc = [line.description || "Materiale", line.item_code ? `(cod. ${line.item_code})` : ""].filter(Boolean).join(" ");
      doc.text(desc, colX.desc, y, { width: pageWidth * 0.53 });
      doc.text(qty, colX.qty, y, { width: pageWidth * 0.18 });
      doc.text(line.required_date || "-", colX.date, y, { width: pageWidth * 0.25 });
      doc.moveDown(0.6);
    }

    doc.moveDown(1);
    drawRule(doc, pageWidth);
    doc.moveDown(0.8);

    doc.font("Helvetica").fontSize(9.5).fillColor("#333333").text(
      "Vi chiediamo cortese conferma di disponibilita' e data di consegna prevista via email a questo indirizzo.",
      { width: pageWidth }
    );
    doc.fillColor("#000000");

    doc.moveDown(2);
    doc.fontSize(8).fillColor("#888888").text(
      `Documento generato automaticamente da OrderWatch il ${new Date().toLocaleString("it-IT")}.`,
      { width: pageWidth }
    );

    doc.end();
  });
}

function drawRule(doc, width) {
  const y = doc.y;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.margins.left + width, y).strokeColor("#cccccc").lineWidth(0.5).stroke();
  doc.strokeColor("#000000");
}
