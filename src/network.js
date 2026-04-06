let ws = null;
let messageHandler = null;
let _isHost = false;
let _roomCode = '';

export function isHost() { return _isHost; }
export function getRoomCode() { return _roomCode; }

export function connect(url) {
    return new Promise((resolve, reject) => {
        ws = new WebSocket(url);
        ws.onopen = () => resolve();
        ws.onerror = (err) => reject(err);
        ws.onmessage = (e) => {
            let msg;
            try { msg = JSON.parse(e.data); } catch { return; }
            if (messageHandler) messageHandler(msg);
        };
        ws.onclose = () => {
            if (messageHandler) messageHandler({ t: 'connectionLost' });
        };
    });
}

export function createRoom() {
    _isHost = true;
    return new Promise((resolve) => {
        const prev = messageHandler;
        messageHandler = (msg) => {
            if (msg.t === 'created') {
                _roomCode = msg.code;
                messageHandler = prev;
                resolve(msg.code);
            } else if (prev) prev(msg);
        };
        ws.send(JSON.stringify({ t: 'create' }));
    });
}

export function joinRoom(code) {
    _isHost = false;
    _roomCode = code;
    return new Promise((resolve, reject) => {
        const prev = messageHandler;
        messageHandler = (msg) => {
            if (msg.t === 'joined') {
                messageHandler = prev;
                resolve();
            } else if (msg.t === 'error') {
                messageHandler = prev;
                reject(new Error(msg.msg));
            } else if (prev) prev(msg);
        };
        ws.send(JSON.stringify({ t: 'join', code }));
    });
}

export function sendStart() {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'start' }));
}

export function sendInput(input) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(input));
}

export function sendState(state) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(state));
}

export function sendEvent(event) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(event));
}

export function sendInit(data) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
}

export function onMessage(handler) {
    messageHandler = handler;
}

export function disconnect() {
    if (ws) ws.close();
}
