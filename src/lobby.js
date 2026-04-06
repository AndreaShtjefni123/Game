import { connect, createRoom, joinRoom, sendStart, onMessage } from './network.js';

const RELAY_URL = 'ws://game.ferit.tech:3000';

let onGameStart = null;

export function initLobby(gameStartCallback) {
    onGameStart = gameStartCallback;

    const createBtn = document.getElementById('createRoomBtn');
    const joinBtn = document.getElementById('joinRoomBtn');
    const startBtn = document.getElementById('startGameBtn');
    const joinInput = document.getElementById('roomCodeInput');
    const status = document.getElementById('lobbyStatus');
    const codeText = document.getElementById('roomCodeText');
    const codeDisplay = document.getElementById('roomCodeDisplay');

    createBtn.addEventListener('click', async () => {
        try {
            status.textContent = 'Connecting...';
            createBtn.disabled = true;
            await connect(RELAY_URL);
            const code = await createRoom();
            codeText.textContent = code;
            codeDisplay.style.display = 'block';
            createBtn.style.display = 'none';
            joinBtn.style.display = 'none';
            joinInput.style.display = 'none';
            status.textContent = 'Waiting for player to join...';

            onMessage((msg) => {
                if (msg.t === 'playerJoined') {
                    status.textContent = 'Player joined!';
                    startBtn.style.display = 'inline-block';
                } else if (msg.t === 'playerLeft') {
                    status.textContent = 'Player left. Waiting...';
                    startBtn.style.display = 'none';
                }
            });
        } catch (err) {
            status.textContent = 'Failed to connect: ' + err.message;
            createBtn.disabled = false;
        }
    });

    joinBtn.addEventListener('click', async () => {
        const code = joinInput.value.trim().toUpperCase();
        if (!code) return;
        try {
            status.textContent = 'Connecting...';
            joinBtn.disabled = true;
            await connect(RELAY_URL);
            await joinRoom(code);
            createBtn.style.display = 'none';
            joinBtn.style.display = 'none';
            joinInput.style.display = 'none';
            status.textContent = 'Joined room ' + code + '. Waiting for host to start...';

            onMessage((msg) => {
                if (msg.t === 'start') {
                    hideLobby();
                    if (onGameStart) onGameStart(false);
                } else if (msg.t === 'hostDisconnected') {
                    status.textContent = 'Host disconnected.';
                }
            });
        } catch (err) {
            status.textContent = err.message;
            joinBtn.disabled = false;
        }
    });

    startBtn.addEventListener('click', () => {
        sendStart();
        hideLobby();
        if (onGameStart) onGameStart(true);
    });
}

function hideLobby() {
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('gameUI').style.display = 'block';
}
