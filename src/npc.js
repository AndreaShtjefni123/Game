import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export const npcs = []; //array to store all the npcs and export it to main.js

const loader = new GLTFLoader();

function spawnFox(scene, player, onSpawned) {
    loader.load(
        "/scriptfox.glb",
        (gltf) => {
            const npc = gltf.scene;
            npc.scale.set(3, 3, 3);

            let x, z;
            do {
                x = Math.random() * 70 - 35;
                z = Math.random() * 70 - 35;
            } while (new THREE.Vector3(x, 0, z).distanceTo(player.position) < 20);

            npc.position.set(x, 0, z);
            scene.add(npc);
            npcs.push(npc);
            if (onSpawned) onSpawned(npc);
        },
        undefined,
        () => {
            // fallback to red box if model fails to load
            const npc = new THREE.Mesh(
                new THREE.BoxGeometry(1.5, 2, 1.5),
                new THREE.MeshStandardMaterial({ color: 0xff0000 })
            );
            let x, z;
            do {
                x = Math.random() * 70 - 35;
                z = Math.random() * 70 - 35;
            } while (new THREE.Vector3(x, 0, z).distanceTo(player.position) < 20);
            npc.position.set(x, 0, z);
            scene.add(npc);
            npcs.push(npc);
            if (onSpawned) onSpawned(npc);
        }
    );
}

export function createNPCs(amount, scene, player) {
    for (let i = 0; i < amount; i++) {
        spawnFox(scene, player);
    }
}

export function updateNPCs(npcs, player, _playerBox, walls) {
    for (let i = 0; i < npcs.length; i++) {
        const npc = npcs[i];

        // save BEFORE anything moves
        const previousPosition = npc.position.clone();

        const direction = new THREE.Vector3(); //direction of the npc
        direction.subVectors(player.position, npc.position); //subtract the npc position from the player position
        direction.y = 0; //ignore vertical
        direction.normalize(); //keep length at 1

        // face the player
        npc.rotation.y = Math.atan2(direction.x, direction.z) + Math.PI;

        const speed = 0.06;

        // separation: push away from other NPCs
        const separation = new THREE.Vector3();
        for (let j = 0; j < npcs.length; j++) {
            if (i === j) continue; // skip self
            const other = npcs[j];
            const dist = npc.position.distanceTo(other.position);
            if (dist < 3) { // if closer than 3 units, push away
                const pushDir = new THREE.Vector3();
                pushDir.subVectors(npc.position, other.position); // away from other
                pushDir.y = 0;
                pushDir.normalize();
                pushDir.multiplyScalar((3 - dist) * 0.05); // stronger push the closer they are
                separation.add(pushDir);
            }
        }
        npc.position.add(separation);

        const NPC_SIZE = new THREE.Vector3(1.5, 3, 1.5); // manual hitbox, avoids GLTF bbox issues

        // try full move first
        npc.position.addScaledVector(direction, speed);

        const npcBox = new THREE.Box3().setFromCenterAndSize(npc.position, NPC_SIZE);
        let blocked = false;
        for (let j = 0; j < walls.length; j++) {
            const wallBox = new THREE.Box3().setFromObject(walls[j]);
            if (npcBox.intersectsBox(wallBox)) {
                blocked = true;
                break;
            }
        }

        if (!blocked) continue; // full move worked, skip to next NPC

        // full move was blocked, try X only
        npc.position.copy(previousPosition);
        npc.position.x += direction.x * speed;

        const npcBoxX = new THREE.Box3().setFromCenterAndSize(npc.position, NPC_SIZE);
        let blockedX = false;
        for (let j = 0; j < walls.length; j++) {
            const wallBox = new THREE.Box3().setFromObject(walls[j]);
            if (npcBoxX.intersectsBox(wallBox)) {
                blockedX = true;
                break;
            }
        }
        if (blockedX) npc.position.x = previousPosition.x; // revert X if blocked

        // --- try Z only ---
        npc.position.z += direction.z * speed;

        const npcBoxZ = new THREE.Box3().setFromCenterAndSize(npc.position, NPC_SIZE);
        let blockedZ = false;
        for (let j = 0; j < walls.length; j++) {
            const wallBox = new THREE.Box3().setFromObject(walls[j]);
            if (npcBoxZ.intersectsBox(wallBox)) {
                blockedZ = true;
                break;
            }
        }
        if (blockedZ) npc.position.z = previousPosition.z; // revert Z if blocked
    }
}