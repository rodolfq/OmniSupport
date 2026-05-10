import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

async function checkTables() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("\n--- Tabelas no Schema 'public' ---");
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.table(tablesResult.rows);
  } catch (err) {
    console.error("Erro na inspeção:", err);
  } finally {
    await client.end();
  }
}

checkTables();
