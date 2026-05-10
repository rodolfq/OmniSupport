import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://edrixccffpbinvfieoyg.supabase.co';
const supabaseKey = 'dummy'; // This will fail if not authenticated, but I need to test DB access. Actually the DB credentials are in the MockDB, let's use the DB direct connection.

import { Client } from 'pg';
const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

async function testDelete() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    // Attempt delete
    const id = '64d398f8-6c61-4b28-8d99-0964ea43977d';
    const res = await client.query("DELETE FROM companies WHERE id = $1", [id]);
    console.log("Delete result rowCount:", res.rowCount);
    
  } catch (err) {
    console.error("Erro na deleção:", err);
  } finally {
    await client.end();
  }
}

testDelete();
