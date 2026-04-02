// Three.js is needed for vectors, geometry, and bounding boxes
import * as THREE from 'three';
// GLTFLoader loads the mini duck model used for the ultimate ability
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// addKill() is called when a mini duck kills a fox — keeps the kill counter accurate
import { addKill } from './clock.js';

// ── CONFIG ────────────────────────────────────────────────────────────────────

const CHARGE_TIME = 30;  // seconds to fully charge the ultimate
const DUCK_COUNT = 7;    // how many mini ducks are spawned when the ultimate activates
const DUCK_SPEED = 0.15; // how fast each mini duck moves per frame
const DUCK_LIFE = 5;     // seconds each mini duck lives before disappearing

// ── STATE ─────────────────────────────────────────────────────────────────────

let charge = 0;          // current charge level in seconds (0 to CHARGE_TIME)
let sceneRef = null;     // reference to the Three.js scene — set by initUltimate()
let playerRef = null;    // reference to the player group — used to spawn ducks around the player
let npcsRef = null;      // reference to the npcs array — used to find targets and kill them

// Each entry is { mesh, timeLeft } — tracked so ducks can be removed after DUCK_LIFE seconds
const activeDucks = [];

// ── MINI DUCK MODEL ───────────────────────────────────────────────────────────

// Load the duck model once — all mini ducks clone this template
let duckTemplate = null;
new GLTFLoader().load(
    '/scriptduck.glb',
    (gltf) => { duckTemplate = gltf.scene; },          // store the loaded model as the template
    undefined,
    () => console.warn('mini duck model failed, will use yellow spheres') // fallback warning
);

// ── PULSE CSS ─────────────────────────────────────────────────────────────────

// Inject a CSS keyframe animation once — makes the ultimate button glow when ready
const style = document.createElement('style');
style.textContent = `
  @keyframes ultimatePulse {
    0%   { box-shadow: 0 0 10px 4px rgba(255,215,0,0.5); }
    50%  { box-shadow: 0 0 24px 10px rgba(255,215,0,0.9); }
    100% { box-shadow: 0 0 10px 4px rgba(255,215,0,0.5); }
  }
  #ultimateBtn.ready { animation: ultimatePulse 1s ease-in-out infinite; cursor:pointer; }
`;
document.head.appendChild(style);

// ── PUBLIC API ────────────────────────────────────────────────────────────────

// Called once from main.js at game start
// Stores references to the scene, player, and npcs array
// Sets up Q key and button click listeners to activate the ultimate
export function initUltimate(scene, player, npcs) {
    sceneRef = scene;
    playerRef = player;
    npcsRef = npcs;

    // Q key activates the ultimate if fully charged
    document.addEventListener('keydown', (e) => {
        if ((e.key === 'q' || e.key === 'Q') && charge >= CHARGE_TIME) {
            activate();
        }
    });

    // The on-screen button also activates it on click
    const btn = document.getElementById('ultimateBtn');
    if (btn) btn.addEventListener('click', () => { if (charge >= CHARGE_TIME) activate(); });
}

// Called every frame from main.js with the time since the last frame (delta)
// Handles charging, mini duck movement, and mini duck kill detection
export function updateUltimate(delta) {
    // Increase charge over time — clamps at CHARGE_TIME so it never overflows
    if (charge < CHARGE_TIME) {
        charge = Math.min(CHARGE_TIME, charge + delta);
        updateUI(); // keep the charge ring in sync every frame while charging
    }

    // ── MINI DUCK MOVEMENT & COLLISION ───────────────────────────────────────

    // Iterate backwards so splicing (removing expired/killed ducks) doesn't skip indices
    for (let i = activeDucks.length - 1; i >= 0; i--) {
        const d = activeDucks[i];
        d.timeLeft -= delta; // count down this duck's remaining lifespan

        // Remove the duck if its lifespan has expired
        if (d.timeLeft <= 0) {
            sceneRef.remove(d.mesh); // remove mesh from the Three.js scene
            activeDucks.splice(i, 1);
            continue;
        }

        // Find the nearest regular fox (mini ducks ignore the boss)
        let nearestFox = null;
        let nearestDist = Infinity;
        for (let j = 0; j < npcsRef.length; j++) {
            if (npcsRef[j].userData.isBoss) continue; // skip the boss — ducks don't target it
            const dist = d.mesh.position.distanceTo(npcsRef[j].position);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestFox = npcsRef[j];
                d.targetIndex = j; // store index for potential future use
            }
        }

        // Steer toward the nearest fox using the same seek logic as regular NPCs
        if (nearestFox) {
            const dir = new THREE.Vector3()
                .subVectors(nearestFox.position, d.mesh.position); // direction toward fox
            dir.y = 0;          // keep on the ground plane
            dir.normalize();    // length 1 for consistent speed
            d.mesh.position.addScaledVector(dir, DUCK_SPEED); // move toward fox
            d.mesh.rotation.y = Math.atan2(dir.x, dir.z);    // face direction of travel
        }

        // Check if this mini duck is touching any regular fox
        const dBox = new THREE.Box3().setFromCenterAndSize(
            d.mesh.position, new THREE.Vector3(1.5, 1.5, 1.5) // duck hitbox
        );
        let hit = false;
        for (let j = npcsRef.length - 1; j >= 0; j--) {
            const npc = npcsRef[j];
            if (npc.userData.isBoss) continue; // boss is immune to mini ducks
            const npcBox = new THREE.Box3().setFromCenterAndSize(
                npc.position, new THREE.Vector3(1.5, 3, 1.5)  // fox hitbox
            );
            if (dBox.intersectsBox(npcBox)) {
                sceneRef.remove(npc);       // remove the fox from the scene
                npcsRef.splice(j, 1);       // remove from the npcs array
                addKill();                  // increment the kill counter
                sceneRef.remove(d.mesh);    // remove the mini duck too (one kill per duck)
                activeDucks.splice(i, 1);
                hit = true;
                break; // one duck kills one fox then dies
            }
        }
        if (hit) continue; // duck already removed — skip to next duck
    }
}

// ── INTERNAL ──────────────────────────────────────────────────────────────────

// Triggers when the player presses Q or clicks the button while fully charged
function activate() {
    charge = 0;   // reset charge to zero
    updateUI();   // update the charge ring to show empty
    spawnDucks(); // release the mini ducks
}

// Spawns DUCK_COUNT mini ducks in a ring around the player
function spawnDucks() {
    for (let i = 0; i < DUCK_COUNT; i++) {
        let mesh;
        if (duckTemplate) {
            mesh = duckTemplate.clone(true); // deep clone the loaded duck model
            mesh.scale.set(0.8, 0.8, 0.8);  // slightly smaller than the player duck
        } else {
            // Fallback if the model didn't load — small yellow sphere
            mesh = new THREE.Mesh(
                new THREE.SphereGeometry(0.4, 8, 8),
                new THREE.MeshStandardMaterial({ color: 0xffdd00 })
            );
        }

        // Spread ducks evenly around the player in a circle
        // angle steps through a full 360° divided by the number of ducks
        const angle = (i / DUCK_COUNT) * Math.PI * 2;
        mesh.position.copy(playerRef.position);         // start at player position
        mesh.position.x += Math.sin(angle) * 2;        // offset outward in X
        mesh.position.z += Math.cos(angle) * 2;        // offset outward in Z
        mesh.position.y = 0.5;                          // slightly above ground

        sceneRef.add(mesh);
        activeDucks.push({ mesh, timeLeft: DUCK_LIFE }); // track with a countdown timer
    }
}

// Updates the charge ring UI and the glow state of the ultimate button
function updateUI() {
    const pct = (charge / CHARGE_TIME) * 100; // convert charge to a percentage
    const chargeEl = document.getElementById('ultimateCharge');
    const btn = document.getElementById('ultimateBtn');
    if (!chargeEl) return; // guard — DOM might not be ready

    // conic-gradient draws the ring filled to the current percentage
    chargeEl.style.background =
        `conic-gradient(#ffd700 ${pct}%, rgba(255,255,255,0.08) ${pct}%)`;

    // Add/remove the 'ready' CSS class — triggers the gold pulse animation when full
    if (charge >= CHARGE_TIME) {
        btn.classList.add('ready');
    } else {
        btn.classList.remove('ready');
    }
}
