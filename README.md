# KnightSprint++

> **Chess meets Tron.** Simultaneous-turn knight strategy on a shared board.  
> Deterministic. Extensible. Zero dependencies.

[![Deploy to GitHub Pages](https://github.com/YOUR_USERNAME/knightsprint/actions/workflows/deploy.yml/badge.svg)](https://github.com/YOUR_USERNAME/knightsprint/actions)

---

## What Is This?

KnightSprint++ is a **simultaneous-turn strategy game** where two to four players (human and/or AI) each control a chess knight. Every turn, all players secretly select their next move — then all moves resolve at once.

**The catch:** every square you visit is permanently blocked. Run out of legal moves and you're eliminated. Last knight standing — or highest score — wins.

This is not chess. This is **territory denial, spatial reasoning, and tempo control**.

---

## Rules

1. **All players move simultaneously.** You select your destination, then everyone's move resolves at the same time.
2. **Knights move in L-shapes** — exactly as in chess (2+1 in any axis).
3. **Visited squares are permanently blocked** — including your own trail and all opponents'.
4. **Collision cancels both moves.** If two players target the same square, neither moves that turn.
5. **No legal moves = elimination.** If a knight has no valid destination at the start of a turn, it's out.
6. **Scoring:** One point per square visited. Starting square counts as one.
7. **Victory:** Last surviving player wins. If all players are eliminated in the same turn, highest score wins.

---

## Controls

| Action          | Keyboard              | Touch / Mouse         |
|-----------------|-----------------------|-----------------------|
| Browse moves    | `Tab` / `→` / `←`   | Tap a highlighted cell |
| Confirm move    | `Enter` / `Space`     | Tap CONFIRM button    |
| Deselect        | `Esc`                 | Tap selected cell again |
| New game        | —                     | ⚙ NEW GAME button    |

**Legal moves** are highlighted with an animated amber dot. **Selected move** shows a solid amber outline.

---

## Architecture

```
/docs                   ← GitHub Pages root (all files served from here)
  index.html            ← Single-page entry point, setup/gameover modals
  styles.css            ← All visual styling, CSS variables, animations
  state.js              ← Pure game logic. No DOM. Deterministic.
  ai.js                 ← AI strategies. Isolated module, swappable.
  ui.js                 ← DOM rendering, animations, event binding.
  game.js               ← Orchestrator. State machine. Bridges all modules.

/.github/workflows
  deploy.yml            ← Auto-deploy to GitHub Pages on push to main

README.md
```

### Module Responsibilities

| File | Owns | Does Not Touch |
|------|------|---------------|
| `state.js` | Game logic, grid, move resolution | DOM, animations |
| `ai.js` | Strategy implementations | DOM, state mutation |
| `ui.js` | DOM, CSS, animations | Game logic |
| `game.js` | Turn state machine, module wiring | Direct DOM queries |

---

## How to Run Locally

No build step required. Open directly in any modern browser:

```bash
git clone https://github.com/YOUR_USERNAME/knightsprint.git
cd knightsprint/docs

# Option A: Python
python3 -m http.server 8080

# Option B: Node
npx serve .

# Option C: VS Code Live Server extension
```

Then open `http://localhost:8080`.

> **Note:** ES Modules require a server — `file://` protocol will block imports due to CORS. Use any local server.

---

## Determinism & Seeds

Every game is fully reproducible from its seed.

- The seed drives a **xorshift32 PRNG** (`makeRng` in `state.js`).
- Obstacle placement, AI tie-breaking, and all randomness flows through this RNG.
- The same seed + same player count + same board size = **identical game every time**.

**To replay a game:**
1. Click ↓ **EXPORT** to download a JSON snapshot.
2. The snapshot includes `seed`, `boardSize`, `playerCount`, and full `history` (move log).
3. Re-run `initState` with the same parameters and replay the history.

**Access the current game state in DevTools:**
```js
window._KS.getState()    // full GameState object
window._KS.serialize()   // JSON string snapshot
```

---

## How to Extend AI

AI strategies live in `ai.js` and are registered by name:

```js
import { registerStrategy } from './ai.js';

registerStrategy('my-strategy', (state, player, legalMoves) => {
  // state    — full GameState (read-only, do not mutate)
  // player   — the AI PlayerState
  // legalMoves — [[r,c], ...] array of valid destinations

  // Return the chosen [row, col]:
  return legalMoves[0];
});
```

Then assign the strategy name to a player in `state.js`:
```js
player.aiStrategy = 'my-strategy';
```

Built-in strategies:

| Name | Description |
|------|-------------|
| `mobility` | Warnsdorff heuristic — maximizes onward moves (keep options open) |
| `aggressor` | Targets squares that reduce opponent mobility |
| `balanced` | Blends mobility and aggression based on board density |

---

## How to Extend Rules

The ruleset is passed as a config object and stored in `GameState.ruleset`:

```js
startGame({
  boardSize:     10,
  playerCount:   3,
  cpuCount:      2,
  seed:          12345,
  timerSeconds:  15,      // per-turn timer; 0 = no timer
  obstacleCount: 8,       // random blocked squares at game start
});
```

**Planned / scaffolded variants** (not yet implemented — architecture ready):

- **Shrinking board** — outer rows collapse each N turns (`ruleset.shrinkBoard`)
- **Fog of war** — players only see squares within knight-move range (`ruleset.fogOfWar`)
- **Survival mode** — solo play, score as many squares as possible before blocking
- **Asymmetric starts** — custom starting positions via `ruleset.startPositions`

---

## Design Decisions

**Why simultaneous turns?**  
Sequential turns reward reaction speed over strategy. Simultaneous resolution forces genuine prediction and spatial planning — you must anticipate where opponents will move.

**Why Warnsdorff's heuristic for AI?**  
It's fast (O(n) per move), deterministic per seed, and produces surprisingly strong play. The Mobility Maximizer AI is competitive against new players.

**Why no canvas?**  
CSS grid + CSS transitions handle all rendering. No redraw loops, no canvas context management. The board is accessible to screen readers and keyboard navigation by default.

**Why vanilla JS?**  
Zero runtime dependency = zero update burden. The game will run identically in 10 years.

---

## Game Feel Principles

- Every action has feedback (hover preview, selection flash, move animation, collision flash).
- All animations ≤ 300ms (per spec). No animation blocks input.
- Color-blind safe palette (amber, ice-blue, rose, jade — tested for deuteranopia).
- Reduced motion mode via OS preference or toggle button.
- Minimum tap target: 40×40px (WCAG 2.5.5).

---

## License

MIT. Fork it, study it, ship it.
