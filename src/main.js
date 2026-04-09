import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { npcs, createNPCs, updateNPCs, createBoss, npcById, recentlySpawned, createNPCMeshAt, createBossMeshAt } from "./npc.js";
import { bullets, shoot, updateBullets, spawnBullet } from "./shoot.js";
import { updateClock, showFinalTime, showFinalKills, addKill, totalKills } from "./clock.js";
import { takeDamage, updateHealthBar, setDuckMesh, setGameOverCallback } from "./health.js";
import { updatePickups, startPickupSpawner } from "./pickup.js";
import { checkLevelUp, getCurrentLevel } from "./levels.js";
import { initUltimate, updateUltimate } from "./ultimate.js";

// ── WEBSOCKET — created only when Multiplayer is chosen ──────────────────────
let socket = null;

// ── MULTIPLAYER STATE ─────────────────────────────────────────────────────────
let myId   = null;
let myRole = null;      // 'host' | 'guest'
let gameStarted = false;
let gameOver    = false;

// Host tracks each guest's last known position (from move messages) and HP
const guestStates = new Map(); // guestId → { x, z, hp, lastHitTime }
const guests      = new Set(); // guestIds who have sent 'ready'

// Wall seed — host generates, guest receives via init
let wallSeed  = null;
let wallBoxes = []; // pre-computed Box3 array after createWalls (Phase 0)

// ── SCENE ─────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color('skyblue');

// ── CAMERA + RENDERER ─────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 500);
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
let lastTime    = performance.now();
let mixer       = null;
let duckTemplateForRemote = null;

const duckLoader = new GLTFLoader();
duckLoader.load(
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

        // Upgrade any blue-box placeholders that were spawned before model loaded
        for (const id in remotePlayers) {
            const existing = remotePlayers[id];
            if (existing.children.length === 1 && existing.children[0].isMesh) {
                scene.remove(existing);
                delete remotePlayers[id];
                spawnRemotePlayer(id);
            }
        }

        if (gltf.animations && gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(duck);
            const clip = gltf.animations.find(a => a.name.toLowerCase() === 'waddle') ?? gltf.animations[0];
            if (clip) mixer.clipAction(clip).play();
        }
        console.log("✅ Duck model loaded!");
    },
    undefined,
    (err) => {
        console.error("❌ Failed to load duck model:", err);
        player.add(new THREE.Mesh(
            new THREE.SphereGeometry(1, 32, 16),
            new THREE.MeshStandardMaterial({ color: 0xffff00 })
        ));
        modelLoaded = true;
    }
);

// ── REMOTE PLAYERS ────────────────────────────────────────────────────────────
const remotePlayers      = {};
const remotePlayerMixers = {};

function spawnRemotePlayer(id) {
    if (remotePlayers[id]) return;
    const group = new THREE.Group();

    if (duckTemplateForRemote) {
        const remoteDuck = duckTemplateForRemote.clone(true);
        remoteDuck.scale.set(1.5, 1.5, 1.5);
        remoteDuck.rotation.y = Math.PI;
        group.add(remoteDuck);
        if (remoteDuck.animations && remoteDuck.animations.length > 0) {
            const m = new THREE.AnimationMixer(remoteDuck);
            m.clipAction(remoteDuck.animations[0]).play();
            remotePlayerMixers[id] = m;
        }
    } else {
        group.add(new THREE.Mesh(
            new THREE.BoxGeometry(1.5, 2, 1.5),
            new THREE.MeshStandardMaterial({ color: 0x00aaff })
        ));
    }

    // Floating nametag
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.font = 'bold 20px Arial';
    ctx.fillText('Player ' + id.substring(0, 6), 4, 24);
    const label = new THREE.Mesh(
        new THREE.PlaneGeometry(3, 0.75),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false })
    );
    label.position.y  = 3.5;
    label.rotation.x  = -Math.PI / 8;
    group.add(label);

    // Lerp targets for smooth 60Hz interpolation (Phase 13)
    group.userData.targetPosition = new THREE.Vector3();
    group.userData.targetRY       = 0;

    scene.add(group);
    remotePlayers[id] = group;
}

// ── WALLS — seeded RNG (Phase 4) ──────────────────────────────────────────────
const walls = [];

// Mulberry32 seeded PRNG — deterministic on both host and guest given the same seed
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function createWalls(amount, seedValue) {
    const rng = seedValue != null ? mulberry32(seedValue) : () => Math.random();
    for (let i = 0; i < amount; i++) {
        const wall = new THREE.Mesh(
            new THREE.BoxGeometry(20, 10, 1),
            new THREE.MeshStandardMaterial({ color: 0x8B4513 })
        );
        wall.position.set(rng() * 70 - 35, 4, rng() * 70 - 35);
        wall.rotation.y = rng() < 0.5 ? 0 : Math.PI / 2;

        if (wall.position.distanceTo(player.position) < 8) { i--; continue; }

        let overlapping = false;
        for (let j = 0; j < walls.length; j++) {
            if (wall.position.distanceTo(walls[j].position) < 20) { overlapping = true; break; }
        }
        if (overlapping) { i--; continue; }

        scene.add(wall);
        walls.push(wall);
    }
    // Pre-compute Box3 once — passed to updateNPCs and updateBullets every frame (Phase 0)
    wallBoxes = walls.map(w => new THREE.Box3().setFromObject(w));
}

// ── FLOOR & GRID ──────────────────────────────────────────────────────────────
const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({ color: 0x228B22 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1;
scene.add(floor);

const grid = new THREE.GridHelper(100, 50, 0x000000, 0x000000);
grid.position.y = -0.99;
grid.material.opacity    = 0.3;
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
    if (e.button === 0 && gameStarted && !gameOver) {
        shoot(e, camera, player, scene, socket, myId);
    }
});

// ── CAMERA ────────────────────────────────────────────────────────────────────
camera.position.set(0, 40, 0);
camera.lookAt(0, 0, 0);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan    = false;
controls.enableRotate = false;
controls.enableZoom   = true;
controls.minDistance  = 10;
controls.maxDistance  = 80;

// ── GAME OVER ─────────────────────────────────────────────────────────────────
function triggerGameOver(reason) {
    if (gameOver) return;
    gameOver = true;
    if (myRole === 'guest' && socket && socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'guestDied' }));
    } else if (myRole === 'host' && socket && socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'gameOver', reason: reason ?? 'npc_contact' }));
    }
    showFinalTime();
    showFinalKills();
    document.getElementById('gameOver').style.display = 'flex';
}
setGameOverCallback(() => triggerGameOver('npc_contact'));

// ── GAME INIT ─────────────────────────────────────────────────────────────────
function startGame() {
    if (gameStarted) return;
    gameStarted = true;
    document.getElementById('lobby').style.display = 'none';

    if (myRole === 'host') {
        wallSeed = Math.floor(Math.random() * 1_000_000);
        createWalls(10, wallSeed);
        createNPCs(3, scene, player);
        recentlySpawned.length = 0; // no guests yet — discard initial batch
        startPickupSpawner(scene, walls);
        initUltimate(scene, player, npcs);

        // NPC sync interval — every 200ms host sends position corrections to guests (Phase 8)
        setInterval(() => {
            if (!socket || socket.readyState !== 1 || guests.size === 0) return;
            const moved = npcs.filter(n =>
                n.userData.lastSyncPos && n.position.distanceTo(n.userData.lastSyncPos) > 0.1
            ).map(n => ({ id: n.userData.id, x: n.position.x, z: n.position.z }));
            if (moved.length === 0) return;
            socket.send(JSON.stringify({ type: 'npcSync', npcs: moved }));
            npcs.forEach(n => { if (n.userData.lastSyncPos) n.userData.lastSyncPos.copy(n.position); });
        }, 200);
    } else {
        // Guest: walls already built from init message, npcs arrive via npcSpawned
        initUltimate(scene, player, npcs);
    }
}

// ── HOST HELPER: spawn NPCs and broadcast to guests (Phase 6) ─────────────────
function spawnNPCsAndSync(count) {
    recentlySpawned.length = 0;
    createNPCs(count, scene, player);
    if (guests.size > 0 && socket && socket.readyState === 1) {
        const batch = recentlySpawned.map(n => ({ id: n.userData.id, x: n.position.x, z: n.position.z }));
        if (batch.length > 0) socket.send(JSON.stringify({ type: 'npcSpawned', npcs: batch }));
    }
    recentlySpawned.length = 0;
}

// ── MULTIPLAYER CONNECT — called only when Multiplayer is chosen ──────────────
function connectMultiplayer() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsHost   = location.hostname === 'localhost' ? 'localhost:3000' : `${location.hostname}:3000`;
    socket = new WebSocket(`${protocol}://${wsHost}`);

// ── SOCKET MESSAGES ───────────────────────────────────────────────────────────
socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    // ── ROOM SETUP ────────────────────────────────────────────────────────────
    if (data.type === 'roomCreated') {
        myId   = data.myId;
        myRole = 'host';
        document.getElementById('roomCode').textContent    = data.code;
        document.getElementById('roomDisplay').style.display = 'block';
        startGame();
        return;
    }

    if (data.type === 'roomJoined') {
        myId   = data.myId;
        myRole = 'guest';
        // Wait for 'init' from host before starting
        return;
    }

    if (data.type === 'roomError') {
        document.getElementById('lobbyError').textContent = data.reason;
        return;
    }

    // ── HOST: guest joined — send world state ─────────────────────────────────
    if (data.type === 'guestJoined') {
        spawnRemotePlayer(data.guestId);
        if (socket.readyState === 1) {
            socket.send(JSON.stringify({
                type:    'init',
                to:      data.guestId,
                wallSeed,
                hostPos: { x: player.position.x, z: player.position.z }
            }));
        }
        return;
    }

    // HOST: guest finished building world — send current NPC state (Phase 6)
    if (data.type === 'ready') {
        guests.add(data.id);
        guestStates.set(data.id, { x: 0, z: 0, hp: 100, lastHitTime: -Infinity });
        if (socket.readyState === 1) {
            const batch = npcs.map(n => ({ id: n.userData.id, x: n.position.x, z: n.position.z }));
            socket.send(JSON.stringify({ type: 'npcSpawned', npcs: batch }));
        }
        return;
    }

    // HOST: guest disconnected mid-game
    if (data.type === 'guestLeft') {
        if (remotePlayers[data.guestId]) {
            scene.remove(remotePlayers[data.guestId]);
            delete remotePlayers[data.guestId];
            delete remotePlayerMixers[data.guestId];
        }
        guests.delete(data.guestId);
        guestStates.delete(data.guestId);
        return;
    }

    // HOST: guest HP hit 0 — remove their duck
    if (data.type === 'guestDied') {
        if (remotePlayers[data.id]) {
            scene.remove(remotePlayers[data.id]);
            delete remotePlayers[data.id];
            delete remotePlayerMixers[data.id];
        }
        guests.delete(data.id);
        guestStates.delete(data.id);
        return;
    }

    // ── GUEST: receive world state from host ──────────────────────────────────
    if (data.type === 'init') {
        wallSeed = data.wallSeed;
        createWalls(10, wallSeed);

        // Spawn a duck representing the host
        spawnRemotePlayer(data.id); // data.id = relay-attached host ID
        if (remotePlayers[data.id]) {
            remotePlayers[data.id].position.set(data.hostPos.x, 0, data.hostPos.z);
            remotePlayers[data.id].userData.targetPosition.set(data.hostPos.x, 0, data.hostPos.z);
        }
        socket.send(JSON.stringify({ type: 'ready' }));
        startGame();
        return;
    }

    // GUEST: create NPC meshes from host's npcSpawned (Phase 6 / 7)
    if (data.type === 'npcSpawned' && myRole === 'guest') {
        for (const n of data.npcs) {
            if (npcById.has(n.id)) continue; // already exists
            createNPCMeshAt(scene, n.id, n.x, n.z);
        }
        return;
    }

    // GUEST: apply drift corrections (Phase 9)
    if (data.type === 'npcSync' && myRole === 'guest') {
        for (const n of data.npcs) {
            const mesh = npcById.get(n.id);
            if (!mesh) continue;
            const target = new THREE.Vector3(n.x, 0, n.z);
            const drift  = mesh.position.distanceTo(target);
            if (drift < 0.5) {
                // within tolerance — ignore
            } else if (drift < 4.0) {
                mesh.userData.correctionTarget = target;
                mesh.userData.correctionFrames = 30;
            } else {
                mesh.position.copy(target); // large drift — snap immediately
            }
        }
        return;
    }

    // GUEST: remove NPC confirmed dead by host (Phase 10)
    if (data.type === 'npcKilled' && myRole === 'guest') {
        const mesh = npcById.get(data.id);
        if (mesh) {
            scene.remove(mesh);
            const idx = npcs.indexOf(mesh);
            if (idx !== -1) npcs.splice(idx, 1);
            npcById.delete(data.id);
            if (mesh.userData.isBoss) {
                document.getElementById('bossBarContainer').style.display = 'none';
            }
        }
        document.getElementById('kills').textContent = `Kills: ${data.kills}`;
        return;
    }

    // ── MOVEMENT (Phase 13) ───────────────────────────────────────────────────
    if (data.type === 'move') {
        // Host uses guest position for collision detection (auth comes from move messages)
        if (myRole === 'host' && guestStates.has(data.id)) {
            const gs = guestStates.get(data.id);
            gs.x = data.x; gs.z = data.z;
        }
        // Update lerp target for smooth visual interpolation
        if (remotePlayers[data.id]) {
            remotePlayers[data.id].userData.targetPosition.set(data.x, data.y ?? 0, data.z);
            remotePlayers[data.id].userData.targetRY = data.ry ?? 0;
        }
        return;
    }

    // ── BOSS ──────────────────────────────────────────────────────────────────
    if (data.type === 'bossSpawned' && myRole === 'guest') {
        if (!npcById.has(data.id)) {
            createBossMeshAt(scene, data.id, data.x, data.z);
        }
        return;
    }

    if (data.type === 'bossHit' && myRole === 'guest') {
        document.getElementById('bossBarInner').style.width = `${(data.hp / 100) * 100}%`;
        const boss = npcs.find(n => n.userData.isBoss);
        if (boss) boss.userData.hp = data.hp;
        return;
    }

    // ── BULLETS ───────────────────────────────────────────────────────────────
    // Spawn other players' bullets locally for visuals; kill authority stays on host
    if (data.type === 'bulletSpawned') {
        spawnBullet(scene, data.origin, data.dir, data.bulletId);
        return;
    }

    // ── DAMAGE & END ──────────────────────────────────────────────────────────
    if (data.type === 'playerDamaged' && myRole === 'guest') {
        takeDamage(data.amount);
        return;
    }

    if (data.type === 'gameOver' && myRole === 'guest') {
        if (gameOver) return;
        gameOver = true;
        showFinalTime();
        showFinalKills();
        document.getElementById('gameOver').querySelector('h1').textContent = 'Game Over';
        document.getElementById('gameOver').style.display = 'flex';
        return;
    }

    if (data.type === 'hostLeft') {
        if (gameOver) return;
        gameOver = true;
        showFinalTime();
        showFinalKills();
        document.getElementById('gameOver').querySelector('h1').textContent = 'Host left the game';
        document.getElementById('gameOver').style.display = 'flex';
    }
};

socket.onopen  = () => console.log('WebSocket connected');
socket.onerror = (e) => console.warn('WebSocket error:', e);
socket.onclose = () => {
    if (!gameOver && myRole === 'guest') triggerGameOver('hostLeft');
};

// ── LOBBY BUTTONS ─────────────────────────────────────────────────────────────
document.getElementById('createBtn').addEventListener('click', () => {
    document.getElementById('lobbyError').textContent = '';
    socket.send(JSON.stringify({ type: 'createRoom' }));
});

document.getElementById('joinBtn').addEventListener('click', () => {
    const code = document.getElementById('codeInput').value.toUpperCase().trim();
    if (!code) return;
    document.getElementById('lobbyError').textContent = '';
    socket.send(JSON.stringify({ type: 'joinRoom', code }));
});
} // end connectMultiplayer()

// ── MAIN MENU BUTTONS ─────────────────────────────────────────────────────────
document.getElementById('spBtn').addEventListener('click', () => {
    document.getElementById('mainMenu').style.display = 'none';
    myRole = 'host';
    startGame();
});

document.getElementById('mpBtn').addEventListener('click', () => {
    document.getElementById('mainMenu').style.display = 'none';
    document.getElementById('lobby').style.display = 'flex';
    connectMultiplayer();
});

// ── GAME LOOP ─────────────────────────────────────────────────────────────────
const SEND_RATE   = 16; // 60Hz position broadcast (Phase 13)
let   lastSendTime = 0;

function animate() {
    requestAnimationFrame(animate);
    if (!gameStarted || gameOver || !modelLoaded) {
        // Keep rendering the lobby/game-over screen while idle
        renderer.render(scene, camera);
        return;
    }

    const now   = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;

    updateClock();
    if (mixer) mixer.update(delta);
    for (const id in remotePlayerMixers) remotePlayerMixers[id].update(delta);

    // ── Lerp remote players toward incoming positions (Phase 13) ─────────────
    for (const id in remotePlayers) {
        const rp = remotePlayers[id];
        if (!rp.userData.targetPosition) continue;
        rp.position.lerp(rp.userData.targetPosition, 0.2);
        if (rp.userData.targetRY !== undefined) {
            rp.rotation.y += (rp.userData.targetRY - rp.rotation.y) * 0.2;
        }
    }

    // ── PLAYER MOVEMENT ───────────────────────────────────────────────────────
    const previousPosition = player.position.clone();
    const cameraDirection  = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    cameraDirection.y = 0;
    cameraDirection.normalize();
    const cameraRight = new THREE.Vector3();
    cameraRight.crossVectors(cameraDirection, new THREE.Vector3(0, 1, 0)).normalize();

    const moveDir = new THREE.Vector3();
    if (keys['w'] || keys['W']) moveDir.addScaledVector(cameraDirection,  1);
    if (keys['s'] || keys['S']) moveDir.addScaledVector(cameraDirection, -1);
    if (keys['a'] || keys['A']) moveDir.addScaledVector(cameraRight,     -1);
    if (keys['d'] || keys['D']) moveDir.addScaledVector(cameraRight,      1);

    if (moveDir.lengthSq() > 0) {
        moveDir.normalize();
        player.position.addScaledVector(moveDir, 0.18);
        player.rotation.y = Math.atan2(moveDir.x, moveDir.z);
    }

    // Player wall collision
    const playerBox = new THREE.Box3().setFromCenterAndSize(player.position, new THREE.Vector3(1.5, 2, 1.5));
    for (let i = 0; i < wallBoxes.length; i++) {
        if (playerBox.intersectsBox(wallBoxes[i])) { player.position.copy(previousPosition); break; }
    }

    // Boundary check
    if (Math.abs(player.position.x) > 50 || Math.abs(player.position.z) > 50) {
        triggerGameOver('out_of_bounds');
        return;
    }

    // ── NPC UPDATE — both host and guest simulate locally (Phase 7) ───────────
    updateNPCs(npcs, player, playerBox, walls, delta, scene, wallBoxes, myRole === 'host');

    // ── BULLETS ───────────────────────────────────────────────────────────────
    const isHost = myRole === 'host';
    const { killedNpcIds, bossHit, newBossHp } = updateBullets(
        bullets, npcs, walls, scene, isHost, wallBoxes
    );

    if (isHost) {
        // Kill handling — update counter, send npcKilled, spawn replacements (Phase 10)
        for (const npcId of killedNpcIds) {
            addKill();
            npcById.delete(npcId);
            if (socket && socket.readyState === 1) {
                socket.send(JSON.stringify({ type: 'npcKilled', id: npcId, kills: totalKills }));
            }
        }
        if (killedNpcIds.length > 0) {
            spawnNPCsAndSync(2 * killedNpcIds.length);
        }

        // Broadcast boss HP after hit so all guests update their bar
        if (bossHit && socket && socket.readyState === 1 && guests.size > 0) {
            socket.send(JSON.stringify({ type: 'bossHit', hp: newBossHp }));
        }

        // NPC contact — host player
        const freshPlayerBox = new THREE.Box3().setFromCenterAndSize(player.position, new THREE.Vector3(1.5, 2, 1.5));
        for (let i = 0; i < npcs.length; i++) {
            if (new THREE.Box3().setFromObject(npcs[i]).intersectsBox(freshPlayerBox)) {
                takeDamage(20);
                break;
            }
        }
        if (gameOver) return;

        // NPC contact — guests (positions from move messages, 2s i-frames per guest)
        for (const [guestId, gs] of guestStates) {
            if (Date.now() - gs.lastHitTime < 2000) continue;
            const guestBox = new THREE.Box3().setFromCenterAndSize(
                new THREE.Vector3(gs.x, 0, gs.z), new THREE.Vector3(1.5, 2, 1.5)
            );
            for (let i = 0; i < npcs.length; i++) {
                if (new THREE.Box3().setFromObject(npcs[i]).intersectsBox(guestBox)) {
                    gs.hp = Math.max(0, gs.hp - 20);
                    gs.lastHitTime = Date.now();
                    if (socket && socket.readyState === 1) {
                        socket.send(JSON.stringify({
                            type: 'playerDamaged', to: guestId, guestId, amount: 20, hp: gs.hp
                        }));
                    }
                    break;
                }
            }
        }

        // Boss bullets — host checks against player
        const pb = new THREE.Box3().setFromCenterAndSize(player.position, new THREE.Vector3(1.5, 2, 1.5));
        for (let i = bullets.length - 1; i >= 0; i--) {
            if (!bullets[i].mesh.userData.isEnemyBullet) continue;
            if (new THREE.Box3().setFromObject(bullets[i].mesh).intersectsBox(pb)) {
                takeDamage(40);
                scene.remove(bullets[i].mesh);
                bullets.splice(i, 1);
            }
        }

        // Pickups — host-only collection; guests don't see pickups (future enhancement)
        updatePickups(scene, player);

        // Drain recentlySpawned — catches boss minion spawns from updateNPCs (Phase 6)
        if (recentlySpawned.length > 0 && guests.size > 0 && socket && socket.readyState === 1) {
            const batch = recentlySpawned.map(n => ({ id: n.userData.id, x: n.position.x, z: n.position.z }));
            socket.send(JSON.stringify({ type: 'npcSpawned', npcs: batch }));
        }
        recentlySpawned.length = 0;

        // Level up — callback sends npcKilled for cleared NPCs before new wave spawns
        checkLevelUp(totalKills, scene, npcs, player, (clearedIds) => {
            for (const id of clearedIds) {
                npcById.delete(id);
                if (socket && socket.readyState === 1) {
                    socket.send(JSON.stringify({ type: 'npcKilled', id, kills: totalKills }));
                }
            }
        });

        // After level-up, new wave NPCs are in recentlySpawned — drain on next frame

        document.getElementById('level').textContent = `Level ${getCurrentLevel()}`;

    } else {
        // Guest: boss bullets — remove visually; damage comes from playerDamaged
        const pb = new THREE.Box3().setFromCenterAndSize(player.position, new THREE.Vector3(1.5, 2, 1.5));
        for (let i = bullets.length - 1; i >= 0; i--) {
            if (!bullets[i].mesh.userData.isEnemyBullet) continue;
            if (new THREE.Box3().setFromObject(bullets[i].mesh).intersectsBox(pb)) {
                scene.remove(bullets[i].mesh);
                bullets.splice(i, 1);
            }
        }
    }

    // ── HUD ───────────────────────────────────────────────────────────────────
    updateHealthBar();
    updateUltimate(delta);

    // ── SEND POSITION 60Hz (Phase 13) with backpressure guard (Phase 12) ──────
    if (myId && socket && socket.readyState === 1 && now - lastSendTime > SEND_RATE) {
        if (socket.bufferedAmount < 8192) {
            lastSendTime = now;
            socket.send(JSON.stringify({
                type: 'move',
                x:   player.position.x,
                y:   player.position.y,
                z:   player.position.z,
                ry:  player.rotation.y
            }));
        }
    }

    // ── CAMERA FOLLOW ─────────────────────────────────────────────────────────
    camera.position.x = player.position.x;
    camera.position.z = player.position.z;
    controls.target.copy(player.position);
    controls.update();
    renderer.render(scene, camera);
}

animate(); // single RAF loop — gameStarted flag gates all game logic
