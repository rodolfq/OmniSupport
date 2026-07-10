import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  try {
    if (id) {
      const res = await query(
        'SELECT id, name, industry, phone FROM public.companies WHERE id = $1',
        [id]
      );
      if (res.rowCount === 0) {
        return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 404 });
      }
      return NextResponse.json(res.rows[0]);
    } else {
      const res = await query(
        'SELECT id, name, industry, phone FROM public.companies ORDER BY name ASC'
      );
      return NextResponse.json(res.rows);
    }
  } catch (error: any) {
    console.error('Error fetching companies in API:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { id, name, industry, phone } = await request.json();

    if (!name) {
      return NextResponse.json({ error: 'Nome da empresa é obrigatório' }, { status: 400 });
    }

    const companyId = id || undefined; // Let database auto-generate UUID if not provided
    
    let res;
    if (companyId) {
      res = await query(
        `INSERT INTO public.companies (id, name, industry, phone)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, industry, phone`,
        [companyId, name, industry || null, phone || null]
      );
    } else {
      res = await query(
        `INSERT INTO public.companies (name, industry, phone)
         VALUES ($1, $2, $3)
         RETURNING id, name, industry, phone`,
        [name, industry || null, phone || null]
      );
    }

    return NextResponse.json(res.rows[0]);
  } catch (error: any) {
    console.error('Error in companies POST:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'ID da empresa é obrigatório' }, { status: 400 });
  }

  try {
    const company = await request.json();

    await query(
      `UPDATE public.companies
       SET name = COALESCE($1, name),
           industry = COALESCE($2, industry),
           phone = COALESCE($3, phone)
       WHERE id = $4`,
      [company.name, company.industry, company.phone, id]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in companies PUT:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'ID da empresa é obrigatório' }, { status: 400 });
  }

  try {
    await query('DELETE FROM public.companies WHERE id = $1', [id]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in companies DELETE:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
