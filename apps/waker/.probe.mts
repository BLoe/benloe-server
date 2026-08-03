import express from 'express';
import { seasonRouter } from '/srv/benloe/apps/waker/src/server/routes/season.js';
import { signSession } from '/srv/benloe/apps/waker/src/server/session.js';

process.env.JWT_SECRET = 'probe-secret';
const app = express();
app.use(seasonRouter);
const server = app.listen(3999, async () => {
  const token = signSession(
    { userId: '810215947997663232', username: 'BenLoe', iat: Math.floor(Date.now() / 1000) },
    'probe-secret'
  );
  const t0 = Date.now();
  const res = await fetch('http://127.0.0.1:3999/api/league/1312065694577209344/season', {
    headers: { cookie: `sleeper_desk=${encodeURIComponent(token)}` },
  });
  const cold = Date.now() - t0;
  const body: any = await res.json();
  const t1 = Date.now();
  await fetch('http://127.0.0.1:3999/api/league/1312065694577209344/season', {
    headers: { cookie: `sleeper_desk=${encodeURIComponent(token)}` },
  });
  const warm = Date.now() - t1;
  console.log('status', res.status, 'cold', cold + 'ms', 'warm', warm + 'ms');
  console.log(
    JSON.stringify(
      {
        season: body.season,
        preseason: body.preseason,
        weeksPlayed: body.weeksPlayed,
        pws: body.playoffWeekStart,
        pt: body.playoffTeams,
        runs: body.runs,
        myRosterId: body.myRosterId,
        remainingGames: body.remainingGames,
        missingWeeks: body.missingWeeks,
        scheduleLen: body.schedule?.length,
        oddsSum: body.teams?.reduce((s: number, t: any) => s + (t.odds?.playoffs ?? 0), 0),
        firstSum: body.teams?.reduce((s: number, t: any) => s + (t.odds?.firstSeed ?? 0), 0),
        lastSum: body.teams?.reduce((s: number, t: any) => s + (t.odds?.lastPlace ?? 0), 0),
        teams: body.teams?.map((t: any) => ({
          n: t.teamName,
          wp: +t.weeklyPoints.toFixed(1),
          up: t.unprojected,
          es: t.emptySlots,
          po: t.odds && +t.odds.playoffs.toFixed(3),
          ew: t.odds && +t.odds.expectedWins.toFixed(2),
          el: t.odds && +t.odds.expectedLosses.toFixed(2),
        })),
        leverage: body.leverage?.map((g: any) => ({
          w: g.week,
          o: g.opponentName,
          lo: +g.ifLost.toFixed(3),
          wi: +g.ifWon.toFixed(3),
          sw: +g.swing.toFixed(3),
        })),
      },
      null,
      1
    )
  );
  server.close();
});
