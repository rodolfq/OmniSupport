import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  try {
    // Check existing tickets
    const { data: allTickets, error: allError } = await supabase
      .from('internal_tickets')
      .select('id, internal_ticket_number, title')
      .limit(10);
    
    // Get max existing number
    const { data: maxData } = await supabase
      .from('internal_tickets')
      .select('internal_ticket_number')
      .order('internal_ticket_number', { ascending: false })
      .limit(1)
      .single();
    
    return NextResponse.json({
      sampleTickets: allError ? { error: allError.message } : allTickets,
      maxNumber: maxData?.internal_ticket_number || 0
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}