# Levels System — Implementation Plan

## How Levels Work

Levels are **kill-target based** — reach the kill target and you advance.
No loading screens, no map changes. The level transition happens in-place:
a brief overlay flashes, foxes get harder, and the player is rewarded.

---

## Level Structure

| Level | Kill Target | Fox Speed Multiplier | Spawn Cooldown (after 20 kills) | Starting Foxes |
|-------|-------------|---------------------|----------------------------------|----------------|
| 1     | 15 kills    | 1.0× (0.12)         | 2.0s                             | 3              |
| 2     | 30 kills    | 1.2× (0.144)        | 1.7s                             | 4              |
| 3     | 50 kills    | 1.4× (0.168)        | 1.4s                             | 5              |
| 4     | 75 kills    | 1.6× (0.192)        | 1.1s                             | 6              |
| 5+    | +30 each    | +0.15× per level    | floors at 0.5s                   | +1 per level   |

---

## What Happens on Level Up

1. **Overlay appears** — `"LEVEL 2!"` text flashes on screen for 1.5 seconds
2. **All current foxes cleared** — every fox in `npcs[]` is removed from the scene
3. **Health restored** — player gets a full heal back to 100 (reward for completing a level)
4. **Difficulty increases** — fox speed multiplier and spawn cooldown update
5. **Fresh wave spawns** — `createNPCs(startingFoxes, scene, player)` called with the new level's count
6. **Overlay disappears** — game resumes

---

## New File: `src/levels.js`

### State it owns
```
let currentLevel = 1;
let killTargetForNextLevel = 15;
```

### Functions

**`getCurrentLevel()`**
Returns the current level number. Used by `main.js` to display in the HUD and
to look up speed/cooldown values.

**`getKillTarget(level)`**
Returns the kill count needed to advance from `level` to `level + 1`.
Formula: `15 + (level - 1) * 15` — grows by 15 each level, then flattens at +30 above level 3.

**`getFoxSpeedMultiplier()`**
Returns the speed multiplier for the current level (e.g. `1.0`, `1.2`, `1.4`...).
`npc.js` will use this — `const speed = 0.12 * getFoxSpeedMultiplier()`.

**`getSpawnCooldown()`**
Returns the current cooldown in seconds. `main.js` replaces the hardcoded `2.0`
with this call so it automatically tightens each level.

**`checkLevelUp(totalKills, scene, npcs, player)`**
Called every frame in `animate()`. Compares `totalKills` against `killTargetForNextLevel`.
If the target is met, calls `doLevelUp()`.

**`doLevelUp(scene, npcs, player)`**
Orchestrates the full level-up sequence:
1. Increments `currentLevel`
2. Recalculates `killTargetForNextLevel`
3. Removes all foxes from scene + `npcs[]`
4. Calls `heal(100)` from `health.js`
5. Shows the level-up overlay (creates a DOM div, removes it after 1.5s)
6. Calls `createNPCs(startingFoxCount, scene, player)` for the new level

---

## Changes to Existing Files

### `src/npc.js`
- Import `getFoxSpeedMultiplier` from `levels.js`
- Change `const speed = 0.12` → `const speed = 0.12 * getFoxSpeedMultiplier()`

### `src/main.js`
- Import `checkLevelUp`, `getCurrentLevel`, `getSpawnCooldown` from `levels.js`
- In `animate()`: call `checkLevelUp(totalKills, scene, npcs, player)` each frame
- Replace hardcoded `SPAWN_COOLDOWN = 2.0` → `getSpawnCooldown()`
- HUD: add a `<div id="level">` element showing current level

### `index.html`
- Add level display to the HUD (alongside timer and kills)
- Add CSS for the level-up overlay animation (big text, fades in and out)

---

## HUD Layout (after levels added)

```
         [ Time: 42s ]   [ Level 2 ]   [ Kills: 18 ]
                    ❤ HEALTH  80 / 100
                    [========        ]
```

---

## Level-Up Overlay (CSS + DOM)

A full-screen semi-transparent div that appears for 1.5 seconds:

```
╔══════════════════════╗
║                      ║
║      LEVEL 2!        ║
║   Health Restored!   ║
║                      ║
╚══════════════════════╝
```

- Background: `rgba(0, 0, 0, 0.6)`
- Text: large white bold font with a yellow glow (`text-shadow`)
- CSS animation: fades in over 0.3s, holds, fades out over 0.3s
- Created and removed via JS (no permanent HTML needed)

---

## Implementation Order

1. Create `src/levels.js` with all state + functions
2. Update `index.html` — add level HUD element
3. Update `src/npc.js` — plug in speed multiplier
4. Update `src/main.js` — wire up `checkLevelUp`, replace hardcoded cooldown, update HUD
