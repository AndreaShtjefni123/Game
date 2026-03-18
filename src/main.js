import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

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
            if (newBox.intersectsBox(existingBox)) {
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

<<<<<<< HEAD
//where camera beigns 
camera.position.x = sphere.position.x;
camera.position.z = sphere.position.z + 15;
camera.position.y = sphere.position.y + 3;

=======
camera.position.x = sphere.position.x;
camera.position.z = sphere.position.z + 15;
camera.position.y = sphere.position.y + 3;
>>>>>>> 5cfc50671ca910d88de2e9805ad3dfaf35609f3a
//it helps to draw on a loop
function animate() {
    requestAnimationFrame(animate);

    const previousPosition = sphere.position.clone();
    // get the direction the camera is facing on the XZ plane
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    cameraDirection.y = 0;           // ignore vertical, stay on ground
    cameraDirection.normalize();     // keep length at 1

    // get the camera's right direction
    const cameraRight = new THREE.Vector3();
    cameraRight.crossVectors(cameraDirection, new THREE.Vector3(0, 1, 0)).normalize();

    const speed = 0.1;
    // Move sphere with WASD
    if (keys['w'] || keys['W']) sphere.position.addScaledVector(cameraDirection, speed);
    if (keys['s'] || keys['S']) sphere.position.addScaledVector(cameraDirection, -speed);
    if (keys['a'] || keys['A']) sphere.position.addScaledVector(cameraRight, -speed);
    if (keys['d'] || keys['D']) sphere.position.addScaledVector(cameraRight, speed);

    // Check collision against every wall
    const ballBox = new THREE.Box3().setFromObject(sphere);

    for (let i = 0; i < walls.length; i++) {
        const wallBox = new THREE.Box3().setFromObject(walls[i]);

        if (ballBox.intersectsBox(wallBox)) {
            // Collision! snap back to where we were
            sphere.position.copy(previousPosition);
            break;
        }
    }
    // Camera follows the sphere
    controls.target.copy(sphere.position);
    controls.update();
    renderer.render(scene, camera);
}
animate();