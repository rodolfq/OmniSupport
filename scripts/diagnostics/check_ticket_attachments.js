const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });

async function main() {
  try {
    const tRes = await pool.query("SELECT id, title, attachments_data FROM public.tickets WHERE title ILIKE '%Teste Com Anexo%'");
    console.log('--- TICKETS ---');
    tRes.rows.forEach(r => {
      console.log({
        id: r.id,
        title: r.title,
        attachments_data: r.attachments_data
      });
    });

    if (tRes.rows.length > 0) {
      const ticketId = tRes.rows[0].id;
      const mRes = await pool.query("SELECT id, content, attachments_data FROM public.ticket_messages WHERE ticket_id = $1", [ticketId]);
      console.log('--- MESSAGES ---');
      mRes.rows.forEach(r => {
        console.log({
          id: r.id,
          content: r.content,
          attachments_data: r.attachments_data
        });
      });
    }
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
