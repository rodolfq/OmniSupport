import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

async function setupPriorities() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("\n--- Ajustando RLS e Populando Prioridades ---");
    
    // 1. Ensure RLS is enabled and policies exist
    await client.query(`ALTER TABLE config_priorities ENABLE ROW LEVEL SECURITY;`);
    
    // Drop existing policy if it exists to avoid errors
    await client.query(`DROP POLICY IF EXISTS "Allow authenticated read/write" ON config_priorities;`);
    
    await client.query(`
      CREATE POLICY "Allow authenticated read/write" ON config_priorities
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
    `);
    
    console.log("Política RLS ajustada.");

    // 2. Clear old data to avoid duplicates/conflicts
    await client.query(`DELETE FROM config_priorities;`);

    // 3. Insert new defaults
    const defaults = [
      { label: 'Nenhuma', sla_hours: 0, color: '#f1f5f9' },
      { label: 'Baixa - 1 Estrela', sla_hours: 48, color: '#22c55e' },
      { label: 'Média - 2 Estrelas', sla_hours: 24, color: '#eab308' },
      { label: 'Alta - 3 Estrelas', sla_hours: 8, color: '#ef4444' },
    ];

    for (const p of defaults) {
      await client.query(
        `INSERT INTO config_priorities (label, sla_hours, color) VALUES ($1, $2, $3)`,
        [p.label, p.sla_hours, p.color]
      );
    }
    
    console.log("Prioridades padrão inseridas.");
  } catch (err) {
    console.error("Erro no setup:", err);
  } finally {
    await client.end();
  }
}

setupPriorities();
