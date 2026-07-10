import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

async function fixRLS() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("\n--- Criando política para 'companies' ---");
    await client.query(`
      CREATE POLICY "Allow authenticated read" ON companies
      FOR SELECT
      TO authenticated
      USING (true);
    `);
    console.log("Política criada com sucesso.");
  } catch (err) {
    console.error("Erro ao criar política:", err);
  } finally {
    await client.end();
  }
}

fixRLS();
