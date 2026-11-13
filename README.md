# Turbo Arena

3D car soccer in the browser, with online multiplayer (1v1, 2v2, ranked, parties).

## Deploy on Render

1. Push this folder to a GitHub repo.
2. On Render: **New > Blueprint** (reads `render.yaml`), or **New > Web Service** with build `npm install` and start `npm start`.
3. Open the Render URL. Share it with a friend: both click **1v1 kick off** and you get matched.

Free Render services sleep after ~15 minutes idle; the first visit after that takes about a minute to wake up.

## Accounts, friends, leaderboard

These work out of the box: the server stores accounts in `data/db.json` (set `DATA_DIR` to change the folder).

**Render's free plan wipes the disk when the service sleeps or redeploys, so accounts reset.** To keep them, either:
- use a paid Render plan and add a Disk mounted at `/data`, with env var `DATA_DIR=/data`, or
- use Supabase (free): run `supabase.sql` in its SQL editor, turn **Confirm email** off under Auth > Providers > Email, and set `SUPABASE_URL` and `SUPABASE_ANON_KEY` on Render. When these are set, Supabase is used instead.

## How multiplayer works

- Matchmaking waits up to 15 s for other players, then starts against bots.
- The first player in a room is the **host**: their browser runs the whole simulation and streams it (30/s) through the server. Other players send inputs and predict their own car. Keep the host's tab in the foreground.
- If a guest leaves, a bot takes over their car. If the host leaves, the match ends for everyone.
- Parties: add a friend in **Friends**, press **Invite**. The leader starts 2v2 / ranked 2v2 and you both join the same team.

## Run locally

```
npm install
npm start     # http://localhost:3000
```
