import * as network from './network.js';

export function initLobby(onStart) {
    const overlay   = document.getElementById('lobbyOverlay');
    const createBtn = document.getElementById('lobbyCreate');
    const joinBtn   = document.getElementById('lobbyJoin');
    const soloBtn   = document.getElementById('lobbySolo');
    const codeInput = document.getElementById('lobbyCode');
    const codeWrap  = document.getElementById('lobbyCodeWrap');
    const codeDisplay = document.getElementById('lobbyRoomCode');
    const errMsg    = document.getElementById('lobbyError');

    network.connect();

    createBtn.addEventListener('click', () => {
        errMsg.textContent = 'Creating room…';
        network.createRoom((res) => {
            if (!res.ok) { errMsg.textContent = 'Failed to create room.'; return; }
            codeDisplay.textContent = res.code;
            codeWrap.style.display = 'block';
            errMsg.textContent = 'Share the code above, then the game will start.';
            // Start after a brief pause so the host sees the code
            setTimeout(() => {
                overlay.style.display = 'none';
                onStart({ isHost: true, roomState: null });
            }, 2000);
        });
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
