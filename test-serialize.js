const { JSDOM } = require("jsdom");
const { window } = new JSDOM("<!DOCTYPE html><html><body><div id='test'></div></body></html>");

const obj = { div: window.document.getElementById('test') };

const cache = new Set();
try {
  JSON.stringify(obj, (k, value) => {
    if (typeof value === 'object' && value !== null) {
      if (cache.has(value)) {
        return '[Circular]';
      }
      cache.add(value);
    }
    return value;
  });
  console.log("SUCCESS");
} catch(e) {
  console.log("ERROR:", e.message);
}
