import { WebSocketServer } from 'ws';
import { createServer } from 'http';


const httpServer = createServer();
const wss = new WebSocketServer({ server: httpServer });

//Object that stores every connected player . Key = Unique ID, Value = WebSocket connection
const players = {};

function generateId() {
    return Math.random().toString(36).substring(2, 9);
}

wss.on('connection', (socket) => {
    //Give player Unique ID
    const id = generateId();
    players[id] = socket;

    //Tell this player what their own ID is
    //They need this so they can label their won messages
    socket.send(JSON.stringify({
        type: 'init',
        id: id
    }))

    //Tell all other player that a new player has joined
    for (const existingId in players) {
        if (existingId !== id) {

            socket.send(JSON.stringify({
                type: 'playerJoined',
                id: existingId
            }));
        }
    }
    //Tell EVERYONE that a new player has joined
    brodcast({
        type: 'playerJoined',
        id: id
    }, id)// the second argument means "skip this socket"

    // This runs every time THIS player sends a message
    socket.on('message', (raw) => {
        const data = JSON.parse(raw);
        // Whatever they sent, relay it to everyone else
        // We attach their ID so others know who moved
        brodcast({ ...data, id }, id);
    });

    // This runs when THIS player disconnects
    socket.on('close', () => {
        delete players[id];
        // Tell everyone else this player is gone
        // So they can remove that character from their screen
        brodcast({
            type: 'playerLeft',
            id: id
        }, id)
    });
});

// Sends a message to everyone EXCEPT the sender
function brodcast(data, skipId) {
    const msg = JSON.stringify(data);
    for (const id in players) {
        if (id !== skipId) {
            const sock = players[id];
            if (sock.readyState === 1) { // 1 = OPEN
                sock.send(msg);
            }
        }
    }
}

httpServer.listen(3000, () => {
    console.log('Server running on port 3000');
});