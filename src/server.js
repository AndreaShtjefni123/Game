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

// Pushes `count` plain NPC objects into the room — no meshes, just data
// Pass isBoss=true to spawn the boss instead of a regular fox
function spawnNPCs(room, count, isBoss = false) {
    for (let i = 0; i < count; i++) {
        const npc = {
            id: npcIdCounter++,
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

// Moves every NPC toward the nearest player — runs on the server so all clients stay in sync
// Returns true if an NPC at (nx, nz) with half-size 0.75 overlaps any wall
function collidesWithWall(nx, nz, walls) {
    const nHalf = 0.75; // NPC hitbox is 1.5x1.5 so half = 0.75
    for (const w of walls) {
        // Wall is BoxGeometry(20, 10, 1) — half extents depend on rotation
        // rotation.y = 0      → wide on X (halfX=10, halfZ=0.5)
        // rotation.y = PI/2   → wide on Z (halfX=0.5, halfZ=10)
        const rotated = Math.abs(Math.sin(w.ry)) > 0.5;
        const wHalfX = rotated ? 0.5 : 10;
        const wHalfZ = rotated ? 10  : 0.5;
        // AABB overlap check
        if (Math.abs(nx - w.x) < nHalf + wHalfX &&
            Math.abs(nz - w.z) < nHalf + wHalfZ) {
            return true;
        }
    }
    return false;
}

// Handles all boss-specific logic for one tick
function updateBoss(npc, room, roomCode) {
    const DELTA = 0.05; // server runs at fixed 50ms = 0.05s per tick

    // Find nearest player to chase
    const positions = Object.values(room.playerPositions);
    let targetX = positions[0].x;
    let targetZ = positions[0].z;
    let nearestDist = Infinity;
    for (const pos of positions) {
        const dx = pos.x - npc.x;
        const dz = pos.z - npc.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < nearestDist) { nearestDist = dist; targetX = pos.x; targetZ = pos.z; }
    }

    // Speed changes based on HP phase
    let speed;
    if (npc.hp > 66)      speed = 0.03; // phase 1 — slow
    else if (npc.hp > 33) speed = 0.05; // phase 2 — medium
    else                   speed = 0.08; // phase 3 — fast

    // Boss moves straight toward player, ignores walls
    const dx = targetX - npc.x;
    const dz = targetZ - npc.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 0.1) {
        npc.x += (dx / len) * speed;
        npc.z += (dz / len) * speed;
    }

    // Shoot timer — fires a bullet at nearest player every 3 seconds
    npc.shootTimer += DELTA;
    if (npc.shootTimer >= 3) {
        npc.shootTimer = 0;
        // Tell all clients to spawn a boss bullet at this position heading toward the nearest player
        brodcast({ type: 'bossBullet', x: npc.x, z: npc.z, targetX, targetZ }, null, roomCode);
    }

    // Spawn timer — summons 2 minions every 10 seconds
    npc.spawnTimer += DELTA;
    if (npc.spawnTimer >= 10) {
        npc.spawnTimer = 0;
        if (room.npcs.length < 20) spawnNPCs(room, 2);
    }
}

function updateNPCs(room, roomCode) {
    const positions = Object.values(room.playerPositions);
    if (positions.length === 0) return;
    const walls = room.walls || [];

    for (const npc of room.npcs) {
        // Boss has its own update function
        if (npc.isBoss) {
            updateBoss(npc, room, roomCode);
            continue;
        }

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

        const speed = 0.10;
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
        const room = rooms[roomCode];
        if (!room) { clearInterval(interval); return; }
        updateNPCs(room, roomCode);
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
                gameState: { level: 1, kills: 0, killTarget: 15 },
                npcs: [],            // authoritative NPC list
                playerPositions: {}, // player positions fed to NPC AI each tick
                walls:data.walls,
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
                walls:room.walls,
                existingPlayers: room.players.filter(p => p !== id) // everyone already in room
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
                // Boss takes 1 HP per bullet hit
                npc.hp--;
                brodcast({ type: 'bossHp', npcId: npc.id, hp: npc.hp }, null, roomCode);
                if (npc.hp > 0) return; // boss still alive, don't remove yet
            }

            // NPC is dead — remove it and sync everyone
            room.npcs.splice(idx, 1);
            room.gameState.kills++;
            brodcast({ type: 'kill', npcId: data.npcId }, null, roomCode);

            // Check if kill target reached — trigger level up
            const KILL_TARGETS = [15, 40, 70, 100];
            const nextTarget = KILL_TARGETS[room.gameState.level - 1] ?? (room.gameState.killTarget + 30);
            if (room.gameState.kills >= nextTarget) {
                room.gameState.level++;
                room.gameState.killTarget = nextTarget;
                // Clear all remaining NPCs
                room.npcs.length = 0;
                // Broadcast level-up so clients heal and show the overlay
                brodcast({ type: 'levelUp', level: room.gameState.level }, null, roomCode);
                // Spawn boss at level 5, new fox wave otherwise
                setTimeout(() => {
                    if (room.gameState.level === 5) {
                        spawnNPCs(room, 1, true);
                    } else {
                        spawnNPCs(room, Math.min(2 + room.gameState.level, 20));
                    }
                }, 1500); // wait 1.5s to match the client overlay duration
            } else {
                // Normal kill — spawn 2 replacements
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