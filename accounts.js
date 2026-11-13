'use strict';
// Built-in accounts, friends and leaderboard, stored in a JSON file (DATA_DIR/db.json). Used when Supabase is not configured.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'db.json');
let db = { users: {}, sessions: {} };   // users: id -> {id,username,salt,hash,data,mmr1..., friends:[ids]}; sessions: token -> id
try { db = Object.assign(db, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) {}
let dirty = false;
function flush() {
  if (!dirty) return; dirty = false;
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(db)); fs.renameSync(FILE + '.tmp', FILE); } catch (e) { console.error('save failed', e.message); }
}
setInterval(flush, 5000).unref();
process.on('SIGTERM', () => { flush(); process.exit(0); });
const mark = () => { dirty = true; };

const byName = n => Object.values(db.users).find(u => u.username.toLowerCase() === String(n).toLowerCase());
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const pub = u => ({ id: u.id, username: u.username, data: u.data, mmr1: u.mmr1, placed1: u.placed1, mmr2: u.mmr2, placed2: u.placed2 });
const NAME = /^[A-Za-z0-9_]{3,16}$/;

function userFor(req) {
  const t = String(req.get('authorization') || '').replace(/^Bearer /, '');
  const id = db.sessions[t];
  return id && db.users[id] ? { u: db.users[id], t } : null;
}
function newSession(u) { const t = crypto.randomBytes(24).toString('hex'); db.sessions[t] = u.id; mark(); return t; }

// used by the websocket layer
function verifyToken(name, tok) { const id = db.sessions[tok]; return !!(id && db.users[id] && db.users[id].username.toLowerCase() === String(name).toLowerCase()); }

const router = express.Router();
router.use(express.json({ limit: '300kb' }));
const auth = (req, res, next) => { const a = userFor(req); if (!a) return res.status(401).json({ error: 'not signed in' }); req.a = a; next(); };

router.post('/signup', (req, res) => {
  const { username, password } = req.body || {};
  if (!NAME.test(username || '')) return res.json({ error: 'Username: 3 to 16 letters, numbers or _.' });
  if (typeof password !== 'string' || password.length < 6 || password.length > 100) return res.json({ error: 'Password needs at least 6 characters.' });
  if (byName(username)) return res.json({ error: 'That username is taken.' });
  if (Object.keys(db.users).length > 20000) return res.json({ error: 'Server is full.' });
  const id = crypto.randomUUID(), salt = crypto.randomBytes(16).toString('hex');
  const u = db.users[id] = { id, username, salt, hash: hash(password, salt), data: {}, mmr1: 0, w1: 0, l1: 0, placed1: false, mmr2: 0, w2: 0, l2: 0, placed2: false, friends: [] };
  res.json({ id, token: newSession(u), username });
});
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = NAME.test(username || '') && typeof password === 'string' ? byName(username) : null;
  if (!u || hash(password, u.salt) !== u.hash) return res.json({ error: 'Wrong username or password.' });
  res.json({ id: u.id, token: newSession(u), username: u.username, data: u.data });
});
router.get('/session', auth, (req, res) => res.json({ id: req.a.u.id, username: req.a.u.username }));
router.post('/logout', auth, (req, res) => { delete db.sessions[req.a.t]; mark(); res.json({ ok: 1 }); });
router.get('/me', auth, (req, res) => res.json({ username: req.a.u.username, data: req.a.u.data }));
router.post('/save', auth, (req, res) => {
  const b = req.body || {}, u = req.a.u;
  if (b.data && typeof b.data === 'object') u.data = b.data;
  ['mmr1', 'w1', 'l1', 'mmr2', 'w2', 'l2'].forEach(k => { if (Number.isFinite(b[k])) u[k] = b[k] | 0; });
  ['placed1', 'placed2'].forEach(k => { if (typeof b[k] === 'boolean') u[k] = b[k]; });
  mark(); res.json({ ok: 1 });
});
router.get('/lb', (req, res) => {
  const m = req.query.mode === '2' ? 2 : 1;
  res.json(Object.values(db.users).filter(u => u['placed' + m]).sort((a, b) => b['mmr' + m] - a['mmr' + m]).slice(0, 25)
    .map(u => ({ username: u.username, ['mmr' + m]: u['mmr' + m], ['w' + m]: u['w' + m], ['l' + m]: u['l' + m] })));
});
router.get('/user', auth, (req, res) => { const u = byName(req.query.u || ''); res.json(u ? pub(u) : null); });
router.get('/friends', auth, (req, res) => {
  req.a.u.friends = req.a.u.friends.filter(id => db.users[id]);
  res.json(req.a.u.friends.map(id => ({ friend_id: id, profiles: pub(db.users[id]) })));
});
router.post('/friends/add', auth, (req, res) => {
  const f = db.users[req.body && req.body.id], me = req.a.u;
  if (!f || f.id === me.id) return res.json({ error: 1 });
  if (!me.friends.includes(f.id)) me.friends.push(f.id);
  mark(); res.json({ ok: 1 });
});
router.post('/friends/remove', auth, (req, res) => {
  const gone = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  req.a.u.friends = req.a.u.friends.filter(id => !gone.includes(id)); mark(); res.json({ ok: 1 });
});

module.exports = { router, verifyToken };
