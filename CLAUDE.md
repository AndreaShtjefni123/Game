# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install           # Install dependencies
npm run dev           # Start Vite dev server at http://localhost:5173 (HMR enabled)
npm run build         # Build to dist/
npm run preview       # Preview production build
node src/server.js    # Start the WebSocket multiplayer server on port 3000
```

## Tech Stack

- **Three.js** (r183) — 3D rendering, physics, raycasting
- **Vite** (v8) — build tool and dev server
- **Vanilla JS** (ES modules) — no framework
- **GLB/glTF** — 3D model format, loaded at runtime via `GLTFLoader`
- **Blender + Python** — `duck_blender.py` / `fox_blender.py` generate the `.glb` assets
- **ws** (v8) — WebSocket library for the multiplayer server
- **Node.js** — runs `src/server.js` for multiplayer

## Architecture

The game is a browser-based 3D survival shooter. Entry point is `index.html` → `src/main.js`.

### Module breakdown

| File | Responsibility |
|------|----------------|
| `src/main.js` | Scene setup, game loop, player controls, wall/boundary collision, NPC kill/spawn orchestration, multiplayer WebSocket client |
| `src/npc.js` | NPC + boss creation, seek-player AI, separation behavior, wall avoidance, boss phase speeds, boss timers |
| `src/shoot.js` | Raycasting-based shooting, bullet movement, bullet–wall and bullet–NPC collision, boss shoot function |
| `src/clock.js` | Survival timer and kill counter — increments each frame, updates DOM |
| `src/health.js` | Player HP, damage, invincibility frames, flash effect, game over callback |
| `src/levels.js` | Kill targets per level, level-up sequence, wave clearing, boss spawn at level 5 |
| `src/pickup.js` | Popcorn health pickups — bobbing animation, player collision, spawn timer |
| `src/ultimate.js` | Q ultimate ability — charges over time, spawns 7 mini ducks that attack foxes |
| `src/server.js` | WebSocket multiplayer server — assigns player IDs, runs shared game loop, relays positions/NPC state/kills to all clients |

### Game loop (`main.js → animate()`)

Each `requestAnimationFrame`:
1. Player WASD movement (camera-relative), wall collision via `Box3`
2. `updateNPCs()` — moves NPCs toward player with separation + wall avoidance, boss timers (solo only — skipped in multiplayer)
3. NPC contact damage check
4. `updatePickups()` — bobbing animation + player pickup collision
5. `updateHealthBar()`, `updateUltimate(delta)`
6. `updateBullets()` — moves bullets, returns kills this frame
7. Enemy bullet hit check (boss bullets → `takeDamage(40)`)
8. Kill handling — `addKill()`, spawn up to cap of 20 foxes
9. `checkLevelUp()` — compare kills to target, trigger level-up if met
10. Camera follow, OrbitControls update, render

### Key design facts

- **Player model**: `public/scriptduck.glb` (duck), scale 1.5×, fallback to yellow sphere on load failure. No animations.
- **NPC model**: `public/scriptfox.glb`, scale 3×. Boss uses same model at scale 8×
- **Walls**: 10 brown boxes (20×10×1), randomly placed, collision tested with `Box3`
- **Player bullets**: travel 0.4 units/frame, destroyed on wall or NPC hit
- **Boss bullets**: travel 0.7 units/frame, 2.5× bigger, deal 40 damage to player
- **Player speed**: 0.18 units/frame
- **Fox speed**: 0.10 units/frame in solo; 0.30 units/tick at 20fps on server (equivalent speed)
- **Fox cap**: max 20 foxes on screen at once to prevent lag
- **Spawn**: starts with 3 foxes; each kill spawns 2 more (capped at 20 total)
- **Camera**: top-down, follows player. OrbitControls for scroll zoom only (rotate disabled)

### Boss (spawns at Level 5)

| Property | Value |
|----------|-------|
| Scale | 8× (much larger than foxes) |
| HP | 100 (takes 1 damage per bullet) |
| Phase 1 speed | 0.03 (100–67 HP) |
| Phase 2 speed | 0.05 (66–34 HP) |
| Phase 3 speed | 0.08 (33–0 HP) |
| Shoots player | Every 3 seconds (40 damage per hit) |
| Spawns minions | Every 10 seconds (2 foxes, only if under cap) |
| Ignores walls | Yes — walks straight through |
| HP bar | Shown in DOM, updates per bullet hit |

### NPC Spawn Chain

```
Game start     → 3 foxes
Kill 1 fox     → +2 spawn (capped at 20 total)
Level up       → all foxes cleared, fresh wave: min(2 + level, 20)
Level 5        → boss fight instead of fox wave
Boss alive     → +2 minions every 10s (only if under 20 cap)
```

### Level progression

| Level | Kill target | Starting foxes |
|-------|-------------|----------------|
| 1→2   | 15 kills    | 4 |
| 2→3   | 40 kills    | 5 |
| 3→4   | 70 kills    | 6 |
| 4→5   | 100 kills   | Boss fight |
| 5+    | +30 each    | Boss fight |

Both modes call `startGame()` which spawns foxes, pickups, ultimate, and starts the game loop.

### Multiplayer (current state)

- **WebSocket server**: `ws://18.234.143.187:3000` — runs on AWS VPS (Debian), managed with pm2
- **Frontend**: served at `http://18.234.143.187` via `serve ~/dist -p 80`
- **VPS SSH**: `ssh -i "C:\Users\user\Game.pem" admin@18.234.143.187`
- **Deploy frontend**: `npm run build` locally, then `scp -i "C:\Users\user\Game.pem" -r dist/ admin@18.234.143.187:~/dist`
- **Start server on VPS**: `cd ~/Game && node src/server.js` (or `pm2 start src/server.js`)

**What is shared in multiplayer:**
- Player positions — each player sees other ducks with nametags and waddle animations
- Fox positions — server runs AI loop every 50ms, broadcasts `npcState` to all clients; client uses Map keyed by `serverId` for matching
- Bullets — when you shoot, direction is relayed to all players via `shoot` message; they spawn a local bullet mesh
- Fox kills — `kill` message sent to server; server removes from `gameState.npcs`, relays to all clients; `killedNpcIds` Set suppresses ghost respawning
- **Level progression — shared**: server tracks combined kill count, broadcasts `levelUp` when `KILL_TARGETS = [15, 40, 70, 100]` is hit; all clients level up together
- Wall layout — host generates walls, sends layout in `joinSuccess.walls`; joiner calls `placeWallsFromServer()` to match

**Server internals (`src/server.js`):**
- `gameState.npcs` — shared NPC list, source of truth for all players; each NPC has a unique `id`
- `spawnNPC(isBoss)` — adds fox or boss to shared list (3 called on boot)
- `setInterval` game loop — moves each NPC toward nearest player at 0.30/tick, broadcasts `npcState` every 50ms
- Handles `move`, `shoot`, `kill`, `levelUp` messages — relays to other players via `broadcast()`
- `KILL_TARGETS` array drives shared level progression; boss spawns at level 5

**Main Menu UI flow:**
- **Play Solo** → `isMultiplayer = false`, no WebSocket, local AI runs via `updateNPCs()`
- **Play Together** → connects to server, shows roomOptions screen
  - **Create Party** — creates a room, waits in waitingRoom until partner joins
  - **Join Party** (button) → reveals `joinCodePanel` (hides Create Party + Back button)
    - Enter code + Join → joins room
    - Back (in panel) → hides panel, restores Create Party + Back button
  - **Back** (roomOptions) → closes socket, returns to main menu
  - **Leave Room** (waitingRoom) → `window.location.reload()`

**What is NOT yet shared:**
- End-game leaderboard
- Individual per-player kill counters (each client tracks its own)
