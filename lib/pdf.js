function escapePdfText(value = "") {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

const BODY_LINES_PER_PAGE = 38;

function buildPdfPageContent(title, bodyLines = []) {
  let currentY = 760;
  const commands = [
    `BT /F1 18 Tf 48 ${currentY} Td (${escapePdfText(title)}) Tj ET`,
  ];

  currentY -= 28;

  bodyLines.forEach((line) => {
    commands.push(
      `BT /F1 11 Tf 48 ${currentY} Td (${escapePdfText(line)}) Tj ET`,
    );
    currentY -= 18;
  });

  return commands.join("\n");
}

function buildPdfPages(title, lines = []) {
  const preparedLines = ["", ...lines];
  const pages = [];

  for (let index = 0; index < preparedLines.length; index += BODY_LINES_PER_PAGE) {
    pages.push(
      buildPdfPageContent(
        pages.length === 0 ? title : `${title} (continued)`,
        preparedLines.slice(index, index + BODY_LINES_PER_PAGE),
      ),
    );
  }

  return pages.length > 0 ? pages : [buildPdfPageContent(title, [""])];
}

export function downloadTextPdf({ filename, title, lines }) {
  if (typeof window === "undefined") {
    return;
  }

  const pageContents = buildPdfPages(title, lines);
  const pageObjectStart = 3;
  const contentObjectStart = pageObjectStart + pageContents.length;
  const fontObjectNumber = contentObjectStart + pageContents.length;
  const pageObjectIds = pageContents.map((_, index) => pageObjectStart + index);
  const contentObjectIds = pageContents.map((_, index) => contentObjectStart + index);
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    `2 0 obj << /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >> endobj`,
    ...pageContents.map(
      (_, index) =>
        `${pageObjectIds[index]} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >> endobj`,
    ),
    ...pageContents.map(
      (contentStream, index) =>
        `${contentObjectIds[index]} 0 obj << /Length ${contentStream.length} >> stream\n${contentStream}\nendstream endobj`,
    ),
    `${fontObjectNumber} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`,
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
