# Game Feature Implementation Plan

## Feature Overview

| # | Feature | New Files | Modified Files |
|---|---------|-----------|---------------|
| 1 | Health System & Health Bar | `src/health.js` | `src/main.js`, `index.html` |
| 2 | Fox Spawn Cooldown | — | `src/main.js` |
| 3 | Duck Attack Ultimate | `src/duckAttack.js` | `src/main.js`, `index.html` |
| 4 | Levels System | `src/levels.js` | `src/main.js`, `index.html` |
| 5 | Popcorn Pickups + Python Script | `popcorn_blender.py`, `src/pickups.js` | `src/main.js` |
| 6 | Top-Down Camera | — | `src/main.js` |

---

## 1. Health System & Health Bar

**What changes:**
- `src/main.js` — remove instant-death on NPC contact, replace with `takeDamage()` call
- New `src/health.js` module — owns health state and i-frame logic
- `index.html` — add a `<div id="healthBar">` UI overlay

**How it works:**
- `health.js` exports `playerHealth` (starts at 100), `takeDamage(amount)`, and `isInvincible()`
- `takeDamage(20)` is called when an NPC intersects the player box
- After a hit, a 1.5-second invincibility window blocks further damage (tracked via `Date.now()`)
- During i-frames the duck mesh goes semi-transparent (opacity 0.4) and flashes — achieved by toggling `duck.traverse(m => m.material.opacity)` on an interval
- The health bar is a plain CSS div: inner width = `health%`, color transitions green → yellow → red via CSS
- When health hits 0, existing `gameOver = true` logic triggers

**Functions:**
```
takeDamage(amount)     → deduct health, start i-frame timer, update bar, trigger death if 0
isInvincible()         → returns true if within i-frame window
updateHealthBar()      → sets bar width + color each frame
flashPlayer(duck)      → toggles opacity during i-frames
heal(amount)           → adds health clamped to 100, updates bar
```

---

## 2. Fox Spawn Cooldown (Scaling Difficulty)

**What changes:**
- `src/main.js` — wrap `createNPCs()` in a cooldown timer instead of spawning immediately per kill

**How it works:**
- Add `let spawnCooldown = 3.0` (seconds) and `let timeSinceLastSpawn = 0` in `main.js`
- In `animate()`, accumulate `delta` into `timeSinceLastSpawn`; only allow spawning when it exceeds `spawnCooldown`
- Every 30 seconds of survival time, reduce `spawnCooldown` by 0.3s (floor at 0.5s) — so early game is relaxed, late game is intense
- Kills are queued; when the cooldown expires, all queued kills spawn their foxes at once

**Functions:**
```
getSpawnCooldown(survivalTime)       → returns current cooldown duration based on time survived
trySpawnQueued(delta, scene, player) → checks timer, spawns queued foxes if cooldown has elapsed
```

---

## 3. Duck Attack Ultimate Ability

**What changes:**
- New `src/duckAttack.js` module
- `src/main.js` — call `updateDuckAttack()` each frame, wire up `Q` key
- `index.html` — add an "Ultimate" meter bar + key hint label

**How it works:**
- `ultimateMeter` goes 0 → 100, charges at `+2 per second survived` + `+10 per fox killed`
- Press `Q` when meter is full → `activateDuckAttack(scene, player, npcs)` is called
- 3–5 mini-ducks spawn using `duck.glb` at scale 0.6, assigned random orbit angles around the player
- Each frame `updateDuckAttack()` moves mini-ducks toward the nearest fox (same seek logic as NPCs, speed 0.12)
- On contact with a fox → fox is removed, kill is counted
- After 10 seconds, all mini-ducks are removed and meter resets to 0
- UI bar pulses/glows with a CSS animation when meter = 100%

**Functions:**
```
chargeMeter(amount)               → adds to ultimateMeter, clamps to 100
activateDuckAttack(scene, player, npcs) → spawns mini-ducks, starts 10s countdown
updateDuckAttack(delta, scene, player, npcs) → moves mini-ducks, checks fox collisions, handles expiry
deactivateDuckAttack(scene)       → removes all mini-ducks, resets state
updateUltimateBar()               → syncs UI bar width + glow state
```

---

## 4. Levels System

**What changes:**
- New `src/levels.js` module
- `src/main.js` — check level-up condition each frame, trigger transition
- `index.html` — level counter in HUD

**How it works:**
- Each level has a kill target (Level 1: 10 kills, Level 2: 25, Level 3: 50, scaling exponentially)
- When `totalKills` reaches the target, `levelUp()` triggers:
  1. Brief 0.5s freeze with overlay showing "Level 2!" text
  2. All current foxes are cleared from the scene
  3. NPC speed increases by 10% per level (passed as a multiplier into `updateNPCs`)
  4. Player gets a full health restore
  5. Fox spawn cooldown floor is lowered per level
- Level counter displays in the HUD alongside the kill count

**Functions:**
```
getCurrentLevel()          → returns current level number
getKillTarget(level)       → returns kill count needed to reach next level
levelUp(scene, npcs)       → clears foxes, applies new speed/cooldown multipliers, shows UI
checkLevelUp(totalKills)   → called each frame, triggers levelUp if target is met
getNpcSpeedMultiplier()    → returns speed scale for current level (e.g. 1.0, 1.1, 1.2...)
```

---

## 5. Popcorn Pickups + Python Script

### Python (`popcorn_blender.py`)
- Creates 5–7 white/cream elongated spheres arranged in a loose pile (popcorn kernel shapes)
- Uses `bpy.ops.mesh.primitive_uv_sphere_add` with non-uniform scale to make kernel shapes
- Applies a white/cream `BSDF` material
- Exports as `public/scriptpopcorn.glb`

### Game Code
**What changes:**
- New `src/pickups.js` module
- `src/main.js` — call `updatePickups(delta, player, scene)` each frame

**How it works:**
- `spawnPopcorn(scene)` places a popcorn piece at a random map position every 15 seconds
- Max 5 popcorns on the map at once
- Each popcorn bobs: `mesh.position.y = baseY + Math.sin(time * 2) * 0.3` and slowly rotates on Y axis
- Player pickup: distance check < 2 units → `heal(15)` called in `health.js`, popcorn removed from scene
- At low health (< 30), popcorn emissive intensity increases as a visual hint to the player

**Functions:**
```
spawnPopcorn(scene)                       → loads glb, places at random valid map position
updatePickups(delta, player, scene)       → handles bob animation, spawn timer, player pickup collision
```

---

## 6. Top-Down Camera

**What changes:**
- `src/main.js` — modify camera position, `OrbitControls` config, and the per-frame follow logic

**How it works:**
- Set `camera.position.set(0, 40, 0)` and `camera.lookAt(0, 0, 0)` on init
- Disable orbit rotation: `controls.enableRotate = false`
- Each frame in `animate()`: `camera.position.x = player.position.x; camera.position.z = player.position.z` so the camera follows the player directly overhead
- Shooting: the existing `aimPlane` raycaster (y=0 plane) already works correctly for top-down, no changes needed
- Scroll-to-zoom stays enabled so players can adjust view distance

---

## Recommended Implementation Order

| Step | Feature | Reason |
|------|---------|--------|
| 1 | Top-down camera | Quick win, sets the visual baseline for everything else |
| 2 | Health system | Core mechanic — other features (heal, levels) depend on it |
| 3 | Spawn cooldown | Balances difficulty before adding more complexity |
| 4 | Popcorn script + pickups | Needs health system to exist first (`heal()`) |
| 5 | Duck Attack | Self-contained, can be added once core loop is stable |
| 6 | Levels | Ties everything together — best done last |
