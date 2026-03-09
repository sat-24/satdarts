# 🎯 301 Darts — Multiplayer Web Game

A real-time multiplayer 301 darts game playable across two devices.

## How to Deploy on Railway

1. **Create a GitHub repo** and push this folder's contents to it.

2. **Go to [railway.app](https://railway.app)** and sign in.

3. Click **New Project → Deploy from GitHub repo** and select your repo.

4. Railway auto-detects Node.js and runs `npm start`. No config needed.

5. Once deployed, Railway gives you a URL like `https://darts-xyz.up.railway.app`.

6. **Share that URL** with your opponent — both open it on their phones!

## How to Play

1. Both players open the app URL on their devices.
2. Both enter the **same Room Code** (e.g. `BULLS`) and their names.
3. Game starts automatically when both join.
4. **301 rules**: Start at 301, take turns throwing 3 darts, subtract scores. First to exactly 0 wins. Going below 0 = BUST (score resets for that turn).
5. Use the **aim slider** to aim left/right, then tap 🎯 to throw.

## Local Development

```bash
npm install
npm start
# Open http://localhost:3000 in two browser tabs
```
