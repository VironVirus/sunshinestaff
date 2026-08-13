import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
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
  white: "FFFFFF",
};
const PAGE_WIDTH_DXA = 9360;

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
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 5, color: COLORS.border },
      bottom: { style: BorderStyle.SINGLE, size: 5, color: COLORS.border },
      left: { style: BorderStyle.SINGLE, size: 5, color: COLORS.border },
      right: { style: BorderStyle.SINGLE, size: 5, color: COLORS.border },
    },
    children: [new Paragraph({
      alignment: options.align ?? AlignmentType.LEFT,
      spacing: { before: 0, after: 0, line: 260 },
      children: [new TextRun({
        text: asText(text),
        bold: Boolean(options.bold),
        color: options.color ?? COLORS.navy,
        font: "Calibri",
        size: options.size ?? 18,
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
      spacing: { before: 160, after: 80 },
      children: [new TextRun({
        text: asText(line.title),
        bold: true,
        color: COLORS.navy,
        font: "Calibri",
        size: 20,
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
            fill: COLORS.navy,
            color: COLORS.white,
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
    new Paragraph({ spacing: { after: 100 } }),
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

function buildLineChartTable(line) {
  const series = Array.isArray(line.series) ? line.series : [];
  const labels = Array.isArray(line.labels) ? line.labels : [];

  return buildTable({
    title: line.title,
    headers: ["Date", ...series.map((entry) => entry.label)],
    widths: [1.4, ...series.map(() => 1.35)],
    rows: labels.map((label, index) => [
      label,
      ...series.map((entry) => entry.displayValues?.[index] ?? entry.values?.[index] ?? 0),
    ]),
  });
}

function lineToChildren(line) {
  if (line?.type === "table") return buildTable(line);
  if (line?.type === "barChart") return buildBarChart(line);
  if (line?.type === "lineChart") return buildLineChartTable(line);

  const entry = typeof line === "string" ? { text: line } : (line ?? {});
  if (entry.pageBreakBefore) {
    return [new Paragraph({ pageBreakBefore: true })].concat(lineToChildren({
      ...entry,
      pageBreakBefore: false,
    }));
  }

  const isSection = Boolean(entry.sectionHeading);
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
      before: Math.round((Number(entry.spaceBefore) || (isSection ? 10 : 0)) * 20),
      after: Math.round((Number(entry.spaceAfter) || (isSection ? 6 : 4)) * 20),
      line: 276,
    },
    keepNext: Boolean(entry.keepWithNext || isSection),
    children: [new TextRun({
      text: asText(entry.text),
      bold: Boolean(entry.bold || isSection),
      color: isSection ? COLORS.navy : (entry.color ?? COLORS.slate),
      font: "Calibri",
      size: Math.round((Number(entry.fontSize) || (isSection ? 13 : 10.5)) * 2),
    })],
  })];
}

export async function createNightDutyRangeDocxBlob({ title, rangeLabel, lines }) {
  const document = new Document({
    creator: "Sunshine Hotel Staff Portal",
    title,
    description: `Editable Night Duty analysis for ${rangeLabel}`,
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 21, color: COLORS.slate } },
        heading1: {
          run: { font: "Calibri", size: 26, bold: true, color: COLORS.navy },
          paragraph: { spacing: { before: 240, after: 120 }, keepNext: true },
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
            spacing: { after: 100 },
            children: [
              new TextRun({ text: "SUNSHINE HOTEL", bold: true, color: COLORS.navy, font: "Calibri", size: 20 }),
              new TextRun({ text: `  |  ${rangeLabel}`, color: COLORS.slate, font: "Calibri", size: 18 }),
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
          spacing: { before: 120, after: 80 },
          children: [new TextRun({
            text: title,
            bold: true,
            color: COLORS.navy,
            font: "Calibri",
            size: 34,
          })],
        }),
        new Paragraph({
          shading: { type: ShadingType.CLEAR, fill: COLORS.goldLight, color: "auto" },
          border: {
            top: { style: BorderStyle.SINGLE, size: 8, color: COLORS.gold },
            bottom: { style: BorderStyle.SINGLE, size: 8, color: COLORS.gold },
          },
          spacing: { before: 0, after: 180 },
          children: [new TextRun({
            text: `Reporting period: ${rangeLabel}`,
            bold: true,
            color: COLORS.gold,
            font: "Calibri",
            size: 21,
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
