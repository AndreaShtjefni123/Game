import { WebSocketServer } from 'ws';
import { createServer } from 'http';


const httpServer = createServer();
const wss = new WebSocketServer({ server: httpServer });

//Object that stores every connected player . Key = Unique ID, Value = WebSocket connection
const players = {};
const gameState = {
    npcs: [],
    bullets: [],
    nextId: 0,
}
//shared list - a list for everyone to see
function spawnNPC(isBoss = false) {
    gameState.npcs.push({
        id: gameState.nextId++,
        x: Math.random() * 70 - 35,
        z: Math.random() * 70 - 35,
        hp: isBoss ? 100 : 1,
        isBoss: isBoss,
        spawnTimer: 0,
        shootTimer: 0
    });
}
// Start with 3 foxes when the server boots
spawnNPC();
spawnNPC();
spawnNPC();

setInterval(() => { //runs every 50 milliseconds
    const playerList = Object.values(players).filter(p => p.position); //gets all players that have a position
    //When a player first connects they have no position yet, so we skip them with .filter(p => p.position). 
    if (playerList.length === 0) return; //if there are no players, do nothing

    for (const npc of gameState.npcs) { //Loop through every fox/boss on the server
        let nearest = playerList[0]; //Find which player is closest to this NPC. 
        let nearestDist = Infinity;//we start with infinity as a default value
        //if their distance is smaller than infinity they are nearest player for the moment
        for (const p of playerList) {
            const dist = Math.hypot(p.position.x - npc.x, p.position.z - npc.z); //Math.hypot calculates straight-line distance using x and z
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = p;
            }
        }
        //Move the NPC one step toward that player. dx/len and dz/len 
        //normalizes the direction (makes it length 1) so speed is always consistent regardless of distance.
        const dx = nearest.position.x - npc.x;
        const dz = nearest.position.z - npc.z;
        const len = Math.hypot(dx, dz);
        const speed = npc.isBoss ? 0.03 : 0.10;
        npc.x += (dx / len) * speed;
        npc.z += (dz / len) * speed;
    }

    broadcast({ type: 'npcState', npcs: gameState.npcs });
}, 50);
//server broadcasts the state of all npcs 

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
    broadcast({
        type: 'playerJoined',
        id: id
    }, id) // the second argument means "skip this socket"

    // This runs every time THIS player sends a message
    socket.on('message', (raw) => {
        const data = JSON.parse(raw);
        if (data.type === 'move') {
            players[id].position = { x: data.x, y: data.y, z: data.z }
        }
        // When a player kills a fox, remove it from the shared NPC list
        if (data.type === 'kill') {
            const idx = gameState.npcs.findIndex(n => n.id === data.npcId);
            if (idx !== -1) gameState.npcs.splice(idx, 1);
        }
        // Whatever they sent, relay it to everyone else
        // We attach their ID so others know who moved
        broadcast({ ...data, id }, id);
    }); // Now the server always knows where every player is.

    // This runs when THIS player disconnects
    socket.on('close', () => {
        delete players[id];
        // Tell everyone else this player is gone
        // So they can remove that character from their screen
        broadcast({
            type: 'playerLeft',
            id: id
        }, id)
    });
});


// Sends a message to everyone EXCEPT the sender
function broadcast(data, skipId) {
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

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
