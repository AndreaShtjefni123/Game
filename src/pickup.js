// Three.js is needed for Box3 (collision) and Vector3
import * as THREE from 'three';
// GLTFLoader loads the popcorn .glb model
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// heal() adds HP to the player when they pick up a popcorn
import { heal } from './health.js';

// ── CONFIG ────────────────────────────────────────────────────────────────────

// Shared array of all active popcorn pickup meshes in the scene
export const pickups = [];
const SPAWN_INTERVAL = 5000; // milliseconds between each new popcorn spawn attempt
const HEAL_AMOUNT = 10;      // how much HP the player recovers per popcorn
const MAX_PICKUPS = 5;       // cap on how many popcorns can exist at once

// ── MODEL LOADING ─────────────────────────────────────────────────────────────

const loader = new GLTFLoader();

// Loads a popcorn model and places it at the given position in the scene
// Called by spawnPickup() after a valid position is found
function loadPopcorn(scene, position) {
    loader.load('/scriptpopcorn.glb', (gltf) => {
        const popcorn = gltf.scene;
        popcorn.scale.set(1.5, 1.5, 1.5);                            // scale to visible size
        popcorn.position.set(position.x, position.y, position.z);    // place at spawn point
        popcorn.rotation.y = Math.PI / 2;                            // rotate 90° for visual variety

        // Store the base Y position for the bobbing animation in updatePickups()
        popcorn.userData.baseY = position.y;
        // Random time offset so not all popcorns bob in sync
        popcorn.userData.time = Math.random() * Math.PI * 2;

        scene.add(popcorn);    // add to the Three.js scene so it renders
        pickups.push(popcorn); // add to the shared array so updatePickups() can find it
    });
}

// ── SPAWN ─────────────────────────────────────────────────────────────────────

// Walls reference — set by startPickupSpawner() so spawnPickup() can avoid placing
// popcorns inside walls
let walls = [];

// Tries to find a valid spawn position and load a popcorn there
// Skips if the pickup cap is already reached
function spawnPickup(scene) {
    if (pickups.length >= MAX_PICKUPS) return; // don't spawn if already at the cap

    const POPCORN_SIZE = new THREE.Vector3(2, 2, 2); // size used for wall overlap test
    let position;
    let attempts = 0;

    // Keep trying random positions until one doesn't overlap a wall (max 20 tries)
    do {
        position = {
            x: Math.random() * 70 - 35, // random X between -35 and +35
            y: 0.5,                      // slightly above ground level
            z: Math.random() * 70 - 35  // random Z between -35 and +35
        };
        attempts++;

        // Build a test box at this position and check against every wall
        const testBox = new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(position.x, position.y, position.z),
            POPCORN_SIZE
        );
        // .some() returns true if any wall overlaps — if so, retry the position
        const insideWall = walls.some(wall =>
            testBox.intersectsBox(new THREE.Box3().setFromObject(wall))
        );

        if (!insideWall) break; // found a clear spot — stop retrying
    } while (attempts < 20); // give up after 20 attempts to avoid an infinite loop

    loadPopcorn(scene, position); // load and place the popcorn model
}

// ── UPDATE ────────────────────────────────────────────────────────────────────

// Called every frame from main.js
// Animates each popcorn (bob + spin) and checks if the player walked over one
export function updatePickups(scene, player) {
    // Build a bounding box around the player for pickup collision
    const playerBox = new THREE.Box3().setFromCenterAndSize(
        player.position,
        new THREE.Vector3(1.5, 2, 1.5) // same hitbox size used in main.js
    );

    // Iterate backwards so splicing (removing picked-up items) doesn't skip indices
    for (let i = pickups.length - 1; i >= 0; i--) {
        const popcorn = pickups[i];

        // Bob up and down using a sine wave
        // time increments each frame, sin() produces a smooth -1 to +1 oscillation
        popcorn.userData.time += 0.03;
        popcorn.position.y = popcorn.userData.baseY + Math.sin(popcorn.userData.time) * 0.2;

        // Slowly rotate the popcorn around the Y axis for visual flair
        popcorn.rotation.y += 0.02;

        // Check if the player's hitbox overlaps this popcorn
        const popcornBox = new THREE.Box3().setFromObject(popcorn);
        if (popcornBox.intersectsBox(playerBox)) {
            heal(HEAL_AMOUNT);           // restore HP
            scene.remove(popcorn);      // remove the mesh from the scene
            pickups.splice(i, 1);       // remove from the array
        }
    }
}

// ── INIT ──────────────────────────────────────────────────────────────────────

// Called once from main.js at game start
// Stores the walls reference, spawns the first popcorn immediately,
// then sets up a recurring interval to keep spawning them
export function startPickupSpawner(scene, wallsArray) {
    walls = wallsArray; // store walls so spawnPickup() can avoid placing inside them

    spawnPickup(scene); // spawn one immediately so there's a pickup available right away

    // Keep spawning on a fixed interval — won't exceed MAX_PICKUPS
    setInterval(() => {
        spawnPickup(scene);
    }, SPAWN_INTERVAL);
}
