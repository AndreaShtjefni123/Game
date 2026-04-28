# Multiplayer Implementation Plan

## Architecture Choice: Host-Client

One player (the **host**) runs the full game simulation in their browser — NPC AI, collision, kill validation, pickups, levels. All other players are **guests** — they send inputs to the host and render what the host tells them. The relay server sits in the cloud and routes messages between players in the same room. It has zero game logic.

```
GUEST BROWSER                  RELAY SERVER (cloud)            HOST BROWSER
─────────────                  ────────────────────            ────────────
press W key
  → send { type:'input' } ──→  room lookup + relay  ──────→  receive input
                                                               apply to simulation
                                                               run NPC tick
                                                               validate bullets
                               ←────────────────────────────  send { type:'state' }
receive state ←────────────────
update NPC mesh positions
update remote player positions
update HUD (kills, health, level)
```

---

## Update Intervals — Who Updates Who and When

### Host → Guests (via relay server)
| What | How often | Why that rate |
|---|---|---|
| NPC positions, player positions, kills, level, pickups | Every 33ms (30 Hz) via `setInterval` | Smooth enough with interpolation, low bandwidth |
| Wall layout + starting NPC count | Once on guest join | Walls never move, no need to repeat |

### Guest → Host (via relay server)
| What | How often | Why that rate |
|---|---|---|
| Keyboard state (WASD) + shoot direction + sequence number | Every 16ms (60 Hz, every rAF frame) | Inputs are tiny (~30 bytes), sending every frame minimises input delay |

### Guest's own screen (local, no network)
| What | How often | Who drives it |
|---|---|---|
| Guest's own duck movement | Every frame (60 Hz) immediately on keypress | Client-side prediction — no waiting for host |
| NPC mesh positions | Every frame (60 Hz) | Interpolation between last two snapshots from host |
| Remote player positions | Every frame (60 Hz) | Interpolation between last two snapshots from host |
| Health bar, kill counter, level, timer | Every frame (60 Hz) | Driven by last received `state` message from host |

### Host's own screen (local, no network)
| What | How often | Who drives it |
|---|---|---|
| Full game simulation (NPC AI, bullets, collision, kills) | Every frame (60 Hz) via `requestAnimationFrame` | Runs exactly as single-player does today |
| State broadcast to guests | Every 33ms (30 Hz) via `setInterval` | Separate from render loop so alt-tab doesn't stop it |

### Full timeline
```
Every 16ms (60 Hz):
  Host rAF        → simulate NPCs, bullets, player, collision
  Guest rAF       → predict own movement, interpolate NPCs + remote players, render

Every 33ms (30 Hz):
  Host setInterval → broadcast state snapshot to all guests via relay

Every 16ms (60 Hz):
  Guest rAF       → send input message to host via relay

On guest join (once):
  Host            → send init message (wall seed, NPC count, host position)
  Guest           → build walls from seed, spawn NPC meshes, start render loop

On kill event:
  Host simulation → removes NPC, increments kill count
  Next state broadcast (≤33ms later) → guests receive removedNPCs, update their meshes

On guest disconnect:
  Relay server    → notifies host immediately
  Host            → removes that guest's state from simulation

On host disconnect:
  Relay server    → sends hostLeft to all guests immediately
  Guests          → show "host left" screen, stop render loop
```

### Why two different rates (30 Hz vs 60 Hz)
- **State at 30 Hz** — state messages are large (~1KB with all NPC positions). 60 Hz would double bandwidth for no visible gain because guests interpolate between snapshots anyway
- **Inputs at 60 Hz** — input messages are tiny (~30 bytes). Sending every frame keeps the host's view of the guest as current as possible, minimising the delay before the host processes the movement

---

## Internet Connectivity

### Why it works without port forwarding
Every player connects **outward** to a public cloud server. NAT traversal is not a problem — routers always allow outbound connections. No player needs to open ports or configure anything.

### Why WebSocket relay, not WebRTC P2P
WebRTC requires a signaling server (still a WebSocket server), STUN servers for NAT discovery, and TURN servers (~$$/GB) as a fallback for users behind strict firewalls. For 2–4 players a relay adds ~10–50ms latency, which is imperceptible. Keep the relay.

### `ws://` → `wss://` — Critical deployment fix
If the frontend is served over HTTPS (GitHub Pages, Netlify, any CDN), browsers **block** `ws://` connections as mixed content. This fails silently. Replace the hardcoded line in `main.js` with:

```js
// main.js — replace the current WebSocket line
const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const wsHost   = window.location.hostname === 'localhost'
    ? 'localhost:3000'
    : 'YOUR_DEPLOYED_SERVER_HOSTNAME'; // e.g. your-app.railway.app
const socket = new WebSocket(`${protocol}://${wsHost}`);
```

---

## Room System

Without rooms every player who connects lands in the same global session. Rooms let multiple independent games run simultaneously and scope all messages so they only reach players in the same session.

### Room code flow
```
Host opens game → clicks "Create Game"
  → sends { type:'createRoom' }
  → server generates 5-char code e.g. "X4TR9"
  → host sees code on screen / can share it

Friend opens game → types "X4TR9" → clicks "Join"
  → sends { type:'joinRoom', code:'X4TR9' }
  → server adds them to room, notifies host
  → game begins
```

### Optional: URL-hash invite link
Encode the room code in the URL so the host can share a direct link:
```
https://yourgame.netlify.app/#X4TR9
```
On page load: if `window.location.hash` contains a code, auto-fill the join input and skip the lobby screen.

---

## File-by-File Changes

### `server.js`

**What changes:** Add a rooms map. Scope all message routing to within a room. Track which socket is the host. Handle host disconnect gracefully.

**New message types the server handles:**

| Received message | From | Action |
|---|---|---|
| `{ type:'createRoom' }` | Any client | Generate 5-char code, mark socket as host, store in rooms map, reply `roomCreated` |
| `{ type:'joinRoom', code }` | Any client | Add socket to room's guest set, notify host with `guestJoined` |
| `{ type:'state', ... }` | Host | Relay to all guests in the room only |
| `{ type:'input', ... }` | Guest | Relay to the host of the room only |
| `{ type:'init', ... }` | Host | Relay to all guests (used for wall seed on join) |
| disconnect | Any | If host: destroy room, send `hostLeft` to all guests. If guest: remove from set |

**Key change:** replace the current global `broadcast()` with a room-scoped version.  
**Also add:** `process.env.PORT || 3000` so the cloud host can inject its own port.

---

### `main.js`

This file gets the most changes. It gains a lobby phase, role awareness, and diverges into two code paths depending on role.

#### Lobby phase (new, runs before game starts)
- Show a lobby UI: "Create Game" button and a code input + "Join Game" button
- On `roomCreated` → display the room code, wait for guests
- On `roomJoined` → hide lobby, receive init message, build world from seed, start game
- On `guestJoined` (host receives) → send `init` message containing the wall seed and starting NPC count

#### Role-split in the game loop

**Host path (game loop runs as today, plus broadcasting):**
- All existing simulation code runs unchanged (NPC AI, collision, bullets, kills, pickups, levels)
- Every 33ms (via `setInterval`, NOT inside `rAF`) broadcast world state to guests:
  ```js
  {
    type: 'state',
    npcs:    [ { id, x, z, ry } ],        // all NPC positions
    players: { guestId: { x, z, ry } },   // guest positions as host knows them
    removedNPCs: ['npc_3'],               // killed this tick
    kills: 14,                             // cumulative kill count
    level: 2,                              // current level
    pickups: [ { id, x, z, active } ]     // popcorn pickup states
  }
  ```
- `setInterval` must be separate from `requestAnimationFrame` — if the host alt-tabs, `rAF` pauses but `setInterval` keeps broadcasting so guests don't freeze

**Guest path (new, replaces most of the game loop):**
- Does NOT run `updateNPCs()`, `updateBullets()`, `checkLevelUp()`, `startPickupSpawner()`
- DOES run: rendering, camera follow, health UI, clock display
- On each `state` message: push snapshot into per-entity buffers; interpolation handles rendering (see Lag section)
- On WASD/shoot: sends `{ type:'input', keys, shootDir, shooting }` to server (relayed to host)
- Guest movement: **client-side prediction** (see Lag section) — move locally immediately, reconcile on host confirmation

#### Wall layout sync
Walls are currently random per client — guests and host would have completely different walls.  
**Fix:** host generates a wall seed number, sends it in the `init` message. Both host and guest call `createWalls(10, seed)` with the same seed → identical layout for everyone.

```js
// Modified createWalls — accepts a seed so both sides get the same layout
function createWalls(amount, seed) {
    let rng = seededRandom(seed); // simple LCG, see below
    for (let i = 0; i < amount; i++) {
        // replace Math.random() calls with rng()
    }
}
function seededRandom(seed) {
    let s = seed;
    return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}
```

#### Shooting — guest fires through host
- Guest clicks → computes world-space shoot direction via raycasting → sends `{ type:'input', shooting:true, shootDir:{x,z} }` to host
- Host receives it, spawns a bullet at that guest's known position in the host simulation, runs collision
- If NPC hit → kill confirmed in next `state` broadcast as `removedNPCs`
- Guest sees the kill update arrive in the state message and despawns the NPC mesh

---

### `npc.js`

No changes to the AI logic. The only change is **who calls it**:
- `createNPCs` and `updateNPCs` are only called on the **host**
- Guests never call these functions — they only receive NPC positions from `state` messages and move meshes accordingly

---

### `shoot.js`

- **Host:** unchanged — raycasts, moves bullets, returns kills exactly as today
- **Guest:** does not call `shoot()` directly. Sends shoot input to host. Optionally spawns a local cosmetic bullet (visual only, not collision-checked) to make shooting feel responsive — this bullet is purely visual and gets corrected by the next state message

---

### `health.js`, `clock.js`, `levels.js`

These are UI/state modules. On the guest they are driven by events from the host's `state` messages rather than local simulation:
- `takeDamage()` is called when host broadcasts `{ type:'damage', amount }` targeting this guest
- `addKill()` is called when `state.kills` increases
- `checkLevelUp()` is replaced by reading `state.level` and comparing to current displayed level

---

### `index.html`

Add the lobby UI (hidden once game starts):
```html
<div id="lobby">
  <button id="createBtn">Create Game</button>
  <div id="roomDisplay" style="display:none">
    Room code: <strong id="roomCode"></strong>
    <p>Share this code with a friend</p>
  </div>
  <hr>
  <input id="codeInput" placeholder="Enter room code" maxlength="5" />
  <button id="joinBtn">Join Game</button>
  <p id="lobbyError" style="color:red"></p>
</div>
```

---

## Full Message Reference

### Server → Client messages

| Message | To | When | Payload |
|---|---|---|---|
| `roomCreated` | Host | Host creates a room | `{ code, role:'host' }` |
| `roomJoined` | Guest | Guest joins successfully | `{ code, role:'guest' }` |
| `roomError` | Guest | Bad code or room full | `{ reason }` |
| `guestJoined` | Host | A new guest joined the room | `{ guestId }` |
| `hostLeft` | All guests | Host disconnected | — |
| `init` | Guest | Relayed from host on join | `{ wallSeed, npcCount, hostPos }` |
| `state` | All guests | Relayed from host at 30Hz | `{ npcs, players, removedNPCs, kills, level, pickups }` |
| `selfState` | One guest | After host processes that guest's input | `{ x, z, lastSeq }` — used for client-side prediction reconciliation |
| `input` | Host | Relayed from a guest | `{ guestId, keys, shootDir, shooting, seq }` |
| `npcSpawned` | All guests | New NPCs created (on kill, boss minions, level up) | `{ npcs: [{ id, x, z }] }` |
| `gameOver` | All guests | Host game ends (player dies or leaves boundary) | `{ reason }` |
| `playerDamaged` | One guest | That guest took damage | `{ guestId, amount, hp }` |
| `bossSpawned` | All guests | Boss appears at level 5 | `{ x, z }` |
| `bossHit` | All guests | Boss took a bullet hit | `{ hp }` |
| `pickupCollected` | All guests | Any player collected a popcorn pickup | `{ pickupId, collectorId }` |

### Client → Server messages

| Message | From | When | Payload |
|---|---|---|---|
| `createRoom` | Host | Host clicks "Create Game" | — |
| `joinRoom` | Guest | Guest enters a room code | `{ code }` |
| `init` | Host | A guest just joined — send them the world | `{ wallSeed, npcCount, hostPos }` |
| `state` | Host | Every 33ms via setInterval | `{ npcs, players, removedNPCs, kills, level, pickups }` |
| `selfState` | Host | After processing a guest's input | `{ guestId, x, z, lastSeq }` |
| `input` | Guest | Every frame (60Hz) | `{ keys, shootDir, shooting, seq }` |
| `ready` | Guest | After receiving init and finishing world setup | — |
| `npcSpawned` | Host | New NPCs created this tick | `{ npcs: [{ id, x, z }] }` |
| `playerDamaged` | Host | A guest took contact or bullet damage | `{ guestId, amount, hp }` |
| `bossSpawned` | Host | Boss spawned at level 5 | `{ x, z }` |
| `bossHit` | Host | Boss took a hit | `{ hp }` |
| `pickupCollected` | Host | A player collected a pickup | `{ pickupId, collectorId }` |
| `gameOver` | Host | Game ended | `{ reason }` |
| `guestDied` | Guest | Guest's HP reached 0 | — |

---

## Lag Issues and Fixes

### Fix 1 — Pre-compute wall bounding boxes (affects all players, fix immediately)

**Problem:** `npc.js` lines 216, 229, 244 call `new THREE.Box3().setFromObject(walls[j])` inside a triple-nested loop. Walls never move. This recomputes 600 bounding boxes per frame (~30ms wasted every frame).

**Fix:** Compute once at startup, pass the array everywhere:
```js
// main.js — after createWalls()
const wallBoxes = walls.map(w => new THREE.Box3().setFromObject(w));

// Pass wallBoxes instead of walls to updateNPCs() and updateBullets()
```

---

### Fix 2 — Hoist scratch objects out of NPC loop (affects all players, fix immediately)

**Problem:** `npc.js` allocates `new THREE.Vector3()` and `new THREE.Box3()` inside the per-frame NPC loop — ~200-300 allocations/frame triggers GC pauses every few seconds showing as random hitches.

**Fix:** Declare scratch objects once at module level, reuse them:
```js
// Top of npc.js — allocated once, reused every frame
const _dir     = new THREE.Vector3();
const _sep     = new THREE.Vector3();
const _pushDir = new THREE.Vector3();
const _npcBox  = new THREE.Box3();
const _NPC_SIZE = new THREE.Vector3(1.5, 3, 1.5);
```

---

### Fix 3 — Snapshot interpolation for remote players and NPCs

**Problem:** Host broadcasts at 30Hz (every 33ms). Guest renders at 60fps (every 16ms). Without smoothing, every other frame is a stale freeze followed by a position jump — entities stutter/teleport.

**How it works:** Instead of applying received positions directly, push them into a timestamped buffer. Render 100ms behind real-time, lerping between the two snapshots that bracket the render time. The 100ms delay absorbs network jitter so there are always two bookmarks to interpolate between.

**Implementation in `main.js`:**
```js
const RENDER_DELAY = 100; // ms behind real-time
const snapshotBuffer = {}; // entityId → [ { t, x, y, z, ry }, ... ]

// On receiving state message — push to buffer, don't apply directly
function onStateMessage(data) {
    const now = performance.now();
    for (const npc of data.npcs) {
        if (!snapshotBuffer[npc.id]) snapshotBuffer[npc.id] = [];
        snapshotBuffer[npc.id].push({ t: now, x: npc.x, z: npc.z, ry: npc.ry });
        if (snapshotBuffer[npc.id].length > 20) snapshotBuffer[npc.id].shift();
    }
    // same for players
}

// In animate() — interpolate all remote entities
function interpolateEntities() {
    const renderTime = performance.now() - RENDER_DELAY;
    for (const id in snapshotBuffer) {
        const buf = snapshotBuffer[id];
        if (buf.length < 2) continue;
        // find the two snapshots that bracket renderTime
        let s1, s2;
        for (let i = buf.length - 1; i >= 1; i--) {
            if (buf[i-1].t <= renderTime && buf[i].t >= renderTime) {
                s1 = buf[i-1]; s2 = buf[i]; break;
            }
        }
        if (!s1 || !s2) continue;
        const alpha = (renderTime - s1.t) / (s2.t - s1.t);
        npcMeshes[id].position.x = s1.x + (s2.x - s1.x) * alpha;
        npcMeshes[id].position.z = s1.z + (s2.z - s1.z) * alpha;
    }
}
```

---

### Fix 4 — `setInterval` for host state broadcast

**Problem:** If host puts `broadcastState()` inside `requestAnimationFrame`, the broadcast stops when the host alt-tabs (rAF pauses in background tabs). All guests freeze.

**Fix:** Separate broadcast loop that runs independently of rendering:
```js
// Host only — runs even when tab is backgrounded
setInterval(() => {
    if (!isHost) return;
    if (socket.bufferedAmount > 16384) return; // skip if backlogged (Fix 5)
    socket.send(JSON.stringify({
        type: 'state',
        npcs: npcs.map(n => ({ id: n.userData.id, x: n.position.x, z: n.position.z, ry: n.rotation.y })),
        // ... players, kills, level, pickups
    }));
}, 33); // 30 Hz
```

---

### Fix 5 — WebSocket backpressure guard

**Problem:** `socket.send()` never blocks. On slow connections messages queue silently in the browser's buffer (`bufferedAmount`). Guests receive position bursts from a drained queue — visible as lag spikes.

**Fix:** Check `bufferedAmount` before each broadcast. If the queue is already backed up, skip this frame:
```js
const MAX_BUFFERED = 16384; // 16 KB
if (socket.bufferedAmount > MAX_BUFFERED) return; // drop this broadcast frame
socket.send(stateMessage);
```

---

### Fix 6 — Client-side prediction for guest's own movement

**Problem:** Guest presses W → sends to relay → host processes → host broadcasts state → guest renders update. Full round-trip. At 100ms RTT internet connection the guest's own duck responds 100-250ms late. Feels broken.

**How it works:**
1. Guest applies own input **locally and immediately** (same movement code the host uses)
2. Tags each input with an incrementing sequence number, sends it to host, keeps a history of unacknowledged inputs
3. When host confirms with `{ selfPos, lastSeq }`: snap to authoritative position, then replay all inputs with `seq > lastSeq` on top of it
4. If host and guest use identical movement code the replay will match the prediction — no visible correction

**Note:** This is only needed for the guest's **own** duck. Remote players and NPCs use interpolation (Fix 3). This is the most complex fix — implement last, after everything else is stable.

---

### Fix 7 — Guest sends inputs every frame, not every tick

**Problem:** If guest only sends inputs at 30Hz (matching the state broadcast), the host doesn't know what the guest is pressing for up to 33ms. This adds unnecessary input delay on top of RTT.

**Fix:** Inputs are tiny (~30 bytes). Send every `requestAnimationFrame` frame (60Hz):
```js
// In guest's animate() — every frame, not throttled
if (!isHost && myId && socket.readyState === 1) {
    socket.send(JSON.stringify({
        type: 'input',
        seq: ++inputSeq,
        keys: { w: keys['w'], a: keys['a'], s: keys['s'], d: keys['d'] },
        shooting: didShootThisFrame,
        shootDir: currentAimDirection
    }));
}
```

---

### Fix 8 — InstancedMesh for NPCs (defer until NPC count > 30)

**Problem:** Each NPC clone is a separate draw call. At 20 NPCs with multi-mesh GLB models = 60-100 draw calls per frame just for NPCs. Frame drops when NPC count grows in later levels.

**Fix:** Replace individual fox clones with `THREE.InstancedMesh` — all foxes rendered in 1 draw call:
```js
const instancedFoxes = new THREE.InstancedMesh(foxGeo, foxMat, MAX_NPCS);
scene.add(instancedFoxes);

// Each frame — update matrix per instance
const _dummy = new THREE.Object3D();
npcs.forEach((npc, i) => {
    _dummy.position.copy(npc.position);
    _dummy.rotation.y = npc.rotation.y;
    _dummy.updateMatrix();
    instancedFoxes.setMatrixAt(i, _dummy.matrix);
});
instancedFoxes.instanceMatrix.needsUpdate = true;
```
Implement this when NPC count starts causing measurable frame drops (typically > 30-50 on mid-range hardware).

---

## Implementation Phases

| Phase | What | Files changed | Prerequisite |
|---|---|---|---|
| 0 | Pre-compute wall boxes + hoist scratch objects (Fix 1 & 2) | `npc.js`, `main.js` | None — do this now |
| 1 | Add rooms to server | `server.js` | None |
| 2 | Add lobby UI + role assignment | `index.html`, `main.js` | Phase 1 |
| 3 | Shared wall seed (same layout for everyone) | `main.js` | Phase 2 |
| 4 | Host broadcasts state at 30Hz via `setInterval` | `main.js` | Phase 3 |
| 5 | Guests render NPCs/players from state messages | `main.js` | Phase 4 |
| 6 | Snapshot interpolation for remote entities (Fix 3) | `main.js` | Phase 5 |
| 7 | Guest inputs sent every frame (Fix 7) | `main.js` | Phase 5 |
| 8 | Guest shooting relayed through host | `main.js`, `shoot.js` | Phase 5 |
| 9 | Backpressure guard (Fix 5) | `main.js` | Phase 4 |
| 10 | `wss://` auto-detect for deployment | `main.js` | Any |
| 11 | Client-side prediction for guest movement (Fix 6) | `main.js` | Phase 7 |
| 12 | InstancedMesh for NPCs (Fix 8) | `npc.js` | Phase 5, when needed |

---

## Deployment Stack

| What | Where | Cost |
|---|---|---|
| WebSocket relay server (`server.js`) | Already on your cloud server | — |
| Game frontend (Three.js client) | GitHub Pages or Netlify | Free |
| TLS (`wss://`) | Handled by your server's reverse proxy | — |

**Required server-side change for deployment:**
```js
// server.js — replace hardcoded port
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

**Required if using nginx as reverse proxy — add WebSocket headers:**
```nginx
location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s; # prevent nginx killing idle WebSocket connections
}
```

---

## Lag Fix Priority Summary

| Priority | Fix | Problem solved | Effort | Do when |
|---|---|---|---|---|
| 1 | Pre-compute wall `Box3` (Fix 1) | ~30ms wasted per frame | Low | Now |
| 2 | Hoist scratch Vector3/Box3 (Fix 2) | GC hitches every few seconds | Low | Now |
| 3 | Snapshot interpolation (Fix 3) | NPC/player teleporting | Medium | Phase 6 |
| 4 | `setInterval` for broadcast (Fix 4) | Alt-tab freezes all guests | Low | Phase 4 |
| 5 | Backpressure guard (Fix 5) | Lag spikes on slow connections | Low | Phase 9 |
| 6 | Send inputs every frame (Fix 7) | Extra input delay for guests | Trivial | Phase 7 |
| 7 | Client-side prediction (Fix 6) | Input lag over internet | High | Phase 11 |
| 8 | InstancedMesh (Fix 8) | Frame drops at high NPC count | Medium | When needed |
| — | Binary/MessagePack | Bandwidth at scale | Medium | Not needed yet |
