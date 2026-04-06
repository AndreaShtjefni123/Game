# Multiplayer Implementation Plan — Host-Client via WebSocket Relay

## Context

The game is a 3D survival shooter (duck vs foxes) built with Three.js + Vite. We want to add 2-player co-op multiplayer where one player (host) runs all game logic and another player (client) joins over the internet. A WebSocket relay server on the user's Lightsail instance (`admin@18.234.143.187`, PEM at `c:\Users\CODECON\Downloads\Game.pem`) forwards messages between host and client.

## Architecture

```
Client Browser  ──wss──►  Lightsail Relay  ◄──wss──  Host Browser
  (renders)               (routes msgs)              (runs game logic)
  sends inputs             room codes                 sends state @20Hz
  interpolates             heartbeats                 processes client inputs
```

- **Host** = runs the full existing game loop + manages a 2nd player entity
- **Client** = sends WASD/shoot/Q inputs, receives full state, renders it
- **Relay** = dumb message router with room management, no game logic

## Files to Create

| File | Purpose |
|------|---------|
| `server/server.js` | WebSocket relay server (Node.js + `ws`) |
| `server/package.json` | Server dependencies (`ws`) |
| `src/network.js` | Client-side WebSocket connection, message send/receive |
| `src/lobby.js` | Lobby UI logic (create/join room, show room code) |

## Files to Modify

| File | Changes |
|------|---------|
| `index.html` | Add lobby screen HTML (create/join UI), hide game UI until connected |
| `src/main.js` | Integrate network module; if host: add 2nd player, broadcast state @20Hz, process client inputs; if client: disable local game logic, apply received state, send inputs |
| `src/npc.js` | Export ability to set NPC positions directly (for client-side rendering) |
| `src/shoot.js` | Support creating bullets from remote player input |
| `src/health.js` | Support tracking health per-player (host + client) |
| `src/clock.js` | No change — host tracks kills/time, sends in snapshot |
| `src/pickup.js` | No change — host runs spawner, sends pickup positions in snapshot |

## Implementation Steps

### Step 1: Relay Server (`server/`)

Create `server/package.json` with `ws` dependency and `server/server.js`:

- **Room management**: `rooms` Map keyed by 5-char code (unambiguous chars: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`)
- **Two message flows**:
  - `client → relay → host`: input messages (type `input`)
  - `host → relay → clients`: state messages (type `state`) + events (type `event`)
- **Room lifecycle**: create → join → start → play → end
- **Heartbeat**: ping/pong every 30s to detect dead connections
- **Room cleanup**: delete room when host disconnects, notify clients
- **Max 2 players per room** (host + 1 client for v1)
- Server listens on port `3001`

### Step 2: Lobby UI (`index.html` + `src/lobby.js`)

Add a lobby screen that shows before the game:
- **Create Room** button → connects to relay, gets room code, displays it
- **Join Room** text input + button → enters code, connects to relay
- Once both players connected, host clicks **Start** → game begins
- Hide lobby, show game UI

### Step 3: Network Module (`src/network.js`)

Client-side WebSocket wrapper:
- `connect(serverUrl)` → establishes WebSocket connection
- `createRoom()` / `joinRoom(code)` → lobby flow
- `sendInput(inputState)` → client sends WASD/shoot/Q to host (via relay)
- `sendState(snapshot)` → host broadcasts game state to client (via relay)
- `onMessage(callback)` → register handler for incoming messages
- Reconnection with exponential backoff (500ms base, 30s max, 10 attempts)
- `isHost` flag set during room creation

### Step 4: Integrate into `main.js`

**Host mode** (existing game loop + additions):
1. Create a 2nd player Group (clone duck model) for the remote player
2. In `animate()`, process buffered client inputs → move remote player, handle remote shoots
3. Every 50ms (20Hz), build a state snapshot and send via `sendState()`:
   ```
   {
     players: [{ x, z, rot, health }, { x, z, rot, health }],
     npcs: [{ x, z, rot, isBoss, hp }],
     bullets: [{ x, z, dirX, dirZ }],
     pickups: [{ x, z }],
     kills, time, level,
     events: [{ type: 'damage', player: 1, amount: 20 }, ...]
   }
   ```
4. Remote player collision with NPCs → call `takeDamage` for player 2
5. Remote player wall collision (server-side validation of client inputs)

**Client mode** (replaces most of the game loop):
1. Don't run `createNPCs`, `startPickupSpawner`, `updateNPCs`, `checkLevelUp`
2. In `animate()`:
   - Capture local inputs (WASD, mouse, Q) → send via `sendInput()` at 20Hz
   - Apply latest received snapshot: set all entity positions/rotations
   - Interpolate between last two snapshots for smooth rendering (100ms buffer)
   - Update DOM (health bar, kills, timer, level) from snapshot data
3. Local prediction: apply own movement immediately, correct toward host position

### Step 5: Remote Player Entity

- Clone duck model for 2nd player, tint it slightly (different color material) so players can tell apart
- Both players share the same `walls[]` array (walls are deterministic, seeded)
- Host checks NPC collision against both players
- Host checks bullet-NPC collision for bullets from both players

### Step 6: Deterministic Walls

Currently walls are randomly placed. For multiplayer, the host needs to send wall positions to the client so they match. Options:
- **Chosen approach**: Host sends wall positions+rotations once at game start in an `init` message. Client creates walls from that data instead of randomly.

### Step 7: Deploy Relay to Lightsail

SSH into `admin@18.234.143.187` using the PEM key:
1. Install Node.js if not present
2. Copy `server/` directory
3. `npm install` + run with `node server.js` (or use PM2 for persistence)
4. Update `src/network.js` to point to `ws://18.234.143.187:3001`

## What Stays Single-Player (Host-Only Logic)

These modules run only on the host — clients receive results via snapshots:
- `npc.js` — NPC AI, spawning, pathfinding
- `levels.js` — level progression, kill targets, boss spawning
- `pickup.js` — popcorn spawning
- `ultimate.js` — Q ability (host activates for whichever player pressed Q)
- `clock.js` — timer, kill counter

## Message Protocol

### Client → Host (via relay)
```json
{ "t": "input", "seq": 1, "keys": { "w": true }, "shoot": { "dx": 0.5, "dz": -0.8 }, "ult": false }
```

### Host → Clients (via relay, 20Hz)
```json
{
  "t": "state",
  "tick": 142,
  "p": [
    { "x": 5.2, "z": -3.1, "r": 1.57, "hp": 100 },
    { "x": -2.0, "z": 8.4, "r": 0.0, "hp": 80 }
  ],
  "n": [{ "x": 10, "z": 5, "r": 2.1, "b": false, "hp": 0 }],
  "b": [{ "x": 3, "z": 1, "dx": 0.5, "dz": -0.8 }],
  "pk": [{ "x": 12, "z": -5 }],
  "k": 24,
  "tm": 65,
  "lv": 2
}
```

### Events (one-shot, reliable)
```json
{ "t": "event", "e": "levelup", "lv": 3 }
{ "t": "event", "e": "gameover" }
{ "t": "event", "e": "bossspawn" }
```

## Verification

1. Start relay server on Lightsail: `node server/server.js`
2. Run `npm run dev` on host machine, open browser
3. Click "Create Room" → get room code
4. On another machine (or another browser), run dev server, enter room code, click "Join"
5. Host clicks "Start" → both players see the game world with two ducks
6. Both players can move independently, shoot, and kill foxes
7. Kills/levels/health sync correctly between both views
8. If client disconnects and reconnects within 30s, they rejoin the game
9. If host disconnects, client sees "Host disconnected" message
