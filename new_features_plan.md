# Game Features Implementation Plan

This document outlines the approach for adding the requested new features to the game, as well as some suggestions to make the gameplay feel even better.

## Core Features Plan

### 1. Health System & Health Bar
Currently, touching a fox is instant death. We will change this to a health-based system.
- **Mechanics:** 
  - The player starts with 100 Health.
  - Getting touched by a fox deducts 20 Health.
  - **Suggestion:** We must add **Invincibility Frames (i-frames)** for 1-2 seconds after getting hit. Without this, the fox intersecting the player's hitbox would hit them 60 times a second, instantly killing them anyway. During i-frames, the duck can flash faintly or become semi-transparent.
- **UI:** Add a visual Health Bar overlay to `index.html` (e.g., in the top-left or bottom-left corner). It will dynamically update its width and color (green -> yellow -> red) based on current health.

### 2. Popcorn Pickups (Healing)
Ducks love popcorn! We will add a spawner that periodically drops popcorn around the map.
- **Mechanics:**
  - A new file `pickups.js` will manage spawning popcorn on the map periodically.
  - The popcorn can be a simple clustered mesh of white/yellow spheres to look like popped kernel.
  - When the player intersects with a popcorn hitbox, it disappears and restores 15 Health.
  - **Suggestion:** Give the popcorn a slow rotation or a floating animation (bobbing up and down) so the player can easily spot it from a distance.

### 3. Ultimate Ability: The "Duck Attack"
A button fills up the longer the player survives. When activated, smaller ducks spawn to help you fight.
- **Mechanics:**
  - **Charging:** The Ultimate meter goes from 0 to 100%. We can have it charge based on a mix of **Time Survived** and **Foxes Killed** (to reward active gameplay).
  - **Activation:** The player presses a specific key (e.g., `Spacebar` or `Q`) or clicks an on-screen button when the meter is full.
  - **The Attack (10 Seconds):** We will spawn 3-5 tiny duck models (using `duck.glb` but scaled down) that orbit the player or seek out nearby foxes and destroy them on contact.
- **UI:** Add an Ultimate Bar or stylized "Duck Button" overlay that fills up visually. When fully charged, it can pulse or glow.



## Additional Gameplay Suggestions
*If you like these, we can include them in the implementation:*
1. **Damage Flash Indicator:** A quick red flash on the screen to clearly show the player they took damage.
2. **Dash/Dodge mechanics:** Press `Shift` to do a quick burst of speed. This makes escaping corners easier since you can take damage now.
3. **Increasing Difficulty:** As time goes on, lower the cooldown between fox spawns to keep the pressure up while the player gets stronger.
