// ── SURVIVAL TIMER ────────────────────────────────────────────────────────────

// Total seconds the player has survived — increments every frame
// Exported so levels.js and main.js can read it if needed
export let survivalTime = 0;

// Called every frame from main.js — adds 1/60 of a second each tick
// Assumes 60fps; for a more accurate timer, pass delta instead
export function updateClock() {
    survivalTime += 1 / 60; // adds ~0.0167 seconds per frame at 60fps
    // Update the timer DOM element — Math.floor removes the decimal
    document.getElementById('timer').textContent = 'Time: ' + Math.floor(survivalTime) + 's';
}

// Called on game over — displays the final survival time on the game over screen
export function showFinalTime() {
    document.getElementById('finalTime').textContent = 'You survived ' + Math.floor(survivalTime) + ' seconds';
}

// ── KILL COUNTER ──────────────────────────────────────────────────────────────

// Total number of NPCs killed — exported so levels.js can check it for level-up
export let totalKills = 0;

// Called from main.js and ultimate.js each time an NPC is killed
// Increments the counter and updates the HUD
export function addKill() {
    totalKills++;  // increment total
    document.getElementById('kills').textContent = 'Kills: ' + totalKills; // update HUD display
}

// Called on game over — displays the final kill count on the game over screen
export function showFinalKills() {
    document.getElementById('finalKills').textContent = 'Kills: ' + totalKills;
}
