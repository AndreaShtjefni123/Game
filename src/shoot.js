import * as THREE from "three";

export const bullets = [];

const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export function shoot(event, camera, sphere, scene) {
    const mouse = new THREE.Vector2(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1
    );

    raycaster.setFromCamera(mouse, camera);

    const targetPoint = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(aimPlane, targetPoint);

    if (!hit) return;

    const bulletGeo = new THREE.SphereGeometry(0.3, 8, 8);
    const bulletMat = new THREE.MeshStandardMaterial({ color: 0xffaa00 });
    const bullet = new THREE.Mesh(bulletGeo, bulletMat);

    bullet.position.set(
        sphere.position.x,
        sphere.position.y,
        sphere.position.z
    );

    const direction = new THREE.Vector3();
    direction.subVectors(targetPoint, sphere.position);
    direction.y = 0;
    direction.normalize();

    scene.add(bullet);
    bullets.push({ mesh: bullet, dir: direction });
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
                scene.remove(npcs[j]);
                npcs.splice(j, 1);
                scene.remove(bullet.mesh);
                bullets.splice(i, 1);
                killsThisFrame++;
                hitNPC = true;
                break;
            }
        }

        if (hitNPC) continue;
    }
    return killsThisFrame;
}