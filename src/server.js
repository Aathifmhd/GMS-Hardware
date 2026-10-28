// Run the credit manager on this computer: `npm start` → http://localhost:3000
// (On Vercel, api/index.js serves the same app and Vercel Cron runs the daily job.)
const app = require('./app');
const { ready } = require('./db');
const M = require('./messaging');

async function tick() {
  try {
    const r = await M.runDailyAutomation();
    if (r.interest.length || r.reminders || r.overdue) console.log(`[auto] interest ${r.interest.length}, reminders ${r.reminders}, overdue notices ${r.overdue}`);
  } catch (e) { console.error('[auto] failed', e.message); }
}

const PORT = Number(process.env.PORT) || 3000;
ready()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n  GMS Hardware Credit Manager running → http://localhost:${PORT}\n`);
      tick();
      setInterval(tick, 60 * 60 * 1000);
    });
  })
  .catch((e) => {
    console.error('Could not connect to the database:', e.message);
    process.exit(1);
  });
