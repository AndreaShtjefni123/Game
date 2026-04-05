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
    "/scriptfox.glb",                           // path to the fox model in /public
    (gltf) => {
        const model = gltf.scene;               // gltf.scene is the root 3D object

        // Blender sometimes bakes cameras and lights into the export
        // They conflict with the game's own lighting so we remove them
        const toRemove = [];
        model.traverse((child) => {
            if (child.isCamera || child.isLight) toRemove.push(child);
        });
        toRemove.forEach((obj) => obj.parent.remove(obj));

        // Save the cleaned model as the template — all future spawns clone this
        foxTemplate = model;
        console.log("✅ Fox template loaded — flushing", pendingSpawns.length, "queued spawns");

        // Flush any spawns that were requested before the model finished loading
        for (const { scene, player, isBoss } of pendingSpawns) {
            if (isBoss) _spawnBossNow(scene, player);
            else _spawnFoxNow(scene, player);
        }
        // Clear the queue
        pendingSpawns.length = 0;
    },
    undefined,                                  // progress callback (not used)
    (err) => console.warn("⚠️ Fox model failed to load, will use fallback boxes.", err)
);

// ── INTERNAL HELPERS ──────────────────────────────────────────────────────────

// Returns a random x/z position that is at least 20 units away from the player
// Keeps NPCs from spawning directly on top of the player
function randomPos(player) {
    let x, z;
    do {
        x = Math.random() * 70 - 35;           // random value between -35 and +35
        z = Math.random() * 70 - 35;
    } while (new THREE.Vector3(x, 0, z).distanceTo(player.position) < 20); // retry if too close
    return { x, z };
}

// Creates a plain colored box mesh — used as a fallback if the fox .glb fails to load
function makeFallbackBox(scaleX, scaleY, scaleZ, color) {
    return new THREE.Mesh(
        new THREE.BoxGeometry(scaleX, scaleY, scaleZ),
        new THREE.MeshStandardMaterial({ color })
    );
}

// Spawns a single regular fox NPC into the scene
function _spawnFoxNow(scene, player) {
    // Clone the template if loaded, otherwise use a red fallback box
    const npc = foxTemplate
        ? foxTemplate.clone(true)               // clone(true) = deep clone, copies all children
        : makeFallbackBox(1.5, 2, 1.5, 0xff0000);

    npc.scale.set(3, 3, 3);                     // scale the fox up to game size
    const { x, z } = randomPos(player);         // pick a spawn point far from the player
    npc.position.set(x, 0, z);                  // place it in the world (y=0 = ground level)
    scene.add(npc);                             // add to the Three.js scene so it renders
    npcs.push(npc);                             // add to the shared npcs array so main.js tracks it
}

// Spawns the boss NPC — larger, slower, has HP, and fires back at the player
function _spawnBossNow(scene, player) {
    // Clone the template if loaded, otherwise use a dark red fallback box
    const boss = foxTemplate
        ? foxTemplate.clone(true)
        : makeFallbackBox(4, 6, 4, 0x800000);   // 0x800000 = dark red color

    boss.scale.set(8, 8, 8);                    // boss is much larger than regular foxes
    boss.userData.isBoss = true;                // flag checked in updateNPCs and shoot.js
    boss.userData.hp = 100;                     // boss takes 100 bullet hits to kill
    boss.userData.spawnTimer = 0;               // counts up every frame — resets when minions spawn
    boss.userData.shootTimer = 0;               // counts up every frame — resets when boss fires
    const { x, z } = randomPos(player);         // spawn far from the player
    boss.position.set(x, 0, z);
    scene.add(boss);
    npcs.push(boss);                            // boss lives in the same npcs array as regular foxes
    document.getElementById('bossBarContainer').style.display = 'block'; // show the HP bar UI
    document.getElementById('bossBarInner').style.width = '100%';        // HP bar starts full
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

// Called from main.js and levels.js to spawn a batch of regular foxes
export function createNPCs(amount, scene, player) {
    for (let i = 0; i < amount; i++) {
        if (foxTemplate) {
            _spawnFoxNow(scene, player);        // model ready — spawn immediately
        } else {
            pendingSpawns.push({ scene, player, isBoss: false }); // queue for later
        }
    }
}

// Called from levels.js when the player reaches level 5
export function createBoss(scene, player) {
    if (foxTemplate) {
        _spawnBossNow(scene, player);           // model ready — spawn immediately
    } else {
        pendingSpawns.push({ scene, player, isBoss: true }); // queue for later
    }
}

// ── UPDATE LOOP ───────────────────────────────────────────────────────────────

// Called every frame from main.js — moves every NPC toward the player
// delta = seconds since last frame (used to make timers frame-rate independent)
// scene is needed so the boss can spawn minions and bullets
export function updateNPCs(npcs, player, _playerBox, walls, delta, scene) {
    for (let i = 0; i < npcs.length; i++) {
        const npc = npcs[i];

        // Save position before moving — used to revert if the NPC walks into a wall
        const previousPosition = npc.position.clone();

        // Calculate the direction vector from this NPC toward the player
        const direction = new THREE.Vector3();
        direction.subVectors(player.position, npc.position); // player minus npc = points toward player
        direction.y = 0;                        // keep movement flat (no flying up or down)
        direction.normalize();                  // make the vector length 1 so speed is consistent

        // Rotate the NPC model to face the player
        // Math.atan2 returns the angle in radians, + Math.PI flips it to face forward
        npc.rotation.y = Math.atan2(direction.x, direction.z) + Math.PI;

        // Pick movement speed based on whether this is the boss and its current HP phase
        let speed;
        if (npc.userData.isBoss) {
            if (npc.userData.hp > 66) {
                speed = 0.03;                   // phase 1 (100–67 HP) — slow and menacing
            } else if (npc.userData.hp > 33) {
                speed = 0.05;                   // phase 2 (66–34 HP) — picking up pace
            } else {
                speed = 0.08;                   // phase 3 (33–0 HP) — faster but still manageable
            }
        } else {
            speed = 0.10;                       // regular fox always moves at this speed
        }

        // ── BOSS-ONLY LOGIC ───────────────────────────────────────────────────
        if (npc.userData.isBoss) {
            // Boss moves straight toward player and ignores walls entirely
            npc.position.addScaledVector(direction, speed);

            // Minion spawn timer — every 10 seconds the boss summons 2 regular foxes
            npc.userData.spawnTimer += delta;   // add seconds elapsed this frame
            if (npc.userData.spawnTimer >= 10) {
                npc.userData.spawnTimer = 0;    // reset the timer
                // Only spawn minions if under the fox cap to prevent lag
                if (npcs.length < 20) createNPCs(2, scene, player);
            }

            // Shoot timer — every 3 seconds the boss fires a bullet at the player
            npc.userData.shootTimer += delta;
            if (npc.userData.shootTimer >= 3) {
                npc.userData.shootTimer = 0;    // reset the timer
                bossShoot(npc, player, scene);  // fire a bullet from boss toward player
            }

            continue; // skip the wall avoidance and separation logic below — boss doesn't use it
        }

        // ── REGULAR FOX SEPARATION ────────────────────────────────────────────
        // Pushes foxes apart so they don't all stack on the same position
        const separation = new THREE.Vector3();
        for (let j = 0; j < npcs.length; j++) {
            if (i === j) continue;              // don't compare an NPC with itself
            const dist = npc.position.distanceTo(npcs[j].position);
            if (dist < 3) {                     // if two foxes are closer than 3 units apart
                const pushDir = new THREE.Vector3();
                pushDir.subVectors(npc.position, npcs[j].position); // direction away from neighbor
                pushDir.y = 0;
                pushDir.normalize();
                pushDir.multiplyScalar((3 - dist) * 0.05); // stronger push the closer they are
                separation.add(pushDir);        // accumulate all push forces
            }
        }
        npc.position.add(separation);          // apply the combined separation force

        // ── WALL COLLISION ────────────────────────────────────────────────────
        // Uses a sliding approach — try the full move first, then fall back to X or Z only
        // This lets foxes slide along walls instead of stopping dead

        const NPC_SIZE = new THREE.Vector3(1.5, 3, 1.5); // hitbox size for collision checks

        // Attempt 1 — try moving in both X and Z at once
        npc.position.addScaledVector(direction, speed);

        // Build a bounding box around the new position and check every wall
        const npcBox = new THREE.Box3().setFromCenterAndSize(npc.position, NPC_SIZE);
        let blocked = false;
        for (let j = 0; j < walls.length; j++) {
            if (npcBox.intersectsBox(new THREE.Box3().setFromObject(walls[j]))) {
                blocked = true;
                break;
            }
        }

        // Full move worked — no wall hit, skip to next NPC
        if (!blocked) continue;

        // Attempt 2 — revert and try X axis only
        npc.position.copy(previousPosition);   // undo the full move
        npc.position.x += direction.x * speed; // only move horizontally

        const npcBoxX = new THREE.Box3().setFromCenterAndSize(npc.position, NPC_SIZE);
        let blockedX = false;
        for (let j = 0; j < walls.length; j++) {
            if (npcBoxX.intersectsBox(new THREE.Box3().setFromObject(walls[j]))) {
                blockedX = true;
                break;
            }
        }
        if (blockedX) npc.position.x = previousPosition.x; // X is blocked too, revert it

        // Attempt 3 — try Z axis only (on top of whatever X settled to)
        npc.position.z += direction.z * speed;

        const npcBoxZ = new THREE.Box3().setFromCenterAndSize(npc.position, NPC_SIZE);
        let blockedZ = false;
        for (let j = 0; j < walls.length; j++) {
            if (npcBoxZ.intersectsBox(new THREE.Box3().setFromObject(walls[j]))) {
                blockedZ = true;
                break;
            }
        }
        if (blockedZ) npc.position.z = previousPosition.z; // Z is blocked too, revert it
        // If both X and Z are blocked the NPC stays exactly at previousPosition (fully stuck)
    }
}
