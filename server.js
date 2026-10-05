const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(__dirname + '/public'));

const W = 1600, H = 1200;
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

const players = {};
const clean = (s, n) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, n);
const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));

const monsters = [];
for (let i = 0; i < 12; i++) monsters.push({ id: i, x: 100 + Math.random() * (W - 200), y: 100 + Math.random() * (H - 200), hp: 30, max: 30, back: 0 });

const atkOf = p => 8 + RACES[p.race].atk + p.stage * 5 + p.lv + p.sk.power * 3 + p.sk.smash * 5 + p.sk.master * 10;
const spdOf = p => Math.min(520, 220 + RACES[p.race].spd + p.sk.speed * 15);
const rangeOf = p => Math.min(250, 80 + p.sk.range * 10);

const snapshot = p => ({
  name: p.name, color: p.color, race: p.race, job: p.job, stage: p.stage,
  lv: p.lv, exp: p.exp, gold: p.gold, sp: p.sp, sk: p.sk
});
const sendSave = p => p.sock.emit('save', snapshot(p));

io.on('connection', (socket) => {
  socket.on('join', (d) => {
    d = d || {};
    const s = d.save && typeof d.save === 'object' ? d.save : null;
    const src = s || d;
    const race = RACES[src.race] ? src.race : '人間';
    const job = CHAINS[src.job] ? src.job : '盗賊';
    const sk = {}; KEYS.forEach(k => { sk[k] = s && s.sk ? num(s.sk[k], 0, MAXSK) : 0; });
    const lv = s ? num(s.lv, 1, 99999) : 1;
    players[socket.id] = {
      id: socket.id, sock: socket, name: clean(src.name, 12) || 'なまえなし',
      color: /^#[0-9a-f]{6}$/i.test(src.color) ? src.color : '#4aa3ff',
      race, job, stage: s ? num(s.stage, 0, 2) : 0, lv,
      exp: s ? num(s.exp, 0, lv * 30) : 0, gold: s ? num(s.gold, 0, 1e9) : 0, sp: s ? num(s.sp, 0, 1e6) : 0, sk,
      x: W / 2 + Math.random() * 100 - 50, y: H / 2 + Math.random() * 100 - 50, dx: 0, dy: 0, cd: 0
    };
    socket.emit('init', { id: socket.id, W, H, EVO_LV, chains: CHAINS, skills: SKILLS });
    sendSave(players[socket.id]);
    io.emit('system', players[socket.id].name + ' が入ってきた');
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
    if (!p || now < p.cd) return;
    p.cd = now + 400;
    io.emit('atk', { id: p.id, r: rangeOf(p) });
    let killed = false;
    for (const m of monsters) {
      if (m.hp <= 0 || Math.hypot(m.x - p.x, m.y - p.y) > rangeOf(p)) continue;
      m.hp -= atkOf(p);
      if (m.hp <= 0) {
        killed = true; m.back = now + 5000;
        p.exp += Math.round(12 * (1 + p.sk.wisdom * 0.2));
        p.gold += Math.round(5 * (1 + p.sk.steal * 0.3));
        while (p.exp >= p.lv * 30) {
          p.exp -= p.lv * 30; p.lv++; p.sp++;
          io.emit('system', p.name + ' が Lv' + p.lv + ' になった');
        }
      }
    }
    if (killed) sendSave(p);
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
    const s = spdOf(p);
    p.x = Math.max(16, Math.min(W - 16, p.x + p.dx * s * dt));
    p.y = Math.max(16, Math.min(H - 16, p.y + p.dy * s * dt));
  }
  for (const m of monsters) if (m.hp <= 0 && now >= m.back) m.hp = m.max;
  io.emit('state', {
    players: Object.values(players).map(p => ({
      id: p.id, name: p.name, color: p.color, race: p.race, job: p.job, stage: p.stage,
      lv: p.lv, exp: p.exp, gold: p.gold, sp: p.sp, sk: p.sk, x: Math.round(p.x), y: Math.round(p.y)
    })),
    monsters: monsters.map(m => ({ id: m.id, x: Math.round(m.x), y: Math.round(m.y), hp: m.hp, max: m.max }))
  });
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('起動しました: http://localhost:' + PORT));
