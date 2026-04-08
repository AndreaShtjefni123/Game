# Multiplayer Implementation Plan
## Duck Survival Shooter — Colyseus + AWS EC2

---

## Is This the Right Method?

Yes. Colyseus is the correct choice for this game for these reasons:

- The game already has all the pieces that benefit most from Colyseus: a game loop, NPCs, levels, health, pickups, and a kill system — all of which need to be authoritative on the server in multiplayer
- Colyseus provides room codes, join/create sessions, and automatic player tracking out of the box — the exact features requested
- The existing AWS EC2 server (18.234.143.187) is fully capable of running Colyseus alongside the static site
- The game's scale (2–4 players per room, casual pace) is a perfect fit — no UDP/WebRTC complexity needed

---

## What Changes and What Stays the Same

### What stays exactly the same
- All Three.js rendering and model loading (duck, fox, popcorn, bullet GLB files)
- All visual effects (level-up overlay, health flash, boss bar, ultimate button UI)
- The camera system (OrbitControls, top-down follow)
- The animation mixer (duck waddle)
- The HTML structure and all existing UI elements
- The Vite build system and project structure

### What moves to the server
- NPC AI logic (seek player, separation, wall avoidance) — currently in `npc.js`
- Bullet movement and hit detection — currently in `shoot.js`
- Player health tracking and damage — currently in `health.js`
- Kill counting and level progression — currently in `clock.js` and `levels.js`
- Pickup spawning timing and collision — currently in `pickup.js`
- Mini-duck movement and NPC targeting — currently in `ultimate.js`
- Wall layout generation (via shared seed so both sides build identical walls)

### What the client does instead
- Sends player inputs to the server (WASD direction, shoot direction, ultimate key)
- Receives server state (positions, health, kills, level) and updates Three.js meshes
- Runs visual-only effects locally (bobbing pickups, animations, UI transitions)
- Shows other players' duck models in the scene, updated from server positions
- Interpolates received positions smoothly at 60fps between server updates

---

## Architecture Overview

```
Browser (Client)                    EC2 Server (18.234.143.187)
─────────────────                   ───────────────────────────
Three.js rendering                  Colyseus game server (port 2567, internal only)
Input capture (WASD, click, Q)  ──► GameRoom: authoritative game loop at 20Hz
UI updates (health bar, kills)       ├─ NPC AI for all foxes/boss
Mesh interpolation at 60fps     ◄──  ├─ Bullet movement + hit detection
Lobby (create/join room)             ├─ Health, kills, level, pickups
                                     └─ Player positions validated

Nginx (port 443, public)
├─ Serves Vite dist/ (static site)
└─ Proxies /colyseus/* → localhost:2567 (WebSocket)
```

The client never trusts itself for game outcomes. It sends what the player *intends* to do (move left, shoot) and the server decides what actually happened (did you hit the NPC? did your health change?).

---

## New Files That Will Be Created

### Server-side (new `server/` folder in the project root)

| File | Purpose |
|---|---|
| `server/index.js` | Colyseus server entry point, binds to localhost:2567 |
| `server/GameRoom.js` | The full authoritative game loop — all game logic lives here |
| `server/schemas.js` | Data shapes that Colyseus auto-syncs to clients (Player, NPC, Bullet, Pickup, MiniDuck, GameState) |
| `server/mathUtils.js` | Vector math helpers without Three.js (distance, normalize, wall collision) |
| `server/ecosystem.config.cjs` | PM2 process manager config — keeps server alive, auto-restarts on crash |
| `server/package.json` | Server-only dependencies |
| `server/.env` | Secret config (admin password, port) — never committed to git |

### Client-side (new files in `src/`)

| File | Purpose |
|---|---|
| `src/network.js` | Colyseus client connection — creates/joins rooms, exports the room reference |
| `src/lobby.js` | Lobby screen logic — Create Room button, room code display, Join by code input |

---

## Files That Will Be Modified

| File | What changes |
|---|---|
| `index.html` | Add lobby screen UI overlaid on top of game before it starts |
| `src/main.js` | WASD no longer directly moves player — sends input to server. Animate loop lerps meshes from server state. Game starts after lobby, not immediately. |
| `src/npc.js` | Remove AI update loop. Keep only model loading and mesh creation (triggered by server saying a new NPC exists). |
| `src/shoot.js` | Remove hit detection. Keep visual bullet spawning for instant feedback. Shooting also sends direction to server. |
| `src/health.js` | Remove local damage/heal calls. Health is received from server and used only to update the UI. |
| `src/clock.js` | Kill count comes from server. Survival timer still runs locally (it's cosmetic only). |
| `src/levels.js` | Remove client-side level-up check. Level-up overlay still shows — triggered by server saying level increased. |
| `src/pickup.js` | Remove spawning interval and collision detection. Pickups appear/disappear based on server state. Bobbing animation stays local. |
| `src/ultimate.js` | Charge tracks locally for UI. Activation sends a message to server. Mini-duck movement runs on server, client just renders their positions. |

---

## The Lobby Flow (Room Codes)

1. Player opens the game → sees a lobby screen (not the game yet)
2. **Create Room:** clicks button → server creates a room and returns a short code (e.g. `aB3xYz`) → code shown on screen → share with friends → game starts immediately for the creator
3. **Join Room:** enters a code → clicks Join → connects to that room → game starts
4. Up to 4 players can be in one room
5. Each room is a fully independent game session — NPCs, levels, and state are separate per room

---

## Server Infrastructure Plan

### One-time EC2 setup (run once, then done)
- Install Node.js LTS via NodeSource (Debian's default is too old)
- Install PM2 globally (process manager)
- Install and configure Nginx
- Generate a self-signed SSL certificate for the IP address
- Configure UFW firewall
- Create folder structure: `/var/www/game/client/` and `/var/www/game/server/`

### Port strategy
- Port **443** (HTTPS/WSS) — public-facing, handled by Nginx
- Port **80** — redirects to 443
- Port **22** — SSH, restricted to your IP only
- Port **2567** — Colyseus, bound to `localhost` only, never reachable from outside
- Nginx proxies all `/colyseus/*` WebSocket traffic internally to port 2567
- The Vite `dist/` build is served as static files on the same Nginx instance

### SSL situation
- Let's Encrypt cannot issue certificates for bare IP addresses — it requires a domain name
- **Now:** self-signed certificate with the IP as Subject Alternative Name. Players click "Advanced → Proceed" once and the game works. Fine for friends-only play.
- **When you get a domain:** replace with Certbot in two commands, auto-renews forever
- The self-signed cert is generated on the server itself — zero cost, takes 30 seconds

### Process management (PM2)
- Colyseus runs as a managed PM2 process named `colyseus-game`
- Auto-restarts on crash with a 3-second delay
- Configured to start automatically on server reboot
- Logs written to `/var/log/pm2/` with automatic rotation
- Monitor dashboard at `https://18.234.143.187/colyseus/monitor` (password protected) shows active rooms, players, memory

### WebSocket keep-alive
- Nginx idle timeout set to 1 hour (default 60s would kill active game sessions)
- Colyseus pings each client every 8 seconds — keeps connections alive through AWS NAT (which drops idle TCP after 350s)

---

## State Synchronization Strategy

### What Colyseus syncs automatically
Colyseus uses binary delta compression — only *changed* fields are transmitted each tick. This means if 5 out of 20 NPCs moved, only those 5 positions are sent.

Synced automatically:
- All player positions, rotations, health values, kill counts, game-over flags, names
- All NPC positions, rotations, boss HP
- All bullet positions (so other players see bullets flying)
- All pickup positions (appear when spawned, disappear when collected)
- Mini-duck positions during ultimate ability
- Room-level state: wall seed, current level, kill target, level-up flag

### What stays local (never sent over network)
- Camera position and zoom
- Survival timer display (cosmetic only)
- Animation mixer state (waddle animation)
- Pickup bobbing animation (purely visual)
- Ultimate charge bar (tracked per player locally)

### Tick rate: 20 updates per second
- Server runs the game loop 20 times per second (every 50ms)
- Clients render at 60fps by interpolating smoothly between received positions
- Player's own movement uses client-side prediction (instant feel) then reconciles gently with server — no visible rubber-banding
- NPC meshes lerp 25% toward server position each frame — looks smooth at 60fps

---

## Multiplayer Gameplay Behaviour

### Multiple players in one room
- Each player sees all other players as duck models in the 3D scene
- Each player's camera follows only their own duck
- NPCs seek the nearest player — shared threat for all
- Kills are tracked per player but count toward the shared level-up total
- Health is individual — one player dying does not end the game for others
- A dead player sees their game-over screen; others continue

### Level-up in multiplayer
- Level is shared — combined kills from all players count toward the target
- When target is reached, everyone levels up at the same moment
- All NPCs clear, all players heal to full, overlay appears for everyone simultaneously
- Level 5 boss fight: one boss spawns, all players fight it together

### If a player disconnects
- Their duck disappears from the scene for other players
- Their kills remain counted toward the level total
- The room continues — does not close when one player leaves
- If all players leave, the room is automatically disposed by Colyseus

---

## Deployment Workflow

### First deployment (step by step)
1. SSH into server: `ssh -i c:\Users\user\Game.pem admin@18.234.143.187`
2. Run one-time setup commands (Node.js, PM2, Nginx, SSL cert, firewall, folders)
3. Upload `server/` folder to `/var/www/game/server/` on the server
4. Run `npm run build` locally, upload `dist/` to `/var/www/game/client/`
5. Start Colyseus: `cd /var/www/game/server && npm install && pm2 start ecosystem.config.cjs`
6. Save PM2 process list and configure auto-start on reboot
7. Run the verification checklist

### Everyday updates
1. Make changes locally, run `npm run build`
2. Upload `dist/` to server — Nginx serves the new build immediately (no restart needed)
3. If server logic changed: upload `server/` files and run `pm2 restart colyseus-game`

---

## Verification Checklist

After deployment, confirm each point before considering it done:

1. PM2 shows `colyseus-game` as `online`
2. Port 2567 is only bound to `127.0.0.1` (not publicly reachable)
3. Static site loads at `https://18.234.143.187` (browser accepts self-signed cert, lobby screen appears)
4. "Create Room" button works and shows a room code
5. Opening a second tab, entering the code, and joining connects successfully
6. Both tabs show two duck models in the scene
7. Moving in one tab makes the other tab's duck move
8. Shooting an NPC in one tab removes it in both tabs simultaneously
9. An NPC touching player 1 reduces only player 1's health bar
10. Reaching 15 combined kills triggers the level-up overlay in both tabs simultaneously
11. Closing one tab — the other continues without any crash or error

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Walls don't match between server and client | Medium | Both use the exact same seeded RNG function. Verified in testing step 3 (walls visible and identical). |
| Player movement feels laggy | Medium | Client-side prediction moves the duck instantly; server reconciliation is a gentle lerp, not a snap. Tested by feel during verification. |
| Self-signed cert blocks players | Low | All modern browsers show "Advanced → Proceed" once. Works for all invited players. Resolved permanently when a domain is purchased. |
| Server crashes under load | Low | PM2 auto-restarts within 3 seconds. At 2–4 players and a few rooms, the EC2 instance is well within comfortable limits. |
| NPC AI too expensive on server | Low | The AI is simple vector math running 20 times/second. Even with 30 NPCs across 5 rooms, CPU usage on any EC2 instance is negligible. |

---

## Summary

This plan implements full multiplayer for the Duck Survival Shooter using Colyseus on the existing AWS EC2 server. The result:

- All existing visual and gameplay features are preserved
- Room codes, create/join sessions, and 2–4 player co-op are added
- The server is authoritative — health, kills, NPC positions, and level cannot be faked by a client
- 9 new or modified files total (2 new client files, 7 new server files, 9 modified client files)
- Deployed entirely on the existing EC2 instance — no new infrastructure needed
- Architecture is designed to grow: more players per room, leaderboards, spectator mode, and matchmaking can all be added on top without restructuring
