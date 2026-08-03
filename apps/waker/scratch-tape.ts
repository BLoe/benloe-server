import express from 'express';
import { tapeRouter } from './src/server/routes/tape.js';
import { signSession } from './src/server/session.js';
const app = express();
app.use(tapeRouter);
const port = 3999;
app.listen(port, async () => {
  const secret = process.env.JWT_SECRET || 'x';
  const tok = signSession({ userId: process.env.WUID!, username: 'ben', iat: Math.floor(Date.now()/1000) }, secret);
  const r = await fetch(`http://127.0.0.1:${port}/api/league/L/tape`, { headers: { cookie: `sleeper_desk=${tok}` } });
  const j: any = await r.json();
  console.log('status', r.status);
  console.log(JSON.stringify({ ...j, rows: undefined }, null, 1));
  console.log('rows', j.rows?.length);
  for (const row of (j.rows ?? []).slice(0, 6)) {
    console.log(row.position, row.name.padEnd(22), 'ppg', row.divergence.pointsPerGame, 'gap', row.divergence.pointsGap, row.divergence.verdict, 'g', row.divergence.games, 'weeks', row.weeks.length, 'snaps', row.weeks.filter((w:any)=>w.snap!=null).length, 'trend', row.trend, 'val', row.value, 'proj', row.projected, row.rostered ? row.teamName : 'FA');
  }
  const noSnap = (j.rows ?? []).filter((r:any)=>r.weeks.every((w:any)=>w.snap==null));
  console.log('rows with zero snap weeks:', noSnap.length, noSnap.slice(0,5).map((r:any)=>r.name));
  const posCounts: any = {};
  for (const r of j.rows ?? []) posCounts[r.position] = (posCounts[r.position]||0)+1;
  console.log('positions', posCounts);
  const verd: any = {};
  for (const r of j.rows ?? []) verd[r.divergence.verdict] = (verd[r.divergence.verdict]||0)+1;
  console.log('verdicts', verd);
  console.log('weeks range', Math.min(...(j.rows??[]).flatMap((r:any)=>r.weeks.map((w:any)=>w.week))), Math.max(...(j.rows??[]).flatMap((r:any)=>r.weeks.map((w:any)=>w.week))));
  console.log('payload KB', Math.round(JSON.stringify(j).length/1024));
  process.exit(0);
});
