function escapePdfText(value = "") {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function buildPdfTextLines(title, lines = []) {
  const preparedLines = [title, "", ...lines];
  let currentY = 760;

  return preparedLines
    .slice(0, 42)
    .map((line, index) => {
      const safeLine = escapePdfText(line);

      if (index === 0) {
        const command = `BT /F1 18 Tf 48 ${currentY} Td (${safeLine}) Tj ET`;
        currentY -= 28;
        return command;
      }

      const command = `BT /F1 11 Tf 48 ${currentY} Td (${safeLine}) Tj ET`;
      currentY -= 18;
      return command;
    })
    .join("\n");
}

export function downloadTextPdf({ filename, title, lines }) {
  if (typeof window === "undefined") {
    return;
  }

  const contentStream = buildPdfTextLines(title, lines);
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj",
    `4 0 obj << /Length ${contentStream.length} >> stream\n${contentStream}\nendstream endobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((objectDefinition) => {
    offsets.push(pdf.length);
    pdf += `${objectDefinition}\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF`;

  const blob = new Blob([pdf], { type: "application/pdf" });
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = blobUrl;
  link.download = filename;
  link.click();

  window.URL.revokeObjectURL(blobUrl);
}
