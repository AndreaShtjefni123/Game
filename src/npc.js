import * as THREE from "three";

export const npcs = []; //array to store all the npcs and export it to main.js

export function createNPCs(amount, scene, sphere) { //create npcs= amount of npcs + scene + sphere(the player)
    for (let i = 0; i < amount; i++) { //loop to create npcs
        const npcGeo = new THREE.BoxGeometry(1.5, 2, 1.5);
        const npcMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        const npc = new THREE.Mesh(npcGeo, npcMat);

        npc.position.set(
            Math.random() * 70 - 35, //random position but inside the floor
            0, //ground level
            Math.random() * 70 - 35
        );

        if (npc.position.distanceTo(sphere.position) < 10) { //if the npc is too close to the player, skip it
            i--;
            continue;
        }

        scene.add(npc);
        npcs.push(npc);
    }
}

export function updateNPCs(npcs, sphere, ballBox, walls) {
    for (let i = 0; i < npcs.length; i++) {
        const npc = npcs[i];

        // save BEFORE anything moves
        const previousPosition = npc.position.clone();

        const direction = new THREE.Vector3(); //direction of the npc
        direction.subVectors(sphere.position, npc.position); //subtract the npc position from the sphere position
        direction.y = 0; //ignore vertical
        direction.normalize(); //keep length at 1

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

        // try full move first
        npc.position.addScaledVector(direction, speed); //move the npc in the direction of the sphere

        const npcBox = new THREE.Box3().setFromObject(npc);
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

        const npcBoxX = new THREE.Box3().setFromObject(npc);
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

        const npcBoxZ = new THREE.Box3().setFromObject(npc);
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