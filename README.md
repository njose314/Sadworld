# SADWORLD — The Cellar Network

> *A dystopian, satirical multiplayer social network for corporate workers.*
> *The AI Corporation thanks you for your compliance.*

---

## SETUP

### Requirements
- Node.js 18+

### Install & Run

```bash
cd sadworld
npm install
npm start
```

The server starts at **http://localhost:3000**

Open multiple browser tabs to test multiplayer.

---

## FEATURES IMPLEMENTED

### Idle Economy
- **Sadcoins** earned while *offline* based on Job Level
- **Daily Tax** of 500 SC deducted every 24 hours for "Nutrient Paste"
- **Death**: Balance < 0 → account wiped, restart from scratch with 10,000 SC

### Corporate Ladder (5 Levels)
| Level | Title | Income/Day | Unlock Cost |
|-------|-------|-----------|-------------|
| 1 | Human Data Scrubber | 300 SC | — |
| 2 | Logic Loop Janitor | 600 SC | 2,500 SC |
| 3 | Empathy Algorithm Auditor | 1,200 SC | 8,000 SC |
| 4 | Sentience Suppression Specialist | 2,500 SC | 20,000 SC |
| 5 | AI Liaison | 5,000 SC | 45,000 SC |

### Corporate Certifications
- Pay the unlock fee and pass a **branching workplace dilemma test**
- Must choose the *most ruthless, corporate-compliant* option to pass
- Wrong choice = fail + SC deducted

### Multiplayer & Teleportation
- Real-time via **Socket.io**
- Visit other online players' cellars
- First 5 teleports/day: **FREE**
- Beyond 5: **1,000 SC/trip**
- Teleporting home is always free

### Canvas Rendering
- **Matrix Digital Rain** background
- Stick figure avatars drawn with Canvas paths
- **[...] typing indicators** above avatar heads
- **Chat bubbles** with lerp stacking + 5-second fade

### Luxury Store Props
- **Managerial Tie** (5,000 SC) — thick line down chest
- **Corporate Mug** (12,000 SC) — cylinder on hand
- **Status Briefcase** (25,000 SC) — rectangle dragged on floor
- **Surveillance Pet** (50,000 SC) — sine-wave floating diamond
- **Executive Office Chair** (100,000 SC) — auto-sit after 3s idle

---

## DUMMY ACCOUNTS (pre-seeded)

| Username | Balance | Level |
|----------|---------|-------|
| Jane_Doe_77 | 28,500 SC | 3 |
| Mark_Unit_42 | 12,000 SC | 2 |
| Corp_Drone_9 | 61,000 SC | 4 |
| Null_Susan_01 | 4,200 SC | 1 |
| Kevin_Protocol | 95,000 SC | 5 |

---

## FILE STRUCTURE

```
sadworld/
├── server.js          — Node.js + Express + Socket.io + SQLite backend
├── package.json
├── sadworld.db        — Auto-generated SQLite database
└── public/
    ├── index.html     — Full game UI
    ├── style.css      — Matrix/CRT aesthetic
    └── game.js        — Canvas engine + Socket.io client
```

---

*The AI Corporation is watching. Compliance is not optional.*
