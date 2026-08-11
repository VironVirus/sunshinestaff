function escapePdfText(value = "") {
  return String(value)
    .replaceAll("°", " degrees ")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function normalizePdfLine(line) {
  if (typeof line === "string") {
    return {
      text: line,
      bold: false,
      fontSize: 11,
      dividerBefore: false,
      dividerAfter: false,
      spaceBefore: 0,
      spaceAfter: 0,
      keepWithNext: false,
    };
  }

  return {
    text: line?.text ?? "",
    bold: Boolean(line?.bold),
    fontSize: Math.min(Math.max(Number(line?.fontSize) || 11, 8), 18),
    dividerBefore: Boolean(line?.dividerBefore),
    dividerAfter: Boolean(line?.dividerAfter),
    spaceBefore: Math.min(Math.max(Number(line?.spaceBefore) || 0, 0), 20),
    spaceAfter: Math.min(Math.max(Number(line?.spaceAfter) || 0, 0), 20),
    keepWithNext: Boolean(line?.keepWithNext),
  };
}

function wrapPdfLine(line) {
  const normalizedLine = normalizePdfLine(line);
  const maximumCharacters = Math.max(
    Math.floor(92 * (11 / normalizedLine.fontSize)),
    34,
  );
  const words = normalizedLine.text.split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return [normalizedLine];
  }

  const wrappedText = [];
  let currentLine = "";

  words.forEach((word) => {
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (candidate.length <= maximumCharacters || !currentLine) {
      currentLine = candidate;
      return;
    }

    wrappedText.push(currentLine);
    currentLine = word;
  });

  if (currentLine) wrappedText.push(currentLine);

  return wrappedText.map((text, index) => ({
    ...normalizedLine,
    text,
    dividerBefore: index === 0 && normalizedLine.dividerBefore,
    dividerAfter: index === wrappedText.length - 1 && normalizedLine.dividerAfter,
    spaceBefore: index === 0 ? normalizedLine.spaceBefore : 0,
    spaceAfter: index === wrappedText.length - 1 ? normalizedLine.spaceAfter : 0,
    keepWithNext: index === wrappedText.length - 1 && normalizedLine.keepWithNext,
  }));
}

function getPdfLineHeight(line) {
  return line.spaceBefore +
    (line.dividerBefore ? 14 : 0) +
    line.fontSize + 7 +
    (line.dividerAfter ? 8 : 0) +
    line.spaceAfter;
}

const MAX_PAGE_BODY_HEIGHT = 665;

function paginatePdfLines(lines = []) {
  const wrappedLines = lines.flatMap(wrapPdfLine);
  const pages = [];
  let currentPage = [];
  let currentHeight = 0;

  wrappedLines.forEach((line, index) => {
    const lineHeight = getPdfLineHeight(line);
    const nextLineHeight = line.keepWithNext && wrappedLines[index + 1]
      ? getPdfLineHeight(wrappedLines[index + 1])
      : 0;

    if (
      currentPage.length > 0 &&
      currentHeight + lineHeight + nextLineHeight > MAX_PAGE_BODY_HEIGHT
    ) {
      pages.push(currentPage);
      currentPage = [];
      currentHeight = 0;
    }

    currentPage.push(line);
    currentHeight += lineHeight;
  });

  if (currentPage.length > 0) pages.push(currentPage);
  return pages.length > 0 ? pages : [[normalizePdfLine("")]];
}

function buildPdfPageContent(title, bodyLines = []) {
  let currentY = 760;
  const commands = [
    `BT /F1 18 Tf 48 ${currentY} Td (${escapePdfText(title)}) Tj ET`,
    `q 1.2 w 0.54 0.41 0.14 RG 48 747 m 564 747 l S Q`,
  ];

  currentY -= 34;

  bodyLines.forEach((line) => {
    const normalizedLine = normalizePdfLine(line);

    currentY -= normalizedLine.spaceBefore;

    if (normalizedLine.dividerBefore) {
      commands.push(
        `q 0.6 w 0.75 0.79 0.84 RG 48 ${currentY} m 564 ${currentY} l S Q`,
      );
      currentY -= 14;
    }

    commands.push(
      `BT /${normalizedLine.bold ? "F2" : "F1"} ${normalizedLine.fontSize} Tf 48 ${currentY} Td (${escapePdfText(normalizedLine.text)}) Tj ET`,
    );
    currentY -= normalizedLine.fontSize + 7;

    if (normalizedLine.dividerAfter) {
      commands.push(
        `q 0.6 w 0.75 0.79 0.84 RG 48 ${currentY + 3} m 564 ${currentY + 3} l S Q`,
      );
      currentY -= 8;
    }

    currentY -= normalizedLine.spaceAfter;
  });

  return commands.join("\n");
}

function buildPdfPages(title, lines = []) {
  return paginatePdfLines(lines).map((pageLines, index) =>
    buildPdfPageContent(
      index === 0 ? title : "Night Duty Report - continued",
      pageLines,
    ));
}

export function createTextPdf({ title, lines }) {
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
        `${pageObjectIds[index]} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectNumber} 0 R /F2 ${fontObjectNumber + 1} 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >> endobj`,
    ),
    ...pageContents.map(
      (contentStream, index) =>
        `${contentObjectIds[index]} 0 obj << /Length ${contentStream.length} >> stream\n${contentStream}\nendstream endobj`,
    ),
    `${fontObjectNumber} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`,
    `${fontObjectNumber + 1} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj`,
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

  return pdf;
}

export function downloadTextPdf({ filename, title, lines }) {
  if (typeof window === "undefined") {
    return;
  }

  const pdf = createTextPdf({ title, lines });
  const blob = new Blob([pdf], { type: "application/pdf" });
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = blobUrl;
  link.download = filename;
  link.click();

  window.URL.revokeObjectURL(blobUrl);
}
