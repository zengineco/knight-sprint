/**
 * ai.js — KnightSprint++ AI Engine
 * Isolated, seed-driven, swappable strategy implementations.
 * No DOM access. Pure state → move decision.
 */

'use strict';

import {
  getLegalMoves,
  countMobility,
  cloneState,
  makeRng,
  PLAYER_STATUS,
} from './state.js';

// ─── Strategy Registry ────────────────────────────────────────────────────────

const STRATEGIES = {};

export function registerStrategy(name, fn) {
  STRATEGIES[name] = fn;
}

export function getStrategyNames() {
  return Object.keys(STRATEGIES);
}

/**
 * Compute an AI move for a given player.
 * Returns [row, col] or null if no moves available.
 * Deterministic per seed — rng is advanced consistently per call.
 */
export function computeAiMove(state, playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player || player.status !== PLAYER_STATUS.ALIVE) return null;

  const moves = getLegalMoves(player.row, player.col, state.boardSize, state.visited);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const stratName = player.aiStrategy || 'mobility';
  const stratFn = STRATEGIES[stratName] || STRATEGIES['mobility'];

  return stratFn(state, player, moves);
}

// ─── Utility: Score a candidate move ─────────────────────────────────────────

function scoreMobility(state, r, c) {
  // Temporarily mark cell as blocked
  const orig = state.visited[r][c];
  state.visited[r][c] = 1;
  const mobility = countMobility(r, c, state.boardSize, state.visited);
  state.visited[r][c] = orig;
  return mobility;
}

function getOpponents(state, playerId) {
  return state.players.filter(
    p => p.id !== playerId && p.status === PLAYER_STATUS.ALIVE
  );
}

// ─── Strategy: Mobility Maximizer ────────────────────────────────────────────
/**
 * Warnsdorff-inspired heuristic.
 * Prefers squares that maximize onward moves (keep options open).
 * Tie-break: random (seeded).
 */
registerStrategy('mobility', (state, player, moves) => {
  let best = null;
  let bestScore = -1;

  for (const [r, c] of moves) {
    const mob = scoreMobility(state, r, c);
    if (mob > bestScore) {
      bestScore = mob;
      best = [r, c];
    } else if (mob === bestScore && state.rng() > 0.5) {
      best = [r, c]; // seeded tie-break
    }
  }

  return best || moves[0];
});

// ─── Strategy: Aggressive Blocker ────────────────────────────────────────────
/**
 * Targets squares that maximally reduce opponent mobility.
 * Falls back to Mobility Maximizer if no opponents.
 */
registerStrategy('aggressor', (state, player, moves) => {
  const opponents = getOpponents(state, player.id);
  if (opponents.length === 0) {
    return STRATEGIES['mobility'](state, player, moves);
  }

  let best = null;
  let bestScore = -Infinity;

  for (const [r, c] of moves) {
    // Temporarily occupy cell
    const orig = state.visited[r][c];
    state.visited[r][c] = 1;

    // Sum of mobility reductions for all opponents
    let reduction = 0;
    for (const opp of opponents) {
      const before = countMobility(opp.row, opp.col, state.boardSize, state.visited);
      reduction += (8 - before); // more blocked = higher score
    }

    // Also factor own future mobility (avoid self-crippling)
    const ownMob = countMobility(r, c, state.boardSize, state.visited);
    const combined = reduction * 2 + ownMob;

    state.visited[r][c] = orig;

    if (combined > bestScore || (combined === bestScore && state.rng() > 0.5)) {
      bestScore = combined;
      best = [r, c];
    }
  }

  return best || moves[0];
});

// ─── Strategy: Balanced (medium difficulty) ──────────────────────────────────
/**
 * Blends mobility and aggression with lookahead.
 * Weights shift based on board occupancy.
 */
registerStrategy('balanced', (state, player, moves) => {
  const total = state.boardSize * state.boardSize;
  const occupied = state.visited.flat().filter(v => v !== 0).length;
  const density = occupied / total; // 0→1

  // Early game: prioritize mobility. Late game: prioritize blocking.
  const aggressWeight = density * 2;
  const mobWeight = 1 - density * 0.5;

  const opponents = getOpponents(state, player.id);
  let best = null;
  let bestScore = -Infinity;

  for (const [r, c] of moves) {
    const orig = state.visited[r][c];
    state.visited[r][c] = 1;

    const mob = countMobility(r, c, state.boardSize, state.visited) * mobWeight;

    let aggress = 0;
    for (const opp of opponents) {
      const before = countMobility(opp.row, opp.col, state.boardSize, state.visited);
      aggress += (8 - before) * aggressWeight;
    }

    const score = mob + aggress + state.rng() * 0.2; // tiny seeded noise
    state.visited[r][c] = orig;

    if (score > bestScore) {
      bestScore = score;
      best = [r, c];
    }
  }

  return best || moves[0];
});
