import { heal } from "./health.js";
import { createNPCs, createBoss } from "./npc.js";

// ─────────────────────────────────────────────
// STATE
// Keeps track of what level the player is on
// and how many kills they need to reach the next one.
// ─────────────────────────────────────────────
export let currentLevel = 1;
let killTarget = 15;      // kills needed to advance from level 1 → 2
let levelingUp = false;   // guard so level-up can't fire twice in one frame

// ─────────────────────────────────────────────
// GETTERS
// These are read by main.js and npc.js so they
// always get the live value for the current level.
// ─────────────────────────────────────────────

export function getCurrentLevel() {
    return currentLevel;
}

// Fox speed starts at 0.12 and increases by 15% each level.
// e.g. level 1 = 0.12, level 2 = 0.138, level 3 = 0.159 ...
export function getFoxSpeedMultiplier() {
    return 1.0 + (currentLevel - 1) * 0.15;
}

// Spawn cooldown starts at 2s and shrinks by 0.25s each level,
// but never goes below 0.5s so the game stays playable.
export function getSpawnCooldown() {
    return Math.max(0.5, 2.0 - (currentLevel - 1) * 0.25);
}

// How many kills are needed to reach the next level.
export function getKillTarget() {
    return killTarget;
}

// ─────────────────────────────────────────────
// CHECK LEVEL UP  (called every frame in main.js)
// Compares totalKills against the current kill target.
// If the player has hit it and we're not already leveling up, fire doLevelUp().
// ─────────────────────────────────────────────
export function checkLevelUp(totalKills, scene, npcs, player) {
    if (levelingUp) return;
    if (totalKills >= killTarget) {
        doLevelUp(scene, npcs, player);
    }
}

// ─────────────────────────────────────────────
// DO LEVEL UP
// The full sequence that runs when the player hits the kill target:
//   1. Lock so it can't fire again mid-transition
//   2. Advance the level counter + recalculate the next kill target
//   3. Clear every fox currently on the map
//   4. Restore the player's health to full (reward!)
//   5. Show the "LEVEL X!" overlay for 1.5 seconds
//   6. Spawn a fresh starting wave sized for the new level
//   7. Unlock so normal gameplay resumes
// ─────────────────────────────────────────────
function doLevelUp(scene, npcs, player) {
    levelingUp = true;

    // Step 2 — advance level and set next kill target
    currentLevel++;
    killTarget = getNextKillTarget(currentLevel);

    // Step 3 — remove every fox from the scene and empty the array
    // We iterate backwards so splicing doesn't skip elements
    for (let i = npcs.length - 1; i >= 0; i--) {
        scene.remove(npcs[i]);
        npcs.splice(i, 1);
    }

    // Step 4 — full health restore as a reward for clearing the level
    heal(100);

    // Step 5 — show the overlay
    showLevelUpOverlay(currentLevel);

    // Step 6 — level 5 is a boss fight; all other levels get a normal wave
    setTimeout(() => {
        if (currentLevel === 5) {
            createBoss(scene, player);
        } else {
            const startingFoxes = 2 + currentLevel;
            createNPCs(startingFoxes, scene, player);
        }
        // Step 7 — unlock after the overlay has gone away (1.5s)
        levelingUp = false;
    }, 1500);
}

// ─────────────────────────────────────────────
// KILL TARGET FORMULA
// Level 1→2: 15 kills,
// ─────────────────────────────────────────────
function getNextKillTarget(level) {
    const targets = [15, 40, 70, 100];
    if (level - 1 < targets.length) {
        return targets[level - 1];
    }
    // level 5+: keep adding 30 to whatever the last target was
    return killTarget + 30;
}

// ─────────────────────────────────────────────
// LEVEL UP OVERLAY
// Creates a DOM div, animates it in, holds, then removes it.
// No permanent HTML needed — it's built and destroyed in JS.
// ─────────────────────────────────────────────
function showLevelUpOverlay(level) {
    // Inject the CSS keyframes once so we don't duplicate them
    if (!document.getElementById('levelUpStyle')) {
        const style = document.createElement('style');
        style.id = 'levelUpStyle';
        style.textContent = `
            @keyframes levelFadeIn  {
                from { opacity:0; transform:translate(-50%,-50%) scale(0.8); }
                to   { opacity:1; transform:translate(-50%,-50%) scale(1); }
            }
            @keyframes levelFadeOut {
                from { opacity:1; }
                to   { opacity:0; }
            }
        `;
        document.head.appendChild(style);
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: absolute;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        text-align: center;
        pointer-events: none;
        animation: levelFadeIn 0.3s ease-out forwards;
    `;
    overlay.innerHTML = `
        <div style="font-size:72px; font-weight:bold; color:white;
                    font-family:Arial; text-shadow: 0 0 20px #ffdd00, 2px 2px 4px black;">
            LEVEL ${level}!
        </div>
        <div style="font-size:26px; color:#ffdd00; font-family:Arial;
                    text-shadow: 1px 1px 3px black; margin-top:10px;">
            ❤ Health Restored!
        </div>
    `;

    document.body.appendChild(overlay);

    // After 1.2s start fading out, then remove from DOM after the fade
    setTimeout(() => {
        overlay.style.animation = 'levelFadeOut 0.3s ease-in forwards';
        setTimeout(() => overlay.remove(), 300);
    }, 1200);
}
