const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(__dirname + '/public'));

const W = 1600, H = 1200;
const RACES = {
  '人間':   { atk: 0, spd: 0 },
  'エルフ':   { atk: 0, spd: 20 },
  'ドワーフ': { atk: 3, spd: -20 },
  '獣人':   { atk: 2, spd: 30 }
};
const CHAINS = {
  '盗賊': ['盗賊', '怪盗', '魔王'],
  '戦士': ['戦士', '騎士', '勇者'],
  '魔法使い': ['魔法使い', '魔導士', '大魔導士']
};
const EVO_LV = [0, 5, 10];
const SKILLS = ['power', 'speed', 'wisdom'];
const players = {};
const clean = (s, n) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, n);

const monsters = [];
for (let i = 0; i < 12; i++) monsters.push({ id: i, x: 100 + Math.random() * (W - 200), y: 100 + Math.random() * (H - 200), hp: 30, max: 30, back: 0 });

const atkOf = p => 8 + RACES[p.race].atk + p.stage * 5 + p.sk.power * 3 + p.lv;
const spdOf = p => 220 + RACES[p.race].spd + p.sk.speed * 15;

io.on('connection', (socket) => {
  socket.on('join', (d) => {
    d = d || {};
    const race = RACES[d.race] ? d.race : '人間';
    const job = CHAINS[d.job] ? d.job : '盗賊';
    players[socket.id] = {
      id: socket.id, name: clean(d.name, 12) || 'なまえなし',
      color: /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : '#4aa3ff',
      race, job, stage: 0, lv: 1, exp: 0, gold: 0, sp: 0,
      sk: { power: 0, speed: 0, wisdom: 0 },
      x: W / 2 + Math.random() * 100 - 50, y: H / 2 + Math.random() * 100 - 50,
      dx: 0, dy: 0, cd: 0
    };
    socket.emit('init', { id: socket.id, W, H, EVO_LV, chains: CHAINS });
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
    io.emit('atk', { id: p.id });
    for (const m of monsters) {
      if (m.hp <= 0 || Math.hypot(m.x - p.x, m.y - p.y) > 80) continue;
      m.hp -= atkOf(p);
      if (m.hp <= 0) {
        m.back = now + 5000;
        p.exp += Math.round(12 * (1 + p.sk.wisdom * 0.2));
        p.gold += 5;
        while (p.exp >= p.lv * 30) {
          p.exp -= p.lv * 30; p.lv++; p.sp++;
          io.emit('system', p.name + ' が Lv' + p.lv + ' になった');
        }
      }
    }
  });

  socket.on('skill', (key) => {
    const p = players[socket.id];
    if (!p || !SKILLS.includes(key) || p.sp < 1 || p.sk[key] >= 5) return;
    p.sk[key]++; p.sp--;
  });

  socket.on('evolve', () => {
    const p = players[socket.id];
    if (!p || p.stage >= 2 || p.lv < EVO_LV[p.stage + 1]) return;
    p.stage++;
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
      lv: p.lv, exp: p.exp, gold: p.gold, sp: p.sp, sk: p.sk,
      x: Math.round(p.x), y: Math.round(p.y)
    })),
    monsters: monsters.map(m => ({ id: m.id, x: Math.round(m.x), y: Math.round(m.y), hp: m.hp, max: m.max }))
  });
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('起動しました: http://localhost:' + PORT));
