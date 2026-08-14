import { NextResponse } from 'next/server';
import { assertCanViewGiro, permissionErrorStatus } from '@/lib/server-permissions';
import { exportPeriod } from '@/lib/services/giro-service';

/**
 * Exportação do Giro por período, em CSV.
 *
 * Gerado no servidor (e não montado na tela, como faz components/reports/
 * export-menu.tsx) porque um período longo traz muito mais linha do que a tela
 * carrega: seria preciso baixar o período inteiro só para transformá-lo em
 * texto. O formato segue o mesmo do resto do sistema — separador vírgula e BOM
 * UTF-8 na frente, sem o qual o Excel abre os acentos quebrados.
 */

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/** AAAA-MM-DD (chave interna) -> DD/MM/AAAA (tudo que o usuário lê). */
function toBrDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const COLUMNS: { label: string; value: (r: any) => unknown }[] = [
  { label: 'Data', value: r => toBrDate(r.date) },
  { label: 'Posição', value: r => r.position },
  { label: 'Analista', value: r => r.userName },
  { label: 'Passagem de turno', value: r => (r.isHandoff ? 'Sim' : 'Não') },
  { label: 'Horário de trabalho', value: r => r.workSchedule },
  { label: 'Tipo de atendimento', value: r => r.serviceType },
  { label: 'Hora', value: r => r.serviceTime },
  { label: 'Observação', value: r => r.note },
  { label: 'Almoço', value: r => r.lunchTime },
  { label: 'Checklist concluído', value: r => r.checklist },
  { label: 'Atendimentos concluídos', value: r => r.history }
];

export async function GET(request: Request) {
  try {
    const check = await assertCanViewGiro();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: permissionErrorStatus(check.error) });

    const searchParams = new URL(request.url).searchParams;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Informe a data inicial e a final.' }, { status: 400 });
    }

    const rows = await exportPeriod(startDate, endDate);
    const header = COLUMNS.map(c => csvCell(c.label)).join(',');
    const lines = rows.map(row => COLUMNS.map(c => csvCell(c.value(row))).join(','));
    const csv = '﻿' + [header, ...lines].join('\r\n');

    // Nome de arquivo no padrão brasileiro, como o resto do sistema.
    const filename = `giro-${toBrDate(startDate).replace(/\//g, '-')}-a-${toBrDate(endDate).replace(/\//g, '-')}.csv`;

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv;charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    });
  } catch (err: any) {
    console.error('Error exporting giro:', err);
    return NextResponse.json({ error: err?.message || 'Erro ao exportar o Giro.' }, { status: 500 });
  }
}
