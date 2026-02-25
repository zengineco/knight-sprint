/**
 * game.js — KnightSprint++ Game Orchestrator
 * Owns the turn state machine. Bridges state.js ↔ ui.js ↔ ai.js.
 * Entry point for all gameplay.
 */

'use strict';

import {
  initState, submitMove, resolveTurn, evaluateState,
  getLegalMoves, serializeState, cloneState,
  PHASE, PLAYER_STATUS, CELL,
} from './state.js';

import { computeAiMove } from './ai.js';

import {
  buildBoard, renderBoard, flashCell, animateMove,
  animateElimination, showGameOver, hideGameOver,
  showSetupPanel, hideSetupPanel, updateConfirmButton,
  startTimer, stopTimer, setCallbacks, bindSetupForm,
  setStatusText, announce,
} from './ui.js';

// ─── Game Instance ────────────────────────────────────────────────────────────

let GS = null;            // current GameState
let _selectedMove = null; // [r,c] human has staged
let _humanId = 0;
let _config = {};
let _resolving = false;

const AI_THINK_MS = 320; // ms delay before AI moves (feels more natural)

// ─── Initialization ───────────────────────────────────────────────────────────

export function startGame(config = {}) {
  stopTimer();
  hideGameOver();
  _resolving = false;
  _selectedMove = null;

  const defaults = {
    boardSize:     8,
    playerCount:   2,
    cpuCount:      1,
    seed:          Math.floor(Math.random() * 99999),
    timerSeconds:  0,
    obstacleCount: 0,
  };

  _config = { ...defaults, ...config };
  _humanId = 0; // Player 0 is always the human

  GS = initState({
    boardSize:    _config.boardSize,
    seed:         _config.seed,
    playerCount:  _config.playerCount,
    cpuCount:     _config.cpuCount,
    ruleset: {
      timerSeconds:  _config.timerSeconds,
      obstacleCount: _config.obstacleCount,
    },
  });

  // Apply AI strategy from config
  if (_config.aiStrategy) _applyAiStrategy(GS, _config.aiStrategy);

  // Patch visited grid to track ownership (10 + playerId) for trail rendering
  _patchVisitedWithOwnership(GS);

  buildBoard(_config.boardSize);
  setCallbacks({
    onCellClick: handleCellClick,
    onConfirm:   handleConfirm,
    onNewGame:   () => showSetupPanel(),
  });

  renderBoard(GS, _humanId, _selectedMove);
  updateConfirmButton(false);
  setStatusText(`Seed: ${_config.seed}`);
  announce('Game started. Select your move.');

  // Start turn
  beginSelectPhase();
}

/**
 * Replace plain BLOCKED markers with ownership markers.
 * Starting squares are owned by starting player.
 */
function _patchVisitedWithOwnership(state) {
  for (const p of state.players) {
    if (state.visited[p.row][p.col] === CELL.BLOCKED) {
      state.visited[p.row][p.col] = 10 + p.id;
    }
  }
}

// ─── Turn Phases ──────────────────────────────────────────────────────────────

function beginSelectPhase() {
  if (!GS || GS.phase !== PHASE.SELECT) return;

  const human = GS.players.find(p => p.id === _humanId);
  const humanAlive = human?.status === PLAYER_STATUS.ALIVE;
  const legalMoves = humanAlive
    ? getLegalMoves(human.row, human.col, GS.boardSize, GS.visited)
    : [];

  renderBoard(GS, _humanId, _selectedMove);

  // Start timer if configured
  if (_config.timerSeconds > 0 && humanAlive) {
    startTimer(_config.timerSeconds, () => {
      // Timer expired — auto-pick first legal move
      if (legalMoves.length > 0 && !_selectedMove) {
        _selectedMove = legalMoves[0];
      }
      handleConfirm();
    });
  }

  // Queue AI moves
  if (!humanAlive) {
    // Human already eliminated — resolve with AIs immediately
    setTimeout(() => resolveWithAiMoves(), AI_THINK_MS);
  }
}

// ─── User Input ───────────────────────────────────────────────────────────────

function handleCellClick(r, c) {
  if (!GS || GS.phase !== PHASE.SELECT || _resolving) return;

  const human = GS.players.find(p => p.id === _humanId);
  if (!human || human.status !== PLAYER_STATUS.ALIVE) return;

  const legal = getLegalMoves(human.row, human.col, GS.boardSize, GS.visited);
  const isLegal = legal.some(([lr, lc]) => lr === r && lc === c);
  if (!isLegal) return;

  // Toggle selection
  if (_selectedMove && _selectedMove[0] === r && _selectedMove[1] === c) {
    _selectedMove = null;
    updateConfirmButton(false);
  } else {
    _selectedMove = [r, c];
    updateConfirmButton(true, 'CONFIRM (' + String.fromCharCode(0x2713) + ')');
  }

  renderBoard(GS, _humanId, _selectedMove);
}

function handleConfirm() {
  if (!GS || GS.phase !== PHASE.SELECT || _resolving) return;
  if (!_selectedMove) return;

  stopTimer();
  _resolving = true;

  // Submit human move
  GS = submitMove(GS, _humanId, _selectedMove[0], _selectedMove[1]);
  updateConfirmButton(false, 'WAITING…');
  _selectedMove = null;

  // Give AI time to "think"
  setTimeout(() => resolveWithAiMoves(), AI_THINK_MS);
}

async function resolveWithAiMoves() {
  // Compute AI moves for all alive CPU players
  for (const p of GS.players) {
    if (!p.isHuman && p.status === PLAYER_STATUS.ALIVE) {
      const aiMove = computeAiMove(GS, p.id);
      if (aiMove) {
        GS = submitMove(GS, p.id, aiMove[0], aiMove[1]);
      }
    }
  }

  // Also handle human if they were eliminated (no move submitted)
  await executeResolution();
}

async function executeResolution() {
  GS = { ...GS, phase: PHASE.RESOLVE };
  renderBoard(GS, _humanId, null);

  const { nextState, events } = resolveTurn(GS);
  GS = nextState;

  // Animate moves
  const movePromises = [];
  for (const ev of events) {
    if (ev.type === 'move') {
      const p = GS.players.find(x => x.id === ev.pid);
      if (p) {
        // Patch ownership in visited
        GS.visited[ev.to[0]][ev.to[1]] = 10 + ev.pid;
        movePromises.push(animateMove(ev.from[0], ev.from[1], ev.to[0], ev.to[1], p.palette));
        flashCell(ev.to[0], ev.to[1], 'cell-flash-land', 280);
      }
    }
    if (ev.type === 'collision') {
      flashCell(ev.square[0], ev.square[1], 'cell-flash-collision', 280);
      announce('Collision! Both moves cancelled.');
    }
  }

  await Promise.all(movePromises);

  // Evaluate
  const { nextState: evaluated, events: evalEvents } = evaluateState(GS);
  GS = evaluated;

  for (const ev of evalEvents) {
    if (ev.type === 'elimination') {
      const p = GS.players.find(x => x.id === ev.pid);
      if (p) {
        await animateElimination(p.row, p.col);
        announce(`Player ${ev.pid + 1} eliminated with ${ev.score} squares.`);
      }
    }
    if (ev.type === 'winner') {
      const p = GS.players.find(x => x.id === ev.pid);
      if (p) announce(`Player ${ev.pid + 1} wins!`);
    }
  }

  renderBoard(GS, _humanId, null);
  _resolving = false;

  if (GS.phase === PHASE.GAMEOVER) {
    showGameOver(GS);
    return;
  }

  updateConfirmButton(false);
  beginSelectPhase();
}

// ─── Keyboard Support ─────────────────────────────────────────────────────────

let _kbCursorIdx = 0;

document.addEventListener('keydown', e => {
  if (!GS || GS.phase !== PHASE.SELECT || _resolving) return;

  const human = GS.players.find(p => p.id === _humanId);
  if (!human || human.status !== PLAYER_STATUS.ALIVE) return;

  const legal = getLegalMoves(human.row, human.col, GS.boardSize, GS.visited);
  if (legal.length === 0) return;

  if (e.key === 'ArrowRight' || e.key === 'Tab') {
    e.preventDefault();
    _kbCursorIdx = (_kbCursorIdx + 1) % legal.length;
    _selectedMove = legal[_kbCursorIdx];
    updateConfirmButton(true);
    renderBoard(GS, _humanId, _selectedMove);
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    _kbCursorIdx = (_kbCursorIdx - 1 + legal.length) % legal.length;
    _selectedMove = legal[_kbCursorIdx];
    updateConfirmButton(true);
    renderBoard(GS, _humanId, _selectedMove);
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (_selectedMove) handleConfirm();
  }
  if (e.key === 'Escape') {
    _selectedMove = null;
    updateConfirmButton(false);
    renderBoard(GS, _humanId, null);
  }
});

// ─── Export for devtools and index.html wiring ───────────────────────────────

window._KS = {
  getState:  () => GS,
  serialize: () => GS ? serializeState(GS) : null,
  startGame,
};

// Expose confirm handler so index.html can wire btn-confirm
window._KS_handleConfirm = handleConfirm;

// Patch AI strategy from config into player objects
function _applyAiStrategy(state, strategy) {
  for (const p of state.players) {
    if (!p.isHuman) {
      // alternate strategies for multiple AI players
      const idx = p.id % 2;
      p.aiStrategy = idx === 0 ? strategy : (strategy === 'mobility' ? 'aggressor' : 'mobility');
    }
  }
}
