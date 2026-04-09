import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// Shared bullets array — main.js passes this into updateBullets every frame
export const bullets = [];

// Monotonic counter for assigning unique bullet IDs (Phase 11)
let bulletSeq = 0;

const raycaster = new THREE.Raycaster();
const aimPlane  = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// ── BULLET MODEL ─────────────────────────────────────────────────────────────
let bulletTemplate = null;
const bulletLoader = new GLTFLoader();
bulletLoader.load(
    "/sciptbullet.glb",
    (gltf) => {
        const model = gltf.scene;
        const toRemove = [];
        model.traverse((child) => { if (child.isCamera || child.isLight) toRemove.push(child); });
        toRemove.forEach((obj) => obj.parent.remove(obj));
        model.scale.set(1.2, 1.2, 1.2);
        bulletTemplate = model;
        console.log("✅ Bullet model loaded!");
    },
    undefined,
    (err) => console.warn("⚠️ bullet.glb not found, using fallback sphere.", err)
);

function makeBulletMesh() {
    if (bulletTemplate) return bulletTemplate.clone(true);
    return new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xffaa00 })
    );
}

// ── SPAWN REMOTE BULLET (Phase 11) ────────────────────────────────────────────
// Called when a bulletSpawned message arrives from another player.
// Creates a visual bullet at the given origin travelling in dir.
// The local host also adds this to bullets[] so it participates in kill validation.
export function spawnBullet(scene, origin, dir, bulletId) {
    const mesh = makeBulletMesh();
    mesh.position.set(origin.x, 0, origin.z);
    const d = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    mesh.rotation.y = Math.atan2(d.x, d.z);
    scene.add(mesh);
    bullets.push({ mesh, dir: d, speed: 0.4, bulletId });
}

// ── PLAYER SHOOT (Phase 11) ───────────────────────────────────────────────────
// socket and myId are nullable — if null the bullet is local-only (no network message).
export function shoot(event, camera, player, scene, socket, myId) {
    const mouse = new THREE.Vector2(
        (event.clientX / window.innerWidth)  *  2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);
    const targetPoint = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(aimPlane, targetPoint)) return;

    const direction = new THREE.Vector3();
    direction.subVectors(targetPoint, player.position);
    direction.y = 0;
    direction.normalize();

    bulletSeq++;
    const bulletId = myId ? `${myId}_${bulletSeq}` : `local_${bulletSeq}`;

    const bullet = makeBulletMesh();
    bullet.position.copy(player.position);
    bullet.rotation.y = Math.atan2(direction.x, direction.z);
    scene.add(bullet);
    bullets.push({ mesh: bullet, dir: direction, speed: 0.4, bulletId });

    // Broadcast to relay so other clients can simulate the visual (Phase 11)
    if (socket && myId && socket.readyState === 1) {
        if (socket.bufferedAmount < 8192) { // backpressure guard (Phase 12)
            socket.send(JSON.stringify({
                type:     'shoot',
                bulletId,
                ownerId:  myId,
                origin:   { x: player.position.x, z: player.position.z },
                dir:      { x: direction.x,        z: direction.z        }
            }));
        }
    }
}

// ── UPDATE BULLETS ────────────────────────────────────────────────────────────
// isHost — if true, NPC hits are registered and NPCs removed (host kill authority).
//          if false, bullets are destroyed on NPC contact but NPCs are not removed
//          — guests wait for npcKilled from host (Phase 11).
// wallBoxes — pre-computed Box3 array passed from main.js (Phase 0).
//
// Returns { killedNpcIds: number[], bossHit: bool, newBossHp: number }
export function updateBullets(bullets, npcs, walls, scene, isHost = true, wallBoxes = null) {
    const killedNpcIds = [];
    let bossHit  = false;
    let newBossHp = -1;

    // Use pre-computed boxes when available (Phase 0 optimisation)
    const wboxes = wallBoxes ?? walls.map(w => new THREE.Box3().setFromObject(w));

    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        bullet.mesh.position.addScaledVector(bullet.dir, bullet.speed ?? 0.4);

        const bulletBox = new THREE.Box3().setFromObject(bullet.mesh);

        // ── WALL CHECK ────────────────────────────────────────────────────────
        let hitWall = false;
        for (let w = 0; w < wboxes.length; w++) {
            if (bulletBox.intersectsBox(wboxes[w])) {
                scene.remove(bullet.mesh);
                bullets.splice(i, 1);
                hitWall = true;
                break;
            }
        }
        if (hitWall) continue;

        // Enemy bullets are handled separately in main.js — skip NPC check
        if (bullet.mesh.userData.isEnemyBullet) continue;

        // ── NPC CHECK ─────────────────────────────────────────────────────────
        for (let j = npcs.length - 1; j >= 0; j--) {
            const npcBox = new THREE.Box3().setFromObject(npcs[j]);
            if (!bulletBox.intersectsBox(npcBox)) continue;

            // Always destroy the bullet on contact
            scene.remove(bullet.mesh);
            bullets.splice(i, 1);

            if (isHost) {
                if (npcs[j].userData.isBoss) {
                    npcs[j].userData.hp--;
                    bossHit   = true;
                    newBossHp = npcs[j].userData.hp;
                    const pct = (npcs[j].userData.hp / 100) * 100;
                    document.getElementById('bossBarInner').style.width = pct + '%';
                    if (npcs[j].userData.hp <= 0) {
                        document.getElementById('bossBarContainer').style.display = 'none';
                        const id = npcs[j].userData.id;
                        scene.remove(npcs[j]);
                        npcs.splice(j, 1);
                        killedNpcIds.push(id);
                    }
                } else {
                    const id = npcs[j].userData.id;
                    scene.remove(npcs[j]);
                    npcs.splice(j, 1);
                    killedNpcIds.push(id);
                }
            }
            // Guest: bullet destroyed above, NPC stays until npcKilled arrives from host
            break;
        }
    }

    return { killedNpcIds, bossHit, newBossHp };
}

// ── BOSS SHOOT ────────────────────────────────────────────────────────────────
// Called from npc.js every 3 seconds on the host only (isHost guard in updateNPCs).
export function bossShoot(boss, player, scene) {
    const direction = new THREE.Vector3();
    direction.subVectors(player.position, boss.position);
    direction.y = 0;
    direction.normalize();

    const bullet = makeBulletMesh();
    bullet.position.set(
        boss.position.x + direction.x * 2,
        boss.position.y,
        boss.position.z + direction.z * 2
    );
    bullet.rotation.y = Math.atan2(direction.x, direction.z);
    bullet.scale.set(2.5, 2.5, 2.5);
    bullet.userData.isEnemyBullet = true;

    scene.add(bullet);
    bullets.push({ mesh: bullet, dir: direction, speed: 0.7 });
}
