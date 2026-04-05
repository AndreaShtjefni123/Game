import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const httpServer = createServer();
const wss = new WebSocketServer({ server: httpServer });

// All connected players - Key = ID, Value = socket
const players = {};
// All active rooms — Key = room code, Value = room object
const rooms = {};

// Unique ID for every NPC spawned — lets clients identify which mesh to remove on kill
let npcIdCounter = 0;

function generateId() {
    return Math.random().toString(36).substring(2, 9);
}

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getRoomCodeByPlayerId(playerId) {
    for (const code in rooms) {
        if (rooms[code].players.includes(playerId)) return code;
    }
    return null;
}

//  NPC SIMULATION 

// Pushes `count` plain {id, x, z} objects into the room — no meshes, just data
function spawnNPCs(room, count) {
    for (let i = 0; i < count; i++) {
        room.npcs.push({
            id: npcIdCounter++,
            x: Math.random() * 70 - 35,
            z: Math.random() * 70 - 35
        });
    }
}

// Moves every NPC toward the nearest player — runs on the server so all clients stay in sync
function updateNPCs(room) {
    const positions = Object.values(room.playerPositions);
    if (positions.length === 0) return;

    for (const npc of room.npcs) {
        // Find nearest player
        let targetX = positions[0].x;
        let targetZ = positions[0].z;
        let nearestDist = Infinity;
        for (const pos of positions) {
            const dx = pos.x - npc.x;
            const dz = pos.z - npc.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < nearestDist) {
                nearestDist = dist;
                targetX = pos.x;
                targetZ = pos.z;
            }
        }

        // Move toward that player at fixed speed
        const dx = targetX - npc.x;
        const dz = targetZ - npc.z;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len > 0.1) {
            const speed = 0.10;
            npc.x += (dx / len) * speed;
            npc.z += (dz / len) * speed;
        }
    }
}

// Ticks at 20fps — moves NPCs then broadcasts their positions to all players in the room
function startRoomLoop(roomCode) {
    const interval = setInterval(() => {
        const room = rooms[roomCode];
        if (!room) { clearInterval(interval); return; }
        updateNPCs(room);
        brodcast({ type: 'npcState', npcs: room.npcs }, null, roomCode);
    }, 50);
    return interval;
}



wss.on('connection', (socket) => {
    const id = generateId();
    players[id] = socket;

    socket.send(JSON.stringify({ type: 'init', id }));

    socket.on('message', (raw) => {
        const data = JSON.parse(raw);

        // Create a new room — seed it with NPCs and start the simulation loop
        if (data.type === 'createRoom') {
            const roomCode = generateRoomCode();
            rooms[roomCode] = {
                hostId: id,
                players: [id],
                gameState: { level: 1, kills: 0 },
                npcs: [],            // authoritative NPC list
                playerPositions: {}, // player positions fed to NPC AI each tick
                deaths: [],          // collects each player's stats when they die
                restartVotes: new Set() // tracks who has voted to restart
            };
            spawnNPCs(rooms[roomCode], 3);
            rooms[roomCode].interval = startRoomLoop(roomCode);
            socket.send(JSON.stringify({ type: 'roomCreated', code: roomCode }));

        // Join an existing room using a code
        } else if (data.type === 'joinRoom') {
            const room = rooms[data.code];
            if (!room) {
                socket.send(JSON.stringify({ type: 'joinFailed', reason: 'Room not found!' }));
                return;
            }
            room.players.push(id);
            socket.send(JSON.stringify({
                type: 'joinSuccess',
                code: data.code,
                id,
                gameState: room.gameState,
                existingPlayers: room.players.filter(p => p !== id) // everyone already in room
            }));
            brodcast({ type: 'playerJoined', id }, id, data.code);

        // Client reports an NPC kill — server removes it, spawns 2 replacements, syncs everyone
        } else if (data.type === 'kill') {
            const roomCode = getRoomCodeByPlayerId(id);
            if (!roomCode) return;
            const room = rooms[roomCode];
            const idx = room.npcs.findIndex(n => n.id === data.npcId);
            if (idx !== -1) room.npcs.splice(idx, 1);
            spawnNPCs(room, 2);
            room.gameState.kills++;
            brodcast({ type: 'kill', npcId: data.npcId }, null, roomCode);
            brodcast({ type: 'killUpdate', kills: room.gameState.kills, level: room.gameState.level }, null, roomCode);

        // Player moved — save position for NPC targeting, relay to other players
        } else if (data.type === 'move') {
            const roomCode = getRoomCodeByPlayerId(id);
            if (roomCode && rooms[roomCode]) {
                rooms[roomCode].playerPositions[id] = { x: data.x, z: data.z };
            }
            brodcast({ ...data, id }, id, roomCode);

        // Player died — store their stats; when all are dead broadcast leaderboard
        } else if (data.type === 'playerDied') {
            const roomCode = getRoomCodeByPlayerId(id);
            if (!roomCode) return;
            const room = rooms[roomCode];
            room.deaths.push({ id, kills: data.kills, time: data.time });
            if (room.deaths.length >= room.players.length) {
                room.deaths.sort((a, b) => b.kills - a.kills); // sort by kills descending
                brodcast({ type: 'leaderboard', results: room.deaths }, null, roomCode);
            }

        // Player voted to restart — when everyone votes, reset the room and restart
        } else if (data.type === 'requestRestart') {
            const roomCode = getRoomCodeByPlayerId(id);
            if (!roomCode) return;
            const room = rooms[roomCode];
            room.restartVotes.add(id);
            brodcast({ type: 'restartVote', votes: room.restartVotes.size, total: room.players.length }, null, roomCode);
            if (room.restartVotes.size >= room.players.length) {
                // All players voted — reload their pages (cleanest reset)
                brodcast({ type: 'restartGame' }, null, roomCode);
            }

        // Host pressed Start — broadcast gameStart to everyone in the room
        } else if (data.type === 'startGame') {
            const roomCode = getRoomCodeByPlayerId(id);
            if (roomCode) brodcast({ type: 'gameStart' }, null, roomCode);

        // All other messages — relay to everyone in the same room
        } else {
            const roomCode = getRoomCodeByPlayerId(id);
            if (roomCode) brodcast({ ...data, id }, id, roomCode);
        }
    });

    socket.on('close', () => {
        delete players[id];
        const roomCode = getRoomCodeByPlayerId(id);
        if (!roomCode) return;
        const room = rooms[roomCode];

        if (id === room.hostId) {
            // Host left — stop the loop to prevent a memory leak, then destroy the room
            clearInterval(room.interval);
            brodcast({ type: 'hostLeft', id: room.hostId }, room.hostId, roomCode);
            delete rooms[roomCode];
        } else {
            // Regular player left
            room.players = room.players.filter(p => p !== id);
            delete room.playerPositions[id];
            brodcast({ type: 'playerLeft', id }, id, roomCode);
        }
    });
});

// Sends a message to everyone in the room EXCEPT skipId (pass null to send to all)
function brodcast(data, skipId, roomCode) {
    const msg = JSON.stringify(data);
    const room = rooms[roomCode];
    if (!room) return;
    for (const pid of room.players) {
        if (pid !== skipId) {
            const sock = players[pid];
            if (sock && sock.readyState === 1) sock.send(msg);
        }
    }
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
