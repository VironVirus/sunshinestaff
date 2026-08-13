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
      pageBreakBefore: false,
    };
  }

  if (line?.type === "barChart") {
    return {
      type: "barChart",
      title: String(line.title ?? ""),
      items: (Array.isArray(line.items) ? line.items : []).slice(0, 12).map((item) => ({
        label: String(item?.label ?? "").slice(0, 28),
        value: Math.max(Number(item?.value) || 0, 0),
        displayValue: String(item?.displayValue ?? item?.value ?? "0").slice(0, 24),
      })),
      pageBreakBefore: Boolean(line.pageBreakBefore),
      spaceBefore: Math.min(Math.max(Number(line.spaceBefore) || 0, 0), 20),
      spaceAfter: Math.min(Math.max(Number(line.spaceAfter) || 0, 0), 20),
    };
  }

  if (line?.type === "table") {
    const headers = (Array.isArray(line.headers) ? line.headers : [])
      .slice(0, 8)
      .map((header) => String(header ?? ""));
    const columnCount = Math.max(headers.length, 1);
    const rows = (Array.isArray(line.rows) ? line.rows : []).map((row) =>
      Array.from({ length: columnCount }, (_, index) => String(row?.[index] ?? "")),
    );
    const requestedWidths = Array.isArray(line.widths)
      ? line.widths.slice(0, columnCount).map((value) => Math.max(Number(value) || 1, 1))
      : Array.from({ length: columnCount }, () => 1);
    const requestedTotal = requestedWidths.reduce((total, value) => total + value, 0);

    return {
      type: "table",
      title: String(line.title ?? ""),
      headers,
      rows,
      widths: requestedWidths.map((value) => (value / requestedTotal) * 516),
      fontSize: Math.min(Math.max(Number(line.fontSize) || 7, 6), 10),
      rowHeight: Math.min(Math.max(Number(line.rowHeight) || 18, 15), 28),
      chunkSize: Math.min(Math.max(Math.trunc(Number(line.chunkSize) || 18), 1), 28),
      pageBreakBefore: Boolean(line.pageBreakBefore),
      spaceBefore: Math.min(Math.max(Number(line.spaceBefore) || 0, 0), 20),
      spaceAfter: Math.min(Math.max(Number(line.spaceAfter) || 0, 0), 20),
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
    pageBreakBefore: Boolean(line?.pageBreakBefore),
  };
}

function wrapPdfLine(line) {
  const normalizedLine = normalizePdfLine(line);

  if (normalizedLine.type === "barChart") {
    return [normalizedLine];
  }

  if (normalizedLine.type === "table") {
    const chunks = [];
    const rows = normalizedLine.rows.length > 0 ? normalizedLine.rows : [[]];

    for (let index = 0; index < rows.length; index += normalizedLine.chunkSize) {
      chunks.push({
        ...normalizedLine,
        title: index === 0
          ? normalizedLine.title
          : `${normalizedLine.title} - continued`,
        rows: rows.slice(index, index + normalizedLine.chunkSize),
        pageBreakBefore: index === 0 && normalizedLine.pageBreakBefore,
        spaceBefore: index === 0 ? normalizedLine.spaceBefore : 6,
      });
    }

    return chunks;
  }

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
    pageBreakBefore: index === 0 && normalizedLine.pageBreakBefore,
  }));
}

function getPdfLineHeight(line) {
  if (line.type === "barChart") {
    return line.spaceBefore + 30 + line.items.length * 23 + line.spaceAfter;
  }

  if (line.type === "table") {
    return line.spaceBefore + (line.title ? 24 : 0) +
      line.rowHeight * (line.rows.length + 1) + line.spaceAfter;
  }

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

    if (line.pageBreakBefore && currentPage.length > 0) {
      pages.push(currentPage);
      currentPage = [];
      currentHeight = 0;
    } else if (
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

    if (normalizedLine.type === "barChart") {
      commands.push(
        `BT /F2 11 Tf 48 ${currentY} Td (${escapePdfText(normalizedLine.title)}) Tj ET`,
      );
      currentY -= 24;
      const maximum = Math.max(...normalizedLine.items.map((item) => item.value), 1);

      normalizedLine.items.forEach((item) => {
        const barWidth = Math.max((item.value / maximum) * 250, item.value > 0 ? 2 : 0);
        commands.push(
          `BT /F1 8 Tf 48 ${currentY} Td (${escapePdfText(item.label)}) Tj ET`,
          `q 0.93 0.94 0.96 rg 190 ${currentY - 2} 250 10 re f Q`,
          `q 0.54 0.41 0.14 rg 190 ${currentY - 2} ${barWidth.toFixed(2)} 10 re f Q`,
          `BT /F2 8 Tf 450 ${currentY} Td (${escapePdfText(item.displayValue)}) Tj ET`,
        );
        currentY -= 23;
      });

      currentY -= normalizedLine.spaceAfter;
      return;
    }

    if (normalizedLine.type === "table") {
      if (normalizedLine.title) {
        commands.push(
          `BT /F2 10 Tf 48 ${currentY} Td (${escapePdfText(normalizedLine.title)}) Tj ET`,
        );
        currentY -= 18;
      }

      const drawRow = (cells, isHeader = false) => {
        const rowTop = currentY + 5;
        const rowBottom = currentY - normalizedLine.rowHeight + 5;
        let currentX = 48;

        if (isHeader) {
          commands.push(
            `q 0.09 0.14 0.22 rg 48 ${rowBottom} 516 ${normalizedLine.rowHeight} re f Q`,
          );
        } else {
          commands.push(
            `q 0.85 0.87 0.9 RG 0.35 w 48 ${rowBottom} 516 ${normalizedLine.rowHeight} re S Q`,
          );
        }

        cells.forEach((cell, index) => {
          const width = normalizedLine.widths[index] ?? 0;
          const maximumCharacters = Math.max(Math.floor(width / (normalizedLine.fontSize * 0.55)), 3);
          const textValue = cell.length > maximumCharacters
            ? `${cell.slice(0, Math.max(maximumCharacters - 1, 1))}.`
            : cell;
          commands.push(
            isHeader
              ? `q 1 1 1 rg BT /F2 ${normalizedLine.fontSize} Tf ${currentX + 4} ${currentY - 7} Td (${escapePdfText(textValue)}) Tj ET Q`
              : `BT /F1 ${normalizedLine.fontSize} Tf ${currentX + 4} ${currentY - 7} Td (${escapePdfText(textValue)}) Tj ET`,
          );
          currentX += width;
          if (index < cells.length - 1) {
            commands.push(
              `q 0.75 0.79 0.84 RG 0.35 w ${currentX} ${rowBottom} m ${currentX} ${rowTop} l S Q`,
            );
          }
        });
        currentY -= normalizedLine.rowHeight;
      };

      drawRow(normalizedLine.headers, true);
      normalizedLine.rows.forEach((row) => drawRow(row));
      currentY -= normalizedLine.spaceAfter;
      return;
    }

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
