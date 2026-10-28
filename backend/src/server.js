// Run the API on this computer: `npm start` → http://localhost:4000/api. `npm start` in the project
// folder also starts the web app → http://localhost:3000, which forwards /api calls here.
// (On Vercel the "backend" service runs src/app.js directly and Vercel Cron runs the daily job.)
const app = require('./app');
const { ready } = require('./db');
const M = require('./messaging');

async function tick() {
  try {
    const r = await M.runDailyAutomation();
    if (r.interest.length || r.reminders || r.overdue) console.log(`[auto] interest ${r.interest.length}, reminders ${r.reminders}, overdue notices ${r.overdue}`);
  } catch (e) { console.error('[auto] failed', e.message); }
}

// API_PORT rather than PORT: tools that start the web app on port 3000 often set PORT for it
const PORT = Number(process.env.API_PORT) || 4000;
ready()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n  GMS Hardware API running → http://localhost:${PORT}/api\n`);
      tick();
      setInterval(tick, 60 * 60 * 1000);
    });
  })
  .catch((e) => {
    console.error('Could not connect to the database:', e.message);
    process.exit(1);
  });
