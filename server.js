const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(__dirname + '/public'));

const W = 1600, H = 1200, SAFE = 150; // SAFE = 中央の安全地帯(PvPなし)
const RACES = {
  '人間': { atk: 0, spd: 0, hp: 0 }, 'エルフ': { atk: 0, spd: 20, hp: 0 },
  'ドワーフ': { atk: 3, spd: -20, hp: 20 }, '獣人': { atk: 2, spd: 30, hp: 0 },
  'スライム': { atk: 0, spd: 0, hp: 60 }, 'ゴブリン': { atk: 2, spd: 10, hp: 10 }, 'ドラゴン': { atk: 6, spd: -10, hp: 30 },
  'キマイラ': { atk: 10, spd: 20, hp: 100 }
};
const MONSTER_RACES = ['スライム', 'ゴブリン', 'ドラゴン'];
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
  master: { name: '極意',     desc: '攻撃力 +10 / Lv', req: { power: 5, speed: 5, wisdom: 5 } },
  kpower: { name: 'キマイラの力', desc: '攻撃力 +15 / Lv', req: { power: 3 }, races: ['キマイラ'] },
  regen:  { name: '再生',         desc: 'HPの回復が速くなる(+5/秒 / Lv)', req: { wisdom: 3 }, races: ['キマイラ'] },
  devour: { name: '捕食',         desc: '魔物をたおすとHP回復と経験値アップ', req: { kpower: 3 }, races: ['キマイラ'] }
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

const MTYPES = {
  slime:  { name: 'スライム', hp: 30, spd: 60,  dmg: 6,  exp: 12, gold: 5 },
  goblin: { name: 'ゴブリン', hp: 70, spd: 90,  dmg: 12, exp: 28, gold: 14 },
  wolf:   { name: 'オオカミ', hp: 55, spd: 150, dmg: 10, exp: 22, gold: 10 }
};
const MKEYS = Object.keys(MTYPES);
const monsters = [];
for (let i = 0; i < 14; i++) {
  const type = MKEYS[i % 3], t = MTYPES[type];
  const x = 100 + Math.random() * (W - 200), y = 100 + Math.random() * (H - 200);
  monsters.push({ id: i, type, x, y, hx: x, hy: y, hp: t.hp, max: t.hp, back: 0, cd: 0, wx: x, wy: y, wt: 0 });
}

const eqWeapon = p => p.weapons.find(w => w.id === p.eq);
const atkOf = p => 8 + RACES[p.race].atk + p.stage * 5 + p.lv + p.sk.power * 3 + p.sk.smash * 5 + p.sk.master * 10 + p.sk.kpower * 15 + (eqWeapon(p) ? eqWeapon(p).atk : 0);
const spdOf = p => Math.min(520, 220 + RACES[p.race].spd + p.sk.speed * 15);
const rangeOf = p => Math.min(250, 80 + p.sk.range * 10);
const mhpOf = p => 100 + p.lv * 10 + p.stage * 50 + (RACES[p.race].hp || 0);
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
    let race = RACES[src.race] ? src.race : '人間';
    let born = false;
    if (!s) {
      if (race === 'キマイラ') race = '人間';
      else if (MONSTER_RACES.includes(race) && Math.random() < 0.1) { race = 'キマイラ'; born = true; }
    }
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
    if (born) io.emit('system', p.name + ' はキマイラに生まれた!');
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
        const mt = MTYPES[m.type];
        p.exp += Math.round(mt.exp * (1 + p.sk.wisdom * 0.2 + p.sk.devour * 0.1));
        p.gold += Math.round(mt.gold * (1 + p.sk.steal * 0.3));
        if (p.sk.devour) p.hp = Math.min(mhpOf(p), p.hp + p.sk.devour * 10);
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
    if (def.races && !def.races.includes(p.race)) return;
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
    p.hp = Math.min(mhpOf(p), p.hp + (3 + p.sk.regen * 5) * dt);
  }
  for (const m of monsters) {
    const t = MTYPES[m.type];
    if (m.hp <= 0) { if (now >= m.back) { m.hp = m.max; m.x = m.hx; m.y = m.hy; } continue; }
    let tgt = null, bd = 260;
    for (const q of Object.values(players)) {
      if (q.dead || inSafe(q)) continue;
      const dd = Math.hypot(q.x - m.x, q.y - m.y);
      if (dd < bd) { bd = dd; tgt = q; }
    }
    let tx, ty, sp = t.spd;
    if (tgt) { tx = tgt.x; ty = tgt.y; }
    else {
      if (now > m.wt) { m.wx = m.hx + Math.random() * 160 - 80; m.wy = m.hy + Math.random() * 160 - 80; m.wt = now + 2000 + Math.random() * 2000; }
      tx = m.wx; ty = m.wy; sp *= 0.4;
    }
    const d = Math.hypot(tx - m.x, ty - m.y);
    if (d > (tgt ? 26 : 4)) { m.x += (tx - m.x) / d * sp * dt; m.y += (ty - m.y) / d * sp * dt; }
    const cd = Math.hypot(m.x - W / 2, m.y - H / 2);
    if (cd > 0.1 && cd < SAFE + 20) { m.x = W / 2 + (m.x - W / 2) / cd * (SAFE + 20); m.y = H / 2 + (m.y - H / 2) / cd * (SAFE + 20); }
    if (tgt && d <= 34 && now >= m.cd) {
      m.cd = now + 1000;
      tgt.hp -= t.dmg;
      io.emit('matk', { id: m.id });
      if (tgt.hp <= 0) { tgt.hp = 0; tgt.dead = now + 3000; tgt.dx = tgt.dy = 0; io.emit('system', tgt.name + ' が ' + t.name + ' にたおされた…'); }
    }
  }
  io.emit('state', {
    players: Object.values(players).map(p => ({
      id: p.id, name: p.name, color: p.color, race: p.race, job: p.job, stage: p.stage,
      lv: p.lv, exp: p.exp, gold: p.gold, sp: p.sp, sk: p.sk, x: Math.round(p.x), y: Math.round(p.y),
      hp: Math.round(p.hp), mhp: mhpOf(p), dead: !!p.dead, wid: p.eq
    })),
    monsters: monsters.map(m => ({ id: m.id, type: m.type, x: Math.round(m.x), y: Math.round(m.y), hp: m.hp, max: m.max }))
  });
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('起動しました: http://localhost:' + PORT));
