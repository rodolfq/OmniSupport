import { NextResponse } from 'next/server';
import postgres from 'postgres';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query');
  const secret = searchParams.get('secret');

  // Proteção simples para não deixar a rota aberta ao público
  if (secret !== 'supa_dev_123') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!query) {
    return NextResponse.json({ error: 'No query provided' }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not set in environment variables' }, { status: 500 });
  }

  try {
    const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
    const result = await sql.unsafe(query);
    await sql.end();
    return NextResponse.json({ result });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
