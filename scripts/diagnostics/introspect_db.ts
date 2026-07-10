import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

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
