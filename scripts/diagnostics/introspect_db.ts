import { Client } from 'pg';

// Conexao vinha embutida aqui, com a senha do banco em texto puro num
// arquivo versionado. Agora sai do ambiente, como no resto do projeto.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Defina DATABASE_URL antes de rodar este script de diagnostico.');
  process.exit(1);
}

async function introspectDB() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    // Query to get all tables and their columns in the public schema
    const query = `
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    `;
    
    const result = await client.query(query);
    
    // Group by table
    const schemaMap: Record<string, any[]> = {};
    for (const row of result.rows) {
      if (!schemaMap[row.table_name]) {
        schemaMap[row.table_name] = [];
      }
      schemaMap[row.table_name].push({
        column: row.column_name,
        type: row.data_type
      });
    }

    console.log(JSON.stringify(schemaMap, null, 2));

  } catch (err) {
    console.error("Erro na inspeção:", err);
  } finally {
    await client.end();
  }
}

introspectDB();
