import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { heal } from './health.js';

export const pickups = [];
const SPAWN_INTERVAL = 5000; // ms between spawns
const HEAL_AMOUNT = 10;
const MAX_PICKUPS = 5;

const loader = new GLTFLoader();

// Pre-load a template for client-side sync
let popcornTemplate = null;
loader.load('/scriptpopcorn.glb', (gltf) => {
    popcornTemplate = gltf.scene;
    popcornTemplate.scale.set(1.5, 1.5, 1.5);
    popcornTemplate.rotation.y = Math.PI / 2;
});

function loadPopcorn(scene, position) {
    loader.load('/scriptpopcorn.glb', (gltf) => {
        const popcorn = gltf.scene;
        popcorn.scale.set(1.5, 1.5, 1.5);
        popcorn.position.set(position.x, position.y, position.z);
        popcorn.rotation.y = Math.PI / 2;
        // store base Y for bobbing animation
        popcorn.userData.baseY = position.y;
        popcorn.userData.time = Math.random() * Math.PI * 2;

        scene.add(popcorn);
        pickups.push(popcorn);
    });
}

let walls = [];

function spawnPickup(scene) {
    if (pickups.length >= MAX_PICKUPS) return;

    const POPCORN_SIZE = new THREE.Vector3(2, 2, 2);
    let position;
    let attempts = 0;

    do {
        position = {
            x: Math.random() * 70 - 35,
            y: 0.5,
            z: Math.random() * 70 - 35
        };
        attempts++;

        const testBox = new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(position.x, position.y, position.z),
            POPCORN_SIZE
        );
        const insideWall = walls.some(wall =>
            testBox.intersectsBox(new THREE.Box3().setFromObject(wall))
        );

        if (!insideWall) break;
    } while (attempts < 20);

    loadPopcorn(scene, position);
}

export function updatePickups(scene, player) {
    const playerBox = new THREE.Box3().setFromCenterAndSize(
        player.position,
        new THREE.Vector3(1.5, 2, 1.5)
    );

    for (let i = pickups.length - 1; i >= 0; i--) {
        const popcorn = pickups[i];

        // bobbing up and down animation
        popcorn.userData.time += 0.03;
        popcorn.position.y = popcorn.userData.baseY + Math.sin(popcorn.userData.time) * 0.2;

        // slow rotation
        popcorn.rotation.y += 0.02;

        // check if player touched it
        const popcornBox = new THREE.Box3().setFromObject(popcorn);
        if (popcornBox.intersectsBox(playerBox)) {
            heal(HEAL_AMOUNT);
            scene.remove(popcorn);
            pickups.splice(i, 1);
        }
    }
}

const _clientPickups = [];

export function syncPickups(scene, pickupData) {
    // Remove excess
    while (_clientPickups.length > pickupData.length) {
        const mesh = _clientPickups.pop();
        scene.remove(mesh);
    }
    // Add missing
    while (_clientPickups.length < pickupData.length) {
        let mesh;
        if (popcornTemplate) {
            mesh = popcornTemplate.clone(true);
        } else {
            mesh = new THREE.Mesh(
                new THREE.SphereGeometry(0.5, 8, 8),
                new THREE.MeshStandardMaterial({ color: 0xffcc00 })
            );
            mesh.scale.set(1.5, 1.5, 1.5);
        }
        scene.add(mesh);
        _clientPickups.push(mesh);
    }
    // Update positions
    for (let i = 0; i < pickupData.length; i++) {
        _clientPickups[i].position.set(pickupData[i].x, 0.5, pickupData[i].z);
    }
}

export function startPickupSpawner(scene, wallsArray) {
    walls = wallsArray;

    // spawn one immediately
    spawnPickup(scene);

    // then keep spawning on interval
    setInterval(() => {
        spawnPickup(scene);
    }, SPAWN_INTERVAL);
}
