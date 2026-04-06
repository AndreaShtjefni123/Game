// Three.js is the 3D library — needed for Vector3, Box3, Mesh etc.
import * as THREE from "three";
// GLTFLoader lets us load .glb model files (the fox model)
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// bossShoot is the function in shoot.js that fires a bullet from the boss toward the player
import { bossShoot } from "./shoot.js";

// Shared array of all active NPC meshes in the scene — main.js reads this every frame
export const npcs = [];

// The fox .glb model loaded once and cloned for every spawn
// Starts as null until the loader finishes
let foxTemplate = null;

// If createNPCs() or createBoss() is called before the model finishes loading,
// the request gets queued here and flushed once the model is ready
const pendingSpawns = [];

// ── MODEL LOADING ─────────────────────────────────────────────────────────────

const loader = new GLTFLoader();
loader.load(
    "/scriptfox.glb",
    (gltf) => {
        const model = gltf.scene;

        const toRemove = [];
        model.traverse((child) => {
            if (child.isCamera || child.isLight) toRemove.push(child);
        });
        toRemove.forEach((obj) => obj.parent.remove(obj));

        foxTemplate = model;
        console.log("✅ Fox template loaded — flushing", pendingSpawns.length, "queued spawns");

        // Flush queued spawns — spawnX/spawnZ carry the server position so the fox
        // appears in the right place instead of a random spot
        for (const { scene, player, isBoss, serverId, spawnX, spawnZ } of pendingSpawns) {
            if (isBoss) _spawnBossNow(scene, player);
            else _spawnFoxNow(scene, player, serverId, spawnX, spawnZ);
        }
        pendingSpawns.length = 0;
    },
    undefined,
    (err) => console.warn("⚠️ Fox model failed to load, will use fallback boxes.", err)
);

// ── INTERNAL HELPERS ──────────────────────────────────────────────────────────

// Returns a random x/z position at least 20 units away from the player
// Only used in solo mode — multiplayer passes server position directly
function randomPos(player) {
    let x, z;
    do {
        x = Math.random() * 70 - 35;
        z = Math.random() * 70 - 35;
    } while (new THREE.Vector3(x, 0, z).distanceTo(player.position) < 20);
    return { x, z };
}

function makeFallbackBox(scaleX, scaleY, scaleZ, color) {
    return new THREE.Mesh(
        new THREE.BoxGeometry(scaleX, scaleY, scaleZ),
        new THREE.MeshStandardMaterial({ color })
    );
}

// serverId — server's ID stamped immediately so npcState can match this mesh
// spawnX/spawnZ — if provided, place fox here (multiplayer: server position, no random jump)
//                 if null, use randomPos (solo mode)
function _spawnFoxNow(scene, player, serverId = null, spawnX = null, spawnZ = null) {
    const npc = foxTemplate
        ? foxTemplate.clone(true)
        : makeFallbackBox(1.5, 2, 1.5, 0xff0000);

    npc.scale.set(3, 3, 3);

    if (spawnX !== null && spawnZ !== null) {
        npc.position.set(spawnX, 0, spawnZ); // use server position — no teleport jump
    } else {
        const { x, z } = randomPos(player);  // solo mode
        npc.position.set(x, 0, z);
    }

    if (serverId !== null) npc.userData.serverId = serverId;

    scene.add(npc);
    npcs.push(npc);
}

function _spawnBossNow(scene, player) {
    const boss = foxTemplate
        ? foxTemplate.clone(true)
        : makeFallbackBox(4, 6, 4, 0x800000);

    boss.scale.set(8, 8, 8);
    boss.userData.isBoss = true;
    boss.userData.hp = 100;
    boss.userData.spawnTimer = 0;
    boss.userData.shootTimer = 0;
    const { x, z } = randomPos(player);
    boss.position.set(x, 0, z);
    scene.add(boss);
    npcs.push(boss);
    document.getElementById('bossBarContainer').style.display = 'block';
    document.getElementById('bossBarInner').style.width = '100%';
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

// serverId — optional server ID (multiplayer only)
// spawnX/spawnZ — optional server position (multiplayer only, prevents random spawn jump)
export function createNPCs(amount, scene, player, serverId = null, spawnX = null, spawnZ = null) {
    for (let i = 0; i < amount; i++) {
        if (foxTemplate) {
            _spawnFoxNow(scene, player, serverId, spawnX, spawnZ);
        } else {
            // Store ID and position in the queue so they survive until the model loads
            pendingSpawns.push({ scene, player, isBoss: false, serverId, spawnX, spawnZ });
        }
    }
}

export function createBoss(scene, player) {
    if (foxTemplate) {
        _spawnBossNow(scene, player);
    } else {
        pendingSpawns.push({ scene, player, isBoss: true });
    }
}

// ── UPDATE LOOP ───────────────────────────────────────────────────────────────

export function updateNPCs(npcs, player, _playerBox, walls, delta, scene) {
    for (let i = 0; i < npcs.length; i++) {
        const npc = npcs[i];

        const previousPosition = npc.position.clone();

        const direction = new THREE.Vector3();
        direction.subVectors(player.position, npc.position);
        direction.y = 0;
        direction.normalize();

        npc.rotation.y = Math.atan2(direction.x, direction.z) + Math.PI;

        let speed;
        if (npc.userData.isBoss) {
            if (npc.userData.hp > 66) {
                speed = 0.03;
            } else if (npc.userData.hp > 33) {
                speed = 0.05;
            } else {
                speed = 0.08;
            }
        } else {
            speed = 0.10;
        }

        if (npc.userData.isBoss) {
            npc.position.addScaledVector(direction, speed);

            npc.userData.spawnTimer += delta;
            if (npc.userData.spawnTimer >= 10) {
                npc.userData.spawnTimer = 0;
                if (npcs.length < 20) createNPCs(2, scene, player);
            }

            npc.userData.shootTimer += delta;
            if (npc.userData.shootTimer >= 3) {
                npc.userData.shootTimer = 0;
                bossShoot(npc, player, scene);
            }

            continue;
        }

        const separation = new THREE.Vector3();
        for (let j = 0; j < npcs.length; j++) {
            if (i === j) continue;
            const dist = npc.position.distanceTo(npcs[j].position);
            if (dist < 3) {
                const pushDir = new THREE.Vector3();
                pushDir.subVectors(npc.position, npcs[j].position);
                pushDir.y = 0;
                pushDir.normalize();
                pushDir.multiplyScalar((3 - dist) * 0.05);
                separation.add(pushDir);
            }
        }
        npc.position.add(separation);

        const NPC_SIZE = new THREE.Vector3(1.5, 3, 1.5);

        npc.position.addScaledVector(direction, speed);

        const npcBox = new THREE.Box3().setFromCenterAndSize(npc.position, NPC_SIZE);
        let blocked = false;
        for (let j = 0; j < walls.length; j++) {
            if (npcBox.intersectsBox(new THREE.Box3().setFromObject(walls[j]))) {
                blocked = true;
                break;
            }
        }

        if (!blocked) continue;

        npc.position.copy(previousPosition);
        npc.position.x += direction.x * speed;

        const npcBoxX = new THREE.Box3().setFromCenterAndSize(npc.position, NPC_SIZE);
        let blockedX = false;
        for (let j = 0; j < walls.length; j++) {
            if (npcBoxX.intersectsBox(new THREE.Box3().setFromObject(walls[j]))) {
                blockedX = true;
                break;
            }
        }
        if (blockedX) npc.position.x = previousPosition.x;

        npc.position.z += direction.z * speed;

        const npcBoxZ = new THREE.Box3().setFromCenterAndSize(npc.position, NPC_SIZE);
        let blockedZ = false;
        for (let j = 0; j < walls.length; j++) {
            if (npcBoxZ.intersectsBox(new THREE.Box3().setFromObject(walls[j]))) {
                blockedZ = true;
                break;
            }
        }
        if (blockedZ) npc.position.z = previousPosition.z;
    }
}