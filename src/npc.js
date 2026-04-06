import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export const npcs = [];

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

// ── REUSABLE OBJECTS (avoid per-frame allocations) ───────────────────────────
const _prevPos = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _separation = new THREE.Vector3();
const _pushDir = new THREE.Vector3();
const _npcBox = new THREE.Box3();
const _npcBoxX = new THREE.Box3();
const _npcBoxZ = new THREE.Box3();
const _npcSize = new THREE.Vector3(1.5, 3, 1.5);

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
    const { x, z } = randomPos(player);
    boss.position.set(x, 0, z);
    scene.add(boss);
    npcs.push(boss);
    document.getElementById('bossBarContainer').style.display = 'block';
    document.getElementById('bossBarInner').style.width = '100%';
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

export function syncNPCs(scene, npcData) {
    // Remove excess
    while (npcs.length > npcData.length) {
        const npc = npcs.pop();
        scene.remove(npc);
    }
    // Add missing
    while (npcs.length < npcData.length) {
        const npc = foxTemplate
            ? foxTemplate.clone(true)
            : makeFallbackBox(1.5, 2, 1.5, 0xff0000);
        npc.scale.set(3, 3, 3);
        scene.add(npc);
        npcs.push(npc);
    }
    // Update positions and state
    for (let i = 0; i < npcData.length; i++) {
        const d = npcData[i];
        const npc = npcs[i];
        npc.position.set(d.x, 0, d.z);
        npc.rotation.y = d.r;
        if (d.b) {
            npc.scale.set(8, 8, 8);
            npc.userData.isBoss = true;
            npc.userData.hp = d.hp;
        } else {
            npc.scale.set(3, 3, 3);
            npc.userData.isBoss = false;
        }
    }
}

export function updateNPCs(npcs, player, _playerBox, walls, player2 = null) {
    for (let i = 0; i < npcs.length; i++) {
        const npc = npcs[i];

        _prevPos.copy(npc.position);

        // Chase the closer player
        let target = player;
        if (player2) {
            const d1 = npc.position.distanceTo(player.position);
            const d2 = npc.position.distanceTo(player2.position);
            if (d2 < d1) target = player2;
        }

        _direction.subVectors(target.position, npc.position);
        _direction.y = 0;
        _direction.normalize();

        // face the player
        npc.rotation.y = Math.atan2(_direction.x, _direction.z) + Math.PI;

        const speed = npc.userData.isBoss ? 0.05 : 0.10;

        // boss ignores walls — move directly toward player and skip wall checks
        if (npc.userData.isBoss) {
            npc.position.addScaledVector(_direction, speed);
            continue;
        }

        // separation: push away from other NPCs
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

        // try full move first
        npc.position.addScaledVector(_direction, speed);

        _npcBox.setFromCenterAndSize(npc.position, _npcSize);
        let blocked = false;
        for (let j = 0; j < walls.length; j++) {
            if (_npcBox.intersectsBox(walls[j].userData.box)) {
                blocked = true;
                break;
            }
        }

        if (!blocked) continue;

        // try X only
        npc.position.copy(_prevPos);
        npc.position.x += _direction.x * speed;

        _npcBoxX.setFromCenterAndSize(npc.position, _npcSize);
        let blockedX = false;
        for (let j = 0; j < walls.length; j++) {
            if (_npcBoxX.intersectsBox(walls[j].userData.box)) {
                blockedX = true;
                break;
            }
        }
        if (blockedX) npc.position.x = _prevPos.x;

        // try Z only
        npc.position.z += _direction.z * speed;

        _npcBoxZ.setFromCenterAndSize(npc.position, _npcSize);
        let blockedZ = false;
        for (let j = 0; j < walls.length; j++) {
            if (_npcBoxZ.intersectsBox(walls[j].userData.box)) {
                blockedZ = true;
                break;
            }
        }
        if (blockedZ) npc.position.z = _prevPos.z;
    }
}
