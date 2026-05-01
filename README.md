# HALF BAKED PARTY BUNDLE

A Jackbox-style party pack: one host screen, one shared lobby, multiple games. Players join once, host picks a game, everyone plays — then the host can pick a different game and the same players keep playing.

## Games

| Game | Status | Mechanic |
|---|---|---|
| **Word Budget** | ✅ Live | Shrinking word limits (15 → 7 → 3 → 1) |
| **Frankenstein** | ✅ Live | Stitch monster answers from each other's word fragments |
| **Shutterbox** | 🚧 Coming soon | Caption the photo |
| **Telephone** | 🚧 Coming soon | Shrinking telephone — chain of paraphrases |

## Quick Start

```bash
npm install
npm start
```

- Host screen on a TV/monitor: `http://localhost:3000/host`
- Player phones: `http://localhost:3000/play`

## How It Works

1. Open `/host` on the TV — a 4-letter room code appears
2. Players open `/play` on their phones, enter the code + a name
3. Once enough players have joined, the host sees a **game picker**
4. Tap a card → that game starts on every screen
5. Game ends → host can **PLAY AGAIN** (same game) or **PICK NEW GAME** (everyone keeps their name; scores reset)
6. Closing the host tab destroys the room

## Architecture

- One Express + Socket.io server (`server/index.js`), one port
- Game logic lives in `server/games/<gameName>.js` modules
- Each module registers with the lobby and exposes namespaced socket handlers (`wb_*`, `fk_*`, `sb_*`, `tel_*`) — collisions impossible
- Shared utilities: `server/roomManager.js`, `server/timerManager.js`, `server/scoreManager.js`, `server/matchmaking.js`, `server/promptPool.js`, `server/fragments.js`
- Client: per-game host renderer (`public/host/games/`) + player renderer (`public/play/games/`) loaded inside a single host/play shell

## Deploy to Railway

1. Push to GitHub
2. Railway → New Project → Deploy from GitHub Repo
3. Auto-detects Node.js, runs `npm install` then `npm start`
4. Generate a domain — `<domain>/host` for the TV, `<domain>/play` for phones

## Credits

A bundle by Landon Panos. Published by HydroPixel Media LLC.
