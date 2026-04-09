import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const httpServer = createServer();
const wss = new WebSocketServer({ server: httpServer });

// rooms: code → { host: WebSocket, hostId: string, guests: Map<guestId, WebSocket> }
const rooms = new Map();

function generateId() {
    return Math.random().toString(36).substring(2, 9);
}

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

function sendTo(ws, data) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
}

// Send to everyone in the room except the socket that sent the message
function broadcastToRoom(room, skipSocket, data) {
    const msg = JSON.stringify(data);
    if (room.host !== skipSocket && room.host.readyState === 1) room.host.send(msg);
    for (const [, gs] of room.guests) {
        if (gs !== skipSocket && gs.readyState === 1) gs.send(msg);
    }
}

wss.on('connection', (socket) => {
    const serverId = generateId(); // internal server-side ID
    let myClientId = null;         // ID the client knows themselves as
    let myRoom     = null;
    let myRole     = null;

    socket.on('message', (raw) => {
        let data;
        try { data = JSON.parse(raw); } catch { return; }

        // ── ROOM SETUP ────────────────────────────────────────────────────────
        if (data.type === 'createRoom') {
            let code;
            do { code = generateRoomCode(); } while (rooms.has(code));
            myClientId = 'host_' + serverId;
            rooms.set(code, { host: socket, hostId: myClientId, guests: new Map() });
            myRoom = code;
            myRole = 'host';
            sendTo(socket, { type: 'roomCreated', code, role: 'host', myId: myClientId });
            return;
        }

        if (data.type === 'joinRoom') {
            const room = rooms.get(data.code);
            if (!room) {
                sendTo(socket, { type: 'roomError', reason: 'Room not found' });
                return;
            }
            myClientId = 'guest_' + serverId;
            room.guests.set(myClientId, socket);
            myRoom = data.code;
            myRole = 'guest';
            sendTo(socket, { type: 'roomJoined', code: data.code, role: 'guest', myId: myClientId });
            sendTo(room.host, { type: 'guestJoined', guestId: myClientId });
            return;
        }

        // ── IN-ROOM ROUTING ───────────────────────────────────────────────────
        const room = myRoom ? rooms.get(myRoom) : null;
        if (!room) return;

        // shoot → re-broadcast as bulletSpawned (relay never forwards raw 'shoot')
        if (data.type === 'shoot') {
            broadcastToRoom(room, socket, {
                type:     'bulletSpawned',
                bulletId: data.bulletId,
                ownerId:  myClientId,
                origin:   data.origin,
                dir:      data.dir,
                id:       myClientId
            });
            return;
        }

        // Guest → Host only (never broadcast to other guests)
        if (data.type === 'ready' || data.type === 'guestDied') {
            sendTo(room.host, { ...data, id: myClientId });
            return;
        }

        // Targeted messages carry a 'to' field — route to that specific socket
        if (data.to) {
            const payload = { ...data, id: myClientId };
            delete payload.to;
            const target = data.to === room.hostId ? room.host : room.guests.get(data.to);
            sendTo(target, payload);
            return;
        }

        // Default: broadcast to everyone else in the room
        broadcastToRoom(room, socket, { ...data, id: myClientId });
    });

    socket.on('close', () => {
        if (!myRoom) return;
        const room = rooms.get(myRoom);
        if (!room) return;

        if (myRole === 'host') {
            // Host left — notify all guests and destroy the room
            for (const [, gs] of room.guests) sendTo(gs, { type: 'hostLeft' });
            rooms.delete(myRoom);
        } else if (myRole === 'guest') {
            room.guests.delete(myClientId);
            sendTo(room.host, { type: 'guestLeft', guestId: myClientId });
        }
    });
});

httpServer.listen(3000, () => console.log('Server running on port 3000'));
