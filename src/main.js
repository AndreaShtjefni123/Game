import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { npcs, createNPCs, updateNPCs, spawnRemoteNpc, removeNpcById, clearAllNpcs, setOnBossSpawn } from "./npc.js";
import { bullets, shoot, updateBullets } from "./shoot.js";
import { updateClock, showFinalTime, showFinalKills, addKill, totalKills } from "./clock.js";
import { takeDamage, updateHealthBar, setDuckMesh, setGameOverCallback, heal, getHealth } from "./health.js";
import { updatePickups, startPickupSpawner, createPickupAt, removePickupById } from "./pickup.js";
import { checkLevelUp, getCurrentLevel, doLevelUp, showLevelUpOverlay } from "./levels.js";
import { initUltimate, updateUltimate } from "./ultimate.js";
import * as network from "./network.js";
import { initLobby } from "./lobby.js";
const scene = new THREE.Scene();

scene.background = new THREE.Color('skyblue');

// Create a camera
const fov = 60;
const aspect = window.innerWidth / window.innerHeight;
const near = 1;
const far = 500;

const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
camera.position.set(0, 20, 12);
camera.lookAt(0, 0, 0); // point the camera at the center

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── PLAYER (duck model) ──────────────────────────────
// Create a Group so all existing code can reference player.position
// immediately, even before the GLB finishes loading.
const player = new THREE.Group();
scene.add(player);

// We'll start the game loop only after the model is loaded
let modelLoaded = false;
let mixer = null;
let waddleAction = null;

let lastTime = performance.now();

// ── multiplayer state ─────────────────────────────────────────────────────────
let gameStarted = false;
const otherPlayers = new Map(); // socketId → { mesh, hpDisc, targetX, targetZ, targetRotation }
const npcTargets   = new Map(); // npcId   → { x, z }  (lerp targets on non-host)
let lastMoveSent = 0;
let lastNpcSent  = 0;
let remoteDuckTemplate = null; // set once the local duck GLB loads

const loader = new GLTFLoader();
loader.load(
    "/scriptduck.glb",
    (gltf) => {
        const duck = gltf.scene;

        // Remove cameras and lights that were exported from Blender
        // (they conflict with the game's own camera and lighting)
        const toRemove = [];
        duck.traverse((child) => {
            if (child.isCamera || child.isLight) {
                toRemove.push(child);
            }
        });
        toRemove.forEach((obj) => obj.parent.remove(obj));

        // Scale the duck to roughly match the old sphere size
        // Adjust these values if the duck appears too big or too small
        duck.scale.set(1.5, 1.5, 1.5);

        // Rotate so the duck faces forward (along -Z in game)
        duck.rotation.y = Math.PI;

        player.add(duck);
        setDuckMesh(duck);
        remoteDuckTemplate = duck; // used to clone meshes for remote players

        // Set up the Waddle animation
        if (gltf.animations && gltf.animations.length > 0) {
            console.log("🦆 Animations found:", gltf.animations.map(a => a.name));
            mixer = new THREE.AnimationMixer(duck);
            const waddleClip = gltf.animations.find(a => a.name.toLowerCase() === "waddle")
                ?? gltf.animations[0]; // fallback to first clip
            if (waddleClip) {
                waddleAction = mixer.clipAction(waddleClip);
                waddleAction.play();
                console.log("✅ Playing animation:", waddleClip.name);
                console.log("   Duration:", waddleClip.duration);
                console.log("   Tracks:", waddleClip.tracks.map(t => t.name));
                const names = [];
                duck.traverse(o => { if (o.name) names.push(o.name); });
                console.log("   Scene objects:", names);
            }
        } else {
            console.warn("⚠️ No animations found in duck GLB.");
        }

        modelLoaded = true;
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
            wall.rotation.y = 0;           // horizontal wall
        } else {
            wall.rotation.y = Math.PI / 2; // vertical wall (90 degrees)
        }

        // Skip if too close to player's start
        if (wall.position.distanceTo(player.position) < 8) {
            i--;
            continue;
        }

        // Skip if overlapping any already placed wall
        let overlapping = false;
        for (let j = 0; j < walls.length; j++) {
            const dist = wall.position.distanceTo(walls[j].position);
            if (dist < 20) {
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
// Cache wall boxes — walls never move so these never need recomputing
const wallBoxes = walls.map(w => new THREE.Box3().setFromObject(w));

const floorGeometry = new THREE.PlaneGeometry(100, 100);
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 });
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2; // lay it flat
floor.position.y = -1;           // push it down below the player
scene.add(floor);

// Grid overlay so you can see movement
const grid = new THREE.GridHelper(100, 50, 0x000000, 0x000000);
grid.position.y = -0.99; // just above the floor to avoid z-fighting
grid.material.opacity = 0.3;
grid.material.transparent = true;
scene.add(grid);

// Lights — required for MeshStandardMaterial to show depth
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); // soft fill light
scene.add(ambientLight);
const sunLight = new THREE.DirectionalLight(0xffffff, 1.2); // bright directional light
sunLight.position.set(5, 10, 7);
scene.add(sunLight);

//tracks which keys are getting pressed down
const keys = {};
window.addEventListener('keydown', (e) => keys[e.key] = true);
window.addEventListener('keyup', (e) => keys[e.key] = false);


const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableRotate = false;        // top-down — no orbiting
controls.enableZoom = true;           // scroll wheel zooms in/out
controls.minDistance = 10;            // closest zoom
controls.maxDistance = 80;            // farthest zoom
window.addEventListener('mousedown', (e) => {
    if (e.button === 0) { // left click only
        shoot(e, camera, player, scene); // passing player instead of sphere
    }
});

// top-down camera — directly above the player
camera.position.set(0, 40, 0);
camera.lookAt(0, 0, 0);

let gameOver = false;

function triggerGameOver() {
    gameOver = true;
    showFinalTime();
    showFinalKills();
    document.getElementById('gameOver').style.display = 'flex';
}
setGameOverCallback(triggerGameOver);

// ── remote player helpers ─────────────────────────────────────────────────────

function _hpColor(hp) {
    if (hp > 60) return 0x4caf50;
    if (hp > 30) return 0xff9800;
    return 0xf44336;
}

function addRemotePlayer(socketId, x, z, rotation, hp) {
    // Wrap the duck clone in a Group (same as local player) so the group's
    // rotation.y controls direction while the duck's built-in Math.PI offset
    // stays intact inside the group.
    const group = new THREE.Group();

    if (remoteDuckTemplate) {
        const duckClone = remoteDuckTemplate.clone(true);
        duckClone.scale.set(1.5, 1.5, 1.5);
        group.add(duckClone);
    } else {
        group.add(new THREE.Mesh(
            new THREE.SphereGeometry(1, 16, 8),
            new THREE.MeshStandardMaterial({ color: 0x00aaff })
        ));
    }

    group.position.set(x, 0, z);
    group.rotation.y = rotation || 0;

    // Small colour disc under the duck showing teammate HP
    const hpGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.12, 16);
    const hpMat = new THREE.MeshStandardMaterial({ color: _hpColor(hp) });
    const hpDisc = new THREE.Mesh(hpGeo, hpMat);
    hpDisc.position.y = -1;
    group.add(hpDisc);

    scene.add(group);
    otherPlayers.set(socketId, { mesh: group, hpDisc, targetX: x, targetZ: z, targetRotation: rotation || 0 });
}

// ── multiplayer event wiring ──────────────────────────────────────────────────

function setupMultiplayer() {
    network.on('playerJoined', ({ socketId, x, z, rotation, hp }) => {
        addRemotePlayer(socketId, x, z, rotation, hp);
    });

    network.on('playerLeft', (socketId) => {
        const p = otherPlayers.get(socketId);
        if (p) {
            scene.remove(p.mesh);
            p.mesh.traverse((child) => {
                if (child.isMesh) {
                    child.geometry?.dispose();
                    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                    else child.material?.dispose();
                }
            });
            otherPlayers.delete(socketId);
        }
    });

    network.on('playerMoved', ({ socketId, x, z, rotation }) => {
        const p = otherPlayers.get(socketId);
        if (p) { p.targetX = x; p.targetZ = z; p.targetRotation = rotation; }
    });

    network.on('playerHealth', ({ socketId, hp }) => {
        const p = otherPlayers.get(socketId);
        if (p) p.hpDisc.material.color.setHex(_hpColor(hp));
    });

    network.on('npcPositions', (data) => {
        if (network.isHost) return;
        for (const { id, x, z, ry } of data) {
            if (!npcTargets.has(id)) {
                spawnRemoteNpc(scene, id, x, z, false);
                npcTargets.set(id, { x, z, ry: ry || 0 });
            } else {
                const t = npcTargets.get(id);
                t.x = x; t.z = z; t.ry = ry || 0;
            }
        }
    });

    network.on('npcRemoved', (npcId) => {
        // wasPresent: true only for kills made by a remote player (the host's
        // own kills are already removed by updateBullets before this event fires)
        const wasPresent = npcs.some(n => n.userData.id === npcId);
        removeNpcById(scene, npcId);
        npcTargets.delete(npcId);
        if (network.isHost && wasPresent) {
            createNPCs(2, scene, player);
        }
    });

    network.on('levelUp', (newLevel) => {
        if (network.isHost) {
            doLevelUp(scene, npcs, player);
        } else {
            clearAllNpcs(scene);
            npcTargets.clear();
            showLevelUpOverlay(newLevel);
            heal(100);
        }
    });

    network.on('pickupSpawned', ({ id, x, z }) => {
        createPickupAt(scene, id, x, z);
    });

    network.on('pickupRemoved', (id) => {
        removePickupById(scene, id);
    });

    network.on('bossSpawned', ({ id, x, z }) => {
        if (network.isHost) return; // host already has the boss from doLevelUp
        spawnRemoteNpc(scene, id, x, z, true);
    });

    network.on('bossHpUpdate', (hp) => {
        document.getElementById('bossBarContainer').style.display = 'block';
        document.getElementById('bossBarInner').style.width = ((hp / 100) * 100) + '%';
    });

    network.on('bossDead', () => {
        removeNpcById(scene, npcs.find(n => n.userData.isBoss)?.userData.id);
        document.getElementById('bossBarContainer').style.display = 'none';
    });

    network.on('hostLeft', (msg) => {
        alert(msg || 'Host has left. Session ended.');
        window.location.reload();
    });

    // When host spawns a boss, report it to the server
    setOnBossSpawn((boss) => {
        if (network.isConnected() && network.isHost) {
            network.sendBossSpawned(boss.userData.id, boss.position.x, boss.position.z);
        }
    });
}

// ── game start (called by lobby) ──────────────────────────────────────────────

function startGame({ isHost, roomState, solo, waitingPlayers }) {
    if (solo) {
        // Single-player: same as before
        createNPCs(3, scene, player);
        startPickupSpawner(scene, walls);
    } else if (isHost) {
        setupMultiplayer();
        // Create duck meshes for anyone who joined during the lobby wait
        if (waitingPlayers) {
            for (const p of waitingPlayers) addRemotePlayer(p.socketId, p.x, p.z, p.rotation, p.hp);
        }
        createNPCs(3, scene, player);
        startPickupSpawner(scene, walls);
    } else {
        // Non-host joining: initialise from room state
        setupMultiplayer();
        if (roomState.npcs) {
            for (const n of roomState.npcs) spawnRemoteNpc(scene, n.id, n.x, n.z, false);
            for (const n of roomState.npcs) npcTargets.set(n.id, { x: n.x, z: n.z });
        }
        if (roomState.pickups) {
            for (const p of roomState.pickups) createPickupAt(scene, p.id, p.x, p.z);
        }
        if (roomState.players) {
            for (const p of roomState.players) addRemotePlayer(p.socketId, p.x, p.z, p.rotation, p.hp);
        }
        if (roomState.boss) {
            spawnRemoteNpc(scene, roomState.boss.id, roomState.boss.x, roomState.boss.z, true);
            document.getElementById('bossBarInner').style.width = ((roomState.boss.hp / 100) * 100) + '%';
        }
    }

    initUltimate(scene, player, npcs);
    gameStarted = true;
}

initLobby(startGame);



function animate() {
    requestAnimationFrame(animate);
    if (gameOver || !modelLoaded || !gameStarted) return;

    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;

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

    const isMoving = moveDir.lengthSq() > 0;
    if (isMoving) {
        moveDir.normalize();
        player.position.addScaledVector(moveDir, speed);
        // rotate duck to face movement direction (+ Math.PI compensates for the model's built-in flip)
        player.rotation.y = Math.atan2(moveDir.x, moveDir.z);
    }

    if (mixer) mixer.update(delta);

    // wall collision
    const playerBox = new THREE.Box3().setFromCenterAndSize(
        player.position,
        new THREE.Vector3(1.5, 2, 1.5)
    );
    for (let i = 0; i < wallBoxes.length; i++) {
        if (playerBox.intersectsBox(wallBoxes[i])) {
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

    // ── send player position (throttled 20 Hz) ────────────────────────────────
    if (network.isConnected() && now - lastMoveSent >= 50) {
        network.sendMove(player.position.x, player.position.z, player.rotation.y);
        lastMoveSent = now;
    }

    // ── lerp remote player duck meshes ────────────────────────────────────────
    for (const [, p] of otherPlayers) {
        p.mesh.position.x += (p.targetX - p.mesh.position.x) * 0.15;
        p.mesh.position.z += (p.targetZ - p.mesh.position.z) * 0.15;
        let rotDiff = p.targetRotation - p.mesh.rotation.y;
        while (rotDiff >  Math.PI) rotDiff -= 2 * Math.PI;
        while (rotDiff < -Math.PI) rotDiff += 2 * Math.PI;
        p.mesh.rotation.y += rotDiff * 0.2;
    }

    // ── NPC update (host or solo only) ────────────────────────────────────────
    if (!network.isConnected() || network.isHost) {
        // Pass remote player positions so NPCs chase the nearest player
        const remotePositions = [...otherPlayers.values()]
            .map(p => new THREE.Vector3(p.targetX, 0, p.targetZ));
        updateNPCs(npcs, player, playerBox, wallBoxes, remotePositions);
    }

    // ── lerp remote NPC meshes toward received positions (non-host) ──────────
    if (network.isConnected() && !network.isHost) {
        const npcById = new Map(npcs.map(n => [n.userData.id, n]));
        for (const [id, t] of npcTargets) {
            const npc = npcById.get(id);
            if (npc) {
                npc.position.x += (t.x - npc.position.x) * 0.1;
                npc.position.z += (t.z - npc.position.z) * 0.1;
                if (t.ry !== undefined) npc.rotation.y = t.ry;
            }
        }
    }

    // ── send NPC positions (host only, throttled 20 Hz) ───────────────────────
    if (network.isConnected() && network.isHost && now - lastNpcSent >= 50) {
        network.sendNpcPositions(npcs.map(n => ({ id: n.userData.id, x: n.position.x, z: n.position.z, ry: n.rotation.y })));
        lastNpcSent = now;
    }

    // NPC contact damage
    for (let i = 0; i < npcs.length; i++) {
        const npcBox = new THREE.Box3().setFromObject(npcs[i]);
        if (npcBox.intersectsBox(playerBox)) {
            takeDamage(20);
            if (network.isConnected()) network.sendHealth(getHealth());
            break;
        }
    }
    if (gameOver) return;

    updatePickups(scene, player);
    updateHealthBar();
    updateUltimate(delta);

    // ── bullets → kills ───────────────────────────────────────────────────────
    const SPAWN_PER_KILL = 2;
    const { kills: killsThisFrame, killedIds, bossKilled } = updateBullets(bullets, npcs, walls, scene);
    if (killsThisFrame > 0) {
        for (let k = 0; k < killsThisFrame; k++) addKill();

        if (network.isConnected()) {
            for (const id of killedIds) network.sendKill(id);
        }

        // Only the host (or solo) spawns replacement NPCs
        if (!network.isConnected() || network.isHost) {
            createNPCs(SPAWN_PER_KILL * killsThisFrame, scene, player);
        }

        // Clean npcTargets for non-host
        if (network.isConnected() && !network.isHost) {
            for (const id of killedIds) npcTargets.delete(id);
        }
    }

    // ── level-up (solo only — multiplayer driven by server levelUp event) ─────
    if (!network.isConnected()) {
        if (bossKilled) {
            doLevelUp(scene, npcs, player);
        } else {
            checkLevelUp(totalKills, scene, npcs, player);
        }
    }

    document.getElementById('level').textContent = `Level ${getCurrentLevel()}`;

    // top-down camera follows player
    camera.position.x = player.position.x;
    camera.position.z = player.position.z;
    controls.target.copy(player.position);
    controls.update();
    renderer.render(scene, camera);
}
animate();