const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function createRoom(roomId) {
  return {
    id: roomId,
    players: [],
    scores: [301, 301],
    currentPlayer: 0,
    dartsThrown: 0,
    allDarts: [[], []],
    gameOver: false,
    winner: null
  };
}

function getRoomForSocket(socketId) {
  for (const roomId in rooms) {
    if (rooms[roomId].players.some(p => p.id === socketId)) return rooms[roomId];
  }
  return null;
}

// sat's original score logic, ported to server
const SEGS = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];

function calcScore(hPct, vPct) {
  const boardX = (hPct / 100) * 500;
  const boardY = (vPct / 100) * 500;
  const dx = boardX - 250, dy = boardY - 250;
  const distance = Math.sqrt(dx*dx + dy*dy);

  let angle = Math.atan2(dy, dx) * 180 / Math.PI;
  angle += 90; if (angle < 0) angle += 360;
  const segment = Math.floor(angle / 18) % 20;
  const base = SEGS[segment];

  if (distance < 15)  return 50;
  if (distance < 30)  return 25;
  if (distance < 120) return base;
  if (distance < 140) return base * 3;
  if (distance < 210) return base;
  if (distance < 230) return base * 2;
  return 0;
}

function getPublicState(room) {
  return {
    scores: room.scores,
    currentPlayer: room.currentPlayer,
    dartsThrown: room.dartsThrown,
    players: room.players.map(p => ({ name: p.name, index: p.index })),
    allDarts: room.allDarts,
    gameOver: room.gameOver,
    winner: room.winner
  };
}

io.on('connection', (socket) => {
  socket.on('join_room', ({ roomId, playerName }) => {
    let room = rooms[roomId];
    if (!room) { room = createRoom(roomId); rooms[roomId] = room; }
    if (room.players.length >= 2) { socket.emit('room_full'); return; }

    const playerIndex = room.players.length;
    room.players.push({ id: socket.id, name: playerName || `Player ${playerIndex+1}`, index: playerIndex });
    socket.join(roomId);

    socket.emit('joined', { playerIndex, roomId, gameState: getPublicState(room) });

    if (room.players.length === 2) {
      io.to(roomId).emit('game_start', {
        players: room.players.map(p => ({ name: p.name, index: p.index })),
        gameState: getPublicState(room)
      });
    } else {
      socket.emit('waiting_for_opponent');
    }
  });

  socket.on('throw_dart', ({ hPct, vPct }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.gameOver) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.index !== room.currentPlayer) return;
    if (room.dartsThrown >= 3) return;

    const score = calcScore(hPct, vPct);
    const dart = { hPct, vPct, score, player: player.index };

    room.allDarts[player.index].push(dart);
    room.dartsThrown++;

    const tentative = room.scores[player.index] - score;
    const bust = tentative < 0;
    if (!bust) room.scores[player.index] = tentative;

    // win check
    if (room.scores[player.index] === 0) {
      room.gameOver = true;
      room.winner = player.index;
      io.to(room.id).emit('dart_thrown', { dart, bust: false, gameState: getPublicState(room) });
      setTimeout(() => {
        io.to(room.id).emit('game_over', {
          winner: player.index, winnerName: player.name, scores: room.scores
        });
      }, 2000);
      return;
    }

    io.to(room.id).emit('dart_thrown', { dart, bust, gameState: getPublicState(room) });

    // after 3 darts or bust, next turn
    if (room.dartsThrown >= 3 || bust) {
      setTimeout(() => {
        room.currentPlayer = room.currentPlayer === 0 ? 1 : 0;
        room.dartsThrown = 0;
        io.to(room.id).emit('next_turn', { currentPlayer: room.currentPlayer, gameState: getPublicState(room) });
      }, bust ? 2200 : 1800);
    }
  });

  socket.on('disconnect', () => {
    const room = getRoomForSocket(socket.id);
    if (room) io.to(room.id).emit('opponent_disconnected');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Darts on port ${PORT}`));
