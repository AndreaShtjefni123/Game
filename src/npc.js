import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { bossShoot } from "./shoot.js";

// Shared array of all active NPC meshes — main.js reads this every frame
export const npcs = [];

// ── NPC ID SYSTEM (Phase 5) ───────────────────────────────────────────────────
// Host assigns IDs via nextNpcId++. Guests receive IDs from npcSpawned messages.
export let nextNpcId = 0;
export const npcById  = new Map(); // O(1) lookup by server-assigned ID

// Drain queue — main.js reads this after any createNPCs/createBoss call on the host
// to send npcSpawned messages to guests. Cleared immediately after draining.
export const recentlySpawned = [];

// Fox GLB template — cloned for every spawn
let foxTemplate = null;

// If createNPCs/createBoss is called before the model finishes loading,
// requests queue here and flush once the model is ready.
const pendingSpawns = [];

// ── Scratch objects hoisted outside the loop — avoids GC pressure (Phase 0) ──
const _direction  = new THREE.Vector3();
const _separation = new THREE.Vector3();
const _pushDir    = new THREE.Vector3();
const _npcBox     = new THREE.Box3();
const _npcBoxX    = new THREE.Box3();
const _npcBoxZ    = new THREE.Box3();
const NPC_SIZE    = new THREE.Vector3(1.5, 3, 1.5);

// ── MODEL LOADING ─────────────────────────────────────────────────────────────
const loader = new GLTFLoader();
loader.load(
    "/scriptfox.glb",
    (gltf) => {
        const model = gltf.scene;
        const toRemove = [];
        model.traverse((child) => { if (child.isCamera || child.isLight) toRemove.push(child); });
        toRemove.forEach((obj) => obj.parent.remove(obj));
        foxTemplate = model;
        console.log("✅ Fox template loaded — flushing", pendingSpawns.length, "queued spawns");
        for (const { scene, player, isBoss } of pendingSpawns) {
            if (isBoss) _spawnBossNow(scene, player);
            else        _spawnFoxNow(scene, player);
        }
        pendingSpawns.length = 0;
    },
    undefined,
    (err) => console.warn("⚠️ Fox model failed to load, will use fallback boxes.", err)
);

// ── INTERNAL HELPERS ──────────────────────────────────────────────────────────

function randomPos(player) {
    let x, z;
    do {
        x = Math.random() * 70 - 35;
        z = Math.random() * 70 - 35;
    } while (new THREE.Vector3(x, 0, z).distanceTo(player.position) < 20);
    return { x, z };
}

function makeFallbackBox(sx, sy, sz, color) {
    return new THREE.Mesh(
        new THREE.BoxGeometry(sx, sy, sz),
        new THREE.MeshStandardMaterial({ color })
    );
}

function _spawnFoxNow(scene, player) {
    const npc = foxTemplate ? foxTemplate.clone(true) : makeFallbackBox(1.5, 2, 1.5, 0xff0000);
    npc.scale.set(3, 3, 3);
    const { x, z } = randomPos(player);
    npc.position.set(x, 0, z);

    // Assign ID (Phase 5)
    npc.userData.id           = nextNpcId++;
    npc.userData.lastSyncPos  = npc.position.clone(); // for host npcSync dirty check

    scene.add(npc);
    npcs.push(npc);
    npcById.set(npc.userData.id, npc);
    recentlySpawned.push(npc);
}

function _spawnBossNow(scene, player) {
    const boss = foxTemplate ? foxTemplate.clone(true) : makeFallbackBox(4, 6, 4, 0x800000);
    boss.scale.set(8, 8, 8);
    boss.userData.isBoss      = true;
    boss.userData.hp          = 100;
    boss.userData.spawnTimer  = 0;
    boss.userData.shootTimer  = 0;

    // Assign ID (Phase 5)
    boss.userData.id          = nextNpcId++;
    boss.userData.lastSyncPos = boss.position.clone();

    const { x, z } = randomPos(player);
    boss.position.set(x, 0, z);
    scene.add(boss);
    npcs.push(boss);
    npcById.set(boss.userData.id, boss);
    recentlySpawned.push(boss);
    document.getElementById('bossBarContainer').style.display = 'block';
    document.getElementById('bossBarInner').style.width = '100%';
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

export function createNPCs(amount, scene, player) {
    for (let i = 0; i < amount; i++) {
        if (foxTemplate) _spawnFoxNow(scene, player);
        else             pendingSpawns.push({ scene, player, isBoss: false });
    }
}

export function createBoss(scene, player) {
    if (foxTemplate) _spawnBossNow(scene, player);
    else             pendingSpawns.push({ scene, player, isBoss: true });
}

// Used by guests to materialize an NPC received via npcSpawned — uses fox model if loaded
export function createNPCMeshAt(scene, id, x, z) {
    const npc = foxTemplate ? foxTemplate.clone(true) : makeFallbackBox(1.5, 2, 1.5, 0xff4400);
    npc.scale.set(3, 3, 3);
    npc.position.set(x, 0, z);
    npc.userData.id          = id;
    npc.userData.lastSyncPos = npc.position.clone();
    scene.add(npc);
    npcs.push(npc);
    npcById.set(id, npc);
    return npc;
}

// Used by guests to materialize a boss received via bossSpawned
export function createBossMeshAt(scene, id, x, z) {
    const boss = foxTemplate ? foxTemplate.clone(true) : makeFallbackBox(4, 6, 4, 0x800000);
    boss.scale.set(8, 8, 8);
    boss.userData.id          = id;
    boss.userData.isBoss      = true;
    boss.userData.hp          = 100;
    boss.userData.spawnTimer  = 0;
    boss.userData.shootTimer  = 0;
    boss.userData.lastSyncPos = new THREE.Vector3(x, 0, z);
    boss.position.set(x, 0, z);
    scene.add(boss);
    npcs.push(boss);
    npcById.set(id, boss);
    document.getElementById('bossBarContainer').style.display = 'block';
    document.getElementById('bossBarInner').style.width = '100%';
    return boss;
}

// ── UPDATE LOOP ───────────────────────────────────────────────────────────────

// wallBoxes — pre-computed Box3 array passed from main.js (Phase 0).
// isHost    — if false, boss skips spawning minions and shooting (Phase 7).
export function updateNPCs(npcs, player, _playerBox, walls, delta, scene, wallBoxes, isHost = true) {
    // Fall back to computing boxes per-frame only if wallBoxes not provided
    const boxes = wallBoxes ?? walls.map(w => new THREE.Box3().setFromObject(w));

    for (let i = 0; i < npcs.length; i++) {
        const npc = npcs[i];
        const previousPosition = npc.position.clone();

        _direction.subVectors(player.position, npc.position);
        _direction.y = 0;
        _direction.normalize();

        npc.rotation.y = Math.atan2(_direction.x, _direction.z) + Math.PI;

        let speed;
        if (npc.userData.isBoss) {
            if      (npc.userData.hp > 66) speed = 0.05;
            else if (npc.userData.hp > 33) speed = 0.09;
            else                           speed = 0.15;
        } else {
            speed = 0.10;
        }

        // ── BOSS-ONLY LOGIC ───────────────────────────────────────────────────
        if (npc.userData.isBoss) {
            npc.position.addScaledVector(_direction, speed);

            // Minion spawn and shooting only run on the host (authoritative actions)
            if (isHost) {
                npc.userData.spawnTimer += delta;
                if (npc.userData.spawnTimer >= 10) {
                    npc.userData.spawnTimer = 0;
                    createNPCs(2, scene, player);
                }
                npc.userData.shootTimer += delta;
                if (npc.userData.shootTimer >= 3) {
                    npc.userData.shootTimer = 0;
                    bossShoot(npc, player, scene);
                }
            }

            // Apply drift correction if one is pending (Phase 9)
            if (npc.userData.correctionFrames > 0) {
                const t = 1 / npc.userData.correctionFrames;
                npc.position.lerp(npc.userData.correctionTarget, t);
                npc.userData.correctionFrames--;
            }
            continue;
        }

        // ── SEPARATION ────────────────────────────────────────────────────────
        _separation.set(0, 0, 0);
        for (let j = 0; j < npcs.length; j++) {
            if (i === j) continue;
            const dist = npc.position.distanceTo(npcs[j].position);
            if (dist < 3) {
                _pushDir.subVectors(npc.position, npcs[j].position);
                _pushDir.y = 0;
                _pushDir.normalize();
                _pushDir.multiplyScalar((3 - dist) * 0.05);
                _separation.add(_pushDir);
            }
        }
        npc.position.add(_separation);

        // ── WALL COLLISION — sliding (Attempt 1: full move) ───────────────────
        npc.position.addScaledVector(_direction, speed);
        _npcBox.setFromCenterAndSize(npc.position, NPC_SIZE);

        let blocked = false;
        for (let j = 0; j < boxes.length; j++) {
            if (_npcBox.intersectsBox(boxes[j])) { blocked = true; break; }
        }

        if (!blocked) {
            // Apply correction after successful move (Phase 9)
            if (npc.userData.correctionFrames > 0) {
                const t = 1 / npc.userData.correctionFrames;
                npc.position.lerp(npc.userData.correctionTarget, t);
                npc.userData.correctionFrames--;
            }
            continue;
        }

        // Attempt 2: X axis only
        npc.position.copy(previousPosition);
        npc.position.x += _direction.x * speed;
        _npcBoxX.setFromCenterAndSize(npc.position, NPC_SIZE);
        let blockedX = false;
        for (let j = 0; j < boxes.length; j++) {
            if (_npcBoxX.intersectsBox(boxes[j])) { blockedX = true; break; }
        }
        if (blockedX) npc.position.x = previousPosition.x;

        // Attempt 3: Z axis only
        npc.position.z += _direction.z * speed;
        _npcBoxZ.setFromCenterAndSize(npc.position, NPC_SIZE);
        let blockedZ = false;
        for (let j = 0; j < boxes.length; j++) {
            if (_npcBoxZ.intersectsBox(boxes[j])) { blockedZ = true; break; }
        }
        if (blockedZ) npc.position.z = previousPosition.z;

        // Apply correction after wall resolution (Phase 9)
        if (npc.userData.correctionFrames > 0) {
            const t = 1 / npc.userData.correctionFrames;
            npc.position.lerp(npc.userData.correctionTarget, t);
            npc.userData.correctionFrames--;
        }
    }
}
