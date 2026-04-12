import * as network from './network.js';

export function initLobby(onStart) {
    const overlay      = document.getElementById('lobbyOverlay');
    const createBtn    = document.getElementById('lobbyCreate');
    const joinBtn      = document.getElementById('lobbyJoin');
    const soloBtn      = document.getElementById('lobbySolo');
    const codeInput    = document.getElementById('lobbyCode');
    const codeWrap     = document.getElementById('lobbyCodeWrap');
    const codeDisplay  = document.getElementById('lobbyRoomCode');
    const startBtn     = document.getElementById('lobbyStart');
    const playerCount  = document.getElementById('lobbyPlayerCount');
    const errMsg       = document.getElementById('lobbyError');

    // Players who joined while host is waiting in the lobby
    const waitingPlayers = [];

    network.connect();

    createBtn.addEventListener('click', () => {
        errMsg.textContent = 'Creating room…';
        network.createRoom((res) => {
            if (!res.ok) { errMsg.textContent = 'Failed to create room.'; return; }

            // Show the code and the Start button — NO auto-timer
            codeDisplay.textContent = res.code;
            codeWrap.style.display = 'block';
            startBtn.style.display = 'block';
            createBtn.style.display = 'none';
            errMsg.textContent = 'Share the code above. Press Start when everyone has joined.';

            // Track players joining while host waits
            network.on('playerJoined', (p) => {
                waitingPlayers.push(p);
                playerCount.textContent = `Players in room: ${waitingPlayers.length + 1}`;
                playerCount.style.display = 'block';
            });
        });
    });

    startBtn.addEventListener('click', () => {
        overlay.style.display = 'none';
        onStart({ isHost: true, waitingPlayers });
    });

    joinBtn.addEventListener('click', () => {
        const code = codeInput.value.trim().toUpperCase();
        if (!code) { errMsg.textContent = 'Enter a room code first.'; return; }
        errMsg.textContent = 'Joining…';
        network.joinRoom(code, (res) => {
            if (!res.ok) { errMsg.textContent = res.error || 'Room not found.'; return; }
            overlay.style.display = 'none';
            onStart({ isHost: false, roomState: res });
        });
    });

    soloBtn.addEventListener('click', () => {
        overlay.style.display = 'none';
        onStart({ solo: true });
    });
}
