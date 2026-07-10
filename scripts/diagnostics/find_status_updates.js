const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../../components/ticket-detail-modal.tsx');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log('--- Occurrences of "/api/tickets" or "status" ---');
lines.forEach((line, idx) => {
  if (line.includes('/api/tickets') || line.includes('status:') || line.includes('setStatus') || line.includes('status =') || line.includes('status=')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
