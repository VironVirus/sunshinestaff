import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";

const COLORS = {
  navy: "162338",
  navyLight: "DDE7F2",
  gold: "A67C2E",
  goldLight: "F8F1DF",
  slate: "475569",
  border: "B8C5D3",
  zebra: "F4F7FA",
  tableHeader: "F2F4F7",
  white: "FFFFFF",
};
const PAGE_WIDTH_DXA = 9360;
const CHART_COLORS = [
  "A67C2E",
  "162338",
  "0F766E",
  "B45309",
  "7C3AED",
  "0369A1",
  "BE185D",
  "4D7C0F",
];
const TRANSPARENT_PNG = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12,
  2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 100, 248, 15,
  0, 1, 5, 1, 1, 39, 24, 227, 102, 0, 0, 0, 0, 73, 69, 78,
  68, 174, 66, 96, 130,
]);

function asText(value) {
  return String(value ?? "");
}

function cell(text, options = {}) {
  return new TableCell({
    width: options.width
      ? { size: options.width, type: WidthType.DXA }
      : undefined,
    verticalAlign: VerticalAlign.CENTER,
    shading: options.fill
      ? { type: ShadingType.CLEAR, fill: options.fill, color: "auto" }
      : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 5, color: COLORS.border },
      bottom: { style: BorderStyle.SINGLE, size: 5, color: COLORS.border },
      left: { style: BorderStyle.SINGLE, size: 5, color: COLORS.border },
      right: { style: BorderStyle.SINGLE, size: 5, color: COLORS.border },
    },
    children: [new Paragraph({
      alignment: options.align ?? AlignmentType.LEFT,
      spacing: { before: 0, after: 0, line: 220 },
      children: [new TextRun({
        text: asText(text),
        bold: Boolean(options.bold),
        color: options.color ?? COLORS.navy,
        font: "Calibri",
        size: options.size ?? 22,
      })],
    })],
  });
}

function buildTable(line) {
  const headers = Array.isArray(line.headers) ? line.headers : [];
  const rows = Array.isArray(line.rows) ? line.rows : [];
  const requestedWidths = Array.isArray(line.widths) && line.widths.length === headers.length
    ? line.widths.map((width) => Math.max(Number(width) || 1, 1))
    : headers.map(() => 1);
  const widthTotal = requestedWidths.reduce((total, width) => total + width, 0) || 1;
  const widths = requestedWidths.map((width) => Math.round((width / widthTotal) * PAGE_WIDTH_DXA));
  const widthDifference = PAGE_WIDTH_DXA - widths.reduce((total, width) => total + width, 0);
  widths[widths.length - 1] += widthDifference;

  return [
    ...(line.title ? [new Paragraph({
      spacing: { before: 100, after: 40 },
      children: [new TextRun({
        text: asText(line.title),
        bold: true,
        color: COLORS.navy,
        font: "Calibri",
        size: 24,
      })],
    })] : []),
    new Table({
      width: { size: PAGE_WIDTH_DXA, type: WidthType.DXA },
      indent: { size: 120, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      columnWidths: widths,
      rows: [
        new TableRow({
          tableHeader: true,
          children: headers.map((header, index) => cell(header, {
            width: widths[index],
            fill: COLORS.tableHeader,
            color: COLORS.navy,
            bold: true,
            align: index === 0 ? AlignmentType.LEFT : AlignmentType.CENTER,
          })),
        }),
        ...rows.map((row, rowIndex) => new TableRow({
          children: headers.map((_, columnIndex) => cell(row?.[columnIndex] ?? "", {
            width: widths[columnIndex],
            fill: rowIndex % 2 === 1 ? COLORS.zebra : COLORS.white,
            bold: Boolean(line.boldLastRow && rowIndex === rows.length - 1),
            align: columnIndex === 0 ? AlignmentType.LEFT : AlignmentType.CENTER,
          })),
        })),
      ],
    }),
    new Paragraph({ spacing: { after: 60 } }),
  ];
}

function buildBarChart(line) {
  const items = Array.isArray(line.items) ? line.items : [];
  const maximum = Math.max(...items.map((item) => Number(item.value) || 0), 1);
  const total = items.reduce((sum, item) => sum + Math.max(Number(item.value) || 0, 0), 0);
  const rows = items.map((item) => {
    const value = Math.max(Number(item.value) || 0, 0);
    const percentage = item.percentage ?? (total > 0 ? (value / total) * 100 : 0);
    const blocks = Math.min(Math.max(Math.round((value / maximum) * 18), value > 0 ? 1 : 0), 18);

    return [
      item.label,
      `${"#".repeat(blocks)}${"-".repeat(18 - blocks)}`,
      `${Number(percentage).toFixed(1)}%`,
      item.displayValue ?? asText(value),
    ];
  });

  return buildTable({
    title: line.title,
    headers: ["Category", "Relative scale", "Share / rate", "Value"],
    widths: [2.1, 2.5, 1, 1.3],
    rows,
  });
}

function escapeXml(value) {
  return asText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function compactChartValue(value) {
  const number = Number(value) || 0;
  if (Math.abs(number) >= 1000000) return `${(number / 1000000).toFixed(1)}m`;
  if (Math.abs(number) >= 1000) return `${(number / 1000).toFixed(0)}k`;
  return Math.round(number).toLocaleString("en-US");
}

function formatChartAxisLabel(value) {
  const label = asText(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(label) ? label.slice(5) : label;
}

function buildLineChartSvg(line) {
  const series = Array.isArray(line.series) ? line.series : [];
  const labels = Array.isArray(line.labels) ? line.labels : [];
  const width = 720;
  const height = 255;
  const left = 68;
  const right = 18;
  const top = 18;
  const bottom = 58;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = series.flatMap((entry) =>
    (entry.values ?? []).map((value) => Number(value) || 0)
  );
  const maximum = Math.max(...values, 1);
  const pointX = (index) => left + (
    labels.length <= 1
      ? plotWidth / 2
      : (index / (labels.length - 1)) * plotWidth
  );
  const pointY = (value) => top + plotHeight - ((Number(value) || 0) / maximum) * plotHeight;
  const labelStep = Math.max(Math.ceil(labels.length / 7), 1);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = top + plotHeight - ratio * plotHeight;
    return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#D5DEE8" stroke-width="0.75" stroke-dasharray="3 5"/><text x="${left - 7}" y="${y + 3}" text-anchor="end" font-family="Calibri,Arial" font-size="10" fill="#64748B">${escapeXml(compactChartValue(maximum * ratio))}</text>`;
  }).join("");
  const paths = series.map((entry, seriesIndex) => {
    const color = asText(entry.color || CHART_COLORS[seriesIndex % CHART_COLORS.length]).replace("#", "");
    const points = (entry.values ?? []).map(
      (value, index) => `${pointX(index)},${pointY(value)}`,
    ).join(" ");
    const markers = (entry.values ?? []).map(
      (value, index) => `<circle cx="${pointX(index)}" cy="${pointY(value)}" r="1.9" fill="#FFFFFF" stroke="#${color}" stroke-width="1.15"/>`,
    ).join("");
    return `<polyline points="${points}" fill="none" stroke="#${color}" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>${markers}`;
  }).join("");
  const axisLabels = labels.map((label, index) => (
    index % labelStep === 0 || index === labels.length - 1
      ? `<text x="${pointX(index)}" y="${height - 31}" text-anchor="middle" font-family="Calibri,Arial" font-size="10" fill="#64748B">${escapeXml(formatChartAxisLabel(label))}</text>`
      : ""
  )).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#FBFCFE"/><rect x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}" fill="#FFFFFF" stroke="#D5DEE8" stroke-width="0.7"/>${grid}${paths}${axisLabels}<text x="${width / 2}" y="${height - 5}" text-anchor="middle" font-family="Calibri,Arial" font-size="11" font-weight="700" fill="#475569">${escapeXml(line.xAxisLabel || "Activity date")}</text><text x="15" y="${height / 2}" text-anchor="middle" font-family="Calibri,Arial" font-size="11" font-weight="700" fill="#475569" transform="rotate(-90 15 ${height / 2})">${escapeXml(line.yAxisLabel || "Value")}</text></svg>`;
}

function buildLineChart(line) {
  const series = Array.isArray(line.series) ? line.series : [];
  const labels = Array.isArray(line.labels) ? line.labels : [];
  if (series.length === 0 || labels.length === 0) return [];
  const svg = buildLineChartSvg(line);
  const legendRuns = series.flatMap((entry, index) => {
    const color = asText(entry.color || CHART_COLORS[index % CHART_COLORS.length]).replace("#", "");
    return [
      new TextRun({ text: index === 0 ? "" : "    ", font: "Calibri", size: 18 }),
      new TextRun({ text: "━ ", bold: true, color, font: "Calibri", size: 18 }),
      new TextRun({ text: asText(entry.label), color: COLORS.slate, font: "Calibri", size: 18 }),
    ];
  });

  return [
    new Paragraph({
      spacing: { before: 100, after: 30 },
      keepNext: true,
      children: [new TextRun({
        text: asText(line.title),
        bold: true,
        color: COLORS.navy,
        font: "Calibri",
        size: 24,
      })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 25 },
      children: [new ImageRun({
        type: "svg",
        data: new TextEncoder().encode(svg),
        transformation: { width: 624, height: 221 },
        fallback: { type: "png", data: TRANSPARENT_PNG },
      })],
    }),
    new Paragraph({
      spacing: { before: 0, after: 70, line: 200 },
      children: legendRuns,
    }),
  ];
}

function buildStackedBarChartSvg(line) {
  const labels = Array.isArray(line.labels) ? line.labels : [];
  const series = Array.isArray(line.series) ? line.series : [];
  const width = 720;
  const height = 270;
  const left = 70;
  const right = 18;
  const top = 18;
  const bottom = 62;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maximum = Math.max(...labels.map((_, labelIndex) => series.reduce(
    (total, entry) => total + Math.max(Number(entry.values?.[labelIndex]) || 0, 0),
    0,
  )), 1);
  const groupWidth = plotWidth / Math.max(labels.length, 1);
  const barWidth = Math.max(Math.min(groupWidth * 0.62, 30), 5);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = top + plotHeight - ratio * plotHeight;
    return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#D5DEE8" stroke-width="0.75" stroke-dasharray="3 5"/><text x="${left - 7}" y="${y + 3}" text-anchor="end" font-family="Calibri,Arial" font-size="10" fill="#64748B">${escapeXml(compactChartValue(maximum * ratio))}</text>`;
  }).join("");
  const bars = labels.map((_, labelIndex) => {
    const x = left + labelIndex * groupWidth + (groupWidth - barWidth) / 2;
    let cumulative = 0;
    const dayTotal = series.reduce(
      (total, entry) => total + Math.max(Number(entry.values?.[labelIndex]) || 0, 0),
      0,
    );
    return series.map((entry, seriesIndex) => {
      const value = Math.max(Number(entry.values?.[labelIndex]) || 0, 0);
      const barHeight = (value / maximum) * plotHeight;
      const y = top + plotHeight - ((cumulative + value) / maximum) * plotHeight;
      const percentage = dayTotal > 0 ? (value / dayTotal) * 100 : 0;
      cumulative += value;
      const color = asText(
        entry.color || CHART_COLORS[seriesIndex % CHART_COLORS.length],
      ).replace("#", "");
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="1" fill="#${color}"/>${percentage >= 6 && barHeight >= 14 && barWidth >= 9 ? `<text x="${x + barWidth / 2}" y="${y + barHeight / 2 + 3}" text-anchor="middle" font-family="Calibri,Arial" font-size="8" font-weight="700" fill="#FFFFFF">${Math.round(percentage)}%</text>` : ""}`;
    }).join("");
  }).join("");
  const labelStep = Math.max(Math.ceil(labels.length / 8), 1);
  const axisLabels = labels.map((label, index) => (
    index % labelStep === 0 || index === labels.length - 1
      ? `<text x="${left + index * groupWidth + groupWidth / 2}" y="${height - 34}" text-anchor="middle" font-family="Calibri,Arial" font-size="10" fill="#64748B">${escapeXml(formatChartAxisLabel(label))}</text>`
      : ""
  )).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#FBFCFE"/><rect x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}" fill="#FFFFFF" stroke="#D5DEE8" stroke-width="0.7"/>${grid}${bars}${axisLabels}<text x="${width / 2}" y="${height - 6}" text-anchor="middle" font-family="Calibri,Arial" font-size="11" font-weight="700" fill="#475569">${escapeXml(line.xAxisLabel || "Activity date")}</text><text x="15" y="${height / 2}" text-anchor="middle" font-family="Calibri,Arial" font-size="11" font-weight="700" fill="#475569" transform="rotate(-90 15 ${height / 2})">${escapeXml(line.yAxisLabel || "Revenue amount")}</text></svg>`;
}

function buildStackedBarChart(line) {
  const series = Array.isArray(line.series) ? line.series : [];
  const labels = Array.isArray(line.labels) ? line.labels : [];
  if (series.length === 0 || labels.length === 0) return [];
  const legendRuns = series.flatMap((entry, index) => {
    const color = asText(
      entry.color || CHART_COLORS[index % CHART_COLORS.length],
    ).replace("#", "");
    return [
      new TextRun({ text: index === 0 ? "" : "    ", font: "Calibri", size: 20 }),
      new TextRun({ text: "■ ", bold: true, color, font: "Calibri", size: 20 }),
      new TextRun({ text: asText(entry.label), color: COLORS.slate, font: "Calibri", size: 20 }),
    ];
  });

  return [
    new Paragraph({
      spacing: { before: 100, after: 30 },
      keepNext: true,
      children: [new TextRun({
        text: asText(line.title),
        bold: true,
        color: COLORS.navy,
        font: "Calibri",
        size: 24,
      })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 25 },
      children: [new ImageRun({
        type: "svg",
        data: new TextEncoder().encode(buildStackedBarChartSvg(line)),
        transformation: { width: 624, height: 234 },
        fallback: { type: "png", data: TRANSPARENT_PNG },
      })],
    }),
    new Paragraph({
      spacing: { before: 0, after: 70, line: 220 },
      children: legendRuns,
    }),
  ];
}

function lineToChildren(line) {
  if (line?.type === "table") return buildTable(line);
  if (line?.type === "barChart") return buildBarChart(line);
  if (line?.type === "lineChart") return buildLineChart(line);
  if (line?.type === "stackedBarChart") return buildStackedBarChart(line);

  const entry = typeof line === "string" ? { text: line } : (line ?? {});
  if (entry.pageBreakBefore) {
    return [new Paragraph({ pageBreakBefore: true })].concat(lineToChildren({
      ...entry,
      pageBreakBefore: false,
    }));
  }

  const isSection = Boolean(entry.sectionHeading);
  const spaceBefore = entry.spaceBefore == null
    ? (isSection ? 10 : 0)
    : Number(entry.spaceBefore) || 0;
  const spaceAfter = entry.spaceAfter == null
    ? (isSection ? 6 : 3)
    : Number(entry.spaceAfter) || 0;
  return [new Paragraph({
    heading: isSection ? HeadingLevel.HEADING_1 : undefined,
    shading: isSection
      ? { type: ShadingType.CLEAR, fill: COLORS.navyLight, color: "auto" }
      : undefined,
    border: entry.dividerBefore || entry.dividerAfter || isSection
      ? {
          top: entry.dividerBefore || isSection
            ? { style: BorderStyle.SINGLE, size: 8, color: COLORS.gold }
            : undefined,
          bottom: entry.dividerAfter || isSection
            ? { style: BorderStyle.SINGLE, size: 8, color: COLORS.gold }
            : undefined,
        }
      : undefined,
    spacing: {
      before: Math.round(spaceBefore * 20),
      after: Math.round(spaceAfter * 20),
      line: 264,
    },
    keepNext: Boolean(entry.keepWithNext || isSection),
    children: [new TextRun({
      text: asText(entry.text),
      bold: Boolean(entry.bold || isSection),
      color: isSection ? COLORS.navy : (entry.color ?? COLORS.slate),
      font: "Calibri",
      size: Math.round((Number(entry.fontSize) || (isSection ? 14 : 12)) * 2),
    })],
  })];
}

export async function createNightDutyRangeDocxBlob({ title, rangeLabel, lines }) {
  const document = new Document({
    creator: "Sunshine Hotel Staff Portal",
    title,
    description: `Editable Operations Report analysis for ${rangeLabel}`,
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 26, color: COLORS.slate },
          paragraph: { spacing: { after: 120, line: 264 } },
        },
        heading1: {
          run: { font: "Calibri", size: 32, bold: true, color: COLORS.navy },
          paragraph: { spacing: { before: 320, after: 160 }, keepNext: true },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: COLORS.gold } },
            spacing: { after: 60 },
            children: [
              new TextRun({ text: "SUNSHINE HOTEL", bold: true, color: COLORS.navy, font: "Calibri", size: 20 }),
              new TextRun({ text: "  |  MANAGEMENT REPORTING", color: COLORS.slate, font: "Calibri", size: 17 }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { top: { style: BorderStyle.SINGLE, size: 5, color: COLORS.border } },
            children: [
              new TextRun({
                color: COLORS.slate,
                font: "Calibri",
                size: 16,
                children: ["Powered by CONSOLish  |  Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES],
              }),
            ],
          })],
        }),
      },
      children: [
        new Paragraph({
          spacing: { before: 80, after: 30 },
          children: [new TextRun({
            text: title,
            bold: true,
            color: COLORS.navy,
            font: "Calibri",
            size: 46,
          })],
        }),
        new Paragraph({
          border: {
            top: { style: BorderStyle.SINGLE, size: 8, color: COLORS.gold },
            bottom: { style: BorderStyle.SINGLE, size: 8, color: COLORS.gold },
          },
          spacing: { before: 0, after: 100 },
          children: [new TextRun({
            text: `REPORTING PERIOD  |  ${rangeLabel}    ·    OPERATIONS AND ACCOUNTING ANALYSIS`,
            bold: true,
            color: COLORS.slate,
            font: "Calibri",
            size: 18,
          })],
        }),
        ...lines.flatMap(lineToChildren),
      ],
    }],
  });

  return Packer.toBlob(document);
}

export async function downloadNightDutyRangeDocx(options) {
  if (typeof window === "undefined") return;
  const blob = await createNightDutyRangeDocxBlob(options);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = options.filename;
  link.click();
  window.URL.revokeObjectURL(url);
}
