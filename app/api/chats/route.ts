import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    if (action === 'sessions') {
      // Obter todas as sessões e suas respectivas mensagens
      const sessionsRes = await query('SELECT * FROM public.chat_sessions ORDER BY created_at DESC');
      const messagesRes = await query('SELECT * FROM public.chat_messages ORDER BY created_at ASC');
      
      const messagesBySession = new Map<string, any[]>();
      messagesRes.rows.forEach(m => {
        const arr = messagesBySession.get(m.session_id) || [];
        arr.push({
          id: m.id,
          senderId: m.sender_id,
          senderName: m.sender_name,
          text: m.text,
          timestamp: m.created_at,
          type: m.type,
          metadata: m.metadata
        });
        messagesBySession.set(m.session_id, arr);
      });

      const sessions = sessionsRes.rows.map(s => ({
        id: s.id,
        customerId: s.customer_id,
        customerName: s.customer_name,
        customerPhone: s.customer_phone,
        assigneeId: s.assignee_id,
        queueId: s.queue_id,
        status: s.status,
        startedAt: s.created_at,
        lastMessageAt: s.last_message_at || s.created_at,
        messages: messagesBySession.get(s.id) || []
      }));

      return NextResponse.json(sessions);
    } 
    
    if (action === 'histories') {
      const res = await query(
        `SELECT h.*, p1.name as customer_profile_name, p2.name as assignee_profile_name 
         FROM public.chat_histories h
         LEFT JOIN public.profiles p1 ON h.customer_id = p1.id
         LEFT JOIN public.profiles p2 ON h.assignee_id = p2.id
         ORDER BY h.finished_at DESC`
      );
      
      return NextResponse.json(res.rows.map(h => ({
        id: h.id,
        sessionId: h.session_id,
        customerId: h.customer_id,
        customerName: h.customer_name || h.customer_profile_name,
        customerPhone: h.customer_phone,
        assigneeId: h.assignee_id,
        assigneeName: h.assignee_profile_name,
        startedAt: h.started_at,
        finishedAt: h.finished_at,
        durationSeconds: h.duration_seconds,
        firstResponseSeconds: h.first_response_seconds,
        rating: h.rating,
        transcript: h.transcript
      })));
    }

    if (action === 'status-history') {
      const res = await query('SELECT * FROM public.user_status_history ORDER BY timestamp DESC LIMIT 500');
      return NextResponse.json(res.rows.map(h => ({
        id: h.id,
        userId: h.user_id,
        status: h.status,
        reason: h.reason,
        timestamp: h.timestamp,
        duration: h.duration
      })));
    }

    if (action === 'absence-reasons') {
      const res = await query('SELECT * FROM public.absence_reasons ORDER BY created_at ASC');
      return NextResponse.json(res.rows.map(r => ({ id: r.id, label: r.label })));
    }

    if (action === 'analyst-status') {
      const res = await query('SELECT * FROM public.analyst_status');
      return NextResponse.json(res.rows.map(s => ({
        userId: s.user_id,
        isOnline: s.is_online,
        lastActive: s.last_active,
        currentLoad: s.current_load,
        currentReason: s.current_reason
      })));
    }

    if (action === 'internal-chats') {
      const res = await query('SELECT * FROM public.internal_chats ORDER BY last_message_at DESC');
      return NextResponse.json(res.rows.map(c => ({
        id: c.id,
        name: c.name,
        imageUrl: c.image_url,
        type: c.type,
        memberIds: c.member_ids || [],
        messages: [],
        lastMessageAt: c.last_message_at || c.created_at
      })));
    }

    if (action === 'internal-messages') {
      const chatId = searchParams.get('chatId');
      if (!chatId) return NextResponse.json({ error: 'chatId é obrigatório' }, { status: 400 });

      const res = await query(
        'SELECT * FROM public.internal_chat_messages WHERE chat_id = $1 ORDER BY created_at ASC',
        [chatId]
      );
      return NextResponse.json(res.rows.map(m => ({
        id: m.id,
        senderId: m.sender_id,
        senderName: m.sender_name,
        text: m.text,
        timestamp: m.created_at,
        type: m.type,
        metadata: m.metadata,
        readBy: [],
        attachments: m.metadata?.attachments || []
      })));
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (error: any) {
    console.error('Error in chats GET:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'save-session') {
      const { session } = body;
      await query(
        `INSERT INTO public.chat_sessions (id, customer_id, customer_name, customer_phone, assignee_id, queue_id, status, created_at, last_message_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (id) DO UPDATE SET
           customer_id = EXCLUDED.customer_id,
           customer_name = EXCLUDED.customer_name,
           customer_phone = EXCLUDED.customer_phone,
           assignee_id = EXCLUDED.assignee_id,
           queue_id = EXCLUDED.queue_id,
           status = EXCLUDED.status,
           last_message_at = EXCLUDED.last_message_at,
           updated_at = NOW()`,
        [
          session.id,
          session.customerId || null,
          session.customerName || null,
          session.customerPhone || null,
          session.assigneeId || null,
          session.queueId || null,
          session.status,
          session.startedAt,
          session.lastMessageAt
        ]
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'create-session') {
      const { session } = body;
      const id = session.id;
      await query(
        `INSERT INTO public.chat_sessions (id, customer_id, customer_name, customer_phone, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          id,
          session.customerId || null,
          session.customerName || null,
          session.customerPhone || null,
          session.status,
          session.startedAt
        ]
      );
      return NextResponse.json({ id });
    }

    if (action === 'push-message') {
      const { sessionId, message } = body;
      await query(
        `INSERT INTO public.chat_messages (id, session_id, sender_id, sender_name, text, type, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          message.id,
          sessionId,
          message.senderId || null,
          message.senderName || null,
          message.text,
          message.type || 'text',
          message.metadata || '{}',
          message.timestamp
        ]
      );
      await query(
        'UPDATE public.chat_sessions SET last_message_at = $1, updated_at = NOW() WHERE id = $2',
        [message.timestamp, sessionId]
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'save-status') {
      const { status } = body;
      await query(
        `INSERT INTO public.analyst_status (user_id, is_online, last_active, current_load)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           is_online = EXCLUDED.is_online,
           last_active = EXCLUDED.last_active,
           current_load = EXCLUDED.current_load`,
        [status.userId, status.isOnline, status.lastActive, status.currentLoad]
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'log-status-change') {
      const { userId, status, reason } = body;
      await query(
        `UPDATE public.analyst_status
         SET current_reason = $1,
             is_online = $2,
             last_active = NOW()
         WHERE user_id = $3`,
        [reason || null, status === 'online', userId]
      );
      await query(
        `INSERT INTO public.user_status_history (user_id, status, reason, timestamp)
         VALUES ($1, $2, $3, NOW())`,
        [userId, status, reason || null]
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'save-absence-reason') {
      const { reason } = body;
      await query('INSERT INTO public.absence_reasons (label) VALUES ($1)', [reason.label]);
      return NextResponse.json({ success: true });
    }

    if (action === 'delete-absence-reason') {
      const { id } = body;
      await query('DELETE FROM public.absence_reasons WHERE id = $1', [id]);
      return NextResponse.json({ success: true });
    }

    if (action === 'save-internal-chat') {
      const { chat } = body;
      await query(
        `INSERT INTO public.internal_chats (id, name, image_url, type, member_ids, last_message_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           image_url = EXCLUDED.image_url,
           type = EXCLUDED.type,
           member_ids = EXCLUDED.member_ids,
           last_message_at = EXCLUDED.last_message_at`,
        [chat.id, chat.name, chat.imageUrl, chat.type, chat.memberIds, chat.lastMessageAt]
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'save-internal-message') {
      const { chatId, message } = body;
      await query(
        `INSERT INTO public.internal_chat_messages (chat_id, sender_id, sender_name, text, type, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          chatId,
          message.senderId || null,
          message.senderName || null,
          message.text,
          message.type || 'text',
          { ...message.metadata, attachments: message.attachments || [] },
          message.timestamp || new Date().toISOString()
        ]
      );
      await query(
        'UPDATE public.internal_chats SET last_message_at = $1 WHERE id = $2',
        [message.timestamp || new Date().toISOString(), chatId]
      );
      return NextResponse.json({ success: true });
    }

    if (action === 'save-history') {
      const { history } = body;
      await query(
        `INSERT INTO public.chat_histories (session_id, customer_id, customer_name, customer_phone, assignee_id, started_at, finished_at, duration_seconds, first_response_seconds, rating, transcript)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          history.sessionId,
          history.customerId || null,
          history.customerName || null,
          history.customerPhone || null,
          history.assigneeId || null,
          history.startedAt,
          history.finishedAt,
          history.durationSeconds || null,
          history.firstResponseSeconds || null,
          history.rating || null,
          history.transcript || ''
        ]
      );
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (error: any) {
    console.error('Error in chats POST:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
