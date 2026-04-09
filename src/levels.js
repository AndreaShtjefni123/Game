// heal is used to restore the player's health to full as a level-up reward
import { heal } from "./health.js";
// createNPCs and createBoss are used to spawn the next wave after leveling up
import { createNPCs, createBoss } from "./npc.js";

// ── STATE ─────────────────────────────────────────────────────────────────────

// Tracks which level the player is currently on — starts at 1
export let currentLevel = 1;
// How many total kills are needed to trigger the next level-up
let killTarget = 15;
// Guard flag — prevents level-up from firing more than once if multiple kills land in the same frame
let levelingUp = false;

// ── GETTERS ───────────────────────────────────────────────────────────────────

// Returns the current level — read by main.js to display the level on the HUD
export function getCurrentLevel() {
    return currentLevel;
}

// Fox move speed scales up 15% per level
// Level 1 = 1.0x (base), Level 2 = 1.15x, Level 3 = 1.30x, etc.
export function getFoxSpeedMultiplier() {
    return 1.0 + (currentLevel - 1) * 0.15;
}

// How long between NPC spawns — shrinks each level to increase pressure
// Starts at 2 seconds, reduces by 0.25s per level, minimum 0.5s
export function getSpawnCooldown() {
    return Math.max(0.5, 2.0 - (currentLevel - 1) * 0.25);
}

// Returns the total kill count needed to advance to the next level
export function getKillTarget() {
    return killTarget;
}

// ── CHECK LEVEL UP ────────────────────────────────────────────────────────────

// Called every frame from main.js — compares totalKills to the current target
// If the player has enough kills and we're not already mid-transition, fire doLevelUp()
// onNPCClear — optional callback called with an array of cleared NPC IDs just before
// the npcs array is emptied. The host uses this to send npcKilled messages to guests.
export function checkLevelUp(totalKills, scene, npcs, player, onNPCClear) {
    if (levelingUp) return;
    if (totalKills >= killTarget) {
        doLevelUp(scene, npcs, player, onNPCClear);
    }
}

// ── DO LEVEL UP ───────────────────────────────────────────────────────────────

// Full sequence that runs when the kill target is reached:
//  1. Lock the guard so it can't fire again mid-transition
//  2. Advance the level counter and set the next kill target
//  3. Clear all foxes from the map
//  4. Restore the player's health to full as a reward
//  5. Show the "LEVEL X!" overlay for 1.5 seconds
//  6. Spawn the next wave (boss at level 5, foxes otherwise)
//  7. Unlock the guard so normal gameplay resumes
function doLevelUp(scene, npcs, player, onNPCClear) {
    levelingUp = true;

    currentLevel++;
    killTarget = getNextKillTarget(currentLevel);

    // Notify caller (host) about which NPC IDs are being cleared so it can
    // send npcKilled messages to guests before removing them locally
    if (onNPCClear) {
        const ids = npcs.map(n => n.userData.id).filter(id => id !== undefined);
        onNPCClear(ids);
    }

    for (let i = npcs.length - 1; i >= 0; i--) {
        scene.remove(npcs[i]);
        npcs.splice(i, 1);
    }

    // Reward the player with full health for clearing the level
    heal(100);

    // Show the animated level-up overlay
    showLevelUpOverlay(currentLevel);

    // Wait 1.5s (overlay duration) then spawn the next wave
    setTimeout(() => {
        if (currentLevel === 5) {
            createBoss(scene, player);  // level 5 is a boss fight instead of a fox wave
        } else {
            const startingFoxes = 2 + currentLevel; // each level starts with more foxes
            createNPCs(startingFoxes, scene, player);
        }
        levelingUp = false; // unlock — normal gameplay resumes
    }, 1500);
}

// ── KILL TARGET FORMULA ───────────────────────────────────────────────────────

// Returns how many total kills are needed to reach each level
// Level 2: 15, Level 3: 40, Level 4: 70, Level 5: 100
// Beyond level 5: keeps adding 30 each time
function getNextKillTarget(level) {
    const targets = [15, 40, 70, 100]; // preset targets for levels 2–5
    if (level - 1 < targets.length) {
        return targets[level - 1];     // look up from the array
    }
    return killTarget + 30;            // level 6+ — extend by 30 each time
}

// ── LEVEL UP OVERLAY ──────────────────────────────────────────────────────────

// Creates a DOM element that shows "LEVEL X!" in the center of the screen
// Animates in, holds briefly, then fades out and removes itself
// No permanent HTML required — built and destroyed entirely in JavaScript
function showLevelUpOverlay(level) {
    // Inject the CSS keyframe animations once — skip if already added
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

    // Build the overlay div and center it on screen
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: absolute;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        text-align: center;
        pointer-events: none;
        animation: levelFadeIn 0.3s ease-out forwards;
    `;
    // Inner HTML — big level number + health restored message
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

    // After 1.2s start fading out, then remove the element from the DOM after the fade
    setTimeout(() => {
        overlay.style.animation = 'levelFadeOut 0.3s ease-in forwards';
        setTimeout(() => overlay.remove(), 300); // remove after fade completes
    }, 1200);
}
