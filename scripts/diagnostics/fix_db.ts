import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

async function fixTable() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("Adicionando coluna 'view_all_company_tickets' na tabela 'profiles'...");
    await client.query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS view_all_company_tickets BOOLEAN DEFAULT FALSE");
    console.log("Coluna adicionada com sucesso!");
    
  } catch (err) {
    console.error("Erro ao alterar tabela:", err);
  } finally {
    await client.end();
  }
}

fixTable();
