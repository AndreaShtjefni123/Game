// Three.js is needed for raycasting, vectors, and geometry
import * as THREE from "three";
// GLTFLoader loads the bullet .glb model
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// Shared array of all active bullets — main.js reads this to pass into updateBullets
export const bullets = [];

// Reusable Box3 instances for bullet/wall/NPC collision — avoids per-frame allocations
const _bulletBox = new THREE.Box3();
const _npcBox = new THREE.Box3();

// Raycaster projects a ray from the camera through the mouse position into the 3D world
const raycaster = new THREE.Raycaster();
// An invisible flat plane at y=0 — the raycaster hits this to find where the mouse points in 3D
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// ── BULLET MODEL ─────────────────────────────────────────────────────────────

// Load the bullet model once — all bullets clone this template
let bulletTemplate = null;
const bulletLoader = new GLTFLoader();
bulletLoader.load(
    "/sciptbullet.glb",                         // path to the bullet model in /public
    (gltf) => {
        const model = gltf.scene;
        // Strip any cameras/lights baked into the Blender export
        const toRemove = [];
        model.traverse((child) => {
            if (child.isCamera || child.isLight) toRemove.push(child);
        });
        toRemove.forEach((obj) => obj.parent.remove(obj));
        model.scale.set(1.2, 1.2, 1.2);        // scale up slightly from the base model size
        bulletTemplate = model;
        console.log("✅ Bullet model loaded!");
    },
    undefined,
    (err) => console.warn("⚠️ bullet.glb not found, using fallback sphere.", err)
);

// Returns a bullet mesh — clones the loaded model or falls back to a yellow sphere
function makeBulletMesh() {
    if (bulletTemplate) {
        return bulletTemplate.clone(true); // clone(true) = deep clone, copies all children
    }
    // Fallback if the .glb didn't load — plain yellow sphere
    const geo = new THREE.SphereGeometry(0.6, 8, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffaa00 });
    return new THREE.Mesh(geo, mat);
}

// ── PLAYER SHOOT ─────────────────────────────────────────────────────────────

// Called from main.js on left mouse click
// Projects a ray from the camera through the mouse position, finds where it hits
// the ground plane, then fires a bullet from the player toward that point
export function shoot(event, camera, player, scene) {
    // Convert mouse pixel position to normalized device coordinates (-1 to +1)
    const mouse = new THREE.Vector2(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1
    );

    // Set the raycaster to fire from the camera through the mouse position
    raycaster.setFromCamera(mouse, camera);

    // Find where the ray intersects the aim plane (the flat ground at y=0)
    const targetPoint = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(aimPlane, targetPoint);

    if (!hit) return; // ray missed the plane (shouldn't happen but safe to guard)

    // Calculate the direction from the player to the target point
    const direction = new THREE.Vector3();
    direction.subVectors(targetPoint, player.position); // targetPoint minus playerPos = direction
    direction.y = 0;         // keep bullet on the ground plane
    direction.normalize();   // make length 1 so bullet speed is consistent

    const bullet = makeBulletMesh();
    bullet.position.set(player.position.x, player.position.y, player.position.z); // spawn at player
    bullet.rotation.y = Math.atan2(direction.x, direction.z); // orient tip toward travel direction
    // "what angle do I need to face to look at the target?"
    scene.add(bullet);
    bullets.push({ mesh: bullet, dir: direction }); // store mesh + direction for updateBullets

    // Return direction so main.js can relay the shot to the server in multiplayer
    return { x: player.position.x, z: player.position.z, dirX: direction.x, dirZ: direction.z };
}

// Spawns a bullet fired by a remote player — called when we receive a 'shoot' message
export function spawnRemoteBullet(x, z, dirX, dirZ, scene) {
    const dir = new THREE.Vector3(dirX, 0, dirZ).normalize();
    const bullet = makeBulletMesh();
    bullet.position.set(x, 0, z);
    bullet.rotation.y = Math.atan2(dirX, dirZ);
    bullet.userData.isRemoteBullet = true; // visual only — doesn't count as a kill for local player
    scene.add(bullet);
    bullets.push({ mesh: bullet, dir });
}

// ── UPDATE BULLETS ────────────────────────────────────────────────────────────

// Called every frame from main.js — moves all bullets and checks for collisions
// Returns the number of NPCs killed this frame so main.js can update the kill counter
export function updateBullets(bullets, npcs, walls, scene) {
    let killsThisFrame = 0;

    // Iterate backwards so splicing (removing) bullets doesn't skip indices
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];

        // Move the bullet forward along its direction each frame
        // speed is per-bullet — enemy bullets are faster than player bullets
        bullet.mesh.position.addScaledVector(bullet.dir, bullet.speed ?? 0.4);

        // Build a bounding box around the bullet for collision detection
        _bulletBox.setFromObject(bullet.mesh);

        // ── WALL CHECK ────────────────────────────────────────────────────────
        let hitWall = false;
        for (let w = 0; w < walls.length; w++) {
            if (_bulletBox.intersectsBox(walls[w].userData.box)) {
                scene.remove(bullet.mesh); // remove the mesh from the scene
                bullets.splice(i, 1);      // remove from the array
                hitWall = true;
                break;
            }
        }

        if (hitWall) continue; // bullet already destroyed — skip NPC check

        // Enemy bullets (fired by the boss) should only hit the player, not NPCs
        // Player-vs-enemy-bullet collision is handled in main.js
        if (bullet.mesh.userData.isEnemyBullet) continue;

        // Remote bullets are visual only — they disappear on NPC contact but don't kill
        if (bullet.mesh.userData.isRemoteBullet) {
            for (let j = npcs.length - 1; j >= 0; j--) {
                if (_bulletBox.intersectsBox(_npcBox.setFromObject(npcs[j]))) {
                    scene.remove(bullet.mesh);
                    bullets.splice(i, 1);
                    break;
                }
            }
            continue;
        }

        // ── NPC CHECK ─────────────────────────────────────────────────────────
        let hitNPC = false;
        for (let j = npcs.length - 1; j >= 0; j--) {
            if (_bulletBox.intersectsBox(_npcBox.setFromObject(npcs[j]))) {
                scene.remove(bullet.mesh); // destroy the bullet
                bullets.splice(i, 1);
                hitNPC = true;

                if (npcs[j].userData.isBoss) {
                    // Boss takes 1 damage per bullet and has 100 total HP
                    npcs[j].userData.hp--;
                    // Update the boss health bar width as a percentage
                    const pct = (npcs[j].userData.hp / 100) * 100;
                    document.getElementById('bossBarInner').style.width = pct + '%';
                    if (npcs[j].userData.hp <= 0) {
                        // Boss is dead — hide the health bar and remove it
                        document.getElementById('bossBarContainer').style.display = 'none';
                        scene.remove(npcs[j]);
                        npcs.splice(j, 1);
                        killsThisFrame++; // count boss kill for the level-up check
                    }
                } else {
                    // Regular fox — one hit kill, remove immediately
                    scene.remove(npcs[j]);
                    npcs.splice(j, 1);
                    killsThisFrame++;
                }
                break; // one bullet can only hit one NPC
            }
        }

        if (hitNPC) continue; // bullet already destroyed — stop processing it
    }
    return killsThisFrame; // main.js uses this to call addKill() and spawn new foxes
}

// Spawns a boss bullet using position and direction sent from the server
export function spawnBossBullet(x, z, dirX, dirZ, scene) {
    const dir = new THREE.Vector3(dirX, 0, dirZ).normalize();
    const bullet = makeBulletMesh();
    bullet.position.set(x + dirX * 2, 0, z + dirZ * 2);
    bullet.rotation.y = Math.atan2(dirX, dirZ);
    bullet.scale.set(2.5, 2.5, 2.5);
    bullet.userData.isEnemyBullet = true;
    scene.add(bullet);
    bullets.push({ mesh: bullet, dir, speed: 0.7 });
}

// ── BOSS SHOOT ────────────────────────────────────────────────────────────────

// Called from npc.js every 3 seconds when the boss is alive
// Fires a bullet FROM the boss TOWARD the player
// Flagged with isEnemyBullet = true so it's handled separately in main.js
export function bossShoot(boss, player, scene) {
    // Calculate the direction from the boss to the player
    const direction = new THREE.Vector3();
    direction.subVectors(player.position, boss.position); // player minus boss = points toward player
    direction.y = 0;        // keep on ground plane
    direction.normalize();  // length 1 for consistent speed

    const bullet = makeBulletMesh();
    // Offset spawn position 2 units in front of the boss so the bullet doesn't start inside it
    bullet.position.set(
        boss.position.x + direction.x * 2,
        boss.position.y,
        boss.position.z + direction.z * 2
    );
    bullet.rotation.y = Math.atan2(direction.x, direction.z); // face direction of travel
    bullet.scale.set(2.5, 2.5, 2.5);           // boss bullets are larger than player bullets
    bullet.userData.isEnemyBullet = true;       // flag — tells updateBullets and main.js this is a boss bullet

    scene.add(bullet);
    bullets.push({ mesh: bullet, dir: direction, speed: 0.7 }); // 0.7 vs player's 0.4
}
