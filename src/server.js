import { WebSocketServer } from 'ws';
import { createServer } from 'http';

// Keep the process alive if an unexpected error slips through
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

const httpServer = createServer();
const wss = new WebSocketServer({ server: httpServer });

// All connected players - Key = ID, Value = socket
const players = {};
// All active rooms — Key = room code, Value = room object
const rooms = {};
const HEARTBEAT_INTERVAL = 30000;

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

// Pushes `count` plain NPC objects into the room — no meshes, just data
// Pass isBoss=true to spawn the boss instead of a regular fox
function spawnNPCs(room, count, isBoss = false) {
    const MAX_NPCS = 20;
    const available = MAX_NPCS - room.npcs.length;
    if (available <= 0) return;
    count = Math.min(count, available);

    for (let i = 0; i < count; i++) {
        const npc = {
            id: room.npcIdCounter++,
            x: Math.random() * 70 - 35,
            z: Math.random() * 70 - 35
        };
        if (isBoss) {
            npc.isBoss = true;
            npc.hp = 100;
            npc.shootTimer = 0;
            npc.spawnTimer = 0;
        }
        room.npcs.push(npc);
    }
}

// Returns true if an NPC at (nx, nz) with half-size 0.75 overlaps any wall
function collidesWithWall(nx, nz, walls) {
    const nHalf = 0.75;
    for (const w of walls) {
        const rotated = Math.abs(Math.sin(w.ry)) > 0.5;
        const wHalfX = rotated ? 0.5 : 10;
        const wHalfZ = rotated ? 10 : 0.5;
        if (Math.abs(nx - w.x) < nHalf + wHalfX &&
            Math.abs(nz - w.z) < nHalf + wHalfZ) {
            return true;
        }
    }
    return false;
}

// Returns the target {x,z} for an NPC — remembers the last target and only switches
// if a different player is 5+ units closer (prevents flip-flopping between equidistant players)
function pickTarget(npc, room) {
    const entries = Object.entries(room.playerPositions);
    if (entries.length === 0) return null;

    let nearestId = null, nearestDist = Infinity;
    for (const [pid, pos] of entries) {
        const dx = pos.x - npc.x, dz = pos.z - npc.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < nearestDist) { nearestDist = dist; nearestId = pid; }
    }

    if (!npc.targetPlayerId || !room.playerPositions[npc.targetPlayerId]) {
        npc.targetPlayerId = nearestId;
    } else {
        const cur = room.playerPositions[npc.targetPlayerId];
        const curDist = Math.sqrt((cur.x - npc.x) ** 2 + (cur.z - npc.z) ** 2);
        if (nearestDist < curDist - 5) npc.targetPlayerId = nearestId;
    }
    return room.playerPositions[npc.targetPlayerId];
}

// Handles all boss-specific logic for one tick
function updateBoss(npc, room, roomCode) {
    const DELTA = 0.05;

    const target = pickTarget(npc, room);
    if (!target) return;
    const targetX = target.x, targetZ = target.z;

    let speed;
    if (npc.hp > 66) speed = 0.09;
    else if (npc.hp > 33) speed = 0.15;
    else speed = 0.24;

    const dx = targetX - npc.x;
    const dz = targetZ - npc.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 0.1) {
        npc.x += (dx / len) * speed;
        npc.z += (dz / len) * speed;
    }

    npc.shootTimer += DELTA;
    if (npc.shootTimer >= 3) {
        npc.shootTimer = 0;
        brodcast({ type: 'bossBullet', x: npc.x, z: npc.z, targetX, targetZ }, null, roomCode);
    }

    npc.spawnTimer += DELTA;
    if (npc.spawnTimer >= 10) {
        npc.spawnTimer = 0;
        spawnNPCs(room, 2);
    }
}

function updateNPCs(room, roomCode) {
    if (Object.keys(room.playerPositions).length === 0) return;
    const walls = room.walls || [];

    for (const npc of room.npcs) {
        if (npc.isBoss) {
            updateBoss(npc, room, roomCode);
            continue;
        }

        // Find target player with hysteresis — won't flip unless 5+ units closer
        const _target = pickTarget(npc, room);
        if (!_target) continue;
        const targetX = _target.x, targetZ = _target.z;

        // Separation — push foxes apart if closer than 3 units
        for (const other of room.npcs) {
            if (other.id === npc.id) continue;
            const sdx = npc.x - other.x;
            const sdz = npc.z - other.z;
            const dist = Math.sqrt(sdx * sdx + sdz * sdz);
            if (dist < 3 && dist > 0) {
                const push = (3 - dist) * 0.05;
                npc.x += (sdx / dist) * push;
                npc.z += (sdz / dist) * push;
            }
        }

        const dx = targetX - npc.x;
        const dz = targetZ - npc.z;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len <= 0.1) continue;

        npc.ry = Math.atan2(dx / len, dz / len) + Math.PI;

        const speed = 0.30;
        const dirX = (dx / len) * speed;
        const dirZ = (dz / len) * speed;
        const prevX = npc.x;
        const prevZ = npc.z;

        // Attempt 1 — move both X and Z
        npc.x += dirX;
        npc.z += dirZ;
        if (!collidesWithWall(npc.x, npc.z, walls)) continue;

        // Attempt 2 — revert, try X only
        npc.x = prevX; npc.z = prevZ;
        npc.x += dirX;
        if (collidesWithWall(npc.x, npc.z, walls)) npc.x = prevX;

        // Attempt 3 — try Z only
        npc.z += dirZ;
        if (collidesWithWall(npc.x, npc.z, walls)) npc.z = prevZ;
    }
}

// Ticks at 20fps — moves NPCs then broadcasts their positions to all players in the room
function startRoomLoop(roomCode) {
    const interval = setInterval(() => {
        try {
            const room = rooms[roomCode];
            if (!room) { clearInterval(interval); return; }
            updateNPCs(room, roomCode);
            brodcast({ type: 'npcState', npcs: room.npcs }, null, roomCode);
        } catch (err) {
            console.error(`Room ${roomCode} tick failed:`, err);
        }
    }, 50);
    return interval;
}

wss.on('connection', (socket) => {
    const id = generateId();
    players[id] = socket;
    socket.isAlive = true;

    socket.send(JSON.stringify({ type: 'init', id }));

    socket.on('pong', () => {
        socket.isAlive = true;
    });

    socket.on('message', (raw) => {
        try {
            const data = JSON.parse(raw);

            // Create a new room — seed it with NPCs and start the simulation loop
            if (data.type === 'createRoom') {
                const roomCode = generateRoomCode();
                rooms[roomCode] = {
                    hostId: id,
                    players: [id],
                    gameState: { level: 1, kills: 0, killTarget: 15 },
                    npcs: [],
                    playerPositions: {},
                    walls: data.walls,
                    deaths: [],
                    restartVotes: new Set(),
                    npcIdCounter: 0
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
                room.playerPositions[id] = { x: 0, z: 0 };
                socket.send(JSON.stringify({
                    type: 'joinSuccess',
                    code: data.code,
                    id,
                    gameState: room.gameState,
                    walls: room.walls,
                    existingPlayers: room.players.filter(p => p !== id)
                }));
                brodcast({ type: 'playerJoined', id }, id, data.code);

            // Client reports an NPC hit — boss loses HP, regular fox is removed immediately
            } else if (data.type === 'kill') {
                const roomCode = getRoomCodeByPlayerId(id);
                if (!roomCode) return;
                const room = rooms[roomCode];
                const idx = room.npcs.findIndex(n => n.id === data.npcId);
                if (idx === -1) return;
                const npc = room.npcs[idx];

                if (npc.isBoss) {
                    npc.hp--;
                    brodcast({ type: 'bossHp', npcId: npc.id, hp: npc.hp }, null, roomCode);
                    if (npc.hp > 0) return;
                }

                room.npcs.splice(idx, 1);
                room.gameState.kills++;
                brodcast({ type: 'kill', npcId: data.npcId }, null, roomCode);

                const KILL_TARGETS = [15, 40, 70, 100];
                const nextTarget = KILL_TARGETS[room.gameState.level - 1] ?? (room.gameState.killTarget + 30);
                if (room.gameState.kills >= nextTarget) {
                    room.gameState.level++;
                    room.gameState.killTarget = nextTarget;
                    room.npcs.length = 0;
                    brodcast({ type: 'levelUp', level: room.gameState.level }, null, roomCode);
                    setTimeout(() => {
                        if (room.gameState.level === 5) {
                            spawnNPCs(room, 1, true);
                        } else {
                            spawnNPCs(room, Math.min(2 + room.gameState.level, 20));
                        }
                    }, 1500);
                } else {
                    spawnNPCs(room, 2);
                }

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
                    room.deaths.sort((a, b) => b.kills - a.kills);
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
        } catch (err) {
            console.error(`Bad message from player ${id}:`, err);
        }
    });

    socket.on('close', () => {
        delete players[id];
        const roomCode = getRoomCodeByPlayerId(id);
        if (!roomCode) return;
        const room = rooms[roomCode];

        if (id === room.hostId) {
            clearInterval(room.interval);
            brodcast({ type: 'restartGame' }, null, roomCode);
            delete rooms[roomCode];
        } else {
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

// Ping every connected socket every 30s — prune any that don't respond
setInterval(() => {
    for (const id in players) {
        const sock = players[id];
        if (!sock.isAlive) {
            console.error(`Pruning dead socket: ${id}`);
            sock.terminate();
            delete players[id];
            const roomCode = getRoomCodeByPlayerId(id);
            if (roomCode) {
                const room = rooms[roomCode];
                room.players = room.players.filter(p => p !== id);
                delete room.playerPositions[id];
                brodcast({ type: 'playerLeft', id }, id, roomCode);
            }
            continue;
        }
        sock.isAlive = false;
        sock.ping();
    }
}, HEARTBEAT_INTERVAL);
