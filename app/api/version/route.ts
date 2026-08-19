import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

// BUILD_ID é gerado pelo próprio Next.js a cada build (hash único, ver
// .next/BUILD_ID) e sobrevive no runtime standalone sem precisar de
// configuração nova no Dockerfile/docker-compose — é o que o client usa pra
// saber se o servidor foi atualizado desde que a página carregou (ver
// app-context.tsx e components/version-update-banner.tsx).
export async function GET() {
  try {
    const buildId = (await readFile(path.join(process.cwd(), '.next', 'BUILD_ID'), 'utf8')).trim();
    return NextResponse.json({ buildId }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[version] Falha ao ler BUILD_ID:', error);
    return NextResponse.json({ error: 'Não foi possível determinar a versão.' }, { status: 500 });
  }
}
