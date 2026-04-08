# Multiplayer Implementation Plan — FINAL
## Duck Survival Shooter — Socket.io (Easiest, Least Risky Path)

---

## Context

Three rounds of research and review produced this recommendation. The original plan used Colyseus + full server authority, which is over-engineered for a 2–4 friend game. This plan uses Socket.io — the simplest, most proven, and least risky path to real multiplayer with room codes, player sync, and shared level progression.

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
- `disconnect`: removes player, notifies others

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

## Hosting

### Option A: Railway ($7/month) — Recommended
- Connect GitHub repo to Railway
- Railway deploys `server/server.js` automatically on every `git push`
- Railway provides a real HTTPS/WSS URL automatically (no self-signed cert, no browser warnings)
- No Nginx config, no PM2, no SSH
- Static site stays on Vercel (free) or the same EC2

### Option B: EC2 (already have it, $0 extra)
- SSH into EC2, run `node server/server.js` with PM2
- Nginx proxies `/socket.io/*` to `localhost:2567`
- Self-signed SSL still needed for WSS (same problem as Colyseus plan)
- The Nginx WebSocket proxy block needs these headers explicitly or it silently fails:
  - `proxy_http_version 1.1`
  - `proxy_set_header Upgrade $http_upgrade`
  - `proxy_set_header Connection "upgrade"`
  - `proxy_buffering off`
  - `proxy_read_timeout 3600s`

Railway is recommended to avoid the self-signed cert problem entirely.

---

## Trade-offs vs. Colyseus Plan

**What you gain:**
- 70% less code to write
- No binary schema system to learn
- No RNG seeding bug (NPCs run locally, no wall sync needed at all)
- No boss fight desync (bullets run locally)
- Faster to test (plain JSON, readable in browser dev tools)
- No invisible NPC bug on join (each client spawns its own NPCs)

**What you accept:**
- NPC positions are not synced between players. Two players in the same room see foxes in slightly different positions. For a casual co-op game this is fine — the NPCs are environmental hazards, not precision shared targets.
- Boss HP needs to be shared. When a player shoots the boss, they send `bossDamage` to the server. Server tracks the true HP, broadcasts it. All clients update their boss bar from the server value. This is the one piece of authoritative logic on the server (~10 lines).
- Kills are reported from clients, not validated. Friends can't easily cheat this, and there's no mechanism to do so from the game UI anyway.

---

## Implementation Order

1. Build `server/server.js` with room create/join and player position broadcast. Test with two browser tabs locally.
2. Build `src/lobby.js` and the `index.html` overlay. Confirm room codes work.
3. Add `src/network.js` with Socket.io client and event callbacks.
4. Add position sending to `main.js` (throttled to 20Hz).
5. Render other players' duck meshes in `main.js` (lerped from position events).
6. Add kill reporting and `levelUp` broadcast.
7. Add boss HP sync (10 lines on server, 5 lines on client).
8. Deploy to Railway, test with a second person.

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
