import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { npcs, createNPCs, updateNPCs, syncNPCs } from "./npc.js";
import { bullets, shoot, shootFromRemote, updateBullets, syncBullets } from "./shoot.js";
import { updateClock, showFinalTime, showFinalKills, addKill, totalKills, survivalTime } from "./clock.js";
import { takeDamage, updateHealthBar, setDuckMesh, setGameOverCallback, getHealth, setHealth } from "./health.js";
import { pickups, updatePickups, startPickupSpawner, syncPickups } from "./pickup.js";
import { checkLevelUp, getCurrentLevel } from "./levels.js";
import { initUltimate, updateUltimate, activateUltimateAt } from "./ultimate.js";
import { initLobby } from "./lobby.js";
import * as net from "./network.js";

// ── SCENE ───────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color('skyblue');

const fov = 60;
const aspect = window.innerWidth / window.innerHeight;
const near = 1;
const far = 500;
const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
camera.position.set(0, 20, 12);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── PLAYER (duck model) ─────────────────────────────
const player = new THREE.Group();
scene.add(player);

let modelLoaded = false;
let mixer = null;
let waddleAction = null;
let lastTime = performance.now();

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

        if (gltf.animations && gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(duck);
            const waddleClip = gltf.animations.find(a => a.name.toLowerCase() === "waddle")
                ?? gltf.animations[0];
            if (waddleClip) {
                waddleAction = mixer.clipAction(waddleClip);
                waddleAction.play();
            }
        }
        modelLoaded = true;
    },
    undefined,
    (error) => {
        console.error("Failed to load duck model:", error);
        const fallbackGeo = new THREE.SphereGeometry(1, 32, 16);
        const fallbackMat = new THREE.MeshStandardMaterial({ color: 0xffff00 });
        player.add(new THREE.Mesh(fallbackGeo, fallbackMat));
        modelLoaded = true;
    }
);

// ── MULTIPLAYER STATE ───────────────────────────────
let gameStarted = false;
let multiplayerHost = false;
let remotePlayer = null;
let remotePlayerHealth = 100;
let remotePlayerLastHit = -Infinity;
const REMOTE_IFRAME = 2000;
let clientInputBuffer = [];
let lastStateSendTime = 0;
let lastInputSendTime = 0;
let latestSnapshot = null;
let prevSnapshot = null;
let inputSeq = 0;
let pendingShoot = null;
let pendingUlt = false;
let stateTick = 0;

// ── WALLS ───────────────────────────────────────────
const walls = [];
const wallData = [];

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
        wall.rotation.y = Math.random() < 0.5 ? 0 : Math.PI / 2;

        if (wall.position.distanceTo(player.position) < 8) { i--; continue; }

        let overlapping = false;
        for (let j = 0; j < walls.length; j++) {
            if (wall.position.distanceTo(walls[j].position) < 20) {
                overlapping = true;
                break;
            }
        }
        if (overlapping) { i--; continue; }

        scene.add(wall);
        walls.push(wall);
        wallData.push({ x: wall.position.x, z: wall.position.z, r: wall.rotation.y });
    }
}

function createWallsFromData(data) {
    for (const w of data) {
        const wallGeo = new THREE.BoxGeometry(20, 10, 1);
        const wallMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const wall = new THREE.Mesh(wallGeo, wallMat);
        wall.position.set(w.x, 4, w.z);
        wall.rotation.y = w.r;
        scene.add(wall);
        walls.push(wall);
    }
}

// ── FLOOR + GRID + LIGHTS ───────────────────────────
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

const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);
const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
sunLight.position.set(5, 10, 7);
scene.add(sunLight);

// ── INPUT ───────────────────────────────────────────
const keys = {};
window.addEventListener('keydown', (e) => {
    keys[e.key] = true;
    // Client captures Q press for sending to host
    if (!multiplayerHost && gameStarted && (e.key === 'q' || e.key === 'Q')) {
        pendingUlt = true;
    }
});
window.addEventListener('keyup', (e) => keys[e.key] = false);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableRotate = false;
controls.enableZoom = true;
controls.minDistance = 10;
controls.maxDistance = 80;

window.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !gameStarted) return;
    if (multiplayerHost) {
        shoot(e, camera, player, scene);
    } else {
        // Client: compute direction, queue for next input send
        const mouse = new THREE.Vector2(
            (e.clientX / window.innerWidth) * 2 - 1,
            -(e.clientY / window.innerHeight) * 2 + 1
        );
        const rc = new THREE.Raycaster();
        rc.setFromCamera(mouse, camera);
        const target = new THREE.Vector3();
        if (rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), target)) {
            const dir = new THREE.Vector3().subVectors(target, player.position);
            dir.y = 0;
            dir.normalize();
            pendingShoot = { dx: +dir.x.toFixed(3), dz: +dir.z.toFixed(3) };
        }
    }
});

// Top-down camera
camera.position.set(0, 40, 0);
camera.lookAt(0, 0, 0);

// ── REMOTE PLAYER ───────────────────────────────────
function createRemotePlayer(tintColor = 0x4488ff) {
    remotePlayer = new THREE.Group();
    if (modelLoaded && player.children.length > 0) {
        const clone = player.children[0].clone(true);
        clone.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material = child.material.clone();
                child.material.color.lerp(new THREE.Color(tintColor), 0.4);
            }
        });
        remotePlayer.add(clone);
    } else {
        const geo = new THREE.SphereGeometry(1, 32, 16);
        const mat = new THREE.MeshStandardMaterial({ color: tintColor });
        remotePlayer.add(new THREE.Mesh(geo, mat));
    }
    scene.add(remotePlayer);
}

// ── GAME OVER ───────────────────────────────────────
let gameOver = false;

function triggerGameOver() {
    gameOver = true;
    showFinalTime();
    showFinalKills();
    document.getElementById('gameOver').style.display = 'flex';
    if (multiplayerHost) {
        net.sendEvent({ t: 'event', e: 'gameover' });
    }
}
setGameOverCallback(triggerGameOver);

// ── LOBBY ───────────────────────────────────────────
initLobby(startGame);

function startGame(asHost) {
    multiplayerHost = asHost;

    if (asHost) {
        // Host: create world, start game logic
        createWalls(10);
        createNPCs(3, scene, player);
        startPickupSpawner(scene, walls);
        initUltimate(scene, player, npcs);
        createRemotePlayer();
        gameStarted = true;

        // Send init data to client
        net.sendInit({ t: 'init', walls: wallData });

        // Listen for client inputs
        net.onMessage((msg) => {
            if (msg.t === 'input') {
                clientInputBuffer.push(msg);
            } else if (msg.t === 'playerLeft') {
                // Client disconnected — continue solo
            }
        });
    } else {
        // Client: wait for init data from host
        net.onMessage((msg) => {
            if (msg.t === 'init') {
                createWallsFromData(msg.walls);
                createRemotePlayer(0xff8844); // orange tint for host's duck
                gameStarted = true;

                // Switch to game message handler
                net.onMessage(handleClientMessage);
            } else if (msg.t === 'hostDisconnected') {
                showDisconnected('Host disconnected');
            }
        });
    }
}

// ── CLIENT MESSAGE HANDLING ─────────────────────────
function handleClientMessage(msg) {
    if (msg.t === 'state') {
        prevSnapshot = latestSnapshot;
        latestSnapshot = msg;
    } else if (msg.t === 'event') {
        handleClientEvent(msg);
    } else if (msg.t === 'hostDisconnected') {
        showDisconnected('Host disconnected');
    }
}

function handleClientEvent(msg) {
    if (msg.e === 'gameover') {
        gameOver = true;
        document.getElementById('gameOver').style.display = 'flex';
    } else if (msg.e === 'levelup') {
        showLevelUpOverlayClient(msg.lv);
    } else if (msg.e === 'bossspawn') {
        document.getElementById('bossBarContainer').style.display = 'block';
        document.getElementById('bossBarInner').style.width = '100%';
    }
}

function showLevelUpOverlayClient(level) {
    if (!document.getElementById('levelUpStyle')) {
        const style = document.createElement('style');
        style.id = 'levelUpStyle';
        style.textContent = `
            @keyframes levelFadeIn { from { opacity:0; transform:translate(-50%,-50%) scale(0.8); } to { opacity:1; transform:translate(-50%,-50%) scale(1); } }
            @keyframes levelFadeOut { from { opacity:1; } to { opacity:0; } }
        `;
        document.head.appendChild(style);
    }
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); text-align:center; pointer-events:none; animation:levelFadeIn 0.3s ease-out forwards; z-index:50;';
    overlay.innerHTML = `<div style="font-size:72px; font-weight:bold; color:white; font-family:Arial; text-shadow:0 0 20px #ffdd00, 2px 2px 4px black;">LEVEL ${level}!</div>`;
    document.body.appendChild(overlay);
    setTimeout(() => {
        overlay.style.animation = 'levelFadeOut 0.3s ease-in forwards';
        setTimeout(() => overlay.remove(), 300);
    }, 1200);
}

function showDisconnected(msg) {
    gameOver = true;
    const el = document.getElementById('gameOver');
    el.style.display = 'flex';
    el.querySelector('h1').textContent = 'Disconnected';
    el.querySelector('p').textContent = msg;
}

// ── HOST UPDATE ─────────────────────────────────────
function hostUpdate(delta, now) {
    updateClock();

    // ── Local player movement ──
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
        player.rotation.y = Math.atan2(moveDir.x, moveDir.z);
    }

    // Wall collision — player 1
    const playerBox = new THREE.Box3().setFromCenterAndSize(
        player.position, new THREE.Vector3(1.5, 2, 1.5)
    );
    for (let i = 0; i < walls.length; i++) {
        const wallBox = new THREE.Box3().setFromObject(walls[i]);
        if (playerBox.intersectsBox(wallBox)) {
            player.position.copy(previousPosition);
            break;
        }
    }

    // Boundary check — player 1
    if (player.position.x > 50 || player.position.x < -50 ||
        player.position.z > 50 || player.position.z < -50) {
        triggerGameOver();
        return;
    }

    // ── Process remote player inputs ──
    processClientInputs();

    // ── Update NPCs (chase closer player) ──
    updateNPCs(npcs, player, playerBox, walls, remotePlayer);

    // NPC collision — player 1
    for (let i = 0; i < npcs.length; i++) {
        const npcBox = new THREE.Box3().setFromObject(npcs[i]);
        if (npcBox.intersectsBox(playerBox)) {
            takeDamage(20);
            break;
        }
    }

    // NPC collision — player 2
    if (remotePlayer) {
        const remoteBox = new THREE.Box3().setFromCenterAndSize(
            remotePlayer.position, new THREE.Vector3(1.5, 2, 1.5)
        );
        for (let i = 0; i < npcs.length; i++) {
            const npcBox = new THREE.Box3().setFromObject(npcs[i]);
            if (npcBox.intersectsBox(remoteBox)) {
                if (Date.now() - remotePlayerLastHit >= REMOTE_IFRAME) {
                    remotePlayerHealth = Math.max(0, remotePlayerHealth - 20);
                    remotePlayerLastHit = Date.now();
                    if (remotePlayerHealth <= 0) {
                        triggerGameOver();
                        return;
                    }
                }
                break;
            }
        }
    }

    if (gameOver) return;

    // Pickups — player 1
    updatePickups(scene, player);

    // Pickups — player 2 (manual check)
    if (remotePlayer) {
        const remoteBox = new THREE.Box3().setFromCenterAndSize(
            remotePlayer.position, new THREE.Vector3(1.5, 2, 1.5)
        );
        for (let i = pickups.length - 1; i >= 0; i--) {
            const popcornBox = new THREE.Box3().setFromObject(pickups[i]);
            if (popcornBox.intersectsBox(remoteBox)) {
                remotePlayerHealth = Math.min(100, remotePlayerHealth + 10);
                scene.remove(pickups[i]);
                pickups.splice(i, 1);
            }
        }
    }

    updateHealthBar();
    updateUltimate(delta);

    // Bullets
    const SPAWN_PER_KILL = 2;
    const killsThisFrame = updateBullets(bullets, npcs, walls, scene);
    if (killsThisFrame > 0) {
        for (let k = 0; k < killsThisFrame; k++) addKill();
        createNPCs(SPAWN_PER_KILL * killsThisFrame, scene, player);
    }

    // Level check
    checkLevelUp(totalKills, scene, npcs, player);
    document.getElementById('level').textContent = `Level ${getCurrentLevel()}`;

    // ── Broadcast state at 20Hz ──
    if (now - lastStateSendTime >= 50) {
        lastStateSendTime = now;
        broadcastState();
    }
}

// ── PROCESS CLIENT INPUTS ───────────────────────────
function processClientInputs() {
    if (!remotePlayer || clientInputBuffer.length === 0) return;

    for (const input of clientInputBuffer) {
        const prevPos = remotePlayer.position.clone();
        const speed = 0.18;
        const moveDir = new THREE.Vector3();

        // Fixed world-space directions (matches top-down camera)
        if (input.keys.w) moveDir.z -= 1;
        if (input.keys.s) moveDir.z += 1;
        if (input.keys.a) moveDir.x -= 1;
        if (input.keys.d) moveDir.x += 1;

        if (moveDir.lengthSq() > 0) {
            moveDir.normalize();
            remotePlayer.position.addScaledVector(moveDir, speed);
            remotePlayer.rotation.y = Math.atan2(moveDir.x, moveDir.z);
        }

        // Wall collision
        const remoteBox = new THREE.Box3().setFromCenterAndSize(
            remotePlayer.position, new THREE.Vector3(1.5, 2, 1.5)
        );
        for (let i = 0; i < walls.length; i++) {
            if (remoteBox.intersectsBox(new THREE.Box3().setFromObject(walls[i]))) {
                remotePlayer.position.copy(prevPos);
                break;
            }
        }

        // Boundary
        if (remotePlayer.position.x > 50 || remotePlayer.position.x < -50 ||
            remotePlayer.position.z > 50 || remotePlayer.position.z < -50) {
            remotePlayer.position.copy(prevPos);
        }

        // Shoot
        if (input.shoot) {
            shootFromRemote(remotePlayer.position, input.shoot.dx, input.shoot.dz, scene);
        }

        // Ultimate
        if (input.ult) {
            activateUltimateAt(remotePlayer.position);
        }
    }
    clientInputBuffer.length = 0;
}

// ── BROADCAST STATE ─────────────────────────────────
function broadcastState() {
    stateTick++;
    net.sendState({
        t: 'state',
        tick: stateTick,
        p: [
            {
                x: +player.position.x.toFixed(2),
                z: +player.position.z.toFixed(2),
                r: +player.rotation.y.toFixed(2),
                hp: getHealth()
            },
            remotePlayer ? {
                x: +remotePlayer.position.x.toFixed(2),
                z: +remotePlayer.position.z.toFixed(2),
                r: +remotePlayer.rotation.y.toFixed(2),
                hp: remotePlayerHealth
            } : null
        ],
        n: npcs.map(npc => ({
            x: +npc.position.x.toFixed(1),
            z: +npc.position.z.toFixed(1),
            r: +npc.rotation.y.toFixed(2),
            b: !!npc.userData.isBoss,
            hp: npc.userData.hp || 0
        })),
        b: bullets.map(b => ({
            x: +b.mesh.position.x.toFixed(1),
            z: +b.mesh.position.z.toFixed(1),
            dx: +b.dir.x.toFixed(3),
            dz: +b.dir.z.toFixed(3)
        })),
        pk: pickups.map(p => ({
            x: +p.position.x.toFixed(1),
            z: +p.position.z.toFixed(1)
        })),
        k: totalKills,
        tm: Math.floor(survivalTime),
        lv: getCurrentLevel()
    });
}

// ── CLIENT UPDATE ───────────────────────────────────
function clientUpdate(delta, now) {
    // Send input at 20Hz
    if (now - lastInputSendTime >= 50) {
        lastInputSendTime = now;
        const input = {
            t: 'input',
            seq: inputSeq++,
            keys: {
                w: !!(keys['w'] || keys['W']),
                s: !!(keys['s'] || keys['S']),
                a: !!(keys['a'] || keys['A']),
                d: !!(keys['d'] || keys['D'])
            }
        };
        if (pendingShoot) {
            input.shoot = pendingShoot;
            pendingShoot = null;
        }
        if (pendingUlt) {
            input.ult = true;
            pendingUlt = false;
        }
        net.sendInput(input);
    }

    // ── Local prediction (own movement) ──
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

    // Wall collision
    const playerBox = new THREE.Box3().setFromCenterAndSize(
        player.position, new THREE.Vector3(1.5, 2, 1.5)
    );
    for (let i = 0; i < walls.length; i++) {
        if (playerBox.intersectsBox(new THREE.Box3().setFromObject(walls[i]))) {
            player.position.copy(previousPosition);
            break;
        }
    }

    // ── Apply snapshot ──
    if (latestSnapshot) {
        // Correct own position toward host's authoritative position
        const myData = latestSnapshot.p[1]; // client is player index 1
        if (myData) {
            const dx = myData.x - player.position.x;
            const dz = myData.z - player.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist > 5) {
                // Teleport if too far off
                player.position.x = myData.x;
                player.position.z = myData.z;
            } else if (dist > 0.1) {
                // Smooth correction
                player.position.x += dx * 0.2;
                player.position.z += dz * 0.2;
            }
            setHealth(myData.hp);
        }

        // Update remote player (host's duck)
        if (remotePlayer && latestSnapshot.p[0]) {
            const hostData = latestSnapshot.p[0];
            remotePlayer.position.set(hostData.x, 0, hostData.z);
            remotePlayer.rotation.y = hostData.r;
        }

        // Sync all entities from snapshot
        syncNPCs(scene, latestSnapshot.n);
        syncBullets(scene, latestSnapshot.b);
        syncPickups(scene, latestSnapshot.pk);

        // Update DOM from snapshot
        updateHealthBar();
        document.getElementById('kills').textContent = 'Kills: ' + latestSnapshot.k;
        document.getElementById('timer').textContent = 'Time: ' + latestSnapshot.tm + 's';
        document.getElementById('level').textContent = 'Level ' + latestSnapshot.lv;

        // Boss health bar
        const boss = latestSnapshot.n.find(n => n.b);
        if (boss) {
            document.getElementById('bossBarContainer').style.display = 'block';
            document.getElementById('bossBarInner').style.width = (boss.hp / 100 * 100) + '%';
        } else {
            document.getElementById('bossBarContainer').style.display = 'none';
        }
    }
}

// ── ANIMATE ─────────────────────────────────────────
function animate() {
    requestAnimationFrame(animate);
    if (gameOver) return;
    if (!modelLoaded) return;

    if (!gameStarted) {
        renderer.render(scene, camera);
        return;
    }

    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;

    if (mixer) mixer.update(delta);

    if (multiplayerHost) {
        hostUpdate(delta, now);
    } else {
        clientUpdate(delta, now);
    }

    if (gameOver) return;

    // Camera follows local player
    camera.position.x = player.position.x;
    camera.position.z = player.position.z;
    controls.target.copy(player.position);
    controls.update();
    renderer.render(scene, camera);
}

animate();
