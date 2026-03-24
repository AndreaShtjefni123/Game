# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # Install dependencies
npm run dev       # Start dev server at http://localhost:5173 (HMR enabled)
npm run build     # Build to dist/
npm run preview   # Preview production build
```

## Tech Stack

- **Three.js** (r183) — 3D rendering, physics, raycasting
- **Vite** (v8) — build tool and dev server
- **Vanilla JS** (ES modules) — no framework
- **GLB/glTF** — 3D model format, loaded at runtime via `GLTFLoader`
- **Blender + Python** — `duck_blender.py` / `fox_blender.py` generate the `.glb` assets

## Architecture

The game is a browser-based 3D survival shooter. Entry point is `index.html` → `src/main.js`.

### Module breakdown

| File | Responsibility |
|------|---------------|
| `src/main.js` | Scene setup, game loop, player controls, wall/boundary collision, NPC kill/spawn orchestration |
| `src/npc.js` | NPC creation, seek-player AI, separation behavior, wall avoidance |
| `src/shoot.js` | Raycasting-based shooting, bullet movement, bullet–wall and bullet–NPC collision |
| `src/clock.js` | Survival timer and kill counter — increments each frame, updates DOM |

### Game loop (`main.js → animate()`)

Each `requestAnimationFrame`:
1. Player WASD movement (camera-relative), wall collision via `Box3`
2. `updateBullets()` — moves bullets, returns kills this frame
3. `updateNPCs()` — moves NPCs toward player with separation + wall avoidance
4. Kill handling — `addKill()`, spawn 2 new NPCs per kill
5. `updateClock()` — advances timer
6. Game-over check (NPC contact or boundary ±50 units)

### Key design facts

- **Player model**: `public/scriptduck.glb` (duck), scale 2.5×, fallback to yellow sphere on load failure
- **NPC model**: currently red `BoxGeometry` (1.5×2×1.5). `public/scriptfox.glb` exists but is **not yet wired up**
- **Walls**: 10 brown planes (20×10×1), randomly placed, collision tested with `Box3`
- **Bullets**: yellow spheres (r=0.3), travel 0.4 units/frame, destroyed on wall or NPC hit
- **NPC speed**: 0.06 units/frame; player speed: 0.18 units/frame
- **Spawn**: starts with 3 NPCs; each kill adds 2 more
- Camera uses `OrbitControls` (right-click drag = rotate, scroll = zoom)
