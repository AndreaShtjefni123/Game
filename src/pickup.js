import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { heal } from './health.js';
import * as network from './network.js';

export const pickups = [];
const SPAWN_INTERVAL = 5000;
const HEAL_AMOUNT = 10;
const MAX_PICKUPS = 5;

const loader = new GLTFLoader();
let walls = [];
let _nextPickupId = 0;

// ── internal mesh creation ────────────────────────────────────────────────────

function _createMesh(scene, position, id) {
    loader.load('/scriptpopcorn.glb', (gltf) => {
        const popcorn = gltf.scene;
        popcorn.scale.set(1.5, 1.5, 1.5);
        popcorn.position.set(position.x, position.y, position.z);
        popcorn.rotation.y = Math.PI / 2;
        popcorn.userData.baseY = position.y;
        popcorn.userData.time = Math.random() * Math.PI * 2;
        if (id !== undefined) popcorn.userData.id = id;
        scene.add(popcorn);
        pickups.push(popcorn);
    });
}

function _findPosition() {
    const POPCORN_SIZE = new THREE.Vector3(2, 2, 2);
    let position, attempts = 0;
    do {
        position = { x: Math.random() * 70 - 35, y: 0.5, z: Math.random() * 70 - 35 };
        attempts++;
        const testBox = new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(position.x, position.y, position.z), POPCORN_SIZE
        );
        if (!walls.some(w => testBox.intersectsBox(new THREE.Box3().setFromObject(w)))) break;
    } while (attempts < 20);
    return position;
}

// ── public API ────────────────────────────────────────────────────────────────

// Called by the server's pickupSpawned event on ALL clients (including host).
export function createPickupAt(scene, id, x, z) {
    _createMesh(scene, { x, y: 0.5, z }, id);
}

// Called by the server's pickupRemoved event on non-collecting clients.
export function removePickupById(scene, id) {
    const idx = pickups.findIndex(p => p.userData.id === id);
    if (idx !== -1) {
        scene.remove(pickups[idx]);
        pickups.splice(idx, 1);
    }
}

export function updatePickups(scene, player) {
    const playerBox = new THREE.Box3().setFromCenterAndSize(
        player.position, new THREE.Vector3(1.5, 2, 1.5)
    );

    for (let i = pickups.length - 1; i >= 0; i--) {
        const popcorn = pickups[i];

        popcorn.userData.time += 0.03;
        popcorn.position.y = popcorn.userData.baseY + Math.sin(popcorn.userData.time) * 0.2;
        popcorn.rotation.y += 0.02;

        const popcornBox = new THREE.Box3().setFromObject(popcorn);
        if (popcornBox.intersectsBox(playerBox)) {
            heal(HEAL_AMOUNT);
            if (network.isConnected() && popcorn.userData.id !== undefined) {
                network.sendRemovePickup(popcorn.userData.id);
            }
            scene.remove(popcorn);
            pickups.splice(i, 1);
        }
    }
}

export function startPickupSpawner(scene, wallsArray) {
    walls = wallsArray;
    _spawnPickup(scene);
    setInterval(() => _spawnPickup(scene), SPAWN_INTERVAL);
}

function _spawnPickup(scene) {
    if (pickups.length >= MAX_PICKUPS) return;
    const position = _findPosition();

    if (network.isConnected() && network.isHost) {
        // Multiplayer host: tell server; mesh created via pickupSpawned callback
        const id = String(_nextPickupId++);
        network.sendSpawnPickup(id, position.x, position.z);
    } else {
        // Single player: create directly
        _createMesh(scene, position, String(_nextPickupId++));
    }
}
