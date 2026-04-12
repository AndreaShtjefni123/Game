import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export const npcs = [];

// Auto-incrementing ID assigned to every NPC at spawn.
// Used for kill dedup, NPC sync, and boss events.
let _nextNpcId = 0;

// Optional callback fired when a boss mesh is added to the scene (host uses
// this to emit bossSpawned to the server).
let _onBossSpawn = null;
export function setOnBossSpawn(cb) { _onBossSpawn = cb; }

// Load the fox model ONCE — every spawn clones this template
let foxTemplate = null;
const pendingSpawns = []; // queued spawns requested before model finished loading

const loader = new GLTFLoader();
loader.load(
    "/scriptfox.glb",
    (gltf) => {
        const model = gltf.scene;
        // strip any cameras/lights baked in from Blender
        const toRemove = [];
        model.traverse((child) => {
            if (child.isCamera || child.isLight) toRemove.push(child);
        });
        toRemove.forEach((obj) => obj.parent.remove(obj));

        foxTemplate = model;
        console.log("✅ Fox template loaded — flushing", pendingSpawns.length, "queued spawns");

        // flush anything that was requested before the model finished
        for (const { scene, player, isBoss } of pendingSpawns) {
            if (isBoss) _spawnBossNow(scene, player);
            else        _spawnFoxNow(scene, player);
        }
        pendingSpawns.length = 0;
    },
    undefined,
    (err) => console.warn("⚠️ Fox model failed to load, will use fallback boxes.", err)
);

// ── internal helpers ──────────────────────────────────────────────────────────

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

function _spawnFoxNow(scene, player) {
    const npc = foxTemplate
        ? foxTemplate.clone(true)
        : makeFallbackBox(1.5, 2, 1.5, 0xff0000);

    npc.scale.set(3, 3, 3);
    const { x, z } = randomPos(player);
    npc.position.set(x, 0, z);
    npc.userData.id = _nextNpcId++;
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
    boss.userData.id = _nextNpcId++;
    const { x, z } = randomPos(player);
    boss.position.set(x, 0, z);
    scene.add(boss);
    npcs.push(boss);
    document.getElementById('bossBarContainer').style.display = 'block';
    document.getElementById('bossBarInner').style.width = '100%';
    if (_onBossSpawn) _onBossSpawn(boss);
}

// ── multiplayer helpers ───────────────────────────────────────────────────────

// Used by non-host clients to create a received NPC mesh.
export function spawnRemoteNpc(scene, id, x, z, isBoss = false) {
    const mesh = foxTemplate
        ? foxTemplate.clone(true)
        : makeFallbackBox(isBoss ? 4 : 1.5, isBoss ? 6 : 2, isBoss ? 4 : 1.5, isBoss ? 0x800000 : 0xff0000);
    mesh.scale.set(isBoss ? 8 : 3, isBoss ? 8 : 3, isBoss ? 8 : 3);
    mesh.position.set(x, 0, z);
    mesh.userData.id = id;
    mesh.userData.isBoss = isBoss;
    if (isBoss) {
        mesh.userData.hp = 100;
        document.getElementById('bossBarContainer').style.display = 'block';
        document.getElementById('bossBarInner').style.width = '100%';
    }
    scene.add(mesh);
    npcs.push(mesh);
    return mesh;
}

// Remove a single NPC by ID — safe to call if already removed.
export function removeNpcById(scene, id) {
    const idx = npcs.findIndex(n => n.userData.id === id);
    if (idx !== -1) {
        scene.remove(npcs[idx]);
        npcs.splice(idx, 1);
    }
}

// Clear every NPC mesh (used by non-host clients on levelUp).
export function clearAllNpcs(scene) {
    for (let i = npcs.length - 1; i >= 0; i--) {
        scene.remove(npcs[i]);
    }
    npcs.length = 0;
}

// ── public API ────────────────────────────────────────────────────────────────

export function createNPCs(amount, scene, player) {
    for (let i = 0; i < amount; i++) {
        if (foxTemplate) {
            _spawnFoxNow(scene, player);
        } else {
            pendingSpawns.push({ scene, player, isBoss: false });
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

export function updateNPCs(npcs, player, _playerBox, walls) {
    for (let i = 0; i < npcs.length; i++) {
        const npc = npcs[i];

        const previousPosition = npc.position.clone();

        const direction = new THREE.Vector3();
        direction.subVectors(player.position, npc.position);
        direction.y = 0;
        direction.normalize();

        // face the player
        npc.rotation.y = Math.atan2(direction.x, direction.z) + Math.PI;

        const speed = npc.userData.isBoss ? 0.05 : 0.10;

        // boss ignores walls — move directly toward player and skip wall checks
        if (npc.userData.isBoss) {
            npc.position.addScaledVector(direction, speed);
            continue;
        }

        // separation: push away from other NPCs
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

        // try full move first
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

        // try X only
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

        // try Z only
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
