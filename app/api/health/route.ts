import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Healthcheck do container (ver HEALTHCHECK no Dockerfile). Checa o que de
// fato derruba a aplicação: o Postgres. Um 200 "vazio" que não toca o banco
// deixaria o container marcado como saudável com a app inteira quebrada.
//
// Público (ver PUBLIC_PATHS em middleware.ts): o Docker chama sem cookie de
// sessão. Não expõe nada além de estar vivo e da latência do banco.
export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();
  try {
    await query('SELECT 1');
    return NextResponse.json({ status: 'ok', dbLatencyMs: Date.now() - startedAt });
  } catch (err: any) {
    console.error('[health] Banco indisponível:', err?.message);
    return NextResponse.json(
      { status: 'error', error: 'database unavailable' },
      { status: 503 }
    );
  }
}
