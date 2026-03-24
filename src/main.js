import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { npcs, createNPCs, updateNPCs } from "./npc.js";
import { bullets, shoot, updateBullets } from "./shoot.js";
import { updateClock, showFinalTime, showFinalKills, addKill, totalKills, survivalTime } from "./clock.js";

const scene = new THREE.Scene();

scene.background = new THREE.Color('skyblue');

// Create a camera
const fov = 60;
const aspect = window.innerWidth / window.innerHeight;
const near = 1;
const far = 500;

const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
camera.position.set(0, 20, 12);
camera.lookAt(0, 0, 0); // point the camera at the center

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── PLAYER (duck model) ──────────────────────────────
// Create a Group so all existing code can reference player.position
// immediately, even before the GLB finishes loading.
const player = new THREE.Group();
scene.add(player);

// We'll start the game loop only after the model is loaded
let modelLoaded = false;

const loader = new GLTFLoader();
loader.load(
    "/scriptduck.glb",
    (gltf) => {
        const duck = gltf.scene;

        // Remove cameras and lights that were exported from Blender
        // (they conflict with the game's own camera and lighting)
        const toRemove = [];
        duck.traverse((child) => {
            if (child.isCamera || child.isLight) {
                toRemove.push(child);
            }
        });
        toRemove.forEach((obj) => obj.parent.remove(obj));

        // Scale the duck to roughly match the old sphere size
        // Adjust these values if the duck appears too big or too small
        duck.scale.set(1.5, 1.5, 1.5);

        // Rotate so the duck faces forward (along -Z in game)
        duck.rotation.y = Math.PI;

        player.add(duck);
        modelLoaded = true;
        console.log("✅ Duck model loaded!");
    },
    (progress) => {
        console.log(`Loading duck: ${Math.round((progress.loaded / progress.total) * 100)}%`);
    },
    (error) => {
        console.error("❌ Failed to load duck model:", error);
        // Fallback: add a yellow sphere so the game is still playable
        const fallbackGeo = new THREE.SphereGeometry(1, 32, 16);
        const fallbackMat = new THREE.MeshStandardMaterial({ color: 0xffff00 });
        const fallbackMesh = new THREE.Mesh(fallbackGeo, fallbackMat);
        player.add(fallbackMesh);
        modelLoaded = true;
    }
);

const walls = [];
function createWalls(amount) {
    for (let i = 0; i < amount; i++) {
        const wallGeo = new THREE.BoxGeometry(20, 10, 1);
        const wallMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const wall = new THREE.Mesh(wallGeo, wallMat);

        wall.position.set(
            Math.random() * 70 - 35,
            4,
            Math.random() * 70 - 35
        );

        if (Math.random() < 0.5) {
            wall.rotation.y = 0;           // horizontal wall
        } else {
            wall.rotation.y = Math.PI / 2; // vertical wall (90 degrees)
        }

        // Skip if too close to player's start
        if (wall.position.distanceTo(player.position) < 8) {
            i--;
            continue;
        }

        // Skip if overlapping any already placed wall
        const newBox = new THREE.Box3().setFromObject(wall);
        let overlapping = false;

        for (let j = 0; j < walls.length; j++) {
            const existingBox = new THREE.Box3().setFromObject(walls[j]);
            // increased from intersectsBox to a distance check of 20 units
            const dist = wall.position.distanceTo(walls[j].position);
            if (dist < 20) {
                overlapping = true;
                break;
            }
        }

        if (overlapping) {
            i--;
            continue;
        }

        scene.add(wall);
        walls.push(wall);
    }
}
createWalls(10);

const floorGeometry = new THREE.PlaneGeometry(100, 100);
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 });
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2; // lay it flat
floor.position.y = -1;           // push it down below the player
scene.add(floor);

// Grid overlay so you can see movement
const grid = new THREE.GridHelper(100, 50, 0x000000, 0x000000);
grid.position.y = -0.99; // just above the floor to avoid z-fighting
grid.material.opacity = 0.3;
grid.material.transparent = true;
scene.add(grid);

// Lights — required for MeshStandardMaterial to show depth
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); // soft fill light
scene.add(ambientLight);
const sunLight = new THREE.DirectionalLight(0xffffff, 1.2); // bright directional light
sunLight.position.set(5, 10, 7);
scene.add(sunLight);

//tracks which keys are getting pressed down
const keys = {};
window.addEventListener('keydown', (e) => keys[e.key] = true);
window.addEventListener('keyup', (e) => keys[e.key] = false);


const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableZoom = true;           // scroll wheel zooms in/out
controls.minDistance = 5;             // closest zoom
controls.maxDistance = 50;            // farthest zoom
controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,         // left-click to orbit
    RIGHT: THREE.MOUSE.ROTATE         // right-click to orbit
};
window.addEventListener('mousedown', (e) => {
    if (e.button === 0) { // left click only
        shoot(e, camera, player, scene); // passing player instead of sphere
    }
});

// where camera begins — offset above and behind the player
camera.position.set(
    player.position.x,
    player.position.y + 20,
    player.position.z + 12
);

createNPCs(3, scene, player);
// function getSpawnAmount() {
//     const minute = Math.floor(survivalTime / 60);
//     return 2 * Math.pow(2, minute);
// }
//this would be needed only if we want the spawn rate to be based on time and kills.


let gameOver = false;


//it helps to draw on a loop
function animate() {
    requestAnimationFrame(animate);
    if (gameOver) return; // stops everything when dead
    if (!modelLoaded) return; // wait for duck model to load
    updateClock();
    const previousPosition = player.position.clone();

    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    cameraDirection.y = 0;
    cameraDirection.normalize();

    const cameraRight = new THREE.Vector3();
    cameraRight.crossVectors(cameraDirection, new THREE.Vector3(0, 1, 0)).normalize();

    const speed = 0.18;
    const moveDir = new THREE.Vector3();
    if (keys['w'] || keys['W']) moveDir.addScaledVector(cameraDirection, 1);
    if (keys['s'] || keys['S']) moveDir.addScaledVector(cameraDirection, -1);
    if (keys['a'] || keys['A']) moveDir.addScaledVector(cameraRight, -1);
    if (keys['d'] || keys['D']) moveDir.addScaledVector(cameraRight, 1);

    if (moveDir.lengthSq() > 0) {
        moveDir.normalize();
        player.position.addScaledVector(moveDir, speed);
        // rotate duck to face movement direction (+ Math.PI compensates for the model's built-in flip)
        player.rotation.y = Math.atan2(moveDir.x, moveDir.z);
    }

    // wall collision — use a manual bounding box for the player group
    const playerBox = new THREE.Box3().setFromCenterAndSize(
        player.position,
        new THREE.Vector3(1.5, 2, 1.5) // approximate duck hitbox
    );
    for (let i = 0; i < walls.length; i++) {
        const wallBox = new THREE.Box3().setFromObject(walls[i]);
        if (playerBox.intersectsBox(wallBox)) {
            player.position.copy(previousPosition);
            break;
        }
    }

    if
        (player.position.x > 50 || player.position.x < -50 || player.position.z > 50 || player.position.z < -50) {
        gameOver = true;
        showFinalTime();
        showFinalKills();
        document.getElementById('gameOver').style.display = 'flex';
        return; // stop the rest of this frame immediately
    }

    // update NPCs
    updateNPCs(npcs, player, playerBox, walls);

    // check if any NPC touched the player
    for (let i = 0; i < npcs.length; i++) {
        const npcBox = new THREE.Box3().setFromObject(npcs[i]);
        if (npcBox.intersectsBox(playerBox)) {
            gameOver = true;
            showFinalTime();
            showFinalKills();
            document.getElementById('gameOver').style.display = 'flex';
            return; // stop the rest of this frame immediately
        }
    }

    const killsThisFrame = updateBullets(bullets, npcs, walls, scene);
    if (killsThisFrame > 0) {
        for (let k = 0; k < killsThisFrame; k++) {
            addKill();
        }
        const SPAWN_PER_KILL = 2; //spawn rate only based on kills
        createNPCs(SPAWN_PER_KILL * killsThisFrame, scene, player);
        // const spawnAmount = getSpawnAmount() * killsThisFrame; 
        // createNPCs(spawnAmount, scene, player); ======= spawn more based on time and kills
    }

    // camera follows player
    controls.target.copy(player.position);
    controls.update();
    renderer.render(scene, camera);
}
animate();