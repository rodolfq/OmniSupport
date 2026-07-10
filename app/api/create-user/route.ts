import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { NextRequest, NextResponse } from 'next/server';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-url.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-role-key',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

export async function POST(request: NextRequest) {
  try {
    const { email, name, role, companyId, phones, viewAllCompanyTickets } = await request.json();

    // Create user in auth.users using admin API
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: Math.random().toString(36).slice(-8),
      email_confirm: true,
      user_metadata: {
        name,
        role
      }
    });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    const userId = authData.user.id;

    // Create profile
    const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
      id: userId,
      email,
      name,
      role,
      company_id: companyId,
      phone: phones?.[0] || null,
      view_all_company_tickets: viewAllCompanyTickets ?? false,
      must_change_password: true,
      is_admin: role === 'Administrador' || role === 'admin',
      lives_in_squad: role === 'Equipe' || role === 'Administrador'
    });

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 400 });
    }

    return NextResponse.json({ id: userId, email, name, role });
  } catch (error: any) {
    console.error('Create user API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}