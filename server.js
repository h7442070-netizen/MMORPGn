const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(__dirname + '/public'));

const W = 1600, H = 1200, SPEED = 220;
const players = {};

const clean = (s, n) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, n);

io.on('connection', (socket) => {
  socket.on('join', (d) => {
    players[socket.id] = {
      id: socket.id,
      name: clean(d && d.name, 12) || 'なまえなし',
      color: /^#[0-9a-f]{6}$/i.test(d && d.color) ? d.color : '#4aa3ff',
      x: W / 2 + Math.random() * 100 - 50,
      y: H / 2 + Math.random() * 100 - 50,
      dx: 0, dy: 0
    };
    socket.emit('init', { id: socket.id, W, H });
    io.emit('system', players[socket.id].name + ' が入ってきた');
  });

  socket.on('input', (d) => {
    const p = players[socket.id];
    if (!p || !d) return;
    let dx = Number(d.dx) || 0, dy = Number(d.dy) || 0;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    p.dx = dx; p.dy = dy;
  });

  socket.on('chat', (text) => {
    const p = players[socket.id];
    const t = clean(text, 100);
    if (!p || !t) return;
    io.emit('chat', { id: p.id, name: p.name, text: t });
  });

  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (p) io.emit('system', p.name + ' が出ていった');
    delete players[socket.id];
  });
});

let last = Date.now();
setInterval(() => {
  const now = Date.now(), dt = (now - last) / 1000;
  last = now;
  for (const p of Object.values(players)) {
    p.x = Math.max(16, Math.min(W - 16, p.x + p.dx * SPEED * dt));
    p.y = Math.max(16, Math.min(H - 16, p.y + p.dy * SPEED * dt));
  }
  io.emit('state', Object.values(players).map(p => ({
    id: p.id, name: p.name, color: p.color,
    x: Math.round(p.x), y: Math.round(p.y)
  })));
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('起動しました: http://localhost:' + PORT));
