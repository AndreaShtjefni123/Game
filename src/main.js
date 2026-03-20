import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { npcs, createNPCs, updateNPCs } from "./npc.js";
import { bullets, shoot, updateBullets } from "./shoot.js";
import { updateClock, showFinalTime, showFinalKills, addKill, totalKills, survivalTime } from "./clock.js";

const scene = new THREE.Scene();

scene.background = new THREE.Color('skyblue');

// Create a camera
const fov = 35;
const aspect = window.innerWidth / window.innerHeight;
const near = 1;
const far = 500;

const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
camera.position.set(0, 3, 10);
camera.lookAt(0, 0, 0); // point the camera at the center

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const geometry = new THREE.SphereGeometry(1, 32, 16);
const material = new THREE.MeshStandardMaterial({ color: 0xffff00 });
const sphere = new THREE.Mesh(geometry, material);
scene.add(sphere);

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

        // Skip if too close to ball's start
        if (wall.position.distanceTo(sphere.position) < 8) {
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
floor.position.y = -1;           // push it down below the sphere
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
controls.enablePan = false; // optional: prevent panning
controls.mouseButtons = {
    RIGHT: THREE.MOUSE.ROTATE  // right-click to orbit
};
window.addEventListener('mousedown', (e) => {
    if (e.button === 0) { // left click only
        shoot(e, camera, sphere, scene); // note: passing 'e' (the event) now
    }
});

//where camera beigns 
camera.position.x = sphere.position.x;
camera.position.z = sphere.position.z + 15;
camera.position.y = sphere.position.y + 3;


camera.position.x = sphere.position.x;
camera.position.z = sphere.position.z + 15;
camera.position.y = sphere.position.y + 3;

createNPCs(3, scene, sphere);
function getSpawnAmount() {
    const minute = Math.floor(survivalTime / 60);
    return 2 * Math.pow(2, minute);
    // 0-60s:    2 per kill
    // 60-120s:  4 per kill
    // 120-180s: 8 per kill
}


let gameOver = false;


//it helps to draw on a loop
function animate() {
    requestAnimationFrame(animate);
    if (gameOver) return; // stops everything when dead
    updateClock();
    const previousPosition = sphere.position.clone();

    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    cameraDirection.y = 0;
    cameraDirection.normalize();

    const cameraRight = new THREE.Vector3();
    cameraRight.crossVectors(cameraDirection, new THREE.Vector3(0, 1, 0)).normalize();

    const speed = 0.18;
    if (keys['w'] || keys['W']) sphere.position.addScaledVector(cameraDirection, speed);
    if (keys['s'] || keys['S']) sphere.position.addScaledVector(cameraDirection, -speed);
    if (keys['a'] || keys['A']) sphere.position.addScaledVector(cameraRight, -speed);
    if (keys['d'] || keys['D']) sphere.position.addScaledVector(cameraRight, speed);

    // wall collision
    const ballBox = new THREE.Box3().setFromObject(sphere);
    for (let i = 0; i < walls.length; i++) {
        const wallBox = new THREE.Box3().setFromObject(walls[i]);
        if (ballBox.intersectsBox(wallBox)) {
            sphere.position.copy(previousPosition);
            break;
        }
    }

    if
        (sphere.position.x > 50 || sphere.position.x < -50 || sphere.position.z > 50 || sphere.position.z < -50) {
        gameOver = true;
        showFinalTime();
        showFinalKills();
        document.getElementById('gameOver').style.display = 'flex';
        return; // stop the rest of this frame immediately
    }

    // update NPCs
    updateNPCs(npcs, sphere, ballBox, walls);

    // check if any NPC touched the player
    for (let i = 0; i < npcs.length; i++) {
        const npcBox = new THREE.Box3().setFromObject(npcs[i]);
        if (npcBox.intersectsBox(ballBox)) {
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
        const spawnAmount = getSpawnAmount() * killsThisFrame;
        createNPCs(spawnAmount, scene, sphere); // spawn more based on time and kills
    }

    // camera follows sphere
    controls.target.copy(sphere.position);
    controls.update();
    renderer.render(scene, camera);
}
animate();