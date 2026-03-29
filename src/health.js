let playerHealth = 100;
const MAX_HEALTH = 100;
const DAMAGE_PER_HIT = 20;
const IFRAME_DURATION = 2000; // milliseconds

let lastHitTime = -Infinity;
let duckMesh = null;       // set via setDuckMesh() once the GLB loads
let flashInterval = null;
let onGameOver = null;     // callback set by main.js

export function setDuckMesh(mesh) {
    duckMesh = mesh;
}

export function setGameOverCallback(cb) {
    onGameOver = cb;
}

export function isInvincible() {
    return (Date.now() - lastHitTime) < IFRAME_DURATION;
}

export function takeDamage(amount = DAMAGE_PER_HIT) {
    if (isInvincible()) return;

    playerHealth = Math.max(0, playerHealth - amount);
    lastHitTime = Date.now();
    updateHealthBar();
    showDamagePopup(amount);
    startFlash();

    if (playerHealth <= 0 && onGameOver) {
        onGameOver();
    }
}

export function heal(amount) {
    playerHealth = Math.min(MAX_HEALTH, playerHealth + amount);
    updateHealthBar();
}

export function getHealth() {
    return playerHealth;
}

export function resetHealth() {
    playerHealth = MAX_HEALTH;
    lastHitTime = -Infinity;
    updateHealthBar();
    stopFlash();
}

export function updateHealthBar() {
    const bar = document.getElementById('healthBarInner');
    const num = document.getElementById('healthNumber');
    if (!bar) return;

    const pct = (playerHealth / MAX_HEALTH) * 100;
    bar.style.width = pct + '%';
    if (num) num.textContent = playerHealth;

    if (pct > 60) {
        bar.style.backgroundColor = '#4caf50'; // green
    } else if (pct > 30) {
        bar.style.backgroundColor = '#ff9800'; // orange
    } else {
        bar.style.backgroundColor = '#f44336'; // red
    }
}

function showDamagePopup(amount) {
    const popup = document.createElement('div');
    popup.textContent = '-' + amount;
    popup.style.cssText = `
        position:absolute; bottom:80px; left:50%; transform:translateX(-50%);
        color:#f44336; font-size:28px; font-family:Arial; font-weight:bold;
        text-shadow:1px 1px 3px black; pointer-events:none;
        animation: floatUp 0.9s ease-out forwards;
    `;
    // inject keyframe once
    if (!document.getElementById('damagePopupStyle')) {
        const style = document.createElement('style');
        style.id = 'damagePopupStyle';
        style.textContent = `@keyframes floatUp {
            0%   { opacity:1; bottom:80px; }
            100% { opacity:0; bottom:130px; }
        }`;
        document.head.appendChild(style);
    }
    document.body.appendChild(popup);
    setTimeout(() => popup.remove(), 900);
}

function startFlash() {
    if (!duckMesh) return;
    stopFlash(); // clear any existing flash

    let visible = true;
    flashInterval = setInterval(() => {
        visible = !visible;
        duckMesh.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.transparent = true;
                child.material.opacity = visible ? 1.0 : 0.25;
            }
        });
    }, 150);

    // stop flashing after i-frame window ends
    setTimeout(() => {
        stopFlash();
    }, IFRAME_DURATION);
}

function stopFlash() {
    if (flashInterval) {
        clearInterval(flashInterval);
        flashInterval = null;
    }
    // restore full opacity
    if (duckMesh) {
        duckMesh.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.opacity = 1.0;
                child.material.transparent = false;
            }
        });
    }
}
