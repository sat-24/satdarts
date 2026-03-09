const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// Room management
const rooms = {};

function createRoom(roomId) {
  return {
    id: roomId,
    players: [],
    scores: [301, 301],
    currentPlayer: 0,
    dartsThrown: 0, // 0,1,2 per turn (3 darts per turn)
    turnDarts: [],  // darts thrown this turn [{x,y,score}]
    allDarts: [[], []], // all darts per player
    gameOver: false,
    winner: null
  };
}

function getRoomForSocket(socketId) {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.players.some(p => p.id === socketId)) return room;
  }
  return null;
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('join_room', ({ roomId, playerName }) => {
    let room = rooms[roomId];
    if (!room) {
      room = createRoom(roomId);
      rooms[roomId] = room;
    }

    if (room.players.length >= 2) {
      socket.emit('room_full');
      return;
    }

    const playerIndex = room.players.length;
    room.players.push({ id: socket.id, name: playerName || `Player ${playerIndex + 1}`, index: playerIndex });
    socket.join(roomId);

    socket.emit('joined', {
      playerIndex,
      roomId,
      gameState: getPublicState(room)
    });

    if (room.players.length === 2) {
      io.to(roomId).emit('game_start', {
        players: room.players.map(p => ({ name: p.name, index: p.index })),
        gameState: getPublicState(room)
      });
    } else {
      socket.emit('waiting_for_opponent');
    }
  });

  socket.on('throw_dart', ({ x, y }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.gameOver) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.index !== room.currentPlayer) return;
    if (room.dartsThrown >= 3) return;

    // Calculate score based on dart position
    const score = calculateDartScore(x, y);

    const dart = { x, y, score, player: player.index };
    room.turnDarts.push(dart);
    room.allDarts[player.index].push(dart);
    room.dartsThrown++;

    // Check if score would bust
    const tentativeScore = room.scores[player.index] - score;
    let bust = tentativeScore < 0;

    if (!bust) {
      room.scores[player.index] = tentativeScore;
    }

    // Check win
    if (room.scores[player.index] === 0) {
      room.gameOver = true;
      room.winner = player.index;
      io.to(room.id).emit('dart_thrown', {
        dart,
        scores: room.scores,
        bust,
        gameState: getPublicState(room)
      });
      io.to(room.id).emit('game_over', {
        winner: player.index,
        winnerName: player.name,
        scores: room.scores
      });
      return;
    }

    io.to(room.id).emit('dart_thrown', {
      dart,
      scores: room.scores,
      bust,
      gameState: getPublicState(room)
    });

    // After 3 darts or bust, end turn
    if (room.dartsThrown >= 3 || bust) {
      // Bust: restore score
      if (bust) {
        // Score wasn't changed, just end turn
      }
      setTimeout(() => {
        room.currentPlayer = room.currentPlayer === 0 ? 1 : 0;
        room.dartsThrown = 0;
        room.turnDarts = [];
        io.to(room.id).emit('next_turn', {
          currentPlayer: room.currentPlayer,
          gameState: getPublicState(room)
        });
      }, 2000);
    }
  });

  socket.on('disconnect', () => {
    const room = getRoomForSocket(socket.id);
    if (room) {
      io.to(room.id).emit('opponent_disconnected');
      // Clean up room after a delay
      setTimeout(() => {
        if (rooms[room.id]) {
          const stillConnected = room.players.some(p => {
            const s = io.sockets.sockets.get(p.id);
            return s && s.connected;
          });
          if (!stillConnected) delete rooms[room.id];
        }
      }, 5000);
    }
  });
});

function getPublicState(room) {
  return {
    scores: room.scores,
    currentPlayer: room.currentPlayer,
    dartsThrown: room.dartsThrown,
    players: room.players.map(p => ({ name: p.name, index: p.index })),
    allDarts: room.allDarts,
    turnDarts: room.turnDarts,
    gameOver: room.gameOver,
    winner: room.winner
  };
}

function calculateDartScore(x, y) {
  // x, y are normalized -1 to 1 from center
  const dist = Math.sqrt(x * x + y * y);
  const angle = Math.atan2(y, x); // radians

  // Dartboard rings (normalized 0-1 radius)
  const BULL = 0.05;
  const BULL25 = 0.12;
  const INNER = 0.38;
  const TRIPLE_INNER = 0.46;
  const TRIPLE_OUTER = 0.54;
  const OUTER = 0.84;
  const DOUBLE_INNER = 0.92;
  const DOUBLE_OUTER = 1.0;

  if (dist > DOUBLE_OUTER) return 0; // Miss

  // Bullseye
  if (dist <= BULL) return 50;
  if (dist <= BULL25) return 25;

  // Get segment number
  const segment = getSegment(angle);

  if (dist <= INNER) return segment;
  if (dist <= TRIPLE_INNER) return segment;
  if (dist <= TRIPLE_OUTER) return segment * 3;
  if (dist <= OUTER) return segment;
  if (dist <= DOUBLE_OUTER) return segment * 2;

  return 0;
}

// Dartboard segment order clockwise from top
const SEGMENTS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

function getSegment(angle) {
  // Angle from atan2: 0=right, positive=down (in screen coords)
  // Dartboard: 20 is at top, segments go clockwise
  // Offset so 20 is at -PI/2 (top), then divide into 20 equal segments
  const segAngle = (2 * Math.PI) / 20;
  // Rotate so 20 is at top: add PI/2, then offset by half segment
  let adjusted = angle + Math.PI / 2 + segAngle / 2;
  if (adjusted < 0) adjusted += 2 * Math.PI;
  adjusted = adjusted % (2 * Math.PI);
  const idx = Math.floor(adjusted / segAngle) % 20;
  return SEGMENTS[idx];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Darts server running on port ${PORT}`);
});
