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

const floorGeometry = new THREE.PlaneGeometry(200, 200);
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 });
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2; // lay it flat
floor.position.y = -1;           // push it down below the sphere
scene.add(floor);

// Grid overlay so you can see movement
const grid = new THREE.GridHelper(200, 50, 0x000000, 0x000000);
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

camera.position.x = sphere.position.x;
camera.position.z = sphere.position.z + 15;
camera.position.y = sphere.position.y + 3;
//it helps to draw on a loop
function animate() {
    requestAnimationFrame(animate);
    // Move sphere with WASD
    if (keys['w'] || keys['W']) sphere.position.z -= 0.1;
    if (keys['s'] || keys['S']) sphere.position.z += 0.1;
    if (keys['a'] || keys['A']) sphere.position.x -= 0.1;
    if (keys['d'] || keys['D']) sphere.position.x += 0.1;

    // Camera follows the sphere
    controls.target.copy(sphere.position);
    controls.update();
    renderer.render(scene, camera);
}
animate();
