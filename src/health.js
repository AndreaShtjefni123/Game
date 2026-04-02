// ── STATE ─────────────────────────────────────────────────────────────────────

let playerHealth = 100;          // current HP — game over when this reaches 0
const MAX_HEALTH = 100;          // cap — can never heal above this
const DAMAGE_PER_HIT = 20;       // default damage if no amount is passed to takeDamage()
const IFRAME_DURATION = 2000;    // milliseconds of invincibility after taking a hit

let lastHitTime = -Infinity;     // timestamp of last hit — -Infinity means never hit yet
let duckMesh = null;             // reference to the duck 3D model — used for the flash effect
let flashInterval = null;        // stores the setInterval ID so we can cancel it
let onGameOver = null;           // callback function set by main.js — called when HP hits 0

// ── SETUP ─────────────────────────────────────────────────────────────────────

// Called from main.js once the duck .glb model finishes loading
// Gives health.js a reference to the mesh so it can animate the flash effect
export function setDuckMesh(mesh) {
    duckMesh = mesh;
}

// Called from main.js to register the game over handler
// health.js calls this when HP reaches 0 so main.js can show the game over screen
export function setGameOverCallback(cb) {
    onGameOver = cb;
}

// ── INVINCIBILITY FRAMES ──────────────────────────────────────────────────────

// Returns true if the player is currently invincible (within IFRAME_DURATION ms of last hit)
// Prevents multiple hits registering in the same brief window
export function isInvincible() {
    return (Date.now() - lastHitTime) < IFRAME_DURATION;
}

// ── DAMAGE ────────────────────────────────────────────────────────────────────

// Reduces player health by the given amount
// Does nothing if the player is currently invincible (i-frames active)
export function takeDamage(amount = DAMAGE_PER_HIT) {
    if (isInvincible()) return; // still in i-frame window — ignore this hit

    playerHealth = Math.max(0, playerHealth - amount); // clamp to 0 so HP can't go negative
    lastHitTime = Date.now();  // start the i-frame timer
    updateHealthBar();         // immediately sync the health bar UI
    showDamagePopup(amount);   // show the floating "-X" damage number
    startFlash();              // make the duck blink to signal the hit

    // If HP reached 0, trigger the game over screen via the callback
    if (playerHealth <= 0 && onGameOver) {
        onGameOver();
    }
}

// ── HEALING ───────────────────────────────────────────────────────────────────

// Adds HP up to the MAX_HEALTH cap — called by pickup.js (popcorn) and levels.js (level-up)
export function heal(amount) {
    playerHealth = Math.min(MAX_HEALTH, playerHealth + amount); // clamp to max
    updateHealthBar(); // sync the bar immediately
}

// ── GETTERS ───────────────────────────────────────────────────────────────────

// Returns current HP — can be read by other modules if needed
export function getHealth() {
    return playerHealth;
}

// Resets HP to full and clears i-frames — used for restart
export function resetHealth() {
    playerHealth = MAX_HEALTH;
    lastHitTime = -Infinity; // clear i-frame timer
    updateHealthBar();
    stopFlash();             // make sure the duck isn't stuck mid-flash
}

// ── HEALTH BAR UI ─────────────────────────────────────────────────────────────

// Updates the health bar width and color in the DOM to match current HP
// Green above 60%, orange above 30%, red below 30%
export function updateHealthBar() {
    const bar = document.getElementById('healthBarInner');
    const num = document.getElementById('healthNumber');
    if (!bar) return; // guard — DOM might not be ready on first call

    const pct = (playerHealth / MAX_HEALTH) * 100; // convert HP to a percentage
    bar.style.width = pct + '%';                    // resize the bar
    if (num) num.textContent = playerHealth;        // update the numeric display

    // Change bar color based on how low HP is
    if (pct > 60) {
        bar.style.backgroundColor = '#4caf50'; // green — healthy
    } else if (pct > 30) {
        bar.style.backgroundColor = '#ff9800'; // orange — warning
    } else {
        bar.style.backgroundColor = '#f44336'; // red — critical
    }
}

// ── DAMAGE POPUP ─────────────────────────────────────────────────────────────

// Shows a floating "-X" text near the health bar that floats upward and fades out
function showDamagePopup(amount) {
    const popup = document.createElement('div');
    popup.textContent = '-' + amount; // e.g. "-20"
    popup.style.cssText = `
        position:absolute; bottom:80px; left:50%; transform:translateX(-50%);
        color:#f44336; font-size:28px; font-family:Arial; font-weight:bold;
        text-shadow:1px 1px 3px black; pointer-events:none;
        animation: floatUp 0.9s ease-out forwards;
    `;
    // Inject the keyframe animation once — skip if already in the document
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
    setTimeout(() => popup.remove(), 900); // remove from DOM after the animation finishes
}

// ── FLASH EFFECT ─────────────────────────────────────────────────────────────

// Makes the duck blink between fully opaque and semi-transparent during i-frames
// Gives the player visual feedback that they've been hit and are temporarily invincible
function startFlash() {
    if (!duckMesh) return; // duck model may not be loaded yet
    stopFlash();           // cancel any existing flash before starting a new one

    let visible = true;
    // Toggle opacity every 150ms to create a blinking effect
    flashInterval = setInterval(() => {
        visible = !visible;
        // traverse() visits every child mesh — needed for multi-part models
        duckMesh.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.transparent = true;
                child.material.opacity = visible ? 1.0 : 0.25; // fully visible or ghosted
            }
        });
    }, 150);

    // Automatically stop flashing when the i-frame window expires
    setTimeout(() => {
        stopFlash();
    }, IFRAME_DURATION);
}

// Cancels the blink interval and restores the duck to fully opaque
function stopFlash() {
    if (flashInterval) {
        clearInterval(flashInterval); // cancel the blinking loop
        flashInterval = null;
    }
    // Restore full opacity so the duck doesn't get stuck semi-transparent
    if (duckMesh) {
        duckMesh.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.opacity = 1.0;
                child.material.transparent = false;
            }
        });
    }
}
