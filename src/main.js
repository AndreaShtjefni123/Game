// Three.js is the core 3D library — handles scenes, cameras, meshes, lighting
import * as THREE from "three";
// OrbitControls lets the player zoom with the scroll wheel
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
// GLTFLoader lets us load .glb model files (the duck player model)
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// NPC array + functions to create and update foxes/boss each frame
import { npcs, createNPCs, updateNPCs } from "./npc.js";
// bullets array + shoot (fires on click) + updateBullets (moves them + checks hits)
import { bullets, shoot, updateBullets, spawnRemoteBullet } from "./shoot.js";
// Timer and kill counter — updateClock ticks every frame, addKill increments the counter
// setKills lets the NPC follower sync their kill count to match the NPC host
import { updateClock, showFinalTime, showFinalKills, addKill, totalKills, setKills } from "./clock.js";
// Player health system — takeDamage, healing, health bar UI, game over callback
import { takeDamage, updateHealthBar, setDuckMesh, setGameOverCallback } from "./health.js";
// Popcorn pickups that heal the player when touched
import { updatePickups, startPickupSpawner } from "./pickup.js";
// Level progression — checks kill count and triggers level-up when target is hit
import { checkLevelUp, getCurrentLevel } from "./levels.js";
// Ultimate ability — charges over time, fires mini ducks on Q press
import { initUltimate, updateUltimate } from "./ultimate.js";

// ── MULTIPLAYER — WebSocket connection ────────────────────────────────────────

// isMultiplayer is set by the menu button — false = solo, true = Play Together
let isMultiplayer = false;
// socket is only created when the player picks Play Together
let socket = null;
// myId stays null until the server tells us who we are
let myId = null;

// remotePlayers holds a Three.js Group for every OTHER player.
// Key = their ID string, Value = their Group in the scene.
const remotePlayers = {};

// Each remote duck needs its own AnimationMixer to play the
// waddle clip independently from our own mixer.
const remotePlayerMixers = {};

// We send our position 20 times per second (every 50 ms).
// Sending every frame (60/s) would flood the server needlessly.
const SEND_RATE = 50; // milliseconds
let lastSendTime = 0;

// Opens the WebSocket and sets up all message handlers.
// Only called when the player picks Play Together.
function connectToServer() {
    socket = new WebSocket(`ws://18.234.143.187:3000`);

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        // 'init' — sent once on connect, gives us our permanent ID
        if (data.type === 'init') {
            myId = data.id;
            console.log('Connected! My ID:', myId);
        }

        // 'playerJoined' — a new browser connected, create a duck for them
        if (data.type === 'playerJoined') {
            spawnRemotePlayer(data.id);
        }

        // 'playerLeft' — remove their character from our scene
        if (data.type === 'playerLeft') {
            if (remotePlayers[data.id]) {
                scene.remove(remotePlayers[data.id]);
                delete remotePlayers[data.id];
                delete remotePlayerMixers[data.id];
            }
        }

        // 'move' — another player moved, update their duck position
        if (data.type === 'move') {
            if (remotePlayers[data.id]) {
                remotePlayers[data.id].position.set(data.x, data.y, data.z);
                remotePlayers[data.id].rotation.y = data.ry;
            }
        }

        // 'shoot' — another player fired, spawn a bullet traveling in their direction
        if (data.type === 'shoot') {
            spawnRemoteBullet(data.x, data.z, data.dirX, data.dirZ, scene);
        }

        // 'npcState' — server sent authoritative NPC positions; sync meshes to match
        if (data.type === 'npcState') {
            // Auto-create meshes for any new NPCs the server spawned
            while (npcs.length < data.npcs.length) {
                createNPCs(1, scene, player);
            }
            // Remove excess NPC meshes if server killed some
            while (npcs.length > data.npcs.length) {
                scene.remove(npcs[npcs.length - 1]);
                npcs.splice(npcs.length - 1, 1);
            }
            // Sync all positions from server
            for (let i = 0; i < data.npcs.length; i++) {
                npcs[i].userData.serverId = data.npcs[i].id;
                npcs[i].position.set(data.npcs[i].x, 0, data.npcs[i].z);
            }
        }

        // 'killUpdate' — server confirms kill count; all players sync their HUD
        if (data.type === 'killUpdate') {
            setKills(data.kills);
            document.getElementById('level').textContent = 'Level ' + data.level;
        }

        // 'kill' — another player killed a fox, remove it from our scene
        if (data.type === 'kill') {
            const idx = npcs.findIndex(n => n.userData.serverId === data.npcId);
            if (idx !== -1) {
                scene.remove(npcs[idx]);
                npcs.splice(idx, 1);
            }
        }

        // 'roomCreated' — server confirmed room creation, show code and start game
        if (data.type === 'roomCreated') {
            document.getElementById('roomCodeDisplay').textContent = 'Room Code: ' + data.code;
            document.getElementById('roomCodeDisplay').style.display = 'block';
            startGame();
        }

        // 'joinSuccess' — code was valid, join the room and start game
        if (data.type === 'joinSuccess') {
            startGame();
        }

        // 'joinFailed' — code was wrong, show error message
        if (data.type === 'joinFailed') {
            document.getElementById('joinError').textContent = 'Room not found. Check the code and try again.';
            document.getElementById('joinError').style.display = 'block';
        }
    };

    socket.onopen = () => console.log('WebSocket connected to server');
    socket.onerror = (e) => console.warn('WebSocket error:', e);
    socket.onclose = () => console.log('Disconnected from server');
}

// ── MULTIPLAYER — Spawn a visual for a remote player ─────────────────────────

let duckTemplateForRemote = null; // set once our own duck loads

function spawnRemotePlayer(id) {
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
        const geo = new THREE.BoxGeometry(1.5, 2, 1.5);
        const mat = new THREE.MeshStandardMaterial({ color: 0x00aaff });
        group.add(new THREE.Mesh(geo, mat));
    }

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 32;
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

const fov    = 60;
const aspect = window.innerWidth / window.innerHeight;
const near   = 1;
const far    = 500;
const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);

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
let mixer = null;
let waddleAction = null;

const loader = new GLTFLoader();
loader.load(
    "/scriptduck.glb",
    (gltf) => {
        const duck = gltf.scene;

        const toRemove = [];
        duck.traverse((child) => {
            if (child.isCamera || child.isLight) toRemove.push(child);
        });
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

        if (gltf.animations && gltf.animations.length > 0) {
            console.log("🦆 Animations found:", gltf.animations.map(a => a.name));
            mixer = new THREE.AnimationMixer(duck);
            const waddleClip = gltf.animations.find(a => a.name.toLowerCase() === "waddle")
                ?? gltf.animations[0];
            if (waddleClip) {
                waddleAction = mixer.clipAction(waddleClip);
                waddleAction.play();
                console.log("✅ Playing animation:", waddleClip.name);
            }
        } else {
            console.warn("⚠️ No animations found in duck GLB.");
        }

        console.log("✅ Duck model loaded!");
    },
    (progress) => {
        console.log(`Loading duck: ${Math.round((progress.loaded / progress.total) * 100)}%`);
    },
    (error) => {
        console.error("❌ Failed to load duck model:", error);
        const fallbackGeo = new THREE.SphereGeometry(1, 32, 16);
        const fallbackMat = new THREE.MeshStandardMaterial({ color: 0xffff00 });
        const fallbackMesh = new THREE.Mesh(fallbackGeo, fallbackMat);
        player.add(fallbackMesh);
        modelLoaded = true;
    }
);

// ── WALLS ─────────────────────────────────────────────────────────────────────

const walls = [];

function createWalls(amount) {
    for (let i = 0; i < amount; i++) {
        const wallGeo = new THREE.BoxGeometry(20, 10, 1);
        const wallMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const wall = new THREE.Mesh(wallGeo, wallMat);

        wall.position.set(
            Math.random() * 70 - 35,
            4,
            Math.random() * 70 - 35
        );

        if (Math.random() < 0.5) {
            wall.rotation.y = 0;
        } else {
            wall.rotation.y = Math.PI / 2;
        }

        if (wall.position.distanceTo(player.position) < 8) {
            i--;
            continue;
        }

        let overlapping = false;
        for (let j = 0; j < walls.length; j++) {
            if (wall.position.distanceTo(walls[j].position) < 20) {
                overlapping = true;
                break;
            }
        }

        if (overlapping) {
            i--;
            continue;
        }

        scene.add(wall);
        walls.push(wall);
    }
}
createWalls(10);

// ── FLOOR ─────────────────────────────────────────────────────────────────────

const floorGeometry = new THREE.PlaneGeometry(100, 100);
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 });
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1;
scene.add(floor);

const grid = new THREE.GridHelper(100, 50, 0x000000, 0x000000);
grid.position.y = -0.99;
grid.material.opacity = 0.3;
grid.material.transparent = true;
scene.add(grid);

// ── LIGHTING ──────────────────────────────────────────────────────────────────

const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);
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
        // In multiplayer, tell the server we fired so other players can see the bullet
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

function startGame() {
    document.getElementById('mainMenu').style.display = 'none';
    // Solo: spawn initial NPCs locally. Multiplayer: server owns the NPCs.
    if (!isMultiplayer) createNPCs(3, scene, player);
    startPickupSpawner(scene, walls);
    initUltimate(scene, player, npcs);
    animate();
}

// Solo button — no server, local AI runs as normal
document.getElementById('soloBtn').addEventListener('click', () => {
    isMultiplayer = false;
    startGame();
});

// Play Together button — connect then show room create/join UI
document.getElementById('multiBtn').addEventListener('click', () => {
    isMultiplayer = true;
    connectToServer();
    document.getElementById('roomOptions').style.display = 'flex';
    document.getElementById('soloBtn').style.display = 'none';
    document.getElementById('multiBtn').style.display = 'none';
});

// Create Room button — server will reply with roomCreated → startGame()
document.getElementById('createBtn').addEventListener('click', () => {
    if (socket && socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'createRoom' }));
    }
});

// Join Room button — server will reply with joinSuccess/joinFailed
document.getElementById('joinBtn').addEventListener('click', () => {
    const code = document.getElementById('codeInput').value.trim().toUpperCase();
    if (code && socket && socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'joinRoom', code }));
    }
});

let gameOver = false;

function triggerGameOver() {
    gameOver = true;
    showFinalTime();
    showFinalKills();
    document.getElementById('gameOver').style.display = 'flex';
}
setGameOverCallback(triggerGameOver);

// ── GAME LOOP ─────────────────────────────────────────────────────────────────

function animate() {
    requestAnimationFrame(animate);
    if (gameOver) return;
    if (!modelLoaded) return;

    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;

    updateClock();

    if (mixer) mixer.update(delta);

    for (const id in remotePlayerMixers) {
        remotePlayerMixers[id].update(delta);
    }

    const previousPosition = player.position.clone();

    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    cameraDirection.y = 0;
    cameraDirection.normalize();

    const cameraRight = new THREE.Vector3();
    cameraRight.crossVectors(cameraDirection, new THREE.Vector3(0, 1, 0)).normalize();

    // ── PLAYER MOVEMENT ───────────────────────────────────────────────────────

    const speed = 0.18;
    const moveDir = new THREE.Vector3();

    if (keys['w'] || keys['W']) moveDir.addScaledVector(cameraDirection, 1);
    if (keys['s'] || keys['S']) moveDir.addScaledVector(cameraDirection, -1);
    if (keys['a'] || keys['A']) moveDir.addScaledVector(cameraRight, -1);
    if (keys['d'] || keys['D']) moveDir.addScaledVector(cameraRight, 1);

    const isMoving = moveDir.lengthSq() > 0;
    if (isMoving) {
        moveDir.normalize();
        player.position.addScaledVector(moveDir, speed);
        player.rotation.y = Math.atan2(moveDir.x, moveDir.z);
    }

    // ── PLAYER WALL COLLISION ─────────────────────────────────────────────────

    const playerBox = new THREE.Box3().setFromCenterAndSize(
        player.position,
        new THREE.Vector3(1.5, 2, 1.5)
    );
    for (let i = 0; i < walls.length; i++) {
        const wallBox = new THREE.Box3().setFromObject(walls[i]);
        if (playerBox.intersectsBox(wallBox)) {
            player.position.copy(previousPosition);
            break;
        }
    }

    // ── BOUNDARY CHECK ────────────────────────────────────────────────────────

    if (player.position.x > 50 || player.position.x < -50 ||
        player.position.z > 50 || player.position.z < -50) {
        gameOver = true;
        showFinalTime();
        showFinalKills();
        document.getElementById('gameOver').style.display = 'flex';
        return;
    }

    // ── NPC UPDATE ────────────────────────────────────────────────────────────

    // Solo: run the AI locally.
    // Multiplayer: server owns all NPC logic; client only mirrors received positions.
    if (!isMultiplayer) {
        updateNPCs(npcs, player, playerBox, walls, delta, scene);
    }

    // Check if any NPC is touching the player — deals contact damage
    for (let i = 0; i < npcs.length; i++) {
        const npcBox = new THREE.Box3().setFromObject(npcs[i]);
        if (npcBox.intersectsBox(playerBox)) {
            takeDamage(20);
            break;
        }
    }
    if (gameOver) return;

    // ── PICKUPS ───────────────────────────────────────────────────────────────

    updatePickups(scene, player);

    // ── HUD UPDATES ───────────────────────────────────────────────────────────

    updateHealthBar();
    updateUltimate(delta);

    // ── BULLETS ───────────────────────────────────────────────────────────────

    const SPAWN_PER_KILL = 2;
    const MAX_FOXES = 20;
    // Snapshot NPC server IDs before bullets are processed so we can detect kills
    const npcIdsBefore = npcs.map((n, i) => n.userData.serverId ?? i);
    const killsThisFrame = updateBullets(bullets, npcs, walls, scene);
    if (killsThisFrame > 0) {
        if (!isMultiplayer) {
            // Solo: increment kills locally and spawn replacements
            for (let k = 0; k < killsThisFrame; k++) addKill();
            const canSpawn = Math.max(0, MAX_FOXES - npcs.length);
            const toSpawn = Math.min(SPAWN_PER_KILL * killsThisFrame, canSpawn);
            if (toSpawn > 0) createNPCs(toSpawn, scene, player);
        } else if (socket && socket.readyState === 1) {
            // Multiplayer: tell server which NPCs were killed.
            // Server handles kill count, respawning, and broadcasting killUpdate to everyone.
            const npcIdsAfter = new Set(npcs.map((n, i) => n.userData.serverId ?? i));
            for (const npcId of npcIdsBefore) {
                if (!npcIdsAfter.has(npcId)) {
                    socket.send(JSON.stringify({ type: 'kill', npcId }));
                }
            }
        }
    }

    // Check if any boss bullet has hit the player
    for (let i = bullets.length - 1; i >= 0; i--) {
        if (!bullets[i].mesh.userData.isEnemyBullet) continue;
        const bBox = new THREE.Box3().setFromObject(bullets[i].mesh);
        if (bBox.intersectsBox(playerBox)) {
            takeDamage(40);
            scene.remove(bullets[i].mesh);
            bullets.splice(i, 1);
        }
    }

    // ── LEVEL UP CHECK ────────────────────────────────────────────────────────

    // Solo only — in multiplayer the server owns kill count, level is set by killUpdate
    if (!isMultiplayer) {
        checkLevelUp(totalKills, scene, npcs, player);
    }
    document.getElementById('level').textContent = `Level ${getCurrentLevel()}`;

    // ── MULTIPLAYER — Send our position to the server ─────────────────────────

    if (isMultiplayer && socket && myId && socket.readyState === 1 && now - lastSendTime > SEND_RATE) {
        lastSendTime = now;
        socket.send(JSON.stringify({
            type: 'move',
            x:  player.position.x,
            y:  player.position.y,
            z:  player.position.z,
            ry: player.rotation.y
        }));
    }

    // ── CAMERA FOLLOW ─────────────────────────────────────────────────────────

    camera.position.x = player.position.x;
    camera.position.z = player.position.z;
    controls.target.copy(player.position);
    controls.update();
    renderer.render(scene, camera);
}
