/**
 * ui.js — KnightSprint++ UI Layer
 * DOM rendering, animations, and event bindings.
 * Communicates with game.js via callback/event pattern.
 * No game logic here — only presentation.
 */

'use strict';

import { CELL, PHASE, PLAYER_STATUS, getLegalMoves } from './state.js';

// ─── DOM References ───────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const qsa = sel => document.querySelectorAll(sel);

let _onCellClick = null;   // callback(row, col)
let _onConfirm = null;     // callback()
let _onNewGame = null;     // callback(options)
let _onSettings = null;    // callback()

export function setCallbacks({ onCellClick, onConfirm, onNewGame }) {
  _onCellClick = onCellClick;
  _onConfirm = onConfirm;
  _onNewGame = onNewGame;
}

// ─── Board Rendering ──────────────────────────────────────────────────────────

let _boardSize = 8;
let _cellElems = []; // [row][col] = td element
let _currentState = null;
let _humanPlayerId = 0;
let _selectedMove = null; // [r,c] currently staged

/**
 * Build the board DOM from scratch. Call once on game init.
 */
export function buildBoard(size) {
  _boardSize = size;
  _cellElems = [];
  _selectedMove = null;

  const boardEl = $('board');
  boardEl.innerHTML = '';
  boardEl.style.setProperty('--board-size', size);

  for (let r = 0; r < size; r++) {
    _cellElems.push([]);
    for (let c = 0; c < size; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell ' + ((r + c) % 2 === 0 ? 'cell-light' : 'cell-dark');
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.setAttribute('role', 'button');
      cell.setAttribute('aria-label', `Row ${r+1} Column ${c+1}`);
      cell.addEventListener('click', () => _onCellClick && _onCellClick(r, c));
      cell.addEventListener('touchend', e => {
        e.preventDefault();
        _onCellClick && _onCellClick(r, c);
      }, { passive: false });
      boardEl.appendChild(cell);
      _cellElems[r].push(cell);
    }
  }
}

/**
 * Full board re-render from state. Called after each state change.
 */
export function renderBoard(state, humanId, selectedMove) {
  _currentState = state;
  _humanPlayerId = humanId;
  _selectedMove = selectedMove;

  const alive = state.players.filter(p => p.status === PLAYER_STATUS.ALIVE);
  const humanPlayer = state.players.find(p => p.id === humanId);
  const legalSet = new Set();

  if (state.phase === PHASE.SELECT && humanPlayer?.status === PLAYER_STATUS.ALIVE) {
    const legalMoves = getLegalMoves(humanPlayer.row, humanPlayer.col, state.boardSize, state.visited);
    for (const [r, c] of legalMoves) legalSet.add(`${r},${c}`);
  }

  for (let r = 0; r < state.boardSize; r++) {
    for (let c = 0; c < state.boardSize; c++) {
      renderCell(r, c, state, humanPlayer, legalSet, selectedMove);
    }
  }

  renderScoreboard(state);
  renderPhaseIndicator(state, humanPlayer);
}

function renderCell(r, c, state, humanPlayer, legalSet, selectedMove) {
  const el = _cellElems[r][c];
  const key = `${r},${c}`;
  const v = state.visited[r][c];

  // Clear previous dynamic classes
  el.className = 'cell ' + ((r + c) % 2 === 0 ? 'cell-light' : 'cell-dark');
  el.innerHTML = '';
  el.style.removeProperty('--trail-color');
  el.removeAttribute('aria-pressed');

  // Obstacle
  if (v === CELL.OBSTACLE) {
    el.classList.add('cell-obstacle');
    el.innerHTML = '<div class="obstacle-icon">✕</div>';
    return;
  }

  // Trail — find which player visited this (scan players by their trail)
  // We encode player ownership in the visited grid as 10 + playerId
  if (v >= 10) {
    const pid = v - 10;
    const pal = state.players[pid]?.palette;
    if (pal) {
      el.classList.add('cell-trail');
      el.style.setProperty('--trail-color', pal.trail);
      el.style.setProperty('--trail-solid', pal.trailSolid);
    }
  } else if (v === CELL.BLOCKED) {
    el.classList.add('cell-blocked');
  }

  // Legal move highlight
  if (legalSet.has(key)) {
    el.classList.add('cell-legal');
    const dot = document.createElement('div');
    dot.className = 'legal-dot';
    el.appendChild(dot);
  }

  // Selected move
  if (selectedMove && selectedMove[0] === r && selectedMove[1] === c) {
    el.classList.add('cell-selected');
    el.setAttribute('aria-pressed', 'true');
  }

  // Player tokens
  for (const p of state.players) {
    if (p.row === r && p.col === c) {
      const token = buildKnightToken(p);
      el.appendChild(token);
    }
  }
}

function buildKnightToken(player) {
  const wrap = document.createElement('div');
  wrap.className = 'knight-token';
  wrap.dataset.pid = player.id;
  wrap.style.setProperty('--player-color', player.palette.primary);
  wrap.style.setProperty('--player-light', player.palette.light);

  if (player.status === PLAYER_STATUS.ELIMINATED) wrap.classList.add('eliminated');
  if (player.status === PLAYER_STATUS.WINNER)     wrap.classList.add('winner');

  // SVG knight head (heraldic silhouette)
  wrap.innerHTML = `
    <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" class="knight-svg" aria-hidden="true">
      <defs>
        <radialGradient id="kg${player.id}" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stop-color="var(--player-light)"/>
          <stop offset="100%" stop-color="var(--player-color)"/>
        </radialGradient>
      </defs>
      <!-- Body -->
      <ellipse cx="16" cy="22" rx="9" ry="7" fill="url(#kg${player.id})"/>
      <!-- Neck -->
      <rect x="12" y="13" width="8" height="10" rx="3" fill="url(#kg${player.id})"/>
      <!-- Head -->
      <ellipse cx="16" cy="11" rx="7" ry="6" fill="url(#kg${player.id})"/>
      <!-- Muzzle -->
      <ellipse cx="21" cy="13" rx="4" ry="3" fill="var(--player-light)" opacity="0.7"/>
      <!-- Eye -->
      <circle cx="13" cy="9" r="1.5" fill="var(--player-color)" opacity="0.9"/>
      <circle cx="13" cy="9" r="0.7" fill="#0a0a14"/>
      <!-- Ear / plume -->
      <path d="M11 6 Q10 2 14 3 Q12 5 13 7 Z" fill="var(--player-color)" opacity="0.8"/>
      <!-- ID number -->
      <text x="16" y="23" text-anchor="middle" font-size="5" fill="#0a0a14" font-weight="bold" font-family="monospace">${player.id + 1}</text>
    </svg>
  `;

  const label = document.createElement('span');
  label.className = 'sr-only';
  label.textContent = `Player ${player.id + 1} (${player.palette.name})`;
  wrap.appendChild(label);

  return wrap;
}

// ─── Scoreboard ───────────────────────────────────────────────────────────────

function renderScoreboard(state) {
  const el = $('scoreboard');
  if (!el) return;
  el.innerHTML = '';

  const sorted = [...state.players].sort((a, b) => b.score - a.score);

  for (const p of sorted) {
    const row = document.createElement('div');
    row.className = 'score-row';
    if (p.status === PLAYER_STATUS.ELIMINATED) row.classList.add('score-eliminated');
    if (p.status === PLAYER_STATUS.WINNER)     row.classList.add('score-winner');

    row.style.setProperty('--player-color', p.palette.primary);

    const moves = getLegalMoves(p.row, p.col, state.boardSize, state.visited);
    const mobilityBar = p.status === PLAYER_STATUS.ALIVE
      ? `<div class="mobility-bar" style="width:${Math.min(100, moves.length / 8 * 100)}%"></div>`
      : '';

    row.innerHTML = `
      <div class="score-swatch" style="background:${p.palette.primary}"></div>
      <div class="score-info">
        <div class="score-name">${p.isHuman ? '👤' : '🤖'} P${p.id+1} ${p.palette.name}</div>
        <div class="score-mob-wrap">${mobilityBar}</div>
      </div>
      <div class="score-pts">${p.score}</div>
      <div class="score-status">${statusLabel(p)}</div>
    `;
    el.appendChild(row);
  }
}

function statusLabel(p) {
  if (p.status === PLAYER_STATUS.WINNER)     return '🏆';
  if (p.status === PLAYER_STATUS.ELIMINATED) return '☠';
  return '';
}

// ─── Phase Indicator ─────────────────────────────────────────────────────────

function renderPhaseIndicator(state, humanPlayer) {
  const el = $('phase-label');
  if (!el) return;

  if (state.phase === PHASE.GAMEOVER) {
    el.textContent = 'GAME OVER';
    el.className = 'phase-label phase-gameover';
    return;
  }

  if (state.phase === PHASE.SELECT) {
    const waiting = humanPlayer?.status === PLAYER_STATUS.ALIVE
      ? 'SELECT YOUR MOVE'
      : 'AI THINKING…';
    el.textContent = `TURN ${state.turn + 1} — ${waiting}`;
    el.className = 'phase-label phase-select';
    return;
  }

  if (state.phase === PHASE.RESOLVE || state.phase === PHASE.ANIMATE) {
    el.textContent = 'RESOLVING…';
    el.className = 'phase-label phase-resolve';
    return;
  }
}

// ─── Animations ──────────────────────────────────────────────────────────────

/**
 * Flash a cell briefly. Duration ≤ 300ms per spec.
 */
export function flashCell(r, c, cssClass, durationMs = 280) {
  const el = _cellElems[r]?.[c];
  if (!el) return;
  el.classList.add(cssClass);
  setTimeout(() => el.classList.remove(cssClass), durationMs);
}

/**
 * Animate a knight moving from one cell to another.
 * Uses CSS transform — no layout reflow.
 */
export function animateMove(fromR, fromC, toR, toC, palette) {
  return new Promise(resolve => {
    // Create a flying token overlay
    const board = $('board');
    const fromEl = _cellElems[fromR]?.[fromC];
    const toEl   = _cellElems[toR]?.[toC];
    if (!fromEl || !toEl) { resolve(); return; }

    const bRect = board.getBoundingClientRect();
    const fRect = fromEl.getBoundingClientRect();
    const tRect = toEl.getBoundingClientRect();

    const ghost = document.createElement('div');
    ghost.className = 'move-ghost';
    ghost.style.cssText = `
      position:fixed;
      width:${fRect.width}px;
      height:${fRect.height}px;
      left:${fRect.left}px;
      top:${fRect.top}px;
      pointer-events:none;
      z-index:100;
      --player-color:${palette.primary};
      --player-light:${palette.light};
    `;
    ghost.innerHTML = fromEl.querySelector('.knight-token')?.outerHTML || '';
    document.body.appendChild(ghost);

    // Trigger animation
    requestAnimationFrame(() => {
      ghost.style.transition = 'left 220ms cubic-bezier(0.4,0,0.2,1), top 220ms cubic-bezier(0.4,0,0.2,1), opacity 220ms';
      ghost.style.left = tRect.left + 'px';
      ghost.style.top  = tRect.top + 'px';
    });

    setTimeout(() => {
      ghost.remove();
      resolve();
    }, 240);
  });
}

/**
 * Animate elimination (shake + fade).
 */
export function animateElimination(r, c) {
  return new Promise(resolve => {
    const el = _cellElems[r]?.[c];
    if (!el) { resolve(); return; }
    el.classList.add('cell-eliminate');
    setTimeout(() => { el.classList.remove('cell-eliminate'); resolve(); }, 280);
  });
}

// ─── Overlays ─────────────────────────────────────────────────────────────────

export function showGameOver(state) {
  const winners = state.players.filter(p => p.status === PLAYER_STATUS.WINNER);
  const sorted  = [...state.players].sort((a, b) => b.score - a.score);

  const el = $('gameover-overlay');
  const titleEl  = $('gameover-title');
  const resultEl = $('gameover-result');
  const tableEl  = $('gameover-table');

  const w = winners[0];
  if (w) {
    titleEl.textContent = w.isHuman ? '⚔ VICTORY' : '☠ DEFEATED';
    titleEl.style.color = w.palette.primary;
    resultEl.textContent = w.isHuman
      ? `Player ${w.id+1} wins with ${w.score} squares`
      : `AI (${w.palette.name}) wins — ${w.score} squares`;
  } else {
    titleEl.textContent = 'DRAW';
    resultEl.textContent = 'All knights blocked simultaneously.';
  }

  tableEl.innerHTML = sorted.map(p => `
    <div class="go-row" style="--pc:${p.palette.primary}">
      <span class="go-swatch" style="background:${p.palette.primary}"></span>
      <span class="go-name">${p.isHuman?'👤':'🤖'} P${p.id+1} ${p.palette.name}</span>
      <span class="go-score">${p.score} sq</span>
      <span class="go-badge">${p.status === PLAYER_STATUS.WINNER ? '🏆' : ''}</span>
    </div>
  `).join('');

  el.classList.remove('hidden');
  el.classList.add('visible');
}

export function hideGameOver() {
  const el = $('gameover-overlay');
  el.classList.remove('visible');
  el.classList.add('hidden');
}

export function showSetupPanel() {
  $('setup-panel').classList.remove('hidden');
  $('setup-panel').classList.add('visible');
}

export function hideSetupPanel() {
  $('setup-panel').classList.remove('visible');
  $('setup-panel').classList.add('hidden');
}

// ─── Confirm Button ───────────────────────────────────────────────────────────

export function updateConfirmButton(enabled, text = 'CONFIRM MOVE') {
  const btn = $('btn-confirm');
  if (!btn) return;
  btn.disabled = !enabled;
  btn.textContent = text;
}

// ─── Timer ───────────────────────────────────────────────────────────────────

let _timerInterval = null;
let _timerEl = null;

export function startTimer(seconds, onExpire) {
  stopTimer();
  _timerEl = $('timer-bar-fill');
  const timerWrap = $('timer-wrap');
  if (!timerWrap) return;

  timerWrap.classList.remove('hidden');
  let remaining = seconds;

  function update() {
    const pct = (remaining / seconds) * 100;
    if (_timerEl) {
      _timerEl.style.width = pct + '%';
      _timerEl.style.background = pct > 50 ? 'var(--c-amber)' : pct > 25 ? '#ff9a00' : '#ff4444';
    }
    remaining--;
    if (remaining < 0) {
      stopTimer();
      onExpire?.();
    }
  }

  update();
  _timerInterval = setInterval(update, 1000);
}

export function stopTimer() {
  if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
  const timerWrap = $('timer-wrap');
  if (timerWrap) timerWrap.classList.add('hidden');
}

// ─── Settings Panel Bindings ──────────────────────────────────────────────────

export function bindSetupForm(onSubmit) {
  const form = $('setup-form');
  if (!form) return;

  form.addEventListener('submit', e => {
    e.preventDefault();
    const data = new FormData(form);
    onSubmit({
      boardSize:    parseInt(data.get('board-size') || '8'),
      playerCount:  parseInt(data.get('player-count') || '2'),
      cpuCount:     parseInt(data.get('cpu-count') || '1'),
      seed:         parseInt(data.get('seed') || String(Date.now() % 99999)),
      timerSeconds: parseInt(data.get('timer') || '0'),
      obstacleCount:parseInt(data.get('obstacles') || '0'),
    });
  });
}

// ─── Keyboard Support ─────────────────────────────────────────────────────────

export function bindKeyboard(state, humanId, onCellClick, onConfirm) {
  // Arrow keys move a virtual cursor over legal moves
  let cursorIdx = 0;

  document.addEventListener('keydown', e => {
    if (!state || state.phase !== PHASE.SELECT) return;

    const human = state.players.find(p => p.id === humanId);
    if (!human || human.status !== PLAYER_STATUS.ALIVE) return;

    const { getLegalMoves: glm } = window._ksState || {};
    // handled via re-import in game.js
  });
}

// ─── Misc Utilities ──────────────────────────────────────────────────────────

export function setStatusText(text) {
  const el = $('status-text');
  if (el) el.textContent = text;
}

export function toggleReducedMotion(on) {
  document.documentElement.classList.toggle('reduced-motion', on);
}

// Announce for screen readers
export function announce(text) {
  const el = $('aria-live');
  if (el) { el.textContent = ''; setTimeout(() => { el.textContent = text; }, 50); }
}
