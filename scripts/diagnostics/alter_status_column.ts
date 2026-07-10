import { query } from '../../lib/db';

async function main() {
  console.log('Adding status column to public.analyst_status...');
  try {
    await query("ALTER TABLE public.analyst_status ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'offline'");
    console.log('✅ Column status added successfully!');
  } catch (err) {
    console.error('❌ Error adding column:', err);
  } finally {
    process.exit(0);
  }
}

main();
