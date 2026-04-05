// Three.js is the core 3D library — handles scenes, cameras, meshes, lighting
import * as THREE from "three";
// OrbitControls lets the player zoom with the scroll wheel
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
// GLTFLoader lets us load .glb model files (the duck player model)
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// NPC array + functions to create and update foxes/boss each frame
import { npcs, createNPCs, updateNPCs, createBoss } from "./npc.js";
// bullets array + shoot (fires on click) + updateBullets (moves them + checks hits)
import { bullets, shoot, updateBullets, spawnRemoteBullet } from "./shoot.js";
// Timer and kill counter — updateClock ticks every frame, addKill increments the counter
import { updateClock, showFinalTime, showFinalKills, addKill, totalKills } from "./clock.js";
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
// isHost — true if this player created the room
let isHost = false;
// roomPlayers — list of player IDs in the waiting room
const roomPlayers = [];

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
    socket = new WebSocket(`wss://game-production-9138.up.railway.app`);

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        // 'init' — sent once on connect, gives us our permanent ID
        if (data.type === 'init') {
            myId = data.id;
            console.log('Connected! My ID:', myId);
        }

        // 'playerJoined' — a new player joined the room
        if (data.type === 'playerJoined') {
            roomPlayers.push(data.id);
            updateWaitingRoom();
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

        // 'npcState' — server sends NPC positions, move existing fox meshes to match
        if (data.type === 'npcState') {
            for (let i = 0; i < data.npcs.length && i < npcs.length; i++) {
                npcs[i].userData.serverId = data.npcs[i].id;
                npcs[i].position.set(data.npcs[i].x, 0, data.npcs[i].z);
            }
        }

        // 'kill' — another player killed a fox, remove it from our scene (kills are independent)
        if (data.type === 'kill') {
            const idx = npcs.findIndex(n => n.userData.serverId === data.npcId);
            if (idx !== -1) {
                scene.remove(npcs[idx]);
                npcs.splice(idx, 1);
            }
        }

        // 'roomCreated' — server confirmed room, show waiting room as host
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

        // 'joinSuccess' — code was valid, show waiting room as non-host
        if (data.type === 'joinSuccess') {
            isHost = false;
            roomPlayers.push(myId);
            document.getElementById('mainMenu').style.display = 'none';
            document.getElementById('waitingRoom').style.display = 'flex';
            updateWaitingRoom();
        }

        // 'joinFailed' — wrong code, show error
        if (data.type === 'joinFailed') {
            document.getElementById('joinError').textContent = data.reason || 'Room not found. Check the code and try again.';
            document.getElementById('joinError').style.display = 'block';
        }

        // 'gameStart' — host pressed Start, everyone begins
        if (data.type === 'gameStart') {
            document.getElementById('waitingRoom').style.display = 'none';
            startGame();
        }
    };

    socket.onopen = () => console.log('WebSocket connected to server');
    socket.onerror = (e) => console.warn('WebSocket error:', e);
    socket.onclose = () => console.log('Disconnected from server');
}

// ── MULTIPLAYER — Spawn a visual for a remote player ─────────────────────────

// We clone the duck GLB so they look the same as us.
// If the model hasn't loaded yet we use a blue fallback box;
// it gets upgraded automatically once the GLB is ready.
// We also add a floating nametag so players can tell each other apart.
let duckTemplateForRemote = null; // set once our own duck loads

function spawnRemotePlayer(id) {
    const group = new THREE.Group();

    if (duckTemplateForRemote) {
        // Clone the duck — every remote player gets their own independent copy
        const remoteDuck = duckTemplateForRemote.clone(true);
        remoteDuck.scale.set(1.5, 1.5, 1.5);
        remoteDuck.rotation.y = Math.PI;
        group.add(remoteDuck);

        // Give the remote duck its own waddle animation
        if (remoteDuck.animations && remoteDuck.animations.length > 0) {
            const m = new THREE.AnimationMixer(remoteDuck);
            m.clipAction(remoteDuck.animations[0]).play();
            remotePlayerMixers[id] = m;
        }
    } else {
        // Fallback: blue box until the duck model finishes loading
        const geo = new THREE.BoxGeometry(1.5, 2, 1.5);
        const mat = new THREE.MeshStandardMaterial({ color: 0x00aaff });
        group.add(new THREE.Mesh(geo, mat));
    }

    // Floating nametag drawn onto a canvas then used as a texture
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
    labelMesh.position.y = 3.5;          // float above the duck
    labelMesh.rotation.x = -Math.PI / 8; // tilt slightly toward camera
    group.add(labelMesh);

    scene.add(group);
    remotePlayers[id] = group;
}

// ── SCENE ─────────────────────────────────────────────────────────────────────

// The scene is the container for every 3D object — meshes, lights, camera targets
const scene = new THREE.Scene();
scene.background = new THREE.Color('skyblue'); // sets the sky/background color

// ── CAMERA ────────────────────────────────────────────────────────────────────

const fov = 60;                                       // field of view in degrees — how wide the view is
const aspect = window.innerWidth / window.innerHeight;   // screen width/height ratio
const near = 1;                                        // objects closer than this won't render
const far = 500;                                      // objects further than this won't render
const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);

// ── RENDERER ──────────────────────────────────────────────────────────────────

// WebGLRenderer draws the Three.js scene onto a <canvas> element
const renderer = new THREE.WebGLRenderer({ antialias: true }); // antialias = smoother edges
renderer.setSize(window.innerWidth, window.innerHeight);        // fill the whole browser window
document.body.appendChild(renderer.domElement);                 // add the canvas to the page

// When the browser window is resized, update camera and renderer to match
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix(); // must call this after changing camera properties
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── PLAYER ────────────────────────────────────────────────────────────────────

// A Group is an empty container — it has position/rotation but no visible mesh
// We use it so player.position works immediately before the GLB model finishes loading
const player = new THREE.Group();
scene.add(player);

// Gate that prevents the game loop from running until the duck model is ready
let modelLoaded = false;
// Tracks the timestamp of the last frame — used to calculate delta time
let lastTime = performance.now();

// Animation mixer and waddle action — set once the GLB loads
let mixer = null;
let waddleAction = null;

// Load the duck .glb model asynchronously
const loader = new GLTFLoader();
loader.load(
    "/scriptduck.glb",
    (gltf) => {
        const duck = gltf.scene; // gltf.scene is the root object of the loaded model

        // Remove cameras and lights baked into the Blender export
        // They conflict with the game's own lighting setup
        const toRemove = [];
        duck.traverse((child) => {
            if (child.isCamera || child.isLight) toRemove.push(child);
        });
        toRemove.forEach((obj) => obj.parent.remove(obj));

        duck.scale.set(1.5, 1.5, 1.5);  // scale the duck to match the game world
        duck.rotation.y = Math.PI;       // rotate 180° so the duck faces forward

        player.add(duck);           // attach the mesh to the player group
        setDuckMesh(duck);          // give health.js a reference so it can flash on damage
        modelLoaded = true;         // unlock the game loop — rendering can begin

        // Cache the duck so spawnRemotePlayer() can clone it for other players.
        // Also upgrade any blue-box placeholders that were created before this loaded.
        duckTemplateForRemote = duck;
        for (const id in remotePlayers) {
            const existing = remotePlayers[id];
            // Only upgrade fallback boxes (they have exactly 1 plain Mesh child)
            if (existing.children.length === 1 && existing.children[0].isMesh) {
                scene.remove(existing);
                delete remotePlayers[id];
                spawnRemotePlayer(id);
            }
        }

        // Set up the Waddle animation if the GLB includes one
        if (gltf.animations && gltf.animations.length > 0) {
            console.log("🦆 Animations found:", gltf.animations.map(a => a.name));
            mixer = new THREE.AnimationMixer(duck);
            const waddleClip = gltf.animations.find(a => a.name.toLowerCase() === "waddle")
                ?? gltf.animations[0]; // fallback to first clip if "waddle" isn't found
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
        // Fallback: add a yellow sphere so the game is still playable
        const fallbackGeo = new THREE.SphereGeometry(1, 32, 16);
        const fallbackMat = new THREE.MeshStandardMaterial({ color: 0xffff00 });
        const fallbackMesh = new THREE.Mesh(fallbackGeo, fallbackMat);
        player.add(fallbackMesh);
        modelLoaded = true;
    }
);

// ── WALLS ─────────────────────────────────────────────────────────────────────

const walls = []; // shared array — npc.js and shoot.js both read this for collision

function createWalls(amount) {
    for (let i = 0; i < amount; i++) {
        const wallGeo = new THREE.BoxGeometry(20, 10, 1);                    // 20 wide, 10 tall, 1 thick
        const wallMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 }); // brown color
        const wall = new THREE.Mesh(wallGeo, wallMat);

        // Place the wall at a random position within the play area
        wall.position.set(
            Math.random() * 70 - 35, // random X between -35 and +35
            4,                        // Y=4 so the bottom sits near ground level
            Math.random() * 70 - 35  // random Z between -35 and +35
        );

        // Randomly rotate the wall to face horizontally or vertically
        if (Math.random() < 0.5) {
            wall.rotation.y = 0;           // horizontal wall
        } else {
            wall.rotation.y = Math.PI / 2; // vertical wall (90 degrees)
        }

        // Reject this wall if it's too close to the player's starting position
        // Prevents the player from spawning trapped behind a wall
        if (wall.position.distanceTo(player.position) < 8) {
            i--; // decrement so the loop retries this slot
            continue;
        }

        // Reject this wall if it overlaps an already-placed wall
        // Prevents walls from clustering together and blocking huge areas
        let overlapping = false;
        for (let j = 0; j < walls.length; j++) {
            const dist = wall.position.distanceTo(walls[j].position);
            if (dist < 20) {
                overlapping = true;
                break;
            }
        }

        if (overlapping) {
            i--; // retry this slot
            continue;
        }

        scene.add(wall);   // add to the Three.js scene so it renders
        walls.push(wall);  // add to the array so collision code can find it
    }
}
createWalls(10); // spawn 10 walls at game start

// ── FLOOR ─────────────────────────────────────────────────────────────────────

const floorGeometry = new THREE.PlaneGeometry(100, 100);                    // flat 100x100 plane
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 }); // green grass color
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2; // rotate from vertical (default) to flat/horizontal
floor.position.y = -1;            // push it slightly below the player feet level
scene.add(floor);

// Grid overlay drawn just above the floor so you can see player/NPC movement
const grid = new THREE.GridHelper(100, 50, 0x000000, 0x000000);
grid.position.y = -0.99;          // slightly above the floor to prevent z-fighting (flickering)
grid.material.opacity = 0.3;      // semi-transparent so it doesn't overpower the green floor
grid.material.transparent = true;
scene.add(grid);

// ── LIGHTING ──────────────────────────────────────────────────────────────────

// MeshStandardMaterial requires light to be visible — without lights everything is black
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); // soft fill light from all directions
scene.add(ambientLight);
const sunLight = new THREE.DirectionalLight(0xffffff, 1.2); // bright directional light like the sun
sunLight.position.set(5, 10, 7);                            // position determines shadow angle
scene.add(sunLight);

// ── INPUT ─────────────────────────────────────────────────────────────────────

// keys{} tracks which keys are currently held down
// keydown sets true, keyup sets false — checked every frame in the move logic
const keys = {};
window.addEventListener('keydown', (e) => keys[e.key] = true);
window.addEventListener('keyup', (e) => keys[e.key] = false);

// Left mouse click fires a bullet toward the mouse cursor position
window.addEventListener('mousedown', (e) => {
    if (e.button === 0) { // 0 = left button, ignore right-click and middle-click
        const shotData = shoot(e, camera, player, scene);
        // In multiplayer, tell the server we fired so other players can see the bullet
        if (isMultiplayer && socket && socket.readyState === 1 && shotData) {
            socket.send(JSON.stringify({ type: 'shoot', ...shotData }));
        }
    }
});

// ── CAMERA SETUP ──────────────────────────────────────────────────────────────

// Top-down view — camera sits directly above the origin looking straight down
camera.position.set(0, 40, 0);
camera.lookAt(0, 0, 0);

// OrbitControls — only zoom is enabled, no rotation or panning
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableRotate = false; // top-down — no orbiting
controls.enableZoom = true;  // scroll wheel zooms in/out
controls.minDistance = 10;    // closest zoom
controls.maxDistance = 80;    // farthest zoom

// ── GAME INIT ─────────────────────────────────────────────────────────────────

// Updates the player list shown in the waiting room
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

// Start Game button — host only, tells server to begin for everyone
document.getElementById('startBtn').addEventListener('click', () => {
    if (socket && socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'startGame' }));
    }
});

function startGame() {
    document.getElementById('mainMenu').style.display = 'none';
    document.getElementById('waitingRoom').style.display = 'none';
    if (!isMultiplayer) createNPCs(3, scene, player); // solo: spawn locally; multiplayer: server owns NPCs
    startPickupSpawner(scene, walls);
    initUltimate(scene, player, npcs);
    animate();
}

// Solo button — no server, local AI runs as normal
document.getElementById('soloBtn').addEventListener('click', () => {
    isMultiplayer = false;
    startGame();
});

// Play Together — connect then show Create/Join options
document.getElementById('multiBtn').addEventListener('click', () => {
    isMultiplayer = true;
    connectToServer();
    document.getElementById('roomOptions').style.display = 'flex';
    document.getElementById('soloBtn').style.display = 'none';
    document.getElementById('multiBtn').style.display = 'none';
});

// Create Room — server replies with roomCreated → waiting room shown
document.getElementById('createBtn').addEventListener('click', () => {
    if (socket && socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'createRoom' }));
    }
});

// Join Room — server replies with joinSuccess or joinFailed
document.getElementById('joinBtn').addEventListener('click', () => {
    const code = document.getElementById('codeInput').value.trim().toUpperCase();
    if (code && socket && socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'joinRoom', code }));
    }
});

let gameOver = false;

// Called by health.js when player HP reaches 0
// Stops the game loop and shows the game over screen
function triggerGameOver() {
    gameOver = true;
    showFinalTime();  // display how long the player survived
    showFinalKills(); // display final kill count
    document.getElementById('gameOver').style.display = 'flex';
}
setGameOverCallback(triggerGameOver); // register so health.js can call it

// ── GAME LOOP ─────────────────────────────────────────────────────────────────

// animate() is called ~60 times per second via requestAnimationFrame
// Everything that moves or changes each frame is updated here
function animate() {
    requestAnimationFrame(animate); // schedules the next frame
    if (gameOver) return;           // stop updating everything once the game ends
    if (!modelLoaded) return;       // don't start until the duck model has loaded

    // delta = seconds since the last frame (usually ~0.016 at 60fps)
    // Used for timers so they run at the same speed regardless of frame rate
    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;

    updateClock(); // tick the survival timer and update its DOM element

    // Advance the player's waddle animation
    if (mixer) mixer.update(delta);

    // Advance each remote player's waddle animation independently
    for (const id in remotePlayerMixers) {
        remotePlayerMixers[id].update(delta);
    }

    // Save player position before movement — used to revert if a wall is hit
    const previousPosition = player.position.clone();

    // Get the direction the camera is facing (flattened to the ground plane)
    // This makes WASD move relative to the camera angle, not world axes
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    cameraDirection.y = 0;          // ignore any vertical tilt
    cameraDirection.normalize();    // make length 1 so speed is consistent

    // Right vector is perpendicular to the camera direction — used for A/D strafing
    const cameraRight = new THREE.Vector3();
    cameraRight.crossVectors(cameraDirection, new THREE.Vector3(0, 1, 0)).normalize();

    // ── PLAYER MOVEMENT ───────────────────────────────────────────────────────

    const speed = 0.18; // units per frame the player moves
    const moveDir = new THREE.Vector3();

    // Accumulate movement direction based on which keys are held
    if (keys['w'] || keys['W']) moveDir.addScaledVector(cameraDirection, 1);   // forward
    if (keys['s'] || keys['S']) moveDir.addScaledVector(cameraDirection, -1);  // backward
    if (keys['a'] || keys['A']) moveDir.addScaledVector(cameraRight, -1);      // strafe left
    if (keys['d'] || keys['D']) moveDir.addScaledVector(cameraRight, 1);       // strafe right

    const isMoving = moveDir.lengthSq() > 0; // lengthSq is cheaper than length (no sqrt)
    if (isMoving) {
        moveDir.normalize(); // normalize so diagonal movement isn't faster than straight
        player.position.addScaledVector(moveDir, speed);
        // face the duck in the direction of movement
        // Math.PI compensates for the model being exported facing the wrong way
        player.rotation.y = Math.atan2(moveDir.x, moveDir.z);
    }

    // ── PLAYER WALL COLLISION ─────────────────────────────────────────────────

    // Build a bounding box around the player's current position
    const playerBox = new THREE.Box3().setFromCenterAndSize(
        player.position,
        new THREE.Vector3(1.5, 2, 1.5) // approximate size of the duck model
    );
    // If the player overlaps any wall, snap back to where they were before moving
    for (let i = 0; i < walls.length; i++) {
        const wallBox = new THREE.Box3().setFromObject(walls[i]);
        if (playerBox.intersectsBox(wallBox)) {
            player.position.copy(previousPosition); // revert the move
            break; // only need to revert once
        }
    }

    // ── BOUNDARY CHECK ────────────────────────────────────────────────────────

    // The playable area is ±50 units — falling off the edge triggers game over
    if (player.position.x > 50 || player.position.x < -50 ||
        player.position.z > 50 || player.position.z < -50) {
        gameOver = true;
        showFinalTime();
        showFinalKills();
        document.getElementById('gameOver').style.display = 'flex';
        return; // stop the rest of this frame immediately
    }

    // ── NPC UPDATE ────────────────────────────────────────────────────────────

    // Move all foxes and the boss toward the player, handle boss timers
    // Only runs in solo — in multiplayer the server moves NPCs and sends positions
    if (!isMultiplayer) {
        updateNPCs(npcs, player, playerBox, walls, delta, scene);
    }

    // Check if any NPC is touching the player — deals contact damage
    for (let i = 0; i < npcs.length; i++) {
        const npcBox = new THREE.Box3().setFromObject(npcs[i]);
        if (npcBox.intersectsBox(playerBox)) {
            takeDamage(20); // 20 damage per contact hit
            break;          // only one NPC can hit per frame to avoid instant death
        }
    }
    if (gameOver) return; // health.js may have triggered game over via takeDamage

    // ── PICKUPS ───────────────────────────────────────────────────────────────

    // Animate popcorn bobbing and check if the player walked over one
    updatePickups(scene, player);

    // ── HUD UPDATES ───────────────────────────────────────────────────────────

    updateHealthBar();       // sync the health bar width to current HP
    updateUltimate(delta);   // charge the ultimate and move any active mini ducks

    // ── BULLETS ───────────────────────────────────────────────────────────────

    const SPAWN_PER_KILL = 2; // how many new foxes spawn when a fox is killed
    const MAX_FOXES = 20;     // hard cap — never more than 20 NPCs on screen at once
    // Snapshot server IDs before updateBullets so we can detect which foxes were killed
    const npcIdsBefore = npcs.map(n => n.userData.serverId);
    // Move all bullets forward and check if they hit a wall or NPC
    // Returns how many NPCs were killed this frame
    const killsThisFrame = updateBullets(bullets, npcs, walls, scene);
    if (killsThisFrame > 0) {
        for (let k = 0; k < killsThisFrame; k++) {
            addKill(); // increment the kill counter and update the HUD
        }
        // Only spawn if under the cap — prevents lag from too many foxes
        const canSpawn = Math.max(0, MAX_FOXES - npcs.length);
        const toSpawn = Math.min(SPAWN_PER_KILL * killsThisFrame, canSpawn);
        if (toSpawn > 0) createNPCs(toSpawn, scene, player);

        // In multiplayer, tell the server which foxes were killed so it removes them for everyone
        if (isMultiplayer && socket && socket.readyState === 1) {
            const npcIdsAfter = new Set(npcs.map(n => n.userData.serverId));
            for (const npcId of npcIdsBefore) {
                if (npcId !== undefined && !npcIdsAfter.has(npcId)) {
                    socket.send(JSON.stringify({ type: 'kill', npcId }));
                }
            }
        }
    }

    // Check if any boss bullet has hit the player
    // Enemy bullets are flagged with isEnemyBullet = true in shoot.js
    for (let i = bullets.length - 1; i >= 0; i--) {
        if (!bullets[i].mesh.userData.isEnemyBullet) continue; // skip player's own bullets
        const bBox = new THREE.Box3().setFromObject(bullets[i].mesh);
        if (bBox.intersectsBox(playerBox)) {
            takeDamage(40);                  // boss bullets deal 40 damage
            scene.remove(bullets[i].mesh);  // remove the bullet mesh from the scene
            bullets.splice(i, 1);           // remove it from the bullets array
        }
    }

    // ── LEVEL UP CHECK ────────────────────────────────────────────────────────

    // Compare total kills against the current level's target — triggers level-up if met
    checkLevelUp(totalKills, scene, npcs, player);
    document.getElementById('level').textContent = `Level ${getCurrentLevel()}`;

    // ── MULTIPLAYER — Send our position to the server ─────────────────────────

    // Throttle to SEND_RATE ms so we don't flood the server.
    // Three checks: myId (server confirmed us), readyState 1 (socket open), time elapsed.
    if (isMultiplayer && socket && myId && socket.readyState === 1 && now - lastSendTime > SEND_RATE) {
        lastSendTime = now;
        socket.send(JSON.stringify({
            type: 'move',
            x: player.position.x,
            y: player.position.y,
            z: player.position.z,
            ry: player.rotation.y  // y-axis rotation so remote players face the right way
        }));
    }

    // ── CAMERA FOLLOW ─────────────────────────────────────────────────────────

    // Lock the camera above the player so it scrolls with them
    // Y stays fixed at 40 units above (set during setup)
    camera.position.x = player.position.x;
    camera.position.z = player.position.z;
    controls.target.copy(player.position); // keep OrbitControls centered on player
    controls.update();
    renderer.render(scene, camera);
}
