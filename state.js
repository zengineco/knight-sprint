/**
 * state.js — KnightSprint++ Game State
 * Pure deterministic logic. No DOM, no side effects.
 * Every function is a pure transformation of GameState.
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

export const CELL = Object.freeze({
  EMPTY:   0,
  BLOCKED: 1, // visited or obstacle
  OBSTACLE: 2,
});

export const PHASE = Object.freeze({
  SETUP:    'setup',
  SELECT:   'select',    // players choosing moves
  RESOLVE:  'resolve',   // simultaneous resolution
  ANIMATE:  'animate',   // visual feedback window
  EVAL:     'evaluate',  // check eliminations / game-over
  GAMEOVER: 'gameover',
});

export const PLAYER_STATUS = Object.freeze({
  ALIVE:      'alive',
  ELIMINATED: 'eliminated',
  WINNER:     'winner',
});

// All 8 legal knight move offsets
export const KNIGHT_MOVES = Object.freeze([
  [-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1],
]);

// Player color palette (color-blind safe + distinct)
export const PLAYER_PALETTES = Object.freeze([
  { id:0, name:'Amber',  primary:'#f0a500', light:'#ffe08a', dark:'#8a5c00', trail:'rgba(240,165,0,0.22)',  trailSolid:'#8a5c00' },
  { id:1, name:'Ice',    primary:'#44b4ff', light:'#a8d8ff', dark:'#1a6090', trail:'rgba(68,180,255,0.22)', trailSolid:'#1a6090' },
  { id:2, name:'Rose',   primary:'#ff6a8a', light:'#ffb4c6', dark:'#8a2040', trail:'rgba(255,106,138,0.22)',trailSolid:'#8a2040' },
  { id:3, name:'Jade',   primary:'#3ed9a0', light:'#a0f0d0', dark:'#1a6040', trail:'rgba(62,217,160,0.22)', trailSolid:'#1a6040' },
]);

// ─── Seeded RNG (xorshift32 — deterministic) ──────────────────────────────────

export function makeRng(seed) {
  let x = (seed | 0) || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

// ─── Board Utilities ──────────────────────────────────────────────────────────

export function inBounds(r, c, size) {
  return r >= 0 && r < size && c >= 0 && c < size;
}

export function cellKey(r, c) { return `${r},${c}`; }

export function getLegalMoves(r, c, size, visited) {
  const moves = [];
  for (const [dr, dc] of KNIGHT_MOVES) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc, size) && visited[nr][nc] === CELL.EMPTY) {
      moves.push([nr, nc]);
    }
  }
  return moves;
}

export function countMobility(r, c, size, visited) {
  return getLegalMoves(r, c, size, visited).length;
}

/**
 * Check if a cell value is "occupied" (blocked, trailed, or obstacle).
 */
export function isOccupied(v) {
  return v !== CELL.EMPTY;
}

// ─── State Factories ──────────────────────────────────────────────────────────

/**
 * Create a fresh visited grid (all EMPTY).
 */
export function makeGrid(size) {
  return Array.from({ length: size }, () => new Array(size).fill(CELL.EMPTY));
}

/**
 * Deep-clone a GameState (for AI search or history).
 */
export function cloneState(state) {
  return {
    boardSize:    state.boardSize,
    seed:         state.seed,
    turn:         state.turn,
    phase:        state.phase,
    players:      state.players.map(p => ({ ...p })),
    visited:      state.visited.map(row => [...row]),
    pendingMoves: new Map(state.pendingMoves),
    ruleset:      { ...state.ruleset },
    rng:          state.rng, // shared — AI should clone seed separately
    obstacles:    state.obstacles ? [...state.obstacles.map(o => [...o])] : [],
    history:      state.history ? [...state.history] : [],
  };
}

/**
 * Build starting positions for N players on a given board size.
 * Deterministic — corner-biased, symmetric-ish.
 */
function defaultStartPositions(n, size) {
  const pad = Math.floor(size / 5);
  const positions = [
    [pad,         pad        ],
    [size-1-pad,  size-1-pad ],
    [pad,         size-1-pad ],
    [size-1-pad,  pad        ],
  ];
  return positions.slice(0, n);
}

/**
 * Place random obstacle squares using the seeded rng.
 * Returns list of [r,c] pairs.
 */
function placeObstacles(size, rng, startPositions, count) {
  const obstacles = [];
  const occupied = new Set(startPositions.map(([r,c]) => cellKey(r,c)));
  // Also protect cells reachable from starts
  for (const [r,c] of startPositions) {
    for (const [dr,dc] of KNIGHT_MOVES) {
      occupied.add(cellKey(r+dr, c+dc));
    }
  }
  let attempts = 0;
  while (obstacles.length < count && attempts < 2000) {
    attempts++;
    const r = Math.floor(rng() * size);
    const c = Math.floor(rng() * size);
    const k = cellKey(r, c);
    if (!occupied.has(k)) {
      obstacles.push([r, c]);
      occupied.add(k);
    }
  }
  return obstacles;
}

/**
 * Initialize a complete GameState.
 */
export function initState({
  boardSize   = 8,
  seed        = 42,
  playerCount = 2,
  cpuCount    = 1,
  ruleset     = {},
} = {}) {
  const rng = makeRng(seed);
  const size = boardSize;

  const defaults = {
    timerSeconds:  0,      // 0 = no timer
    obstacleCount: 0,
    fogOfWar:      false,
    shrinkBoard:   false,
  };
  const rules = { ...defaults, ...ruleset };

  // Player list: first (playerCount - cpuCount) are human
  const humanCount = Math.max(1, playerCount - cpuCount);
  const players = [];
  const starts = defaultStartPositions(playerCount, size);

  for (let i = 0; i < playerCount; i++) {
    players.push({
      id:       i,
      isHuman:  i < humanCount,
      status:   PLAYER_STATUS.ALIVE,
      row:      starts[i][0],
      col:      starts[i][1],
      score:    1, // count starting square
      palette:  PLAYER_PALETTES[i],
      aiStrategy: i === 0 ? null : (i % 2 === 1 ? 'mobility' : 'aggressor'),
    });
  }

  const visited = makeGrid(size);

  // Mark starting squares
  for (const p of players) {
    visited[p.row][p.col] = CELL.BLOCKED;
  }

  // Place obstacles
  const obstacleList = placeObstacles(size, rng, starts, rules.obstacleCount);
  for (const [r, c] of obstacleList) {
    visited[r][c] = CELL.OBSTACLE;
  }

  return {
    boardSize:    size,
    seed,
    turn:         0,
    phase:        PHASE.SELECT,
    players,
    visited,
    obstacles:    obstacleList,
    pendingMoves: new Map(),
    ruleset:      rules,
    rng,
    history:      [], // [{turn, moves: [{pid, from, to}]}]
  };
}

// ─── Move Resolution ──────────────────────────────────────────────────────────

/**
 * Submit a pending move for a player.
 * Returns new state (immutable pattern).
 */
export function submitMove(state, playerId, row, col) {
  const s = cloneState(state);
  s.pendingMoves.set(playerId, [row, col]);
  return s;
}

/**
 * Resolve all pending moves simultaneously.
 * Returns { nextState, events[] }
 * Events: { type: 'move'|'collision'|'elimination', ... }
 */
export function resolveTurn(state) {
  const s = cloneState(state);
  const events = [];

  // Collect intended destinations
  const intended = new Map(); // pid → [r,c]
  const alive = s.players.filter(p => p.status === PLAYER_STATUS.ALIVE);

  for (const p of alive) {
    const move = s.pendingMoves.get(p.id);
    if (move) {
      intended.set(p.id, move);
    }
    // Players who didn't submit a move stay put (counted as pass)
  }

  // Detect destination collisions: two players targeting same square
  const destCount = new Map();
  for (const [, dest] of intended) {
    const k = cellKey(dest[0], dest[1]);
    destCount.set(k, (destCount.get(k) || 0) + 1);
  }

  const turnRecord = { turn: s.turn, moves: [] };

  for (const p of alive) {
    const move = intended.get(p.id);
    if (!move) continue;

    const [nr, nc] = move;
    const k = cellKey(nr, nc);

    // Collision → both moves cancelled
    if (destCount.get(k) > 1) {
      events.push({ type: 'collision', players: [], square: [nr, nc] });
      continue;
    }

    // Validate move is still legal (grid may have changed from another player this same tick)
    if (s.visited[nr][nc] !== CELL.EMPTY) {
      events.push({ type: 'blocked', pid: p.id, square: [nr, nc] });
      continue;
    }

    // Execute move
    const from = [p.row, p.col];
    p.row = nr;
    p.col = nc;
    s.visited[nr][nc] = CELL.BLOCKED;
    p.score++;
    events.push({ type: 'move', pid: p.id, from, to: [nr, nc] });
    turnRecord.moves.push({ pid: p.id, from, to: [nr, nc] });
  }

  s.history.push(turnRecord);
  s.pendingMoves.clear();
  s.turn++;
  s.phase = PHASE.EVAL;

  return { nextState: s, events };
}

/**
 * Evaluate board state: eliminate players with no moves, check game-over.
 */
export function evaluateState(state) {
  const s = cloneState(state);
  const events = [];

  const alive = s.players.filter(p => p.status === PLAYER_STATUS.ALIVE);

  for (const p of alive) {
    const moves = getLegalMoves(p.row, p.col, s.boardSize, s.visited);
    if (moves.length === 0) {
      p.status = PLAYER_STATUS.ELIMINATED;
      events.push({ type: 'elimination', pid: p.id, score: p.score });
    }
  }

  const stillAlive = s.players.filter(p => p.status === PLAYER_STATUS.ALIVE);

  if (stillAlive.length <= 1) {
    if (stillAlive.length === 1) {
      stillAlive[0].status = PLAYER_STATUS.WINNER;
      events.push({ type: 'winner', pid: stillAlive[0].id });
    } else {
      // All eliminated simultaneously — highest score wins
      const maxScore = Math.max(...s.players.map(p => p.score));
      for (const p of s.players) {
        if (p.score === maxScore) {
          p.status = PLAYER_STATUS.WINNER;
          events.push({ type: 'winner', pid: p.id });
        }
      }
    }
    s.phase = PHASE.GAMEOVER;
  } else {
    s.phase = PHASE.SELECT;
  }

  return { nextState: s, events };
}

/**
 * Serialize state to a JSON-safe snapshot (for export / replay).
 */
export function serializeState(state) {
  return JSON.stringify({
    boardSize:  state.boardSize,
    seed:       state.seed,
    turn:       state.turn,
    phase:      state.phase,
    players:    state.players.map(({ id, isHuman, status, row, col, score, aiStrategy }) =>
                  ({ id, isHuman, status, row, col, score, aiStrategy })),
    visited:    state.visited,
    obstacles:  state.obstacles,
    ruleset:    state.ruleset,
    history:    state.history,
  });
}
