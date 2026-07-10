const dotenv = require('dotenv');
const path = require('path');
const { Pool } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });

// Import the supabase client from the build file
const { supabase } = require('../../lib/supabase');

async function main() {
  try {
    const ticketRes = await pool.query('SELECT * FROM public.tickets LIMIT 1');
    if (ticketRes.rowCount === 0) {
      console.log('No tickets in DB');
      return;
    }
    const ticket = ticketRes.rows[0];
    console.log('Updating ticket:', ticket.id);

    // Call supabase client update directly, simulate local API handling
    // We mock the API request internally
    const url = 'http://localhost:3000/api/compat/supabase';
    const axios = require('axios');
    
    const payload = {
      table: 'tickets',
      action: 'update',
      payload: {
        title: ticket.title,
        description: ticket.description,
        status: 'Em Andamento',
        priority: ticket.priority,
        category: ticket.category,
        company_id: ticket.company_id,
        customer_id: ticket.customer_id,
        assignee_id: ticket.assignee_id,
        updated_at: new Date().toISOString()
      },
      filters: [
        { type: 'eq', col: 'id', val: ticket.id }
      ]
    };

    const res = await axios.post(url, payload);
    console.log('Compat API direct call result:', res.data);
  } catch (err) {
    if (err.response) {
      console.error('Error response from compat API:', err.response.status, err.response.data);
    } else {
      console.error('Error:', err.message);
    }
  } finally {
    await pool.end();
  }
}

main();
