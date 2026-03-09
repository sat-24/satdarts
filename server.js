const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function createRoom(id) {
  return { id, players: [], scores: [301,301], currentPlayer:0, gameOver:false };
}

function getRoomForSocket(sid) {
  for (const id in rooms)
    if (rooms[id].players.some(p=>p.id===sid)) return rooms[id];
  return null;
}

const SEGS=[20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];

function calcScore(hPct, vPct) {
  const bx=(hPct/100)*500, by=(vPct/100)*500;
  const dx=bx-250, dy=by-250;
  const dist=Math.sqrt(dx*dx+dy*dy);
  let angle=Math.atan2(dy,dx)*180/Math.PI+90;
  if(angle<0) angle+=360;
  const seg=Math.floor(angle/18)%20;
  const base=SEGS[seg];
  if(dist<15)  return 50;
  if(dist<30)  return 25;
  if(dist<120) return base;
  if(dist<140) return base*3;
  if(dist<210) return base;
  if(dist<230) return base*2;
  return 0;
}

function state(room) {
  return {
    scores: room.scores,
    currentPlayer: room.currentPlayer,
    dartsThrown: 0,
    players: room.players.map(p=>({name:p.name,index:p.index})),
    allDarts: [[],[]],
    gameOver: room.gameOver,
    winner: room.winner||null
  };
}

io.on('connection', socket => {
  socket.on('join_room', ({roomId, playerName}) => {
    let room = rooms[roomId];
    if(!room){ room=createRoom(roomId); rooms[roomId]=room; }
    if(room.players.length>=2){ socket.emit('room_full'); return; }

    const idx=room.players.length;
    room.players.push({id:socket.id, name:playerName||`Player ${idx+1}`, index:idx});
    socket.join(roomId);
    socket.emit('joined',{playerIndex:idx,roomId});

    if(room.players.length===2){
      io.to(roomId).emit('game_start',{
        players:room.players.map(p=>({name:p.name,index:p.index})),
        gameState:state(room)
      });
    } else {
      socket.emit('waiting_for_opponent');
    }
  });

  socket.on('throw_dart', ({hPct,vPct}) => {
    const room=getRoomForSocket(socket.id);
    if(!room||room.gameOver) return;
    const player=room.players.find(p=>p.id===socket.id);
    if(!player||player.index!==room.currentPlayer) return;

    const score=calcScore(hPct,vPct);
    const dart={hPct,vPct,score,player:player.index};

    const tentative=room.scores[player.index]-score;
    const bust=tentative<0;
    if(!bust) room.scores[player.index]=tentative;

    if(room.scores[player.index]===0){
      room.gameOver=true; room.winner=player.index;
      io.to(room.id).emit('dart_thrown',{dart,bust:false,gameState:state(room)});
      setTimeout(()=>{
        io.to(room.id).emit('game_over',{winner:player.index,winnerName:player.name,scores:room.scores});
      },2800);
      return;
    }

    io.to(room.id).emit('dart_thrown',{dart,bust,gameState:state(room)});

    // 1 dart per turn — always switch
    setTimeout(()=>{
      room.currentPlayer = room.currentPlayer===0?1:0;
      io.to(room.id).emit('next_turn',{currentPlayer:room.currentPlayer,gameState:state(room)});
    }, bust ? 2800 : 2600);
  });

  socket.on('disconnect', ()=>{
    const room=getRoomForSocket(socket.id);
    if(room) io.to(room.id).emit('opponent_disconnected');
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Darts on port ${PORT}`));
