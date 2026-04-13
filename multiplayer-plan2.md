# Multiplayer Implementation Plan — FINAL
## Duck Survival Shooter — Socket.io (Easiest, Least Risky Path)

---

## Context

Three rounds of research and review produced this recommendation. The original plan used Colyseus + full server authority, which is over-engineered for a 2–4 friend game. This plan uses Socket.io — the simplest, most proven, and least risky path to real multiplayer with room codes, player sync, and shared level progression.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Railway Server                      │
│                    server/server.js                     │
│                                                         │
│  Rooms: { code → { players, kills, level, hostId } }   │
│  Relay only — no game logic, no Three.js               │
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
│                       │   │  received from host       │
│  Broadcasts:          │   │                           │
│  → NPC positions      │   │  Sends:                   │
│    (10–20x/sec)       │   │  → Player position        │
│  → Kill confirmations │   │  → Shot requests          │
│  → Level-up trigger   │   │  → Kill reports           │
└───────────────────────┘   └───────────────────────────┘
```

**Data flow summary:**
- **Player positions** — each player sends their own position to the server, server rebroadcasts to others
- **NPC positions** — host sends all NPC positions to server, server rebroadcasts to clients
- **Kills** — clients report kills to server; if NPC kill, server notifies host to validate; host confirms and broadcasts removal
- **Level-up** — server tracks shared kill count, broadcasts `levelUp` to all when threshold hit
- **Boss HP** — server holds true HP, decrements on damage events, broadcasts current value to all

---

## Why Socket.io Instead of Colyseus

| | Colyseus | Socket.io |
|---|---|---|
| Server code (new files) | 7 new server files | 1 server file |
| Client files modified | 9 existing files | 2 existing files + 1 new |
| Schema / sync system | Binary delta schema (must learn) | Plain JSON (you already know it) |
| Room codes | Built-in but complex setup | 5 lines: UUID + JS object |
| Deploy complexity | Nginx + PM2 + SSL + Colyseus | Node.js + one command |
| SSL for friends | Self-signed (browser warnings) | Railway gives real HTTPS automatically |
| Implementation time | 2–3 weeks realistically | 3–5 days |
| Risk | Medium (schema desyncs, ES module gotchas, RNG bugs) | Low (proven in thousands of games, pure JS) |

Socket.io is used in thousands of browser multiplayer games. No vendor lock-in. No binary schema to learn. No special state management. You send JSON, you receive JSON.

---

## What You Get With This Plan

- 2–4 players see each other moving in real-time as duck models
- Room codes: one player creates, gets a code, shares it with friends, friends join
- Shared kill count toward level-up (both players' kills add together)
- Individual player health (each player tracks their own)
- NPCs run locally on each client (each client runs its own AI — simpler, no server-side Three.js needed)
- Level-up overlay synced across all players at the same moment
- If one player disconnects, others continue

---

## What Stays Exactly the Same

Everything that currently works stays untouched:
- `src/npc.js` — NPC AI runs locally, unchanged
- `src/shoot.js` — bullets run locally, unchanged
- `src/health.js` — health runs locally, unchanged
- `src/clock.js` — survival timer unchanged
- `src/levels.js` — level logic unchanged (server just broadcasts the trigger)
- `src/pickup.js` — pickups run locally, unchanged
- `src/ultimate.js` — unchanged
- All Three.js rendering, models, animations, camera, UI — unchanged

---

## Files to Create

### `server/server.js` (~250 lines total)
One file. Everything the server does:
- Creates a Socket.io server on port 2567 (or whatever Railway assigns)
- Manages rooms: `rooms` object maps room code → `{players: {}, kills: 0, level: 1}`
- `createRoom`: generates a 6-character room code, creates the room, emits the code back
- `joinRoom(code)`: adds the player to that room, emits current state (level, kills)
- `playerMove(x, z, rotation)`: rebroadcasts to all *other* players in the room
- `playerKill`: increments shared kill count, checks level threshold, if hit → broadcasts `levelUp` to everyone in the room
- `playerDamage(health)`: rebroadcasts to that player's room (so others can show a health flash)
- `disconnect`: removes player, notifies other

### `src/network.js` (~100 lines)
Client-side Socket.io connection:
- Connects to the server URL
- `createRoom()`: emits `createRoom`, returns a promise that resolves with the room code
- `joinRoom(code)`: emits `joinRoom`, returns promise
- Listens for `playerJoined`, `playerLeft`, `playerMoved`, `levelUp`, `playerDamaged`
- Exports event callbacks the caller can set

### `src/lobby.js` (~80 lines)
Lobby screen before the game starts:
- Shows "Create Room" button and "Join Room" input
- On create: calls `network.createRoom()`, shows the code, waits briefly, then hides lobby and starts game
- On join: calls `network.joinRoom(code)`, if success hides lobby and starts game
- Handles bad codes (room not found error)

---

## Files to Modify

### `index.html`
Add a lobby overlay div on top of the canvas. Contains: game title, "Create Room" button, room code display area, join input + "Join" button. Hidden once game starts.

### `src/main.js`
Three additions only — everything else stays as-is:

1. **Send position updates**: inside `animate()`, after player moves, call `network.sendMove(x, z, rotation)` (throttled to 20 times/second — no need to send every frame)

2. **Render other players**: listen for `playerMoved` events from network. For each other player ID, keep a duck mesh in a `otherPlayers` map. On each event, lerp that duck's position toward the new value.

3. **Sync kills and level**: when `addKill()` fires, also call `network.sendKill()`. Listen for `levelUp` from server — when it arrives, call the same level-up overlay function that already exists.

That's it. No game logic moves to the server.

---

## Player Position Logic (Detailed)

### Sending your position

After the player moves each frame and wall collision resolves, the local position is sent to the server. This is throttled — not every frame, only ~20 times per second using a frame counter. Only `x`, `z`, and `rotation.y` are sent; Y is always 0 in this game so it is never transmitted.

### Receiving other players' positions

Each remote player is tracked in an `otherPlayers` map keyed by socket ID. When a `playerMoved` event arrives from the server, two things happen: if this is the first time seeing that ID, a new duck mesh is created and added to the scene; if the player already exists, only the stored target position and rotation are updated. The mesh itself does not jump to the new position immediately.

### Smoothing (lerp)

Every frame, each remote duck mesh lerps toward its stored target position. This means the mesh closes a fraction of the remaining distance each frame rather than snapping. The result is smooth movement even though position updates only arrive 20 times per second. Rotation is snapped directly without lerping since the change is small and lerping rotation looks odd.

### Cleanup on disconnect

When the server emits that a player has left, their duck mesh is removed from the scene and their entry is deleted from the map. This must happen or ghost ducks will stay frozen in place.

### Server responsibility

The server receives the position from the sender and rebroadcasts it to everyone else in the same room. It does no validation and stores no position state — it only relays. This keeps the server simple and stateless for movement.

---

## Hosting
### EC2 
- SSH into EC2, run `node server/server.js` with PM2
- Nginx proxies `/socket.io/*` to `localhost:2567`
- Self-signed SSL still needed for WSS (same problem as Colyseus plan)
- The Nginx WebSocket proxy block needs these headers explicitly or it silently fails:
  - `proxy_http_version 1.1`
  - `proxy_set_header Upgrade $http_upgrade`
  - `proxy_set_header Connection "upgrade"`
  - `proxy_buffering off`
  - `proxy_read_timeout 3600s`


---

## Trade-offs vs. Colyseus Plan

**What you gain:**
- 70% less code to write
- No binary schema system to learn
- No RNG seeding bug (NPCs run locally, no wall sync needed at all)
- No boss fight desync (bullets run locally)
- Faster to test (plain JSON, readable in browser dev tools)
- No invisible NPC bug on join

---

## Implementation Order

1. Build `server/server.js` with room create/join and player position broadcast. Test with two browser tabs locally.
2. Build `src/lobby.js` and the `index.html` overlay. Confirm room codes work.
3. Add `src/network.js` with Socket.io client and event callbacks.
4. Add position sending to `main.js` (throttled to 20Hz).
5. Render other players' duck meshes in `main.js` (lerped from position events).
6. **Add NPC sync:** mark the room creator as host in `server.js`. Host broadcasts NPC positions after each AI tick; clients receive and display them instead of running their own AI.
7. Add kill reporting and `levelUp` broadcast.
8. Add boss HP sync (10 lines on server, 5 lines on client).
9. Deploy to Railway, test with a second person.

---

## Verification Checklist

1. Lobby screen appears, game doesn't start yet
2. "Create Room" shows a 6-character code
3. Second browser tab joins with that code
4. Both tabs show two duck models in the scene
5. Moving in one tab moves that duck in the other (smooth, not jumpy)
6. Shooting NPCs and killing works locally
7. Combined kills across both players trigger level-up overlay in both tabs simultaneously
8. Closing one tab — the other continues without errors
9. Boss HP bar decreases when either player hits the boss
10. No SSL browser warning (Railway gives real HTTPS)
11. Both players see the same fox in the same position at the same time
12. Closing the host tab ends the session with a visible message (not a silent freeze)

---

## Risks (Minimal)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| NPC positions differ between clients | High | Low — NPCs are environmental | Accepted trade-off for simplicity |
| Kill double-count (both clients report same kill) | Medium | Low — overcounts toward level-up | Track killed NPC IDs on client, only report once |
| Socket.io disconnects on mobile/bad WiFi | Medium | Low — auto-reconnect built into Socket.io | Use `socket.io` auto-reconnect with room rejoin |
| Railway cold start on free tier | Low (paid tier) | Medium | $7/mo paid tier keeps server warm |

---

## Summary

Socket.io is the right choice for this game at this stage. It gives you everything you need (room codes, 2–4 player sync, shared level progression) with the least code, least risk, and fastest path to something playable. The entire implementation is 3–5 days of focused work. The game logic stays intact. The server is 250 lines of plain JavaScript you can read and debug easily.

When you want to grow — more players, leaderboards, anti-cheat, spectator mode — you can migrate to Colyseus on top of this foundation without restructuring the client code, because the network interface (`network.js`) is already abstracted.
