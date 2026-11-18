// Geração de CSV/XLSX/PDF a partir de uma tabela de dados — extraído de
// components/reports/export-menu.tsx (2026-11-18) para ser reaproveitado por
// quem precisa exportar uma lista (ex.: botão "Exportar" dos chamados) sem
// herdar o acoplamento daquele componente com Relatórios (permissão
// reports:export e o log em /api/reports/export-log). Lógica idêntica —
// só separada do componente React e de qualquer permissão.

export interface ReportExportColumn<T> {
  key: keyof T;
  label: string;
  format?: (value: T[keyof T], row: T) => string; // só usado no PDF
}

export interface ReportExportConfig<T = any> {
  title: string;
  columns: ReportExportColumn<T>[];
  rows: T[];
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function buildCsv<T>(config: ReportExportConfig<T>): string {
  const header = config.columns.map(c => csvCell(c.label)).join(',');
  const lines = config.rows.map(row => config.columns.map(c => csvCell(row[c.key])).join(','));
  // BOM UTF-8 na frente — sem isso o Excel abre acento quebrado.
  return '' + [header, ...lines].join('\r\n');
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Planilha Excel: uma aba por seção, com o valor bruto (número puro), para o Excel recalcular.
export async function buildXlsx(sections: ReportExportConfig<any>[]): Promise<Blob> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  for (const section of sections) {
    const aoa: unknown[][] = [
      section.columns.map(c => c.label),
      ...section.rows.map(row => section.columns.map(c => {
        const v = row[c.key];
        return v === null || v === undefined ? '' : v;
      })),
    ];
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    // Nome de aba: até 31 caracteres, sem caracteres proibidos pelo Excel, e sem repetir.
    const base = (section.title.replace(/[\/?*[\]:]/g, ' ').trim().slice(0, 31)) || 'Planilha';
    let name = base;
    for (let n = 2; usedNames.has(name); n++) name = `${base.slice(0, 27)} ${n}`;
    usedNames.add(name);
    XLSX.utils.book_append_sheet(wb, sheet, name);
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// Cores da identidade visual (ver app/globals.css --accent) — mesmo verde
// água do resto do produto, pra o PDF não parecer um documento genérico.
const PDF_ACCENT: [number, number, number] = [15, 166, 148]; // #0FA694
const PDF_INK: [number, number, number] = [30, 41, 59]; // slate-800
const PDF_MUTED: [number, number, number] = [100, 116, 139]; // slate-500
const PDF_ZEBRA: [number, number, number] = [246, 250, 249]; // tingido levemente de verde água

// Largura MÍNIMA/MÁXIMA de uma coluna e o padding (esquerda+direita) por
// célula, em pt — usados tanto pra medir a largura natural de cada coluna
// quanto pra desenhar.
const COL_MIN_WIDTH = 34;
const COL_MAX_WIDTH = 170;
const CELL_PADDING = 12;

// Mede a largura "natural" de cada coluna (maior entre o rótulo do
// cabeçalho e o valor de toda linha), com o MESMO tamanho de fonte que vai
// ser usado pra desenhar a tabela de verdade — é o que faz uma coluna
// "Bad" (1 dígito) ficar estreita e "Analista" (nome) ficar larga, em vez
// de todas saírem do mesmo tamanho (ver nota abaixo, 2026-10-08).
function measureNaturalColumnWidths(doc: any, section: ReportExportConfig<any>, fontSize: number): number[] {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize);
  const widths = section.columns.map(col => doc.getTextWidth(col.label));
  doc.setFont('helvetica', 'normal');
  section.rows.forEach(row => {
    section.columns.forEach((col, i) => {
      const raw = row[col.key];
      const text = col.format ? col.format(raw, row) : (raw === null || raw === undefined ? '—' : String(raw));
      const w = doc.getTextWidth(text);
      if (w > widths[i]) widths[i] = w;
    });
  });
  return widths.map(w => Math.min(COL_MAX_WIDTH, Math.max(COL_MIN_WIDTH, w + CELL_PADDING)));
}

// A partir da largura natural de cada coluna, decide a largura final pra
// caber exatamente em `contentWidth`: se SOBRA espaço, distribui a sobra
// proporcionalmente (coluna mais larga ganha mais, não ganham todas igual);
// se FALTA espaço (tabela não cabe nem larga), encolhe todas
// proporcionalmente — ainda pode quebrar linha em alguma célula, mas só
// onde o conteúdo pede, não em toda coluna por igual.
function fitColumnWidths(natural: number[], contentWidth: number): number[] {
  const sum = natural.reduce((a, b) => a + b, 0);
  if (sum <= 0) return natural;
  if (sum <= contentWidth) {
    const extra = contentWidth - sum;
    return natural.map(w => w + extra * (w / sum));
  }
  const scale = contentWidth / sum;
  return natural.map(w => Math.max(COL_MIN_WIDTH * 0.7, w * scale));
}

// Monta o PDF de reunião: cabeçalho com o relatório e o filtro, e uma tabela por seção.
// Usado pelo PDF da página inteira e pelo PDF de uma seção (ex.: o ranking).
//
// Reescrito em 2026-10-08 em duas rodadas (o motivo de vários PDFs saírem
// quebrados):
// 1ª rodada: o código antigo escrevia cada célula com `maxWidth` — o jsPDF
//    QUEBRA a linha sozinho quando o texto excede a largura, mas o cursor Y
//    sempre avançava uma linha FIXA (13pt), nunca o nº de linhas que o texto
//    realmente ocupou. Texto comprido sobrepunha a linha seguinte. Corrigido
//    medindo cada célula com `splitTextToSize` ANTES de desenhar.
// 2ª rodada (achado pelo usuário, com print de uma tabela de 17 colunas):
//    a largura ainda era `contentWidth / nº de colunas` — IGUAL pra todas,
//    então uma tabela com muita coluna (ex.: Desempenho por Analista) dava
//    uma largura tão apertada que até "Good"/"Bad" (1 dígito) quebravam
//    palavra por sílaba. Agora cada coluna mede o próprio conteúdo
//    (measureNaturalColumnWidths/fitColumnWidths) e a página vira PAISAGEM
//    sozinha quando a soma das larguras naturais não cabe em retrato.
export async function buildPdf(sections: ReportExportConfig<any>[], reportLabel: string, filterSummary: string) {
  const ready = sections.filter(s => s.rows.length > 0);
  if (ready.length === 0) return null;
  const { jsPDF } = await import('jspdf');
  const marginX = 40;

  // Doc de medição: só pra rodar getTextWidth/splitTextToSize antes de
  // decidir orientação — unidade/fonte é tudo que importa aqui, o tamanho
  // de página não entra na medição de texto.
  const probe = new jsPDF({ unit: 'pt', format: 'a4' });
  const portraitContentWidth = probe.internal.pageSize.getWidth() - marginX * 2;
  const sectionFontSize = (s: ReportExportConfig<any>) => (s.columns.length > 10 ? 7 : 8);
  const naturalWidthsBySection = ready.map(s => measureNaturalColumnWidths(probe, s, sectionFontSize(s)));
  const widestSectionSum = Math.max(...naturalWidthsBySection.map(ws => ws.reduce((a, b) => a + b, 0)));
  const orientation: 'portrait' | 'landscape' = widestSectionSum > portraitContentWidth ? 'landscape' : 'portrait';

  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation });
  const marginTop = 56;
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - marginX * 2;
  const footerY = pageHeight - 26;
  let y = marginTop;
  let pageNumber = 1;

  const drawFooter = () => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_MUTED);
    doc.text('SSX Desk', marginX, footerY);
    doc.text(`Página ${pageNumber}`, pageWidth - marginX, footerY, { align: 'right' });
  };

  const addPage = () => {
    drawFooter();
    doc.addPage();
    pageNumber += 1;
    y = marginTop;
  };

  // Garante espaço pra `height` pt; se não couber, vira página. Devolve
  // true quando a página virou — quem desenha tabela usa isso pra saber se
  // precisa redesenhar o cabeçalho de coluna.
  const ensureSpace = (height: number): boolean => {
    if (y + height > footerY - 10) {
      addPage();
      return true;
    }
    return false;
  };

  const drawReportHeader = () => {
    doc.setFillColor(...PDF_ACCENT);
    doc.rect(0, 0, pageWidth, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(...PDF_INK);
    doc.text(reportLabel, marginX, y);
    y += 20;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...PDF_MUTED);
    const filterLines = doc.splitTextToSize(filterSummary || 'Sem filtros aplicados', contentWidth);
    doc.text(filterLines, marginX, y);
    y += filterLines.length * 12;
    doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, marginX, y);
    y += 16;
    doc.setDrawColor(...PDF_ACCENT);
    doc.setLineWidth(1.2);
    doc.line(marginX, y, pageWidth - marginX, y);
    doc.setLineWidth(0.5);
    y += 26;
  };

  drawReportHeader();

  const LINE_HEIGHT = 12;
  const ROW_PADDING = 6;
  const HEADER_HEIGHT = 20;

  ready.forEach((section, sectionIndex) => {
    const fontSize = sectionFontSize(section);
    // Larguras já medidas pelo conteúdo real (measureNaturalColumnWidths,
    // antes de decidir a orientação) — só falta encaixar no contentWidth
    // de verdade da página escolhida. x-offset de cada coluna vem da soma
    // acumulada das larguras anteriores (colunas não são mais iguais).
    const colWidths = fitColumnWidths(naturalWidthsBySection[sectionIndex], contentWidth);
    const colX: number[] = [];
    colWidths.reduce((acc, w, i) => { colX[i] = acc; return acc + w; }, marginX);

    const drawSectionTitle = () => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11.5);
      doc.setTextColor(...PDF_ACCENT);
      doc.text(section.title.toUpperCase(), marginX, y);
      y += 18;
    };

    const drawColumnHeader = () => {
      doc.setFillColor(...PDF_ACCENT);
      doc.rect(marginX, y - 13, contentWidth, HEADER_HEIGHT, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(fontSize);
      doc.setTextColor(255, 255, 255);
      section.columns.forEach((col, i) => doc.text(col.label, colX[i] + 5, y, { maxWidth: colWidths[i] - 8 }));
      y += HEADER_HEIGHT - 4;
    };

    ensureSpace(HEADER_HEIGHT + 24);
    drawSectionTitle();
    drawColumnHeader();

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize);

    section.rows.forEach((row, rowIndex) => {
      // Cada célula pode quebrar em N linhas — a linha da TABELA usa a maior
      // delas, e só então o cursor avança (é exatamente o que faltava antes).
      const cellLines = section.columns.map((col, i) => {
        const raw = row[col.key];
        const text = col.format ? col.format(raw, row) : (raw === null || raw === undefined ? '—' : String(raw));
        return doc.splitTextToSize(text, colWidths[i] - 8) as string[];
      });
      const maxLines = Math.max(1, ...cellLines.map(l => l.length));
      const rowHeight = maxLines * LINE_HEIGHT + ROW_PADDING;

      const quebrouPagina = ensureSpace(rowHeight);
      if (quebrouPagina) drawColumnHeader();

      if (rowIndex % 2 === 1) {
        doc.setFillColor(...PDF_ZEBRA);
        doc.rect(marginX, y - 9, contentWidth, rowHeight, 'F');
      }

      doc.setTextColor(...PDF_INK);
      cellLines.forEach((lines, i) => {
        doc.text(lines, colX[i] + 5, y, { maxWidth: colWidths[i] - 8 });
      });
      y += rowHeight;
    });

    y += 20;
  });

  drawFooter();
  return doc;
}
