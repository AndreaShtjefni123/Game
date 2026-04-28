# Hybrid Multiplayer Implementation Plan

## What Changed From Original Plan

The original plan had the host running all NPC AI and guests only interpolating positions from 30Hz state broadcasts. The updated approach is a **hybrid**: every client simulates NPC movement locally at 60fps, and the host sends position corrections at 200ms to fix any drift. Deaths and bullets remain host-authoritative and instant.

| | Original Plan | Hybrid Plan |
|---|---|---|
| Guest NPC simulation | Never — interpolate from 30Hz host state | Full `updateNPCs()` at 60fps locally |
| NPC sync frequency | 30Hz state (large, always all NPCs) | 200ms delta (only drifted NPCs) |
| NPC smoothness on guest | Interpolation between snapshots | Native 60fps + invisible lerp correction |
| Network load for NPCs | High (30×/sec) | Low (5×/sec) |
| Shared AI code | Not shared | Extracted to `npcLogic.js` |
| Bullet position tracking | N/A | Never synced — local only |

---

## Architecture Overview

```
HOST BROWSER                 RELAY SERVER              GUEST BROWSER
────────────                 ────────────              ─────────────
updateNPCs() at 60fps                                  updateNPCs() at 60fps
(targets host player pos)                              (targets guest player pos)

every 200ms:
  npcSync ─────────────────→ relay ─────────────────→ lerp NPCs to correct positions

on NPC death (instant):
  npcKilled ───────────────→ relay ─────────────────→ remove NPC by ID immediately

on player shoots:
  validate hit (raycast)                               spawn visual bullet immediately
  npcKilled if hit ────────→ relay ─────────────────→ remove NPC on confirmation

on guest joins:
  init ────────────────────→ relay ─────────────────→ build world, spawn NPC meshes
  npcSpawned ──────────────→ relay ─────────────────→ create NPC meshes with IDs

on new NPC spawned (kill reward):
  npcSpawned ──────────────→ relay ─────────────────→ create new NPC mesh with ID
```

---

## Message Flow Reference

A quick reference for every message, who sends it, and who receives it.

```
Legend:  H = Host   G = Guest   R = Relay Server   → = direction
```

| Message | Sender | Path | Receiver | When |
|---|---|---|---|---|
| `createRoom` | H | H → R | R | Host clicks Create Game |
| `roomCreated` | R | R → H | H | Server confirms room made |
| `joinRoom` | G | G → R | R | Guest clicks Join |
| `roomJoined` | R | R → G | G | Server confirms join |
| `roomError` | R | R → G | G | Bad room code |
| `guestJoined` | R | R → H | H | New guest connected |
| `hostLeft` | R | R → all G | all G | Host disconnected |
| `init` | H | H → R → G | one G | Guest just joined — send world state |
| `ready` | G | G → R → H | H | Guest finished building the world |
| `move` | H or G | → R → all others | all others | Every 16ms — position broadcast |
| `npcSpawned` | H | H → R → all G | all G | On game start or kill reward |
| `npcSync` | H | H → R → all G | all G | Every 200ms — drift correction |
| `npcKilled` | H | H → R → all G | all G | Instantly when an NPC dies |
| `shoot` | H or G | → R → all others | all others | Player fires a bullet |
| `bulletSpawned` | R | R → all G | all G | Relay re-broadcasts shoot as this |
| `playerDamaged` | H | H → R → one G | one G | NPC touches a guest |
| `bossSpawned` | H | H → R → all G | all G | Boss appears |
| `bossHit` | H | H → R → all G | all G | Boss takes a hit |
| `pickupCollected` | H | H → R → all G | all G | Player collects popcorn |
| `gameOver` | H | H → R → all G | all G | Game ends |
| `guestDied` | G | G → R → H | H | Guest HP hits 0 |

---

## Drift & Sync Rates

NPC speed is `0.06 units/frame × 60fps = 3.6 units/second`.

| Sync rate | Max drift before correction | Bandwidth (50 NPCs) | Verdict |
|---|---|---|---|
| 1000ms | ~3.6 units (visible) | ~450 bytes/s | Too slow |
| **200ms** | ~0.72 units (invisible) | ~2.25 KB/s | Recommended |
| 100ms | ~0.36 units | ~4.5 KB/s | Overkill |
| 33ms | ~0.1 units | ~13.5 KB/s | Pointless — same as old plan |

**Use 200ms.** It is 5× less traffic than the original 30Hz broadcast and drift is sub-half-NPC-width — invisible with lerp correction.

---

## Correction Thresholds

When a guest receives an `npcSync` message:

| Drift distance | Action | Why |
|---|---|---|
| `< 0.5 units` | Ignore | Within acceptable tolerance |
| `0.5 – 4.0 units` | Lerp over 30 frames (~0.5s) | Smooth invisible correction |
| `>= 4.0 units` | Hard snap immediately | NPC badly desynced, snap is cleaner |

---

## Bullet Handling

Bullets are **never position-synced**. Only 2 messages per kill:

```
1. Player shoots  →  send { type:'shoot', origin, direction, bulletId }
2. NPC hit        →  send { type:'npcKilled', id }
```

Everything in between (bullet flying, wall collision, despawn) is local on each client. Each client simulates the bullet from the same origin + direction, so it looks identical on all screens.

For other players' bullets: host sends `bulletSpawned` once with origin + direction. Guest simulates flight locally from that point. Guest never registers the kill — only `npcKilled` from the host removes the NPC.

---

## Player Movement

Each player calculates their own movement locally every frame (WASD + camera-relative direction, speed 0.18). They then broadcast their resulting position to all other clients at **60Hz** (every 16ms). Receivers interpolate toward the incoming position each frame so movement looks smooth rather than snapping.

```
SEND_RATE = 16ms  (was 50ms — 20Hz before)

Every frame:
  player moves locally → position is always up to date on your own screen
  every 16ms → send { type:'move', x, z, ry } to relay
  relay → broadcast to all other clients
  receivers → lerp their copy of your duck toward the new position
```

### Why 60Hz instead of 20Hz

At 20Hz updates arrive every 50ms. The remote duck has to jump 50ms worth of movement in one frame — visible teleporting. At 60Hz updates arrive every 16ms — the gaps are small enough that lerp smoothing covers them completely.

### Interpolation on the receiver

```js
// When a move message arrives — store the target, don't snap
if (data.type === 'move') {
    remotePlayers[data.id].targetPosition.set(data.x, data.y, data.z);
    remotePlayers[data.id].targetRY = data.ry;
}

// Every frame — slide toward the target smoothly
for (const id in remotePlayers) {
    remotePlayers[id].position.lerp(remotePlayers[id].targetPosition, 0.2);
    remotePlayers[id].rotation.y += (remotePlayers[id].targetRY - remotePlayers[id].rotation.y) * 0.2;
}
```

The `0.2` lerp factor means the duck covers 20% of the remaining distance every frame — smooth and responsive without overshooting.

---

## Full Message Schema

Each message below shows:
- **Direction** — who sends it and the path it takes
- **Schema** — the exact JSON
- **Implementation** — what code sends/receives this and how
- **Example** — a simple real scenario

---

### Server → Client Messages

---

#### `roomCreated`

**Direction:** Relay Server → Host

```json
{
  "type": "roomCreated",
  "code": "X4TR9",
  "role": "host"
}
```

**Implementation (`main.js` — host side):**
When the host's `socket.onmessage` receives this, store the room code and show it in the lobby UI so the host can share it with a friend. Also set a `role = 'host'` flag so the game loop knows which code path to run.

```js
if (data.type === 'roomCreated') {
    myRole = 'host';
    document.getElementById('roomCode').textContent = data.code;
    document.getElementById('roomDisplay').style.display = 'block';
}
```

**Example:**
> Host clicks "Create Game" → server generates code "X4TR9" → host sees "Room code: X4TR9" on screen → shares it with friend.

---

#### `roomJoined`

**Direction:** Relay Server → Guest

```json
{
  "type": "roomJoined",
  "code": "X4TR9",
  "role": "guest",
  "myId": "guest_abc123"
}
```

**Implementation (`main.js` — guest side):**
Store `myId` and `myRole`. Hide the lobby UI and wait for the `init` message from the host before starting the game. `myId` is used to tag all future messages so the host knows which guest sent them.

```js
if (data.type === 'roomJoined') {
    myId   = data.myId;
    myRole = 'guest';
    // wait for init before starting game
}
```

**Example:**
> Guest types "X4TR9" and clicks Join → server confirms → guest gets their ID "guest_abc123" and waits for the host to send the world state.

---

#### `roomError`

**Direction:** Relay Server → Guest

```json
{
  "type": "roomError",
  "reason": "Room not found"
}
```

**Implementation (`main.js` — guest side):**
Show the error message in the lobby so the guest knows the code was wrong or the room is gone. Keep the lobby visible — let them try again.

```js
if (data.type === 'roomError') {
    document.getElementById('lobbyError').textContent = data.reason;
}
```

**Example:**
> Guest types "ZZZZZ" → no such room exists → guest sees "Room not found" in red under the input field.

---

#### `guestJoined`

**Direction:** Relay Server → Host

```json
{
  "type": "guestJoined",
  "guestId": "guest_abc123"
}
```

**Implementation (`main.js` — host side):**
A new player connected. The host immediately sends back an `init` message to that guest with the wall seed and host position. Also spawn a visual duck in the scene for this guest. Track `guestId` so future messages can be routed to the right player.

```js
if (data.type === 'guestJoined') {
    spawnRemotePlayer(data.guestId);
    socket.send(JSON.stringify({
        type: 'init',
        to: data.guestId,
        wallSeed: currentWallSeed,
        hostPos: { x: player.position.x, z: player.position.z }
    }));
}
```

**Example:**
> Friend opens the game and joins → host is notified → host sends the world seed so the friend builds the same wall layout.

---

#### `hostLeft`

**Direction:** Relay Server → All Guests

```json
{
  "type": "hostLeft"
}
```

**Implementation (`main.js` — guest side):**
The host disconnected. Stop the game loop, show a "Host left the game" screen. There is no reconnection — the room is destroyed on the server.

```js
if (data.type === 'hostLeft') {
    gameOver = true;
    document.getElementById('gameOver').querySelector('h1').textContent = 'Host left the game';
    document.getElementById('gameOver').style.display = 'flex';
}
```

**Example:**
> Host closes their browser tab → all guests immediately see "Host left the game" and the game stops.

---

#### `init`

**Direction:** Host → Relay → Guest (sent to one specific guest on join)

```json
{
  "type": "init",
  "wallSeed": 839201,
  "hostPos": { "x": 0, "z": 0 }
}
```

**Implementation (`main.js` — guest side):**
Use `wallSeed` to call `createWalls(10, wallSeed)` with a seeded random so the guest gets the exact same wall layout as the host. Place the host's duck at `hostPos`. After world setup is done, send `ready` back to the server.

```js
if (data.type === 'init') {
    createWalls(10, data.wallSeed);          // same layout as host
    spawnRemotePlayer('host', data.hostPos); // show host duck
    socket.send(JSON.stringify({ type: 'ready' }));
}
```

**Example:**
> Guest joins → host sends seed 839201 → guest generates identical walls → both players see the same map.

---

#### `npcSpawned`

**Direction:** Host → Relay → All Guests

```json
{
  "type": "npcSpawned",
  "npcs": [
    { "id": 0, "x": 5.2, "z": -3.1 },
    { "id": 1, "x": -8.0, "z": 1.4 },
    { "id": 2, "x": 2.7, "z": -6.8 }
  ]
}
```

**Implementation (`main.js` — guest side):**
For each NPC in the list, create a fox mesh at the given position and register it in `npcById` with its server-assigned ID. This ID is what links host authority messages (like `npcKilled`) to the right mesh on the guest's screen.

```js
if (data.type === 'npcSpawned') {
    for (const n of data.npcs) {
        const mesh = createNPCMesh(scene);
        mesh.position.set(n.x, 0, n.z);
        mesh.userData.id = n.id;
        npcById.set(n.id, mesh);
        npcs.push(mesh);
    }
}
```

**Example:**
> Game starts with 3 NPCs → host sends their IDs and positions → guest spawns 3 fox meshes at the same spots.

---

#### `npcSync`

**Direction:** Host → Relay → All Guests (every 200ms via `setInterval`)

```json
{
  "type": "npcSync",
  "npcs": [
    { "id": 0, "x": 5.8, "z": -2.4 },
    { "id": 2, "x": 3.1, "z": -5.9 }
  ]
}
```
> Only includes NPCs that have actually moved since last sync. Dead NPCs are not included.

**Implementation (`main.js` — guest side):**
For each NPC in the message, look it up by ID in `npcById`, measure the distance between the authoritative position and the guest's local position, then apply the correction threshold rules.

```js
if (data.type === 'npcSync') {
    for (const n of data.npcs) {
        const mesh = npcById.get(n.id);
        if (!mesh) continue;
        const drift = mesh.position.distanceTo(new THREE.Vector3(n.x, 0, n.z));
        if      (drift < 0.5)  { /* ignore */ }
        else if (drift < 4.0)  { mesh.userData.correctionTarget = new THREE.Vector3(n.x, 0, n.z); mesh.userData.correctionFrames = 30; }
        else                   { mesh.position.set(n.x, 0, n.z); }
    }
}
```

**Example:**
> 200ms passes → host sends NPC 0 at (5.8, -2.4) → guest's NPC 0 is at (5.6, -2.3) → drift is 0.2 → ignored, within tolerance.

---

#### `npcKilled`

**Direction:** Host → Relay → All Guests (instant, not on the 200ms interval)

```json
{
  "type": "npcKilled",
  "id": 4,
  "kills": 7
}
```

**Implementation (`main.js` — guest side):**
Look up NPC by ID, remove its mesh from the scene immediately, delete from `npcById` and splice from `npcs`. Update the kill counter HUD with `kills`.

```js
if (data.type === 'npcKilled') {
    const mesh = npcById.get(data.id);
    if (mesh) {
        scene.remove(mesh);
        npcById.delete(data.id);
        npcs.splice(npcs.indexOf(mesh), 1);
    }
    document.getElementById('kills').textContent = `Kills: ${data.kills}`;
}
```

**Example:**
> Host shoots NPC id:4 → instantly sends npcKilled → both host and guest fox disappears at the same moment.

---

#### `bulletSpawned`

**Direction:** Host → Relay → All Guests

```json
{
  "type": "bulletSpawned",
  "bulletId": "guest_abc123_12",
  "ownerId": "guest_abc123",
  "origin": { "x": 3.2, "z": -1.0 },
  "dir": { "x": 0.71, "z": 0.71 }
}
```
> Guest skips spawning if `ownerId === myId` — they already have the bullet locally.

**Implementation (`shoot.js` — guest side):**
Check `ownerId` — if it matches `myId` skip it (already spawned locally). Otherwise create a yellow sphere bullet at `origin` travelling in `dir`. Simulate it locally from that point; never register kills from it — wait for `npcKilled`.

```js
if (data.type === 'bulletSpawned' && data.ownerId !== myId) {
    spawnBullet(scene, data.origin, data.dir, data.bulletId);
}
```

**Example:**
> Host fires → host sees their own bullet immediately (local) → guests receive bulletSpawned and simulate the same bullet from the same origin so it looks identical on all screens.

---

#### `playerDamaged`

**Direction:** Host → Relay → One Specific Guest

```json
{
  "type": "playerDamaged",
  "guestId": "guest_abc123",
  "amount": 20,
  "hp": 60
}
```

**Implementation (`main.js` — guest side):**
Only act on this message if `guestId === myId`. Call `takeDamage(data.amount)` and sync the health bar to `data.hp`. The host is the authority on damage — guests never call `takeDamage` from local NPC contact.

```js
if (data.type === 'playerDamaged' && data.guestId === myId) {
    takeDamage(data.amount);
    syncHealthBar(data.hp);
}
```

**Example:**
> NPC touches the guest → host detects the collision → sends playerDamaged → guest's health bar drops from 80 to 60.

---

#### `bossSpawned`

**Direction:** Host → Relay → All Guests

```json
{
  "type": "bossSpawned",
  "id": 7,
  "x": 10.0,
  "z": -10.0
}
```
> `id` is assigned from the same `nextNpcId++` counter as regular NPCs. `userData.isBoss` on the mesh (not the ID) is what identifies it as the boss.

**Implementation (`main.js` — guest side):**
Create the boss mesh at the given position and register it in `npcById` using the ID sent in the message. `userData.isBoss = true` is set on the mesh so the update loop can apply boss-specific behaviour. Corrections come via `npcSync` like any other NPC.

```js
if (data.type === 'bossSpawned') {
    const boss = createBossMesh(scene);
    boss.position.set(data.x, 0, data.z);
    boss.userData.id = data.id;
    boss.userData.isBoss = true;
    npcById.set(data.id, boss);
    npcs.push(boss);
}
```

**Example:**
> Player reaches kill target → host spawns boss at (10, -10) → all guests see the boss appear at the same spot.

---

#### `bossHit`

**Direction:** Host → Relay → All Guests

```json
{
  "type": "bossHit",
  "hp": 3
}
```

**Implementation (`main.js` — guest side):**
Update the boss HP display. Flash the boss mesh red. The guest never reduces boss HP from their own bullets — they wait for this message from the host.

```js
if (data.type === 'bossHit') {
    document.getElementById('bossHp').textContent = `Boss HP: ${data.hp}`;
    flashRed(npcById.get(99));
}
```

**Example:**
> Guest shoots boss → host validates the hit → sends bossHit hp:3 → all players see boss HP drop to 3.

---

#### `pickupCollected`

**Direction:** Host → Relay → All Guests

```json
{
  "type": "pickupCollected",
  "pickupId": "pickup_2",
  "collectorId": "guest_abc123"
}
```

**Implementation (`main.js` — guest side):**
Remove the pickup mesh from the scene for all players (so it disappears on everyone's screen). If `collectorId === myId`, also apply the heal effect locally.

```js
if (data.type === 'pickupCollected') {
    removePickup(data.pickupId, scene);
    if (data.collectorId === myId) healPlayer(20);
}
```

**Example:**
> Guest walks over popcorn → host confirms collection → pickup disappears on all screens → only the guest who collected it gets the HP.

---

#### `gameOver`

**Direction:** Host → Relay → All Guests

```json
{
  "type": "gameOver",
  "reason": "npc_contact"
}
```
> Possible reasons: `"npc_contact"`, `"out_of_bounds"`, `"host_died"`

**Implementation (`main.js` — guest side):**
Stop the game loop, show the game over screen. Display the reason so the player knows why the session ended.

```js
if (data.type === 'gameOver') {
    gameOver = true;
    document.getElementById('gameOver').style.display = 'flex';
}
```

**Example:**
> Host gets touched by an NPC → host's HP hits 0 → sends gameOver reason:"npc_contact" → all guests see the game over screen simultaneously.

---

### Client → Server Messages

---

#### `createRoom`

**Direction:** Host → Relay Server

```json
{
  "type": "createRoom"
}
```

**Implementation (`main.js` — host side):**
Sent when the host clicks "Create Game" in the lobby. Wire this to the button's click handler. The server responds with `roomCreated`.

```js
document.getElementById('createBtn').addEventListener('click', () => {
    socket.send(JSON.stringify({ type: 'createRoom' }));
});
```

**Example:**
> Host opens game, sees lobby, clicks "Create Game" → sends createRoom → server generates code "X4TR9" and replies.

---

#### `joinRoom`

**Direction:** Guest → Relay Server

```json
{
  "type": "joinRoom",
  "code": "X4TR9"
}
```

**Implementation (`main.js` — guest side):**
Sent when the guest types a room code and clicks "Join". Read the input field value and send it. Server replies with `roomJoined` or `roomError`.

```js
document.getElementById('joinBtn').addEventListener('click', () => {
    const code = document.getElementById('codeInput').value.toUpperCase().trim();
    socket.send(JSON.stringify({ type: 'joinRoom', code }));
});
```

**Example:**
> Guest types "X4TR9" and clicks Join → sends joinRoom → server looks up the room and replies roomJoined.

---

#### `init`

**Direction:** Host → Relay → Guest (targeted to one guest on join)

```json
{
  "type": "init",
  "wallSeed": 839201,
  "hostPos": { "x": 0, "z": 0 }
}
```

**Implementation (`main.js` — host side):**
Sent immediately after receiving `guestJoined`. Use the same seed that was used to build the host's own walls so the guest generates an identical layout. Include current host position so the guest places the host duck correctly.

```js
socket.send(JSON.stringify({
    type: 'init',
    to: data.guestId,
    wallSeed: currentWallSeed,
    hostPos: { x: player.position.x, z: player.position.z }
}));
```

**Example:**
> Guest joins mid-game → host sends seed 839201 and its position (0, 0) → guest builds walls, places host duck, sends ready.

---

#### `ready`

**Direction:** Guest → Relay → Host

```json
{
  "type": "ready"
}
```

**Implementation (`main.js` — guest side):**
Sent after the guest finishes world setup from `init`. The host waits for this before sending `npcSpawned` so the guest has walls ready before NPCs start moving.

```js
if (data.type === 'init') {
    createWalls(10, data.wallSeed);
    socket.send(JSON.stringify({ type: 'ready' }));
}
```

**Example:**
> Guest receives init, builds 10 walls → sends ready → host receives it and sends the initial npcSpawned with all current NPCs.

---

#### `npcSpawned` (host → server)

**Direction:** Host → Relay → All Guests

```json
{
  "type": "npcSpawned",
  "npcs": [
    { "id": 5, "x": 12.0, "z": 4.5 },
    { "id": 6, "x": -3.0, "z": 9.2 }
  ]
}
```

**Implementation (`main.js` — host side):**
Called in two places: on game start (send all initial NPCs), and inside `createNPCs()` after each kill reward spawn. IDs are assigned by a monotonic counter on the host — `nextNpcId++`.

```js
function spawnNPCsAndSync(count) {
    const batch = [];
    for (let i = 0; i < count; i++) {
        const npc = createNPC(scene, player);
        npc.userData.id = nextNpcId++;
        batch.push({ id: npc.userData.id, x: npc.position.x, z: npc.position.z });
    }
    socket.send(JSON.stringify({ type: 'npcSpawned', npcs: batch }));
}
```

**Example:**
> Player kills an NPC → 2 new NPCs spawn with IDs 5 and 6 → host sends npcSpawned → guests create 2 new fox meshes at those positions.

---

#### `npcSync` (host → server)

**Direction:** Host → Relay → All Guests (every 200ms)

```json
{
  "type": "npcSync",
  "npcs": [
    { "id": 0, "x": 5.8, "z": -2.4 },
    { "id": 2, "x": 3.1, "z": -5.9 }
  ]
}
```

**Implementation (`main.js` — host side):**
A `setInterval` (not the game loop) sends this every 200ms. Use `setInterval` not `requestAnimationFrame` so it keeps firing even when the tab is in the background. Only include NPCs that moved more than 0.1 units since the last sync to save bandwidth.

```js
setInterval(() => {
    if (socket.readyState !== 1 || guests.size === 0) return;
    const moved = npcs
        .filter(n => n.position.distanceTo(n.userData.lastSyncPos) > 0.1)
        .map(n => ({ id: n.userData.id, x: n.position.x, z: n.position.z }));
    if (moved.length === 0) return;
    socket.send(JSON.stringify({ type: 'npcSync', npcs: moved }));
    npcs.forEach(n => n.userData.lastSyncPos.copy(n.position));
}, 200);
```

**Example:**
> 200ms passes → 3 of 10 NPCs moved enough → host sends only those 3 → guests lerp-correct them, 7 untouched.

---

#### `npcKilled` (host → server)

**Direction:** Host → Relay → All Guests (instant)

```json
{
  "type": "npcKilled",
  "id": 4,
  "kills": 7
}
```

**Implementation (`main.js` — host side):**
Sent immediately inside `updateBullets()` the frame a bullet hits an NPC. Does not wait for the 200ms sync interval — instant delivery. Include running kill total so all clients can sync their HUD.

```js
// inside the kill handling block in animate()
socket.send(JSON.stringify({ type: 'npcKilled', id: killedNpc.userData.id, kills: totalKills }));
```

**Example:**
> Host's bullet hits NPC id:4 → sends npcKilled instantly → guests remove that fox mesh within one network round-trip.

---

#### `shoot`

**Direction:** Host → Relay → All Guests (broadcast as `bulletSpawned`)

```json
{
  "type": "shoot",
  "bulletId": "guest_abc123_12",
  "ownerId": "guest_abc123",
  "origin": { "x": 3.2, "z": -1.0 },
  "dir": { "x": 0.71, "z": 0.71 }
}
```

**Implementation (`shoot.js`):**
When any player fires (host or guest), send this to the relay. The relay re-broadcasts it as `bulletSpawned` to all other clients. Assign IDs as `myId + '_' + bulletSeq++` so duplicate bullets can be detected and skipped.

```js
export function shoot(e, camera, player, scene, socket, myId) {
    // ... raycast to get dir ...
    bulletSeq++;
    const bulletId = `${myId}_${bulletSeq}`;
    spawnBulletLocal(scene, player.position, dir);
    socket.send(JSON.stringify({
        type: 'shoot', bulletId, ownerId: myId,
        origin: { x: player.position.x, z: player.position.z },
        dir: { x: dir.x, z: dir.z }
    }));
}
```

**Example:**
> Host clicks → bullet spawns locally immediately → host sends shoot → guests receive bulletSpawned and simulate the same bullet.

---

#### `move`

**Direction:** Any Client → Relay → All Other Clients (60Hz, every 16ms)

```json
{
  "type": "move",
  "x": 4.1,
  "y": 0,
  "z": -2.3,
  "ry": 1.57
}
```

**Implementation (`main.js` — all clients):**
Sent inside `animate()` throttled to every 16ms. Every client sends its own position — the relay broadcasts it to everyone else in the room. On the receiving end, store the position as a `targetPosition` and lerp toward it each frame rather than snapping.

```js
// Sending (inside animate)
const SEND_RATE = 16; // 60Hz
if (myId && socket.readyState === 1 && now - lastSendTime > SEND_RATE) {
    lastSendTime = now;
    socket.send(JSON.stringify({
        type: 'move',
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
        ry: player.rotation.y
    }));
}

// Receiving
if (data.type === 'move' && remotePlayers[data.id]) {
    remotePlayers[data.id].targetPosition.set(data.x, data.y, data.z);
    remotePlayers[data.id].targetRY = data.ry;
}

// Every frame — smooth lerp toward target
for (const id in remotePlayers) {
    remotePlayers[id].position.lerp(remotePlayers[id].targetPosition, 0.2);
    remotePlayers[id].rotation.y += (remotePlayers[id].targetRY - remotePlayers[id].rotation.y) * 0.2;
}
```

**Example:**
> Guest holds W → sends move 60 times per second → host sees guest duck sliding smoothly instead of teleporting every 50ms.

---

#### `playerDamaged` (host → server)

**Direction:** Host → Relay → One Specific Guest

```json
{
  "type": "playerDamaged",
  "guestId": "guest_abc123",
  "amount": 20,
  "hp": 60
}
```

**Implementation (`main.js` — host side):**
The host tracks every guest's HP. When the host detects an NPC colliding with a guest's authoritative position, it reduces their HP and sends this. The guest never calculates their own damage — they wait for this message.

```js
if (guestBox.intersectsBox(npcBox)) {
    guestState.hp -= 20;
    socket.send(JSON.stringify({
        type: 'playerDamaged', to: guestId,
        guestId, amount: 20, hp: guestState.hp
    }));
}
```

**Example:**
> NPC walks into the guest's position on the host → host deducts 20 HP → sends playerDamaged → guest's health bar updates.

---

#### `bossSpawned` (host → server)

**Direction:** Host → Relay → All Guests

```json
{
  "type": "bossSpawned",
  "id": 7,
  "x": 10.0,
  "z": -10.0
}
```
> `id` comes from `nextNpcId++`, same counter as regular NPCs.

**Implementation (`main.js` — host side):**
Sent when `checkLevelUp()` triggers the boss spawn inside the host's game loop. The boss gets the next ID from the same `nextNpcId++` counter used by regular NPCs — no magic reserved number. `userData.isBoss` on the mesh is what distinguishes it, not its ID. Guests register it in `npcById` like any other NPC.

```js
if (shouldSpawnBoss) {
    const boss = spawnBoss(scene, player);
    boss.userData.id = nextNpcId++;
    socket.send(JSON.stringify({ type: 'bossSpawned', id: boss.userData.id, x: boss.position.x, z: boss.position.z }));
}
```

**Example:**
> Host hits kill target for level 3 → boss spawns at (10, -10) → guests receive bossSpawned and the big red mesh appears on their screen.

---

#### `bossHit` (host → server)

**Direction:** Host → Relay → All Guests

```json
{
  "type": "bossHit",
  "hp": 3
}
```

**Implementation (`main.js` — host side):**
Sent when a bullet hits the boss mesh on the host. Host is authoritative on boss HP — guests never reduce it locally. Sent every hit so all screens show the same HP value.

```js
if (bulletHitsBoss) {
    bossHp--;
    socket.send(JSON.stringify({ type: 'bossHit', hp: bossHp }));
    if (bossHp <= 0) handleBossDeath();
}
```

**Example:**
> Host shoots boss → boss HP drops from 4 to 3 → all players see boss HP update to 3 simultaneously.

---

#### `pickupCollected` (host → server)

**Direction:** Host → Relay → All Guests

```json
{
  "type": "pickupCollected",
  "pickupId": "pickup_2",
  "collectorId": "guest_abc123"
}
```

**Implementation (`main.js` — host side):**
The host checks every player's authoritative position against pickup positions each frame. When overlap detected, remove the pickup locally, send this message so all guests remove it too. `collectorId` tells the recipient guest whether to apply the heal.

```js
if (playerBox.intersectsBox(pickupBox)) {
    removePickup(pickupId, scene);
    socket.send(JSON.stringify({ type: 'pickupCollected', pickupId, collectorId: playerId }));
}
```

**Example:**
> Guest walks over popcorn → host detects overlap → pickup disappears on all screens → only that guest gets +20 HP.

---

#### `gameOver` (host → server)

**Direction:** Host → Relay → All Guests

```json
{
  "type": "gameOver",
  "reason": "npc_contact"
}
```

**Implementation (`main.js` — host side):**
Sent when the host's `triggerGameOver()` fires. Sent before stopping the host's own game loop so the message goes out. Guests stop their loops on receipt.

```js
function triggerGameOver(reason) {
    socket.send(JSON.stringify({ type: 'gameOver', reason }));
    gameOver = true;
    showFinalTime();
    showFinalKills();
    document.getElementById('gameOver').style.display = 'flex';
}
```

**Example:**
> NPC touches host → host HP hits 0 → sends gameOver → all guests' games end at the same time.

---

#### `guestDied`

**Direction:** Guest → Relay → Host

```json
{
  "type": "guestDied"
}
```

**Implementation (`main.js` — guest side):**
Sent when the guest's local HP (synced via `playerDamaged`) reaches 0. The host removes that guest's character from the scene and stops sending them input confirmations.

```js
if (myHp <= 0) {
    socket.send(JSON.stringify({ type: 'guestDied' }));
    gameOver = true;
    showFinalTime();
}
```

**Example:**
> Guest takes 20 damage → HP hits 0 → sends guestDied → host removes that duck from the scene for everyone.

---

## File-by-File Changes

### New File: `src/npcLogic.js`

Extract pure movement math from `npc.js` — no Three.js imports, uses plain `{x, z}` objects. Imported by both `npc.js` (client) and `server.js` (Node.js) so the AI logic is never duplicated.

```js
// src/npcLogic.js
export function seekPlayer(npc, player, speed) { ... }
export function separate(npc, others, radius) { ... }
export function avoidWalls(npc, wallBoxes) { ... }
```

---

### `npc.js`

- Add `npc.userData.id = nextNpcId++` at spawn (monotonic counter, host-assigned)
- Add parallel `npcById = new Map()` for O(1) lookup on corrections
- Add `correctionTarget` and `correctionFrames` to `npc.userData`
- In `updateNPCs()`, after movement apply lerp correction:
  ```js
  if (npc.userData.correctionFrames > 0) {
      const t = 1 / npc.userData.correctionFrames;
      npc.position.lerp(npc.userData.correctionTarget, t);
      npc.userData.correctionFrames--;
  }
  ```
- Import pure math from `npcLogic.js`

---

### `main.js`

**Host additions:**
- On NPC spawn: send `npcSpawned` to all guests with IDs and positions
- `setInterval` at 200ms to send `npcSync` with all current NPC positions
- On NPC death: send `npcKilled` instantly (separate from sync interval)
- On guest joins: send `init` with wall seed and host position
- Track `guestStates` map — last known position (from `move` messages) + HP for every connected guest
- Read guest position from incoming `move` messages — no separate input simulation needed; 16ms staleness is acceptable for a co-op game

**Guest additions (core hybrid change):**
- On `npcSpawned`: create NPC meshes, register in `npcById` with server IDs
- Call `updateNPCs(npcs, player, walls)` every frame (same as host)
- On `npcSync`: apply threshold-based correction per NPC
- On `npcKilled`: look up by ID, remove from scene and map immediately
- On `bulletSpawned`: spawn visual bullet if `ownerId !== myId`

**Both paths:**
- Wall seed sync — both call `createWalls(10, seed)` with same seed
- Change `SEND_RATE` from 50ms → 16ms for 60Hz position broadcast
- Add `targetPosition` and `targetRY` to each remote player, lerp toward them every frame

---

### `shoot.js`

- Assign bullet IDs: `bulletId = myId + '_' + seq++`
- Local shooter spawns visual bullet immediately (no network wait)
- Send `{ type:'shoot', bulletId, origin, dir }` to host
- On receiving `bulletSpawned`: skip if `ownerId === myId`, otherwise spawn visual
- Guests never register kills locally — wait for `npcKilled` from host

---

### `server.js`

- Add rooms map, scope all routing to room
- Add relay for all new message types: `npcSync`, `npcKilled`, `npcSpawned`, `bulletSpawned`
- Track which socket is host per room
- Handle host disconnect: destroy room, send `hostLeft` to all guests
- Handle guest disconnect: remove from room, notify host
- Route `playerDamaged` to specific guests only (not broadcast)

---

### `index.html`

Add lobby UI:
```html
<div id="lobby">
  <button id="createBtn">Create Game</button>
  <div id="roomDisplay" style="display:none">
    Room code: <strong id="roomCode"></strong>
    <p>Share this with a friend</p>
  </div>
  <hr>
  <input id="codeInput" placeholder="Enter room code" maxlength="5" />
  <button id="joinBtn">Join Game</button>
  <p id="lobbyError" style="color:red"></p>
</div>
```

---

## Implementation Phases

| Phase | What | Files | Notes |
|-------|------|-------|-------|
| 0 | Pre-compute wall boxes + hoist scratch objects | `npc.js`, `main.js` | Do now, no multiplayer dependency |
| 1 | Extract `src/npcLogic.js` (pure math, no Three.js) | `npc.js`, new file | Shared by client and server |
| 2 | Add rooms to server | `server.js` | Scope all messages to room |
| 3 | Lobby UI + role assignment | `index.html`, `main.js` | Create/join room flow |
| 4 | Shared wall seed | `main.js` | Same layout on all clients |
| 5 | NPC ID system (`npcById` Map, server-assigned IDs) | `npc.js`, `main.js` | Foundation for all sync |
| 6 | Host sends `npcSpawned` on spawn | `main.js`, `server.js` | Guests create meshes with correct IDs |
| 7 | Guests run `updateNPCs()` locally | `main.js` | Core hybrid change |
| 8 | Host sends `npcSync` at 200ms | `main.js`, `server.js` | Position corrections |
| 9 | Guest applies threshold lerp/snap corrections | `main.js` | <0.5 skip, 0.5–4 lerp, >4 snap |
| 10 | Host sends `npcKilled` instantly on death | `main.js`, `server.js` | Guests remove NPC by ID immediately |
| 11 | Bullet prediction + host kill authority | `shoot.js`, `main.js` | bulletId dedup, guests wait for npcKilled |
| 12 | Backpressure guard + `wss://` auto-detect | `main.js` | Check `bufferedAmount` before each send |
| 13 | Increase position broadcast to 60Hz + lerp interpolation on receivers | `main.js` | Change SEND_RATE 50→16, add targetPosition lerp |

---

## Performance Fixes (From Original Plan — Still Apply)

| Fix | Problem | File | When |
|-----|---------|------|------|
| Pre-compute wall `Box3` | ~30ms wasted per frame recomputing static boxes | `npc.js`, `main.js` | Phase 0 |
| Hoist scratch `Vector3`/`Box3` | GC pauses every few seconds | `npc.js` | Phase 0 |
| `setInterval` for host broadcast | Alt-tab freezes all guests | `main.js` | Phase 8 |
| Backpressure guard on `socket.send` | Lag spikes on slow connections | `main.js` | Phase 12 |
| `InstancedMesh` for NPCs | Frame drops at 30+ NPCs | `npc.js` | When needed |

---

## Deployment

| What | Where | Cost |
|------|-------|------|
| WebSocket relay server (`server.js`) | Cloud server (Railway, Render, etc.) | Free tier |
| Game frontend | GitHub Pages or Netlify | Free |
| TLS (`wss://`) | Handled by reverse proxy | — |

```js
// main.js — replace hardcoded ws:// with:
const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const wsHost = window.location.hostname === 'localhost'
    ? 'localhost:3000'
    : 'your-app.railway.app';
const socket = new WebSocket(`${protocol}://${wsHost}`);
```
