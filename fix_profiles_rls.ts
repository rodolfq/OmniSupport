import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

async function fixProfilesRLS() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("\n--- Criando política para 'profiles' ---");
    await client.query(`
      CREATE POLICY "Allow authenticated read" ON profiles
      FOR SELECT
      TO authenticated
      USING (true);
    `);
    console.log("Política criada com sucesso para profiles.");
  } catch (err) {
    console.error("Erro ao criar política para profiles:", err);
  } finally {
    await client.end();
  }
}

fixProfilesRLS();
