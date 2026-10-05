const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(__dirname + '/public'));

const W = 1600, H = 1200, SAFE = 150; // SAFE = 中央の安全地帯(PvPなし)
const RACES = {
  '人間': { atk: 0, spd: 0 }, 'エルフ': { atk: 0, spd: 20 },
  'ドワーフ': { atk: 3, spd: -20 }, '獣人': { atk: 2, spd: 30 }
};
const CHAINS = {
  '盗賊': ['盗賊', '怪盗', '魔王'],
  '戦士': ['戦士', '騎士', '勇者'],
  '魔法使い': ['魔法使い', '魔導士', '大魔導士']
};
const EVO_LV = [0, 5, 10];
const SKILLS = {
  power:  { name: 'パワー',   desc: '攻撃力 +3 / Lv', req: {} },
  speed:  { name: 'スピード', desc: '移動が速くなる(上限あり)', req: {} },
  wisdom: { name: 'かしこさ', desc: '経験値 +20% / Lv', req: {} },
  smash:  { name: '強打',     desc: '攻撃力 +5 / Lv', req: { power: 3 }, jobs: ['戦士'] },
  steal:  { name: 'ぬすむ',   desc: 'ゴールド +30% / Lv', req: { speed: 3 }, jobs: ['盗賊'] },
  range:  { name: '範囲拡大', desc: '攻撃のはんいが広がる(上限あり)', req: { wisdom: 3 }, jobs: ['魔法使い'] },
  master: { name: '極意',     desc: '攻撃力 +10 / Lv', req: { power: 5, speed: 5, wisdom: 5 } }
};
const KEYS = Object.keys(SKILLS);
const MAXSK = 9999;
const SHOP = [
  { id: 'wood',   name: '木の剣',     atk: 3,  price: 50 },
  { id: 'iron',   name: '鉄の剣',     atk: 8,  price: 200 },
  { id: 'steel',  name: '鋼の剣',     atk: 15, price: 600 },
  { id: 'staff',  name: '魔法の杖',   atk: 25, price: 1500 },
  { id: 'legend', name: '伝説の剣',   atk: 50, price: 5000 }
];
const TIERS = [{ price: 300, atk: 8 }, { price: 1000, atk: 20 }, { price: 3000, atk: 40 }];
const PIX = /^[0-9a-f]{256}$/;

const players = {};
const clean = (s, n) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, n);
const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));

const monsters = [];
for (let i = 0; i < 12; i++) monsters.push({ id: i, x: 100 + Math.random() * (W - 200), y: 100 + Math.random() * (H - 200), hp: 30, max: 30, back: 0 });

const eqWeapon = p => p.weapons.find(w => w.id === p.eq);
const atkOf = p => 8 + RACES[p.race].atk + p.stage * 5 + p.lv + p.sk.power * 3 + p.sk.smash * 5 + p.sk.master * 10 + (eqWeapon(p) ? eqWeapon(p).atk : 0);
const spdOf = p => Math.min(520, 220 + RACES[p.race].spd + p.sk.speed * 15);
const rangeOf = p => Math.min(250, 80 + p.sk.range * 10);
const mhpOf = p => 100 + p.lv * 10 + p.stage * 50;
const inSafe = p => Math.hypot(p.x - W / 2, p.y - H / 2) < SAFE;

function cleanWeapons(arr) {
  const out = [];
  if (!Array.isArray(arr)) return out;
  for (const w of arr.slice(0, 20)) {
    if (!w) continue;
    const s = SHOP.find(x => x.id === w.id);
    if (s) { if (!out.some(o => o.id === s.id)) out.push({ id: s.id, name: s.name, atk: s.atk, pix: null }); }
    else if (typeof w.id === 'string' && /^c\d{1,15}$/.test(w.id) && PIX.test(w.pix))
      out.push({ id: w.id, name: clean(w.name, 10) || 'じさく', atk: num(w.atk, 0, 40), pix: w.pix });
  }
  return out;
}

const snapshot = p => ({
  name: p.name, color: p.color, race: p.race, job: p.job, stage: p.stage,
  lv: p.lv, exp: p.exp, gold: p.gold, sp: p.sp, sk: p.sk, weapons: p.weapons, eq: p.eq
});
const sendSave = p => p.sock.emit('save', snapshot(p));
const artOf = p => { const w = eqWeapon(p); return w && w.pix ? { id: w.id, pix: w.pix } : null; };
const spawn = p => { p.x = W / 2 + Math.random() * 100 - 50; p.y = H / 2 + Math.random() * 100 - 50; };

io.on('connection', (socket) => {
  socket.on('join', (d) => {
    d = d || {};
    const s = d.save && typeof d.save === 'object' ? d.save : null;
    const src = s || d;
    const race = RACES[src.race] ? src.race : '人間';
    const job = CHAINS[src.job] ? src.job : '盗賊';
    const sk = {}; KEYS.forEach(k => { sk[k] = s && s.sk ? num(s.sk[k], 0, MAXSK) : 0; });
    const lv = s ? num(s.lv, 1, 99999) : 1;
    const weapons = s ? cleanWeapons(s.weapons) : [];
    const p = players[socket.id] = {
      id: socket.id, sock: socket, name: clean(src.name, 12) || 'なまえなし',
      color: /^#[0-9a-f]{6}$/i.test(src.color) ? src.color : '#4aa3ff',
      race, job, stage: s ? num(s.stage, 0, 2) : 0, lv,
      exp: s ? num(s.exp, 0, lv * 30) : 0, gold: s ? num(s.gold, 0, 1e9) : 0, sp: s ? num(s.sp, 0, 1e6) : 0, sk,
      weapons, eq: s && weapons.some(w => w.id === s.eq) ? s.eq : null,
      x: 0, y: 0, dx: 0, dy: 0, cd: 0, dead: 0, hp: 0
    };
    spawn(p); p.hp = mhpOf(p);
    socket.emit('init', { id: socket.id, W, H, SAFE, EVO_LV, chains: CHAINS, skills: SKILLS, SHOP, TIERS });
    for (const q of Object.values(players)) { const a = artOf(q); if (a) socket.emit('wart', a); }
    const a = artOf(p); if (a) io.emit('wart', a);
    sendSave(p);
    io.emit('system', p.name + ' が入ってきた');
  });

  socket.on('input', (d) => {
    const p = players[socket.id]; if (!p || !d) return;
    let dx = Number(d.dx) || 0, dy = Number(d.dy) || 0;
    const len = Math.hypot(dx, dy); if (len > 1) { dx /= len; dy /= len; }
    p.dx = dx; p.dy = dy;
  });

  socket.on('chat', (text) => {
    const p = players[socket.id], t = clean(text, 100);
    if (!p || !t) return;
    io.emit('chat', { id: p.id, name: p.name, text: t });
  });

  socket.on('attack', () => {
    const p = players[socket.id], now = Date.now();
    if (!p || p.dead || now < p.cd) return;
    p.cd = now + 400;
    const range = rangeOf(p);
    io.emit('atk', { id: p.id, r: range });
    let changed = false;
    for (const m of monsters) {
      if (m.hp <= 0 || Math.hypot(m.x - p.x, m.y - p.y) > range) continue;
      m.hp -= atkOf(p);
      if (m.hp <= 0) {
        changed = true; m.back = now + 5000;
        p.exp += Math.round(12 * (1 + p.sk.wisdom * 0.2));
        p.gold += Math.round(5 * (1 + p.sk.steal * 0.3));
        while (p.exp >= p.lv * 30) {
          p.exp -= p.lv * 30; p.lv++; p.sp++;
          io.emit('system', p.name + ' が Lv' + p.lv + ' になった');
        }
      }
    }
    // プレイヤー同士(安全地帯の中では当たらない)
    if (!inSafe(p)) for (const q of Object.values(players)) {
      if (q === p || q.dead || inSafe(q) || Math.hypot(q.x - p.x, q.y - p.y) > range) continue;
      q.hp -= atkOf(p);
      if (q.hp <= 0) {
        q.hp = 0; q.dead = now + 3000; q.dx = q.dy = 0;
        const loot = Math.floor(q.gold * 0.1);
        q.gold -= loot; p.gold += loot; changed = true;
        sendSave(q);
        io.emit('system', p.name + ' が ' + q.name + ' をたおした!(' + loot + 'G うばった)');
      }
    }
    if (changed) sendSave(p);
  });

  socket.on('skill', (key) => {
    const p = players[socket.id], def = SKILLS[key];
    if (!p || !def || p.sp < 1 || p.sk[key] >= MAXSK) return;
    if (def.jobs && !def.jobs.includes(p.job)) return;
    for (const r in def.req) if (p.sk[r] < def.req[r]) return;
    p.sk[key]++; p.sp--; sendSave(p);
  });

  socket.on('evolve', () => {
    const p = players[socket.id];
    if (!p || p.stage >= 2 || p.lv < EVO_LV[p.stage + 1]) return;
    p.stage++; sendSave(p);
    io.emit('system', p.name + ' が「' + CHAINS[p.job][p.stage] + '」に進化した!');
  });

  socket.on('buy', (id) => {
    const p = players[socket.id], s = SHOP.find(x => x.id === id);
    if (!p || !s || p.gold < s.price || p.weapons.length >= 20 || p.weapons.some(w => w.id === s.id)) return;
    p.gold -= s.price; p.weapons.push({ id: s.id, name: s.name, atk: s.atk, pix: null }); sendSave(p);
  });

  socket.on('craft', (d) => {
    const p = players[socket.id]; if (!p || !d || p.weapons.length >= 20) return;
    const t = TIERS[num(d.tier, 0, TIERS.length - 1)];
    if (typeof d.pix !== 'string' || !PIX.test(d.pix) || d.pix === '0'.repeat(256) || p.gold < t.price) return;
    p.gold -= t.price;
    p.weapons.push({ id: 'c' + Date.now(), name: clean(d.name, 10) || 'じさく', atk: t.atk, pix: d.pix });
    sendSave(p);
  });

  socket.on('equip', (id) => {
    const p = players[socket.id]; if (!p) return;
    if (id === null) p.eq = null;
    else { const w = p.weapons.find(x => x.id === id); if (!w) return; p.eq = w.id; if (w.pix) io.emit('wart', { id: w.id, pix: w.pix }); }
    sendSave(p);
  });

  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (p) io.emit('system', p.name + ' が出ていった');
    delete players[socket.id];
  });
});

let last = Date.now();
setInterval(() => {
  const now = Date.now(), dt = (now - last) / 1000; last = now;
  for (const p of Object.values(players)) {
    if (p.dead) { if (now >= p.dead) { p.dead = 0; spawn(p); p.hp = mhpOf(p); } continue; }
    const s = spdOf(p);
    p.x = Math.max(16, Math.min(W - 16, p.x + p.dx * s * dt));
    p.y = Math.max(16, Math.min(H - 16, p.y + p.dy * s * dt));
    p.hp = Math.min(mhpOf(p), p.hp + 3 * dt);
  }
  for (const m of monsters) if (m.hp <= 0 && now >= m.back) m.hp = m.max;
  io.emit('state', {
    players: Object.values(players).map(p => ({
      id: p.id, name: p.name, color: p.color, race: p.race, job: p.job, stage: p.stage,
      lv: p.lv, exp: p.exp, gold: p.gold, sp: p.sp, sk: p.sk, x: Math.round(p.x), y: Math.round(p.y),
      hp: Math.round(p.hp), mhp: mhpOf(p), dead: !!p.dead, wid: p.eq
    })),
    monsters: monsters.map(m => ({ id: m.id, x: Math.round(m.x), y: Math.round(m.y), hp: m.hp, max: m.max }))
  });
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('起動しました: http://localhost:' + PORT));
