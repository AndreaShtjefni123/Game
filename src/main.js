// Three.js is the core 3D library — handles scenes, cameras, meshes, lighting
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { npcs, createNPCs, updateNPCs, createBoss } from "./npc.js";
import { bullets, shoot, updateBullets, spawnRemoteBullet } from "./shoot.js";
import { updateClock, showFinalTime, showFinalKills, addKill, totalKills, survivalTime, setKills } from "./clock.js";
import { takeDamage, updateHealthBar, setDuckMesh, setGameOverCallback } from "./health.js";
import { updatePickups, startPickupSpawner } from "./pickup.js";
import { checkLevelUp, getCurrentLevel } from "./levels.js";
import { initUltimate, updateUltimate } from "./ultimate.js";

// ── MULTIPLAYER ────────────────────────────────────────────────────────────────

let isMultiplayer = false;
let socket = null;
let myId = null;
let isHost = false;
const roomPlayers = [];
let spectating = false;
let spectateTargetId = null;
const remotePlayers = {};
<<<<<<< HEAD



// We send our position 20 times per second (every 50 ms).
// Sending every frame (60/s) would flood the server needlessly.
const SEND_RATE = 50; // milliseconds
=======
const remotePlayerMixers = {};
const SEND_RATE = 50;
>>>>>>> 3273d7372f3d71f40c53a3ea62dbe03840c5d81e
let lastSendTime = 0;

function connectToServer() {
    socket = new WebSocket(`ws://18.234.143.187:3000`);

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'init') {
            myId = data.id;
            console.log('Connected! My ID:', myId);
        }

        if (data.type === 'playerJoined') {
            roomPlayers.push(data.id);
            updateWaitingRoom();
            spawnRemotePlayer(data.id);
        }

        if (data.type === 'playerLeft') {
            if (remotePlayers[data.id]) {
                scene.remove(remotePlayers[data.id]);
                delete remotePlayers[data.id];
            }
            if (spectating && spectateTargetId === data.id) {
                const ids = Object.keys(remotePlayers);
                spectateTargetId = ids.length > 0 ? ids[0] : null;
                document.getElementById('spectateLabel').textContent = spectateTargetId
                    ? 'Player ' + spectateTargetId.substring(0, 4)
                    : 'No players alive';
            }
        }

        if (data.type === 'move') {
            if (remotePlayers[data.id]) {
                remotePlayers[data.id].position.set(data.x, data.y, data.z);
                remotePlayers[data.id].rotation.y = data.ry;
            }
        }

        if (data.type === 'shoot') {
            spawnRemoteBullet(data.x, data.z, data.dirX, data.dirZ, scene);
        }

        if (data.type === 'npcState') {
            while (npcs.length < data.npcs.length) createNPCs(1, scene, player);
            while (npcs.length > data.npcs.length) {
                scene.remove(npcs[npcs.length - 1]);
                npcs.splice(npcs.length - 1, 1);
            }
            for (let i = 0; i < data.npcs.length; i++) {
                npcs[i].userData.serverId = data.npcs[i].id;
                npcs[i].position.set(data.npcs[i].x, 0, data.npcs[i].z);
            }
        }

        if (data.type === 'killUpdate') {
            setKills(data.kills);
            document.getElementById('level').textContent = 'Level ' + data.level;
        }

        if (data.type === 'kill') {
            const idx = npcs.findIndex(n => n.userData.serverId === data.npcId);
            if (idx !== -1) { scene.remove(npcs[idx]); npcs.splice(idx, 1); }
        }

        if (data.type === 'roomCreated') {
            isHost = true;
            roomPlayers.push(myId);
            document.getElementById('mainMenu').style.display = 'none';
            document.getElementById('waitingRoom').style.display = 'flex';
            document.getElementById('roomCodeDisplay').textContent = 'Room Code: ' + data.code;
            document.getElementById('startBtn').style.display = 'block';
            document.getElementById('waitingMsg').style.display = 'none';
            updateWaitingRoom();
        }

        if (data.type === 'joinSuccess') {
            isHost = false;
            for (const pid of data.existingPlayers) roomPlayers.push(pid);
            roomPlayers.push(myId);
            document.getElementById('mainMenu').style.display = 'none';
            document.getElementById('waitingRoom').style.display = 'flex';
            document.getElementById('roomCodeDisplay').textContent = 'Room Code: ' + data.code;
            updateWaitingRoom();
        }

        if (data.type === 'joinFailed') {
            document.getElementById('joinError').textContent = data.reason || 'Room not found. Check the code and try again.';
            document.getElementById('joinError').style.display = 'block';
        }

        if (data.type === 'gameStart') {
            document.getElementById('waitingRoom').style.display = 'none';
            startGame();
        }

        if (data.type === 'leaderboard') {
            spectating = false;
            spectateTargetId = null;
            document.getElementById('spectateOverlay').style.display = 'none';
            const tbody = document.getElementById('leaderboardBody');
            tbody.innerHTML = '';
            data.results.forEach((r, i) => {
                const row = document.createElement('tr');
                row.style.cssText = r.id === myId ? 'color:#ffdd00; font-weight:bold;' : 'color:white;';
                row.innerHTML = `
                    <td style="padding:10px;">${i + 1}</td>
                    <td style="padding:10px;">Player ${r.id.substring(0, 4)}${r.id === myId ? ' (you)' : ''}</td>
                    <td style="padding:10px;">${r.kills}</td>
                    <td style="padding:10px;">${r.time}s</td>
                `;
                tbody.appendChild(row);
            });
            document.getElementById('leaderboard').style.display = 'flex';
            document.getElementById('restartWaiting').style.display = 'block';
            document.getElementById('restartWaiting').textContent = '0 / ' + data.results.length + ' want to play again';
        }

        if (data.type === 'restartVote') {
            document.getElementById('restartWaiting').textContent = data.votes + ' / ' + data.total + ' want to play again';
        }

        if (data.type === 'restartGame') {
            window.location.reload();
        }
    };

    socket.onopen = () => console.log('WebSocket connected to server');
    socket.onerror = (e) => console.warn('WebSocket error:', e);
    socket.onclose = () => console.log('Disconnected from server');
}

// ── REMOTE PLAYER SPAWN ───────────────────────────────────────────────────────

let duckTemplateForRemote = null;

function spawnRemotePlayer(id) {
    const group = new THREE.Group();

    if (duckTemplateForRemote) {
        const remoteDuck = duckTemplateForRemote.clone(true);
        remoteDuck.scale.set(1.5, 1.5, 1.5);
        remoteDuck.rotation.y = Math.PI;
        group.add(remoteDuck);
<<<<<<< HEAD


=======
        if (remoteDuck.animations && remoteDuck.animations.length > 0) {
            const m = new THREE.AnimationMixer(remoteDuck);
            m.clipAction(remoteDuck.animations[0]).play();
            remotePlayerMixers[id] = m;
        }
>>>>>>> 3273d7372f3d71f40c53a3ea62dbe03840c5d81e
    } else {
        const geo = new THREE.BoxGeometry(1.5, 2, 1.5);
        const mat = new THREE.MeshStandardMaterial({ color: 0x00aaff });
        group.add(new THREE.Mesh(geo, mat));
    }

    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('Player ' + id.substring(0, 4), 4, 24);
    const texture = new THREE.CanvasTexture(canvas);
    const labelMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(3, 0.75),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
    );
    labelMesh.position.y = 3.5;
    labelMesh.rotation.x = -Math.PI / 8;
    group.add(labelMesh);

    scene.add(group);
    remotePlayers[id] = group;
}

// ── SCENE ─────────────────────────────────────────────────────────────────────

const scene = new THREE.Scene();
scene.background = new THREE.Color('skyblue');

// ── CAMERA ────────────────────────────────────────────────────────────────────

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 500);

// ── RENDERER ──────────────────────────────────────────────────────────────────

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── PLAYER ────────────────────────────────────────────────────────────────────

const player = new THREE.Group();
scene.add(player);

let modelLoaded = false;
let lastTime = performance.now();
<<<<<<< HEAD

// Load the duck .glb model asynchronously
=======
let mixer = null;
let waddleAction = null;

>>>>>>> 3273d7372f3d71f40c53a3ea62dbe03840c5d81e
const loader = new GLTFLoader();
loader.load(
    "/scriptduck.glb",
    (gltf) => {
        const duck = gltf.scene;
        const toRemove = [];
        duck.traverse((child) => { if (child.isCamera || child.isLight) toRemove.push(child); });
        toRemove.forEach((obj) => obj.parent.remove(obj));

        duck.scale.set(1.5, 1.5, 1.5);
        duck.rotation.y = Math.PI;
        player.add(duck);
        setDuckMesh(duck);
        modelLoaded = true;

        duckTemplateForRemote = duck;
        for (const id in remotePlayers) {
            const existing = remotePlayers[id];
            if (existing.children.length === 1 && existing.children[0].isMesh) {
                scene.remove(existing);
                delete remotePlayers[id];
                spawnRemotePlayer(id);
            }
        }

<<<<<<< HEAD
=======
        if (gltf.animations && gltf.animations.length > 0) {
            console.log("🦆 Animations found:", gltf.animations.map(a => a.name));
            mixer = new THREE.AnimationMixer(duck);
            const waddleClip = gltf.animations.find(a => a.name.toLowerCase() === "waddle") ?? gltf.animations[0];
            if (waddleClip) { waddleAction = mixer.clipAction(waddleClip); waddleAction.play(); }
        } else {
            console.warn("⚠️ No animations found in duck GLB.");
        }
>>>>>>> 3273d7372f3d71f40c53a3ea62dbe03840c5d81e
        console.log("✅ Duck model loaded!");
    },
    (progress) => { console.log(`Loading duck: ${Math.round((progress.loaded / progress.total) * 100)}%`); },
    (error) => {
        console.error("❌ Failed to load duck model:", error);
        const fallbackMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshStandardMaterial({ color: 0xffff00 }));
        player.add(fallbackMesh);
        modelLoaded = true;
    }
);

// ── WALLS ─────────────────────────────────────────────────────────────────────

const walls = [];

function createWalls(amount) {
    for (let i = 0; i < amount; i++) {
        const wall = new THREE.Mesh(
            new THREE.BoxGeometry(20, 10, 1),
            new THREE.MeshStandardMaterial({ color: 0x8B4513 })
        );
        wall.position.set(Math.random() * 70 - 35, 4, Math.random() * 70 - 35);
        wall.rotation.y = Math.random() < 0.5 ? 0 : Math.PI / 2;

        if (wall.position.distanceTo(player.position) < 8) { i--; continue; }

        let overlapping = false;
        for (let j = 0; j < walls.length; j++) {
            if (wall.position.distanceTo(walls[j].position) < 20) { overlapping = true; break; }
        }
        if (overlapping) { i--; continue; }

        scene.add(wall);
        walls.push(wall);
    }
}
createWalls(10);

// ── FLOOR ─────────────────────────────────────────────────────────────────────

const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: 0x228B22 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1;
scene.add(floor);

const grid = new THREE.GridHelper(100, 50, 0x000000, 0x000000);
grid.position.y = -0.99;
grid.material.opacity = 0.3;
grid.material.transparent = true;
scene.add(grid);

// ── LIGHTING ──────────────────────────────────────────────────────────────────

scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
sunLight.position.set(5, 10, 7);
scene.add(sunLight);

// ── INPUT ─────────────────────────────────────────────────────────────────────

const keys = {};
window.addEventListener('keydown', (e) => keys[e.key] = true);
window.addEventListener('keyup',   (e) => keys[e.key] = false);

window.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
        const shotData = shoot(e, camera, player, scene);
        if (isMultiplayer && socket && socket.readyState === 1 && shotData) {
            socket.send(JSON.stringify({ type: 'shoot', ...shotData }));
        }
    }
});

// ── CAMERA SETUP ──────────────────────────────────────────────────────────────

camera.position.set(0, 40, 0);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan    = false;
controls.enableRotate = false;
controls.enableZoom   = true;
controls.minDistance  = 10;
controls.maxDistance  = 80;

// ── GAME INIT ─────────────────────────────────────────────────────────────────

function updateWaitingRoom() {
    const list = document.getElementById('waitingPlayerList');
    list.innerHTML = '';
    roomPlayers.forEach((pid, i) => {
        const entry = document.createElement('div');
        entry.style.cssText = 'background:rgba(255,255,255,0.1); border-radius:6px; padding:10px 16px; color:white; font-size:16px;';
        entry.textContent = (i === 0 ? 'Host' : 'Player ' + (i + 1)) + ' — ' + pid.substring(0, 6);
        list.appendChild(entry);
    });
}

document.getElementById('startBtn').addEventListener('click', () => {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: 'startGame' }));
});

function startGame() {
    document.getElementById('mainMenu').style.display = 'none';
    document.getElementById('waitingRoom').style.display = 'none';
    if (!isMultiplayer) createNPCs(3, scene, player);
    startPickupSpawner(scene, walls);
    initUltimate(scene, player, npcs);
    animate();
}

<<<<<<< HEAD
// Solo button — no server, local AI runs as normal
document.getElementById('soloBtn').addEventListener('click', () => { //browser API that finds an HTML element by its id
    //attribute and returns it so you can read or change it with JavaScript.
    isMultiplayer = false;
    startGame();
});
=======
document.getElementById('soloBtn').addEventListener('click', () => { isMultiplayer = false; startGame(); });
>>>>>>> 3273d7372f3d71f40c53a3ea62dbe03840c5d81e

document.getElementById('multiBtn').addEventListener('click', () => {
    isMultiplayer = true;
    connectToServer();
    document.getElementById('roomOptions').style.display = 'flex';
    document.getElementById('soloBtn').style.display = 'none';
    document.getElementById('multiBtn').style.display = 'none';
});

document.getElementById('createBtn').addEventListener('click', () => {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: 'createRoom' }));
});

document.getElementById('joinBtn').addEventListener('click', () => {
    const code = document.getElementById('codeInput').value.trim().toUpperCase();
    if (code && socket && socket.readyState === 1) socket.send(JSON.stringify({ type: 'joinRoom', code }));
});

let gameOver = false;

function triggerGameOver() {
    gameOver = true;
    showFinalTime();
    showFinalKills();
    if (isMultiplayer && socket && socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'playerDied', kills: totalKills, time: Math.floor(survivalTime) }));
        spectating = true;
        const ids = Object.keys(remotePlayers);
        spectateTargetId = ids.length > 0 ? ids[0] : null;
        const overlay = document.getElementById('spectateOverlay');
        overlay.style.display = 'flex';
        document.getElementById('spectateLabel').textContent = spectateTargetId
            ? 'Player ' + spectateTargetId.substring(0, 4)
            : 'No players alive';
        document.getElementById('spectateStats').textContent =
            `Your score: ${totalKills} kills — ${Math.floor(survivalTime)}s`;
    } else {
        document.getElementById('gameOver').style.display = 'flex';
    }
}
setGameOverCallback(triggerGameOver);

document.getElementById('restartBtn').addEventListener('click', () => {
    if (socket && socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'requestRestart' }));
        document.getElementById('restartBtn').disabled = true;
        document.getElementById('restartBtn').textContent = 'Waiting...';
    }
});

// ── GAME LOOP ─────────────────────────────────────────────────────────────────

function animate() {
    requestAnimationFrame(animate);
    if (!modelLoaded) return;

    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;

<<<<<<< HEAD
    // Spectate mode — just follow the target player and render, skip all game logic
=======
    if (mixer) mixer.update(delta);
    for (const id in remotePlayerMixers) remotePlayerMixers[id].update(delta);

>>>>>>> 3273d7372f3d71f40c53a3ea62dbe03840c5d81e
    if (spectating) {
        if (spectateTargetId && remotePlayers[spectateTargetId]) {
            const pos = remotePlayers[spectateTargetId].position;
            camera.position.x = pos.x;
            camera.position.z = pos.z;
            controls.target.copy(pos);
        }
        controls.update();
        renderer.render(scene, camera);
        return;
    }

    if (gameOver) return;

    updateClock();

    const previousPosition = player.position.clone();

    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    cameraDirection.y = 0;
    cameraDirection.normalize();

    const cameraRight = new THREE.Vector3();
    cameraRight.crossVectors(cameraDirection, new THREE.Vector3(0, 1, 0)).normalize();

    const speed = 0.18;
    const moveDir = new THREE.Vector3();

    if (keys['w'] || keys['W']) moveDir.addScaledVector(cameraDirection, 1);
    if (keys['s'] || keys['S']) moveDir.addScaledVector(cameraDirection, -1);
    if (keys['a'] || keys['A']) moveDir.addScaledVector(cameraRight, -1);
    if (keys['d'] || keys['D']) moveDir.addScaledVector(cameraRight, 1);

    if (moveDir.lengthSq() > 0) {
        moveDir.normalize();
        player.position.addScaledVector(moveDir, speed);
        player.rotation.y = Math.atan2(moveDir.x, moveDir.z);
    }

    const playerBox = new THREE.Box3().setFromCenterAndSize(player.position, new THREE.Vector3(1.5, 2, 1.5));
    for (let i = 0; i < walls.length; i++) {
        if (playerBox.intersectsBox(new THREE.Box3().setFromObject(walls[i]))) {
            player.position.copy(previousPosition);
            break;
        }
    }

    if (player.position.x > 50 || player.position.x < -50 ||
        player.position.z > 50 || player.position.z < -50) {
        gameOver = true;
        showFinalTime();
        showFinalKills();
        document.getElementById('gameOver').style.display = 'flex';
        return;
    }

    if (!isMultiplayer) updateNPCs(npcs, player, playerBox, walls, delta, scene);

    for (let i = 0; i < npcs.length; i++) {
        if (new THREE.Box3().setFromObject(npcs[i]).intersectsBox(playerBox)) {
            takeDamage(20);
            break;
        }
    }
    if (gameOver) return;

    updatePickups(scene, player);
    updateHealthBar();
    updateUltimate(delta);

    const SPAWN_PER_KILL = 2;
    const MAX_FOXES = 20;
    const npcIdsBefore = npcs.map((n, i) => n.userData.serverId ?? i);
    const killsThisFrame = updateBullets(bullets, npcs, walls, scene);
    if (killsThisFrame > 0) {
        if (!isMultiplayer) {
            for (let k = 0; k < killsThisFrame; k++) addKill();
            const toSpawn = Math.min(SPAWN_PER_KILL * killsThisFrame, Math.max(0, MAX_FOXES - npcs.length));
            if (toSpawn > 0) createNPCs(toSpawn, scene, player);
        } else if (socket && socket.readyState === 1) {
            const npcIdsAfter = new Set(npcs.map((n, i) => n.userData.serverId ?? i));
            for (const npcId of npcIdsBefore) {
                if (!npcIdsAfter.has(npcId)) socket.send(JSON.stringify({ type: 'kill', npcId }));
            }
        }
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
        if (!bullets[i].mesh.userData.isEnemyBullet) continue;
        const bBox = new THREE.Box3().setFromObject(bullets[i].mesh);
        if (bBox.intersectsBox(playerBox)) {
            takeDamage(40);
            scene.remove(bullets[i].mesh);
            bullets.splice(i, 1);
        }
    }

    if (!isMultiplayer) checkLevelUp(totalKills, scene, npcs, player);
    document.getElementById('level').textContent = `Level ${getCurrentLevel()}`;

    if (isMultiplayer && socket && myId && socket.readyState === 1 && now - lastSendTime > SEND_RATE) {
        lastSendTime = now;
        socket.send(JSON.stringify({ type: 'move', x: player.position.x, y: player.position.y, z: player.position.z, ry: player.rotation.y }));
    }

    camera.position.x = player.position.x;
    camera.position.z = player.position.z;
    controls.target.copy(player.position);
    controls.update();
    renderer.render(scene, camera);
}