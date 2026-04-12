# Multiplayer Implementation Plan — FINAL
## Duck Survival Shooter — Socket.io

---

## Context

Three rounds of research produced this plan. The original approach used Colyseus with full server authority, which is over-engineered for a 2–4 friend game. This plan uses Socket.io — the simplest and least risky path to real multiplayer with room codes, player sync, and shared level progression. The server relays messages and holds a small amount of shared state (kill count, level, boss HP, dedup Set). All game logic runs on the clients.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                       EC2 Server                        │
│                    server/server.js                     │
│                                                         │
│  Rooms: { code → { players, kills, level, hostId,      │
│                    deadNpcIds (Set), bossHp,            │
│                    pickups: { id → {x,z} } } }         │
│  Light authority — relays messages, tracks kills,       │
│  level, boss HP, pickup state, kill dedup              │
└────────────┬───────────────────────┬────────────────────┘
             │  Socket.io (WSS)      │  Socket.io (WSS)
             │                       │
┌────────────▼──────────┐   ┌────────▼──────────────────┐
│     HOST (Player 1)   │   │    CLIENT (Player 2, 3…)  │
│                       │   │                           │
│  Runs full game loop  │   │  Runs full game loop      │
│  updateNPCs() ✓       │   │  updateNPCs() ✗ (skipped) │
│  updateBullets() ✓    │   │  updateBullets() ✓        │
│  Owns NPC positions   │   │  Displays NPC positions   │
│  Owns pickup spawning │   │  received from host       │
│                       │   │                           │
│  Sends to server:     │   │  Sends to server:         │
│  → playerMove         │   │  → playerMove             │
│  → npcPositions+IDs   │   │  → playerKill (NPC ID)    │
│    (10–20x/sec)       │   │  → removePickup (on collect)│
│  → spawnPickup (only) │   │  → bossDamage (on boss hit)│
│  → bossSpawned (only) │   │  → playerHealth (on hit/heal)│
└───────────────────────┘   └───────────────────────────┘

Server broadcasts to all clients:
→ playerMoved, playerLeft, playerJoined
→ npcPositions, npcRemoved
→ pickupSpawned, pickupRemoved
→ bossSpawned, bossHpUpdate, bossDead
→ playerHealth, levelUp
```

---

## Why Socket.io Instead of Colyseus

| | Colyseus | Socket.io |
|---|---|---|
| Server code (new files) | 7 new server files | 1 server file |
| Client files modified | 9 existing files | 2 existing files + 1 new |
| Schema / sync system | Binary delta schema (must learn) | Plain JSON (you already know it) |
| Room codes | Built-in but complex setup | 5 lines: UUID + JS object |
| Deploy complexity | Nginx + PM2 + SSL + Colyseus | Node.js + one command |
| Implementation time | 2–3 weeks realistically | 3–5 days |
| Risk | Medium (schema desyncs, ES module gotchas) | Low (proven in thousands of games) |

---

## How Each System Works in Multiplayer

**Bullets**
Bullets run entirely local on whoever fired them. No bullet position is ever sent to other players — other players never see your bullets fly. This is fine. Bullets travel fast enough that by the time you'd sync a position, they've already hit or missed. What gets synced is the outcome (NPC dead), not the bullet itself.

**Player Positions**
Every client sends `playerMove(x, z, rotation)` to the server 20 times per second. The server rebroadcasts it as `playerMoved` to everyone else in the room. Receiving clients lerp their duck mesh toward the latest position rather than snapping to it, keeping movement smooth between updates. 20Hz is the right rate for duck walking speed — fast enough to look smooth, low enough not to stress the connection. If NPC movement looks jerky under real network conditions, dead-reckoning (extrapolating from last known velocity) is the natural next step, but lerp is the right starting point.

**NPCs**
The host runs all NPC AI. After each AI tick the host sends `npcPositions` to the server with every NPC's position and ID. The server broadcasts it to all clients at 10–20Hz. Clients maintain an `npcMeshes` Map (id → mesh) and lerp each mesh toward the received position. Running the AI on one machine is the only clean option — if every client ran it independently, tiny floating-point differences would compound and NPCs would end up in completely different places on each screen.

**Kills**
When a client's bullet hits an NPC, it reports the kill via `playerKill(npcId)`. The server checks `deadNpcIds` — if the ID is already there, the report is dropped silently. If not, the ID is added, the shared kill count goes up, and the server broadcasts `npcRemoved(npcId)` to all clients. Every client looks up that ID in their `npcMeshes` Map, calls `scene.remove()` on the mesh, and deletes the entry. The server then checks the kill count against the level threshold and broadcasts `levelUp` if hit. No host hop — the server handles everything directly.

**Ultimate Ability Kills**
The ultimate ability (`ultimate.js`) kills NPCs on contact. Those kills must also be reported via `playerKill(npcId)`. NPC objects already carry state in `userData` (e.g. `userData.isBoss`), and the host-assigned ID is stored as `userData.id` (assigned at spawn in `npc.js`) — so the NPC ID is available at the moment of contact without changing the proximity loop logic. The only addition to `ultimate.js` is calling `network.sendKill(npc.userData.id)` at the point an NPC is removed.

**Pickups**
The host owns all pickup spawning. When the host's spawn timer fires, it assigns a unique ID to the pickup, emits `spawnPickup(id, x, z)` to the server, and then waits. The server stores the pickup in `room.pickups` and broadcasts `pickupSpawned(id, x, z)` to everyone in the room including the host using `io.in(room).emit`. The host creates the pickup mesh only when it receives this broadcast — the same code path as every other client. This keeps the creation logic consistent and avoids duplicates.

When any player walks over a pickup, they heal immediately, emit `removePickup(id)` to the server, and remove the pickup locally. The server removes it from `room.pickups` and broadcasts `pickupRemoved(id)` to all others who remove their copy. No round-trip validation — heal and removal are instant. Occasional simultaneous double-collect is a minor co-op bonus, not a problem.

**Health**
Each player's HP lives on their own machine. When you take damage or get healed, you handle it locally and also send `playerHealth(hp)` to the server. The server relays it to everyone else in the room so teammates can see a small indicator under your duck. Sending on both damage and heal events keeps the indicator accurate — sending only on damage would leave it stale after a pickup heal.

**Boss Spawn**
When the host spawns the boss, it emits `bossSpawned(id, x, z)` to the server. The server sets `room.bossHp = 100` and rebroadcasts `bossSpawned` to all clients. Every client creates the boss mesh at that position and shows the boss HP bar. If a player joins mid-boss-fight, the `joinRoom` acknowledgement includes the current boss state so they see it immediately.

**Boss HP and Death**
The server holds the true boss HP. When any player's bullet hits the boss, they send `bossDamage()` to the server. The server decrements `room.bossHp` and broadcasts `bossHpUpdate(hp)` to all clients so every boss bar shows the same number. When `room.bossHp` reaches 0, the server broadcasts `bossDead` to all clients, increments the shared kill count by 1, and checks the level threshold. Every client removes the boss mesh from scene, deletes it from their `npcMeshes` Map, and hides the boss bar. `bossDamage` and `playerHealth` are separate events — one is damage dealt to the boss, the other is your own current HP.

**Level-Up**
The server maintains a shared kill count. The kill thresholds `[15, 40, 70, 100]` then `+30` per level are defined as a constant in `server.js`. These must match `src/levels.js` — see the Risks section. When the kill count hits the threshold the server broadcasts `levelUp(newLevel)` to all clients.

In multiplayer, `checkLevelUp()` is **not** called from the host's game loop — level progression is server-driven for all players including the host. When the server broadcasts `levelUp(newLevel)`, the host's `onLevelUp` handler calls `doLevelUp(scene, npcs, player)` — the exported version of the function `levels.js` already uses — which clears NPCs, heals the player, shows the overlay, and spawns the new wave after 1.5s. Non-host clients' `onLevelUp` handler iterates their `npcMeshes` Map, calls `scene.remove()` on each mesh, clears the map, then calls `showLevelUpOverlay(newLevel)` and `heal(100)` directly. Both `doLevelUp` and `showLevelUpOverlay` must be exported from `levels.js`.

The server includes the current level number in every room message so clients can self-correct if they miss a `levelUp` event.

**Room Codes and Joining**
Host creates a room, server generates a 6-character code. When a player joins with that code, the server uses a Socket.io acknowledgement callback to send back the full current state. The new joiner creates duck meshes for all players already in the room from this roster. The server also emits `playerJoined` to everyone already in the room with the new player's socket ID, so existing clients can create a duck mesh for the newcomer.

The acknowledgement response object shape (success):
```js
{
  ok: true,
  level: 2,
  kills: 28,
  npcs:    [ { id, x, z } ],           // current NPC positions from host's last broadcast
  pickups: [ { id, x, z } ],           // active pickups currently in room.pickups
  boss:    { id, x, z, hp } | null,    // null if no boss is alive
  players: [ { socketId, x, z, rotation, hp } ]  // all players already in room
}
```
On failure (bad code): `{ ok: false, error: "Room not found" }`.
The `joinRoom` handler in `server.js` must build this response from the current room state before calling `ack(response)`.

**Host Disconnect**
When the host disconnects the server detects it and sends a visible "host left" message to all remaining clients. The session ends. Host migration would require transferring the NPC simulation state, the spawn queue, and re-establishing who runs AI — not worth it for a casual friend game.

**Ghost Ducks**
When any player disconnects — including the host — the server emits `playerLeft` with that player's socket ID to everyone still connected. Each client removes that duck mesh from the `otherPlayers` map and calls `scene.remove()` on it immediately. This cleanup runs before the "session ended" message in the case of a host disconnect.

---

## What Stays Exactly the Same

- `src/health.js` — health runs locally, unchanged
- `src/clock.js` — survival timer unchanged
- All Three.js rendering, models, camera, UI — unchanged

---

## Files to Create

**`server/server.js`** (~300 lines)
Manages rooms: `{ players: {}, kills: 0, level: 1, hostId, deadNpcIds: new Set(), bossHp: 0, pickups: {} }`.

Kill thresholds as a constant: `[15, 40, 70, 100]` then `+30` — must match `src/levels.js`.

Handles these events:
- `createRoom` — generates 6-char code, creates room, sends code back via acknowledgement
- `joinRoom(code, ack)` — adds player, sends full room state via acknowledgement callback (`{ ok, level, kills, npcs, pickups, boss, players }`); emits `playerJoined` to existing room members with new player's socket ID; on bad code sends `{ ok: false, error: "Room not found" }`
- `playerMove(x, z, rotation)` — rebroadcasts as `playerMoved` to all other players
- `npcPositions(data)` — host sends; server rebroadcasts to all clients
- `playerKill(npcId)` — checks `deadNpcIds`, drops duplicate; otherwise adds ID, increments kills, broadcasts `npcRemoved(npcId)` to all, checks level threshold
- `playerHealth(hp)` — rebroadcasts to all others in room
- `spawnPickup(id, x, z)` — host only; server stores in `room.pickups`, broadcasts `pickupSpawned` to all via `io.in(room).emit`
- `removePickup(id)` — any client on collect; server removes from `room.pickups`, broadcasts `pickupRemoved` to all others
- `bossSpawned(id, x, z)` — host only; server sets `room.bossHp = 100`, rebroadcasts to all
- `bossDamage()` — any client on boss hit; server decrements `room.bossHp`, broadcasts `bossHpUpdate(hp)` to all; if `bossHp` reaches 0, broadcasts `bossDead`, increments kills, checks level threshold
- `disconnect` — removes player, emits `playerLeft` with socket ID to all others; if host, emits "host left" message and deletes room

**`src/network.js`** (~120 lines)
Exports an `isHost` flag set when `createRoom` succeeds. Host-only functions (`sendSpawnPickup`, `sendBossSpawned`) should only be called when `isHost` is true — callers are responsible for checking this.

Outgoing functions: `createRoom()`, `joinRoom(code)` (uses acknowledgement callback), `sendMove(x, z, rotation)`, `sendNpcPositions(data)`, `sendKill(npcId)`, `sendHealth(hp)`, `sendSpawnPickup(id, x, z)`, `sendRemovePickup(id)`, `sendBossSpawned(id, x, z)`, `sendBossDamage()`

Incoming callbacks: `onPlayerJoined`, `onPlayerLeft`, `onPlayerMoved`, `onNpcPositions`, `onNpcRemoved`, `onLevelUp`, `onPlayerHealth`, `onPickupSpawned`, `onPickupRemoved`, `onBossSpawned`, `onBossHpUpdate`, `onBossDead`

**`src/lobby.js`** (~80 lines)
The screen before the game starts. Shows a "Create Room" button and a join input. On create, calls `network.createRoom()`, displays the code, then hides the lobby and starts the game. On join, calls `network.joinRoom(code)` and starts on success. Shows an error for bad codes.

---

## Files to Modify

**`index.html`**
Add a lobby overlay div on top of the canvas with the game title, "Create Room" button, room code display, and join input. Hidden once the game starts.

**`src/npc.js`**
Add a module-level counter `let _nextNpcId = 0` at the top of the file. In both `_spawnFoxNow` and `_spawnBossNow`, assign `npc.userData.id = _nextNpcId++` before pushing the NPC to the array. This ID is used in all kill dedup, NPC sync, and boss events — it must exist on every NPC object the host creates.

**`src/levels.js`**
Export two currently-private functions so `main.js` can call them from the `onLevelUp` socket handler:
- `export function doLevelUp(scene, npcs, player)` — already does the full level-up sequence (clear NPCs, heal, show overlay, spawn new wave). Host calls this when it receives `levelUp` from the server.
- `export function showLevelUpOverlay(level)` — non-host clients call this directly along with `heal(100)` and `npcMeshes` map clear.
No other logic changes to this file.

**`src/shoot.js`**
One change only: the local boss HP block (the `npcs[j].userData.hp--` decrement and boss bar update, currently lines 100–107) must be bypassed in multiplayer. When `network.isConnected()` is true, skip that block and call `network.sendBossDamage()` instead. The boss bar is updated only by `onBossHpUpdate` events from the server. In single-player (no network), the original local HP decrement runs unchanged.

**`src/pickup.js`**
Host: when spawn timer fires, generate a unique ID using a module-level counter (`let _nextPickupId = 0` at the top of the file; ID = `String(_nextPickupId++)`). Emit `spawnPickup(id, x, z)` to the server. Do not create the mesh immediately — wait for the `pickupSpawned` callback. This keeps the creation path identical to every other client and prevents duplicates.

All clients (including host): listen for `pickupSpawned` to create the popcorn at the given position with the ID stored on the object. On collection: heal immediately, emit `removePickup(id)`, remove locally. Listen for `pickupRemoved` to remove by ID.

**`src/ultimate.js`**
One addition only: immediately after the `addKill()` call (line 110), add `network.sendKill(npc.userData.id)`. NPC IDs must be assigned in `npc.js` first — this depends on the `npc.js` change above.

**`src/main.js`**
Six additions — everything else stays as-is:

1. After player moves each frame, call `network.sendMove(x, z, rotation)` throttled to 20Hz. Host also sends `network.sendNpcPositions(data)` after the NPC AI tick, also throttled to 20Hz using a timestamp gate: `if (Date.now() - lastNpcBroadcast >= 50) { network.sendNpcPositions(...); lastNpcBroadcast = Date.now(); }` — declare `let lastNpcBroadcast = 0` at setup. The same 50ms gate applies to `sendMove`.

2. Listen for `onPlayerMoved`. Keep a duck mesh per remote player in an `otherPlayers` map (socket ID → mesh), lerped toward received positions. Show a small HP indicator under each duck updated by `onPlayerHealth`. On `joinRoom` success, create duck meshes for all players already in the room from the roster in the acknowledgement response. Listen for `onPlayerJoined` to create a mesh for players who arrive after you joined.

3. Listen for `onPlayerLeft`. Look up that socket ID in `otherPlayers`, call `scene.remove()` on the mesh, delete the entry.

4. Maintain an `npcMeshes` Map (id → mesh) populated from the `onNpcPositions` stream. Listen for `onNpcRemoved(npcId)` — look up the ID in the map, `scene.remove()` the mesh, delete the entry. On `onLevelUp` (non-host clients): iterate `npcMeshes`, `scene.remove()` each mesh, clear the map, call `showLevelUpOverlay(level)` and `heal(100)`.

5. Remove the `checkLevelUp()` call from the game loop when multiplayer is active. Level-up is entirely server-driven. Host `onLevelUp` handler: call `doLevelUp(scene, npcs, player)` (the same function `levels.js` already uses — now exported). Non-host `onLevelUp` handler: clear `npcMeshes`, call `showLevelUpOverlay(level)` and `heal(100)`. Listen for `onLevelUp` for the overlay on all clients.

6. When `addKill()` fires, also call `network.sendKill(npcId)`. When boss spawns (host only), call `network.sendBossSpawned(id, x, z)`. When a bullet hits the boss, call `network.sendBossDamage()`. Listen for `onBossHpUpdate(hp)` and update the boss bar. Listen for `onBossDead` — remove boss mesh from `npcMeshes`, hide the boss bar.

---

## Implementation Order

0. Install dependencies. Frontend: `npm install socket.io-client` (adds to `package.json`). Server: create a `server/` directory, run `npm init -y` inside it, then `npm install socket.io express`. The server is a separate Node.js process — `socket.io-client` is the only new frontend dep.

1. Build `server/server.js` with room create/join (with acknowledgements) and player position broadcast. Test with two browser tabs locally.
2. Build `src/lobby.js` and the `index.html` overlay. Confirm room codes and join work.
3. Add `src/network.js` with Socket.io client, all outgoing functions, and all incoming callbacks.
4. Add `playerMove` sending to `main.js` (throttled to 20Hz). Render other players' duck meshes with lerp. Handle player roster from join response and `onPlayerJoined` for late arrivals.
5. Add `onPlayerLeft` ghost duck cleanup.
6. Add NPC sync — host sends `npcPositions` after AI tick; clients build and update `npcMeshes` Map from stream.
7. Add kill reporting and deduplication — `sendKill(npcId)`, `deadNpcIds` Set on server, `onNpcRemoved` mesh cleanup, `onLevelUp` NPC clearing for clients.
8. Add pickup sync — host emits spawn events; all clients (including host) create on `onPickupSpawned`; anyone emits removal on collect.
9. Add HP relay — `sendHealth(hp)` on damage and heal; display indicator under remote ducks.
10. Add boss sync — `bossSpawned` from host, `bossDamage` from any client, `bossHpUpdate` and `bossDead` from server.
11. Add ultimate kill reporting — `network.sendKill(npc.userData.id)` at point of NPC removal in `ultimate.js`.
12. Deploy to EC2, test with a second person.

---

## Hosting

SSH into EC2, run `node server/server.js` with PM2 so it restarts on crash. Nginx proxies `/socket.io/*` to `localhost:2567`. Self-signed SSL is required for WSS. The Nginx WebSocket proxy block needs these headers or it silently fails:

- `proxy_http_version 1.1`
- `proxy_set_header Upgrade $http_upgrade`
- `proxy_set_header Connection "upgrade"`
- `proxy_buffering off`
- `proxy_read_timeout 3600s`

---

## Verification Checklist

1. Lobby screen appears, game doesn't start yet
2. "Create Room" shows a 6-character code
3. Second tab joins and loads at the correct level, kill count, NPC positions, and active pickups
4. Both tabs show two duck models in the scene immediately on join
5. Moving in one tab moves that duck in the other — smooth, not jumpy
6. Joining a room with an existing player shows that player's duck immediately
7. Disconnecting a client removes their duck immediately — no frozen ghost mesh
8. Both players see the same popcorn pickups in the same positions
9. Collecting a pickup heals instantly and the pickup disappears for all players
10. Teammate HP indicator updates when they take damage and when they heal
11. Combined kills across both players trigger the level-up overlay in both tabs simultaneously
12. On level-up, NPC meshes are cleared on all client screens before the new wave appears
13. Shooting the same NPC from both clients only registers one kill
14. Closing a client's tab — the host and others continue without errors
15. Boss mesh appears on all screens when the host spawns it
16. Boss HP bar shows the same value on all screens and decreases when any player hits it
17. When boss dies, mesh is removed and bar is hidden on all screens
18. Ultimate ability kills count toward the shared kill total
19. SSL configured in Nginx — browser accepts WSS without warnings
20. Both players see foxes in the same positions at the same time
21. Closing the host tab ends the session with a visible message — not a silent freeze

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| NPC positions drift slightly between clients | Low | Lerp smooths it; host is authoritative. If still jerky, upgrade to dead-reckoning |
| Kill double-count | Low | `deadNpcIds` Set on server drops duplicates |
| Pickup double-collect | Very low | Both players heal once — acceptable in co-op |
| Kill thresholds out of sync between server.js and levels.js | Medium | Both files define the same constant array — must be kept in sync manually. Clean fix if needed: extract to a shared config file imported by both |
| Host-only event called by non-host | Low | `isHost` flag in network.js; callers check before sending |
| Bad WiFi drops Socket.io connection | Medium | Socket.io auto-reconnect built in |
| Server crashes on EC2 | Low | PM2 auto-restarts on crash |
| Host disconnects mid-game | Medium | Server sends visible message; session ends cleanly |
