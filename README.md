# Turbo Arena

A static browser game (`index.html`) with optional online accounts via Supabase. Host it on Netlify from GitHub.

## Setup
1. Create a free project at supabase.com.
2. SQL Editor: paste and run `supabase/schema.sql`.
3. Authentication -> Providers -> Email: turn **off** "Confirm email" (usernames are mapped to fake emails, so no confirmation mail can arrive).
4. Project Settings -> API: copy the Project URL and the `anon` public key into `config.js`.
5. Push this folder to a GitHub repo.
6. Netlify -> Add new site -> Import from Git -> pick the repo. Leave the build command empty, publish directory `.`.

## What works online
- Accounts (username + password) and cloud saves of your look, settings and rank
- A shared leaderboard
- A friends list by username

## Not done yet
- Live matches and real-time parties. These need a WebSocket server, which Netlify cannot host (use Render, Railway, Fly.io or a realtime service). Queues still end in a bot, and party members are AI cars.
- Cheat-proof ranked. Ranks are reported by the browser, so a determined player could fake one until a server decides results.
- Password reset.
