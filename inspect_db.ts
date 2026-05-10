import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

async function inspectDatabase() {
  const client = new Client({ connectionString });
  
  try {
    console.log("Tentando conectar ao banco...");
    await client.connect();
    console.log("Conexão estabelecida com sucesso!");

    console.log("\n--- Schemas Encontrados ---");
    const schemasResult = await client.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog')");
    console.table(schemasResult.rows);

    console.log("\n--- Colunas em 'public.tickets' ---");
    const columnsResult = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'tickets' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);
    console.table(columnsResult.rows);

    console.log("\n--- Verificando acesso ao Schema 'auth' ---");
    try {
      const authTables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'auth' LIMIT 5");
      console.log("Acesso ao schema 'auth' permitido. Tabelas encontradas:");
      console.table(authTables.rows);
    } catch (e) {
      console.log("Acesso ao schema 'auth' negado ou erro ao acessar.");
    }

  } catch (err) {
    console.error("Erro na inspeção:", err);
  } finally {
    await client.end();
  }
}

inspectDatabase();
