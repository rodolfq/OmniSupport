import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(request: NextRequest) {
  // Criar cliente server-side que lê cookies automaticamente
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false
    },
    global: {
      headers: {
        cookie: request.headers.get('cookie') || ''
      }
    }
  });

  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error || !session?.user) {
      return NextResponse.json({ user: null, error: 'No session' }, { status: 401 });
    }

    // Buscar profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, name, email, role, company_id, phone, view_all_company_tickets, must_change_password, is_admin')
      .eq('id', session.user.id)
      .maybeSingle();

    if (profileError || !profile) {
      // Retornar pelo menos os dados básicos do usuário
      return NextResponse.json({
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.user_metadata?.name || session.user.email?.split('@')[0],
          role: session.user.user_metadata?.role || 'Funcionário'
        }
      });
    }

    return NextResponse.json({
      user: {
        id: profile!.id,
        email: profile!.email,
        name: profile!.name,
        role: profile!.role,
        companyId: profile!.company_id,
        phone: profile!.phone,
        viewAllCompanyTickets: profile!.view_all_company_tickets,
        mustChangePassword: profile!.must_change_password,
        isAdmin: profile!.is_admin
      }
    });
  } catch (error: any) {
    console.error('Auth me error:', error);
    return NextResponse.json({ user: null, error: error.message }, { status: 500 });
  }
}