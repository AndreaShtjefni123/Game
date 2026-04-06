import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { addKill } from './clock.js';

const CHARGE_TIME = 30;   // seconds to fully charge
const DUCK_COUNT = 7;
const DUCK_SPEED = 0.15;
const DUCK_LIFE = 5;    // seconds before a mini duck disappears

let charge = 0;
let sceneRef = null;
let playerRef = null;
let npcsRef = null;

const activeDucks = []; // { mesh, direction, timeLeft }

// ── load duck template once ───────────────────────────────────────────────────
let duckTemplate = null;
new GLTFLoader().load(
    '/scriptduck.glb',
    (gltf) => { duckTemplate = gltf.scene; },
    undefined,
    () => console.warn('mini duck model failed, will use yellow spheres')
);

// ── inject pulse CSS once ─────────────────────────────────────────────────────
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

// ── public API ────────────────────────────────────────────────────────────────

export function initUltimate(scene, player, npcs) {
    sceneRef = scene;
    playerRef = player;
    npcsRef = npcs;

    document.addEventListener('keydown', (e) => {
        if ((e.key === 'q' || e.key === 'Q') && charge >= CHARGE_TIME) {
            activate();
        }
    });

    const btn = document.getElementById('ultimateBtn');
    if (btn) btn.addEventListener('click', () => { if (charge >= CHARGE_TIME) activate(); });
}

export function updateUltimate(delta) {
    // charge over time
    if (charge < CHARGE_TIME) {
        charge = Math.min(CHARGE_TIME, charge + delta);
        updateUI();
    }

    // move + collide mini ducks
    for (let i = activeDucks.length - 1; i >= 0; i--) {
        const d = activeDucks[i];
        d.timeLeft -= delta;

        if (d.timeLeft <= 0) {
            sceneRef.remove(d.mesh);
            activeDucks.splice(i, 1);
            continue;
        }

        // find nearest non-boss fox to chase
        let nearestFox = null;
        let nearestDist = Infinity;
        for (let j = 0; j < npcsRef.length; j++) {
            if (npcsRef[j].userData.isBoss) continue;
            const dist = d.mesh.position.distanceTo(npcsRef[j].position);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestFox = npcsRef[j];
                d.targetIndex = j;
            }
        }

        if (nearestFox) {
            // steer toward the fox like an NPC
            const dir = new THREE.Vector3()
                .subVectors(nearestFox.position, d.mesh.position);
            dir.y = 0;
            dir.normalize();
            d.mesh.position.addScaledVector(dir, DUCK_SPEED);
            d.mesh.rotation.y = Math.atan2(dir.x, dir.z);
        }

        // kill on contact
        const dBox = new THREE.Box3().setFromCenterAndSize(
            d.mesh.position, new THREE.Vector3(1.5, 1.5, 1.5)
        );
        let hit = false;
        for (let j = npcsRef.length - 1; j >= 0; j--) {
            const npc = npcsRef[j];
            if (npc.userData.isBoss) continue;
            const npcBox = new THREE.Box3().setFromCenterAndSize(
                npc.position, new THREE.Vector3(1.5, 3, 1.5)
            );
            if (dBox.intersectsBox(npcBox)) {
                sceneRef.remove(npc);
                npcsRef.splice(j, 1);
                addKill();
                sceneRef.remove(d.mesh);
                activeDucks.splice(i, 1);
                hit = true;
                break;
            }
        }
        if (hit) continue;
    }
}

// ── internal ──────────────────────────────────────────────────────────────────

export function activateUltimateAt(position) {
    if (charge < CHARGE_TIME) return;
    charge = 0;
    updateUI();
    for (let i = 0; i < DUCK_COUNT; i++) {
        let mesh;
        if (duckTemplate) {
            mesh = duckTemplate.clone(true);
            mesh.scale.set(0.8, 0.8, 0.8);
        } else {
            mesh = new THREE.Mesh(
                new THREE.SphereGeometry(0.4, 8, 8),
                new THREE.MeshStandardMaterial({ color: 0xffdd00 })
            );
        }
        const angle = (i / DUCK_COUNT) * Math.PI * 2;
        mesh.position.set(
            position.x + Math.sin(angle) * 2,
            0.5,
            position.z + Math.cos(angle) * 2
        );
        sceneRef.add(mesh);
        activeDucks.push({ mesh, timeLeft: DUCK_LIFE });
    }
}

function activate() {
    charge = 0;
    updateUI();
    spawnDucks();
}

function spawnDucks() {
    for (let i = 0; i < DUCK_COUNT; i++) {
        let mesh;
        if (duckTemplate) {
            mesh = duckTemplate.clone(true);
            mesh.scale.set(0.8, 0.8, 0.8);
        } else {
            mesh = new THREE.Mesh(
                new THREE.SphereGeometry(0.4, 8, 8),
                new THREE.MeshStandardMaterial({ color: 0xffdd00 })
            );
        }

        // spread spawn positions slightly around the player
        const angle = (i / DUCK_COUNT) * Math.PI * 2;
        mesh.position.copy(playerRef.position);
        mesh.position.x += Math.sin(angle) * 2;
        mesh.position.z += Math.cos(angle) * 2;
        mesh.position.y = 0.5;
        sceneRef.add(mesh);
        activeDucks.push({ mesh, timeLeft: DUCK_LIFE });
    }
}

function updateUI() {
    const pct = (charge / CHARGE_TIME) * 100;
    const chargeEl = document.getElementById('ultimateCharge');
    const btn = document.getElementById('ultimateBtn');
    if (!chargeEl) return;

    chargeEl.style.background =
        `conic-gradient(#ffd700 ${pct}%, rgba(255,255,255,0.08) ${pct}%)`;

    if (charge >= CHARGE_TIME) {
        btn.classList.add('ready');
    } else {
        btn.classList.remove('ready');
    }
}
