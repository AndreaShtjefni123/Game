import { io } from 'socket.io-client';

const SERVER_URL = 'http://18.234.143.187:3001';

let socket = null;
export let isHost = false;
export let mySocketId = null;
const _callbacks = {};

const EVENTS = [
    'playerJoined', 'playerLeft', 'playerMoved',
    'npcPositions', 'npcRemoved',
    'levelUp', 'playerHealth',
    'pickupSpawned', 'pickupRemoved',
    'bossSpawned', 'bossHpUpdate', 'bossDead', 'hostLeft'
];

export function connect() {
    if (socket) return;
    socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
        mySocketId = socket.id;
        console.log('[net] connected', socket.id);
    });
    socket.on('disconnect', () => console.log('[net] disconnected'));
    EVENTS.forEach(ev => socket.on(ev, (...args) => _callbacks[ev]?.(...args)));
}

export function isConnected() {
    return !!(socket && socket.connected);
}

export function on(event, fn) {
    _callbacks[event] = fn;
}

export function createRoom(ack) {
    socket.emit('createRoom', (res) => {
        if (res.ok) isHost = true;
        ack(res);
    });
}

export function joinRoom(code, ack) {
    socket.emit('joinRoom', code, ack);
}

export function sendMove(x, z, rotation) {
    if (isConnected()) socket.emit('playerMove', { x, z, rotation });
}

export function sendNpcPositions(data) {
    if (isConnected() && isHost) socket.emit('npcPositions', data);
}

export function sendKill(npcId) {
    if (isConnected()) socket.emit('playerKill', npcId);
}

export function sendHealth(hp) {
    if (isConnected()) socket.emit('playerHealth', hp);
}

export function sendSpawnPickup(id, x, z) {
    if (isConnected() && isHost) socket.emit('spawnPickup', { id, x, z });
}

export function sendRemovePickup(id) {
    if (isConnected()) socket.emit('removePickup', id);
}

export function sendBossSpawned(id, x, z) {
    if (isConnected() && isHost) socket.emit('bossSpawned', { id, x, z });
}

export function sendBossDamage() {
    if (isConnected()) socket.emit('bossDamage');
}
