import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export const bullets = [];

const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// Pre-load the bullet model once; fall back to null if it fails
let bulletTemplate = null;
const bulletLoader = new GLTFLoader();
bulletLoader.load(
    "/sciptbullet.glb",
    (gltf) => {
        const model = gltf.scene;
        // Strip any cameras/lights baked in from Blender
        const toRemove = [];
        model.traverse((child) => {
            if (child.isCamera || child.isLight) toRemove.push(child);
        });
        toRemove.forEach((obj) => obj.parent.remove(obj));
        model.scale.set(1.2, 1.2, 1.2);
        bulletTemplate = model;
        console.log("✅ Bullet model loaded!");
    },
    undefined,
    (err) => console.warn("⚠️ bullet.glb not found, using fallback sphere.", err)
);

function makeBulletMesh() {
    if (bulletTemplate) {
        return bulletTemplate.clone(true);
    }
    // Fallback yellow sphere
    const geo = new THREE.SphereGeometry(0.6, 8, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffaa00 });
    return new THREE.Mesh(geo, mat);
}

export function shoot(event, camera, player, scene) {
    const mouse = new THREE.Vector2(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1
    );

    raycaster.setFromCamera(mouse, camera);

    const targetPoint = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(aimPlane, targetPoint);

    if (!hit) return;

    const direction = new THREE.Vector3();
    direction.subVectors(targetPoint, player.position);
    direction.y = 0;
    direction.normalize();

    const bullet = makeBulletMesh();
    bullet.position.set(player.position.x, player.position.y, player.position.z);

    // Orient the teardrop tip to face the direction of travel
    bullet.rotation.y = Math.atan2(direction.x, direction.z);

    scene.add(bullet);
    bullets.push({ mesh: bullet, dir: direction });
}

export function shootFromRemote(position, dirX, dirZ, scene) {
    const direction = new THREE.Vector3(dirX, 0, dirZ).normalize();
    const bullet = makeBulletMesh();
    bullet.position.set(position.x, position.y, position.z);
    bullet.rotation.y = Math.atan2(direction.x, direction.z);
    scene.add(bullet);
    bullets.push({ mesh: bullet, dir: direction });
}

const _clientBullets = [];

export function syncBullets(scene, bulletData) {
    // Remove excess
    while (_clientBullets.length > bulletData.length) {
        const mesh = _clientBullets.pop();
        scene.remove(mesh);
    }
    // Add missing
    while (_clientBullets.length < bulletData.length) {
        const mesh = makeBulletMesh();
        scene.add(mesh);
        _clientBullets.push(mesh);
    }
    // Update positions
    for (let i = 0; i < bulletData.length; i++) {
        _clientBullets[i].position.set(bulletData[i].x, 0, bulletData[i].z);
        _clientBullets[i].rotation.y = Math.atan2(bulletData[i].dx, bulletData[i].dz);
    }
}

export function updateBullets(bullets, npcs, walls, scene) { // walls added here
    let killsThisFrame = 0;
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        bullet.mesh.position.addScaledVector(bullet.dir, 0.4);
        const bulletBox = new THREE.Box3().setFromObject(bullet.mesh);

        // check if bullet hit a wall
        let hitWall = false;
        for (let w = 0; w < walls.length; w++) {
            const wallBox = new THREE.Box3().setFromObject(walls[w]);
            if (bulletBox.intersectsBox(wallBox)) {
                // remove bullet, stop it here
                scene.remove(bullet.mesh);
                bullets.splice(i, 1);
                hitWall = true;
                break;
            }
        }

        if (hitWall) continue; // skip NPC check if already destroyed

        // check if bullet hit any NPC
        let hitNPC = false;
        for (let j = npcs.length - 1; j >= 0; j--) {
            const npcBox = new THREE.Box3().setFromObject(npcs[j]);
            if (bulletBox.intersectsBox(npcBox)) {
                scene.remove(bullet.mesh);
                bullets.splice(i, 1);
                hitNPC = true;

                if (npcs[j].userData.isBoss) {
                    npcs[j].userData.hp--;
                    const pct = (npcs[j].userData.hp / 100) * 100;
                    document.getElementById('bossBarInner').style.width = pct + '%';
                    if (npcs[j].userData.hp <= 0) {
                        document.getElementById('bossBarContainer').style.display = 'none';
                        scene.remove(npcs[j]);
                        npcs.splice(j, 1);
                        killsThisFrame++;
                    }
                } else {
                    scene.remove(npcs[j]);
                    npcs.splice(j, 1);
                    killsThisFrame++;
                }
                break;
            }
        }

        if (hitNPC) continue;
    }
    return killsThisFrame;
}