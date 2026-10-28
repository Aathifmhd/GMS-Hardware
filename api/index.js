// Vercel serverless entry point: every /api/* request is handled by the Express app.
// If the app cannot even load, answer with the reason instead of Vercel's generic crash page.
let handler;
try {
  handler = require('../src/app');
} catch (e) {
  console.error(e);
  handler = (req, res) => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: `App failed to start: ${e.message}` }));
  };
}
module.exports = handler;
