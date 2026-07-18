import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    const res = await query(
      `SELECT h.id, h.customer_name, h.finished_at, h.rating, s.ticket_number
       FROM public.chat_histories h
       LEFT JOIN public.chat_sessions s ON s.id = h.session_id
       WHERE h.rating IS NOT NULL
       ORDER BY h.finished_at DESC`
    );

    const responses = res.rows.map(r => ({
      id: r.id,
      customerName: r.customer_name,
      ticketNumber: r.ticket_number,
      rating: r.rating,
      finishedAt: r.finished_at
    }));

    const total = responses.length;
    const satisfied = responses.filter(r => r.rating === 1).length;
    const toImprove = responses.filter(r => r.rating === 0).length;
    const satisfactionRate = total > 0 ? satisfied / total : 0;

    return NextResponse.json({ total, satisfied, toImprove, satisfactionRate, responses });
  } catch (error: any) {
    console.error('Error fetching survey report:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
