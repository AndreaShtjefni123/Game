import { createServer } from 'http';
import { Server } from 'socket.io';
import express from 'express';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = 3001;

// Kill thresholds — must match src/levels.js getNextKillTarget
const KILL_TARGETS = [15, 40, 70, 100];
function getNextKillTarget(level, prevTarget) {
    if (level - 1 < KILL_TARGETS.length) return KILL_TARGETS[level - 1];
    return prevTarget + 30;
}

function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return rooms[code] ? generateCode() : code;
}

const rooms = {};

io.on('connection', (socket) => {
    console.log('+ connect', socket.id);
    let roomCode = null;

    socket.on('createRoom', (ack) => {
        const code = generateCode();
        rooms[code] = {
            players: {},
            kills: 0,
            level: 1,
            killTarget: KILL_TARGETS[0],
            hostId: socket.id,
            deadNpcIds: new Set(),
            bossHp: 0,
            bossState: null,
            pickups: {},
            lastNpcPositions: []
        };
        rooms[code].players[socket.id] = { x: 0, z: 0, rotation: 0, hp: 100 };
        socket.join(code);
        roomCode = code;
        console.log(`Room ${code} created by ${socket.id}`);
        if (typeof ack === 'function') ack({ ok: true, code });
    });

    socket.on('joinRoom', (code, ack) => {
        const room = rooms[code];
        if (!room) {
            if (typeof ack === 'function') ack({ ok: false, error: 'Room not found' });
            return;
        }
        room.players[socket.id] = { x: 0, z: 0, rotation: 0, hp: 100 };
        socket.join(code);
        roomCode = code;
        socket.to(code).emit('playerJoined', { socketId: socket.id, x: 0, z: 0, rotation: 0, hp: 100 });
        const response = {
            ok: true,
            level: room.level,
            kills: room.kills,
            npcs: room.lastNpcPositions,
            pickups: Object.entries(room.pickups).map(([id, p]) => ({ id, x: p.x, z: p.z })),
            boss: room.bossState,
            players: Object.entries(room.players)
                .filter(([sid]) => sid !== socket.id)
                .map(([sid, p]) => ({ socketId: sid, x: p.x, z: p.z, rotation: p.rotation, hp: p.hp }))
        };
        console.log(`${socket.id} joined ${code}`);
        if (typeof ack === 'function') ack(response);
    });

    socket.on('playerMove', ({ x, z, rotation }) => {
        if (!roomCode || !rooms[roomCode]) return;
        const p = rooms[roomCode].players[socket.id];
        if (p) { p.x = x; p.z = z; p.rotation = rotation; }
        socket.to(roomCode).emit('playerMoved', { socketId: socket.id, x, z, rotation });
    });

    socket.on('playerHealth', (hp) => {
        if (!roomCode || !rooms[roomCode]) return;
        const p = rooms[roomCode].players[socket.id];
        if (p) p.hp = hp;
        socket.to(roomCode).emit('playerHealth', { socketId: socket.id, hp });
    });

    socket.on('npcPositions', (data) => {
        if (!roomCode || !rooms[roomCode]) return;
        rooms[roomCode].lastNpcPositions = data;
        socket.to(roomCode).emit('npcPositions', data);
    });

    socket.on('playerKill', (npcId) => {
        if (!roomCode || !rooms[roomCode]) return;
        const room = rooms[roomCode];
        if (room.deadNpcIds.has(npcId)) return;
        room.deadNpcIds.add(npcId);
        room.kills++;
        io.in(roomCode).emit('npcRemoved', npcId);
        _checkLevelUp(roomCode);
    });

    socket.on('startGame', () => {
        if (!roomCode || !rooms[roomCode]) return;
        if (socket.id !== rooms[roomCode].hostId) return;
        socket.to(roomCode).emit('gameStart');
        console.log(`Room ${roomCode} game started by host`);
    });

    socket.on('spawnPickup', ({ id, x, z }) => {
        if (!roomCode || !rooms[roomCode]) return;
        const room = rooms[roomCode];
        if (socket.id !== room.hostId) return;
        room.pickups[id] = { x, z };
        io.in(roomCode).emit('pickupSpawned', { id, x, z });
    });

    socket.on('removePickup', (id) => {
        if (!roomCode || !rooms[roomCode]) return;
        delete rooms[roomCode].pickups[id];
        socket.to(roomCode).emit('pickupRemoved', id);
    });

    socket.on('bossSpawned', ({ id, x, z }) => {
        if (!roomCode || !rooms[roomCode]) return;
        const room = rooms[roomCode];
        if (socket.id !== room.hostId) return;
        room.bossHp = 100;
        room.bossState = { id, x, z, hp: 100 };
        io.in(roomCode).emit('bossSpawned', { id, x, z, hp: 100 });
    });

    socket.on('bossDamage', () => {
        if (!roomCode || !rooms[roomCode]) return;
        const room = rooms[roomCode];
        if (room.bossHp <= 0) return;
        room.bossHp = Math.max(0, room.bossHp - 1);
        if (room.bossState) room.bossState.hp = room.bossHp;
        io.in(roomCode).emit('bossHpUpdate', room.bossHp);
        if (room.bossHp <= 0) {
            room.bossState = null;
            io.in(roomCode).emit('bossDead');
            room.level++;
            room.killTarget = getNextKillTarget(room.level, room.killTarget);
            room.deadNpcIds.clear();
            io.in(roomCode).emit('levelUp', room.level);
        }
    });

    socket.on('disconnect', () => {
        console.log('- disconnect', socket.id);
        if (!roomCode || !rooms[roomCode]) return;
        const room = rooms[roomCode];
        delete room.players[socket.id];
        io.in(roomCode).emit('playerLeft', socket.id);
        if (socket.id === room.hostId) {
            io.in(roomCode).emit('hostLeft', 'The host has left. Session ended.');
            delete rooms[roomCode];
            console.log(`Room ${roomCode} deleted (host left)`);
        }
    });

    function _checkLevelUp(code) {
        const room = rooms[code];
        if (!room || room.kills < room.killTarget) return;
        room.level++;
        room.killTarget = getNextKillTarget(room.level, room.killTarget);
        room.deadNpcIds.clear();
        console.log(`Room ${code} leveled up to ${room.level}`);
        io.in(code).emit('levelUp', room.level);
    }
});

httpServer.listen(PORT, () => console.log(`Socket.io server running on port ${PORT}`));
