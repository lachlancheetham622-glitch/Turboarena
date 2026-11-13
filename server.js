'use strict';
// Turbo Arena server: serves the game, and runs matchmaking, rooms, parties and the host/guest relay over WebSocket.
// The physics runs in the browser of the room's host; this server only pairs players and forwards messages.
const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const accounts = require('./accounts');

const PORT = process.env.PORT || 3000;
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_ANON_KEY || '';

const app = express();
app.disable('x-powered-by');
app.use('/api', accounts.router);
app.get('/health', (req, res) => res.type('text').send('ok'));
app.get('/config.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-store');
  res.send('window.TURBO_CONFIG=' + JSON.stringify({
    supabaseUrl: SB_URL, supabaseAnonKey: SB_KEY, local: !(SB_URL && SB_KEY), emailDomain: process.env.EMAIL_DOMAIN || 'turbo-arena.users'
  }) + ';');
});
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); }
}));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 32 * 1024 });

const users = new Map();    // lowercase username -> socket (signed-in players only)
const queues = new Map();   // "2:1" (team size : ranked) -> [entry]
const rooms = new Map();
let roomSeq = 1;

const STY = ['octane', 'dominus', 'hatch', 'wedge', 'breaker', 'hauler', 'sprinter'];
const BST = ['fire', 'ice', 'toxic', 'plasma', 'gold', 'rose', 'ocean', 'sunset', 'mint', 'rainbow'];
const BOOM = ['burst', 'confetti', 'shock', 'nova', 'fireworks', 'pillar', 'bubbles', 'ember', 'glitter'];
const BOTS = ['Apex', 'Nova', 'Drift', 'Rocket', 'Blaze', 'Viper', 'Turbo', 'Echo', 'Zephyr', 'Orbit', 'Havoc', 'Pixel', 'Comet', 'Rogue', 'Slick', 'Bolt'];
const col = (v, d) => (Number.isInteger(v) && v >= 0 && v <= 0xffffff ? v : d);
function cleanLook(l) {
  l = l && typeof l === 'object' ? l : {};
  return { style: STY.includes(l.style) ? l.style : 'octane', paint: col(l.paint, 0x6fb4ff), trim: col(l.trim, 0x0d1426), boost: BST.includes(l.boost) ? l.boost : 'fire', boom: BOOM.includes(l.boom) ? l.boom : 'burst' };
}
const num = (v, lo, hi) => { v = +v; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0; };
const send = (ws, o) => {
  if (ws.readyState !== 1 || ws.bufferedAmount > 1e6) return;
  try { ws.send(typeof o === 'string' ? o : JSON.stringify(o)); } catch (e) {}
};

// With SUPABASE_URL and SUPABASE_ANON_KEY set, a signed-in name is only accepted if the login token belongs to that account.
async function verify(name, tok) {
  if (!SB_URL || !SB_KEY) return accounts.verifyToken(name, tok);
  if (!tok || typeof tok !== 'string') return false;
  try {
    const r = await fetch(SB_URL + '/auth/v1/user', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + tok } });
    if (!r.ok) return false;
    const u = await r.json();
    return String(u.email || '').toLowerCase().split('@')[0] === name.toLowerCase();
  } catch (e) { return false; }
}
function register(ws, name) {
  const key = name.toLowerCase(), old = users.get(key);
  if (old && old !== ws) { send(old, { t: 'dup' }); old.close(); }
  ws.name = name; ws.key = key; users.set(key, ws);
  send(ws, { t: 'ready', name });
}

// ---- queue
function leaveQueue(ws) {
  const e = ws.q; if (!e) return;
  const q = queues.get(e.key);
  if (q) { const i = q.indexOf(e); if (i >= 0) q.splice(i, 1); }
  for (const w of e.members) { w.q = null; if (w !== ws) send(w, { t: 'pqc' }); }
}
function tryMatch(key) {
  const q = queues.get(key); if (!q || !q.length) return;
  const size = key[0] === '2' ? 2 : 1, ranked = +key.split(':')[1], teams = [], solos = [];
  for (const e of q) { if (e.members.length >= size) teams.push({ entries: [e], members: e.members }); else solos.push(e); }
  while (solos.length >= size) { const part = solos.splice(0, size); teams.push({ entries: part, members: part.flatMap(e => e.members) }); }
  if (teams.length < 2) return;
  let [a, b] = teams;
  [...a.entries, ...b.entries].forEach(e => { const i = q.indexOf(e); if (i >= 0) q.splice(i, 1); });
  if (Math.random() < 0.5) [a, b] = [b, a];
  createRoom(a.members, b.members, size === 2, ranked);
}

// ---- rooms
function createRoom(blue, orange, two, ranked) {
  const size = two ? 2 : 1, roster = [], used = new Set(), players = new Map();
  const uniq = base => { let n = base || 'Guest', k = 2; while (used.has(n.toLowerCase())) n = (base || 'Guest') + ' ' + k++; used.add(n.toLowerCase()); return n; };
  const botName = () => uniq(BOTS[Math.floor(Math.random() * BOTS.length)]);
  let slot = 0;
  const fill = (team, list) => {
    for (const w of list) { w.q = null; w.slot = slot; players.set(slot, w); roster.push({ slot, team, name: uniq(w.name), human: true, look: w.look }); slot++; }
    for (let i = list.length; i < size; i++) { roster.push({ slot, team, name: botName(), human: false }); slot++; }
  };
  fill('b', blue); fill('o', orange);
  const room = { id: roomSeq++, hostSlot: 0, players, roster };
  rooms.set(room.id, room);
  const map = Math.floor(Math.random() * 5);
  for (const [s, w] of players) { w.room = room; send(w, { t: 'match', room: room.id, slot: s, host: s === 0, two, ranked, map, roster }); }
}
function leaveRoom(ws) {
  const r = ws.room; if (!r) return;
  ws.room = null; r.players.delete(ws.slot);
  if (ws.slot === r.hostSlot) {
    for (const w of r.players.values()) { w.room = null; send(w, { t: 'abort' }); }
    r.players.clear(); rooms.delete(r.id);
  } else {
    const h = r.players.get(r.hostSlot);
    if (h) send(h, { t: 'left', slot: ws.slot });
    if (!r.players.size) rooms.delete(r.id);
  }
  ws.slot = -1;
}

// ---- parties (two players)
function partyUpdate(p) {
  const msg = { t: 'party', leader: p.leader.name, members: p.members.map(w => ({ name: w.name, look: w.look })) };
  p.members.forEach(w => send(w, msg));
}
function dissolve(p) {
  if (!p) return;
  leaveQueue(p.members[0]);
  for (const w of p.members) if (w.party === p) { w.party = null; send(w, { t: 'party', members: [], leader: '' }); }
}

function handle(ws, m, raw) {
  switch (m.t) {
    case 'hello': {
      ws.look = cleanLook(m.look);
      const name = typeof m.name === 'string' ? m.name.trim() : '';
      if (/^[A-Za-z0-9_]{3,16}$/.test(name) && ws.key !== name.toLowerCase()) {
        verify(name, m.tok).then(ok => { if (ok && ws.readyState === 1) register(ws, name); });
      } else if (!name && ws.key) {
        if (users.get(ws.key) === ws) users.delete(ws.key);
        ws.key = null; ws.name = '';
        if (ws.party) dissolve(ws.party);
      }
      if (ws.party) partyUpdate(ws.party);
      break;
    }
    case 'look': ws.look = cleanLook(m.look); if (ws.party) partyUpdate(ws.party); break;
    case 'p': send(ws, { t: 'pp', ts: m.ts }); break;

    case 'q': {
      if (ws.room) leaveRoom(ws);
      leaveQueue(ws);
      const ranked = m.ranked === 1 || m.ranked === 2 ? m.ranked : 0;
      const two = ranked ? ranked === 2 : !!m.two;
      let members = [ws];
      if (ws.party) {
        if (ws.party.leader !== ws || !m.party || !two) return;
        members = ws.party.members.slice();
        if (members.some(x => x.room || x.q)) return;
      }
      const key = (two ? 2 : 1) + ':' + ranked;
      const entry = { members, key };
      members.forEach(w => { w.q = entry; if (w !== ws) send(w, { t: 'pq', ranked, leader: ws.name }); });
      if (!queues.has(key)) queues.set(key, []);
      queues.get(key).push(entry);
      tryMatch(key);
      break;
    }
    case 'ql': leaveQueue(ws); break;
    case 'bm': {   // a party that waited without finding anyone: play as a team against bots
      const p = ws.party;
      if (!p || p.leader !== ws) return;
      leaveQueue(ws);
      if (p.members.some(x => x.room)) return;
      createRoom(p.members.slice(), [], true, m.ranked === 2 ? 2 : 0);
      break;
    }
    case 'leave': leaveRoom(ws); break;
    case 'in': {
      const r = ws.room; if (!r || ws.slot === r.hostSlot) return;
      const h = r.players.get(r.hostSlot);
      if (h) send(h, { t: 'in', slot: ws.slot, thr: num(m.thr, -1, 1), steer: num(m.steer, -1, 1), roll: num(m.roll, -1, 1), jump: m.jump ? 1 : 0, boost: m.boost ? 1 : 0, hb: m.hb ? 1 : 0, jr: m.jr | 0 });
      break;
    }
    case 's': {
      const r = ws.room; if (!r || ws.slot !== r.hostSlot) return;
      for (const [s, w] of r.players) if (s !== ws.slot) send(w, raw);
      break;
    }

    case 'pinv': {
      const target = users.get(String(m.to || '').toLowerCase());
      if (!ws.key) return send(ws, { t: 'pmsg', msg: 'Log in to party up.' });
      if (!target) return send(ws, { t: 'pmsg', msg: String(m.to || '').slice(0, 16) + ' is offline.' });
      if (target === ws) return;
      if (ws.party || target.party) return send(ws, { t: 'pmsg', msg: 'One of you is already in a party.' });
      if (ws.room || ws.q || target.room || target.q) return send(ws, { t: 'pmsg', msg: 'Busy right now, try again in a moment.' });
      target.invites.set(ws.key, Date.now());
      send(target, { t: 'pinv', from: ws.name });
      send(ws, { t: 'pmsg', msg: 'Invite sent to ' + target.name + '.', ok: true });
      break;
    }
    case 'pacc': {
      const inv = users.get(String(m.from || '').toLowerCase());
      const at = inv && ws.invites.get(inv.key);
      ws.invites.delete(String(m.from || '').toLowerCase());
      if (!inv || !at || Date.now() - at > 60000) return send(ws, { t: 'pmsg', msg: 'That invite expired.' });
      if (inv.party || ws.party || inv.room || ws.room || inv.q || ws.q) return send(ws, { t: 'pmsg', msg: 'Could not form the party right now.' });
      const p = { leader: inv, members: [inv, ws] };
      inv.party = ws.party = p;
      partyUpdate(p);
      break;
    }
    case 'pdec': {
      const inv = users.get(String(m.from || '').toLowerCase());
      ws.invites.delete(String(m.from || '').toLowerCase());
      if (inv) send(inv, { t: 'pmsg', msg: ws.name + ' declined your invite.' });
      break;
    }
    case 'pleave': dissolve(ws.party); break;
  }
}

function cleanup(ws) {
  if (ws.key && users.get(ws.key) === ws) users.delete(ws.key);
  const p = ws.party;
  leaveQueue(ws);
  leaveRoom(ws);
  if (p) { ws.party = null; dissolve(p); }
}

wss.on('connection', ws => {
  ws.alive = true; ws.name = ''; ws.key = null; ws.look = cleanLook(null);
  ws.party = null; ws.q = null; ws.room = null; ws.slot = -1; ws.invites = new Map(); ws.rate = { t: 0, n: 0 };
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const now = Date.now();
    if (now - ws.rate.t > 1000) { ws.rate.t = now; ws.rate.n = 0; }
    if (++ws.rate.n > 240) return;
    const raw = data.toString();
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    try { handle(ws, m, raw); } catch (e) { console.error('handler error', e); }
  });
  ws.on('close', () => cleanup(ws));
  ws.on('error', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; try { ws.ping(); } catch (e) {}
  }
}, 25000);

server.listen(PORT, () => console.log('Turbo Arena listening on ' + PORT));
