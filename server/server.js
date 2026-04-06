import { WebSocketServer } from 'ws';

const PORT = 3001;
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HEARTBEAT_INTERVAL = 30000;

const wss = new WebSocketServer({ port: PORT });
const rooms = new Map();

function generateCode() {
    let code;
    do {
        code = '';
        for (let i = 0; i < 5; i++) {
            code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
        }
    } while (rooms.has(code));
    return code;
}

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        switch (msg.t) {
            case 'create': {
                const code = generateCode();
                rooms.set(code, { host: ws, client: null, started: false });
                ws.roomCode = code;
                ws.role = 'host';
                ws.send(JSON.stringify({ t: 'created', code }));
                console.log(`Room ${code} created`);
                break;
            }

            case 'join': {
                const room = rooms.get(msg.code);
                if (!room) {
                    ws.send(JSON.stringify({ t: 'error', msg: 'Room not found' }));
                    return;
                }
                if (room.client) {
                    ws.send(JSON.stringify({ t: 'error', msg: 'Room is full' }));
                    return;
                }
                room.client = ws;
                ws.roomCode = msg.code;
                ws.role = 'client';
                ws.send(JSON.stringify({ t: 'joined', code: msg.code }));
                if (room.host && room.host.readyState === 1) {
                    room.host.send(JSON.stringify({ t: 'playerJoined' }));
                }
                console.log(`Player joined room ${msg.code}`);
                break;
            }

            case 'start': {
                const room = rooms.get(ws.roomCode);
                if (!room || ws.role !== 'host') return;
                room.started = true;
                // Send start to client only (host already knows)
                if (room.client && room.client.readyState === 1) {
                    room.client.send(JSON.stringify({ t: 'start' }));
                }
                console.log(`Room ${ws.roomCode} started`);
                break;
            }

            case 'input': {
                // client → host
                const room = rooms.get(ws.roomCode);
                if (!room || !room.host || ws.role !== 'client') return;
                if (room.host.readyState === 1) room.host.send(raw.toString());
                break;
            }

            case 'state':
            case 'event':
            case 'init': {
                // host → client
                const room = rooms.get(ws.roomCode);
                if (!room || !room.client || ws.role !== 'host') return;
                if (room.client.readyState === 1) room.client.send(raw.toString());
                break;
            }
        }
    });

    ws.on('close', () => {
        const room = rooms.get(ws.roomCode);
        if (!room) return;

        if (ws.role === 'host') {
            if (room.client && room.client.readyState === 1) {
                room.client.send(JSON.stringify({ t: 'hostDisconnected' }));
            }
            rooms.delete(ws.roomCode);
            console.log(`Room ${ws.roomCode} destroyed (host left)`);
        } else if (ws.role === 'client') {
            room.client = null;
            if (room.host && room.host.readyState === 1) {
                room.host.send(JSON.stringify({ t: 'playerLeft' }));
            }
            console.log(`Client left room ${ws.roomCode}`);
        }
    });
});

// Heartbeat — detect dead connections
const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => clearInterval(heartbeat));

console.log(`Relay server listening on port ${PORT}`);
