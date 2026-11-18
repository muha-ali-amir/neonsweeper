/* ------------------------------------------------------------------ *
 *  NEONSWEEPER // minesweeper core
 *  Pure game logic. Rendering / audio / UI live elsewhere.
 * ------------------------------------------------------------------ */

import { clamp } from './config.js';

const NEIGHBOR_OFFSETS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/** Correct manual flags needed for one siphon token. */
export const SIPHON_FLAGS_PER_TOKEN = 3;
/** Tokens required to refund one ability charge. */
export const SIPHON_TOKENS_PER_REFUND = 3;
/** Hard cap on siphon refunds per run. */
export const SIPHON_MAX_REFUNDS = 2;
/** Sonar sweeps a (radius * 2 + 1) square, i.e. 5x5 by default. */
export const SONAR_RADIUS = 2;

export class MinesweeperGame {
  constructor(config) {
    this.newGame(config);
  }

  newGame({ cols, rows, mines }) {
    const total = cols * rows;
    this.cols = cols;
    this.rows = rows;
    this.total = total;
    this.mineTotal = clamp(Math.floor(mines), 1, total - 1);
    this.tiles = Array.from({ length: total }, () => ({
      mine: false,
      adjacent: 0,
      revealed: false,
      flagged: false,
      exploded: false,
      questioned: false,
    }));
    this.phase = 'ready'; // ready | playing | won | lost
    this.minesPlaced = false;
    this.revealedCount = 0;
    this.flagCount = 0;
    this.explodedIndex = -1;
    this.firstReveal = true;
    this.actionCount = 0;
    this.startedAt = null;
    this.endedAt = null;

    // countermeasure state
    this.ghostShield = 0;
    this.siphonTokens = 0;
    this.siphonProgress = 0;
    this.siphonRefunds = 0;
    this.siphonCredited = new Set();
  }

  /** GHOST PROTOCOL: arm one passive hit-absorbing shield. */
  armGhost() {
    this.ghostShield = 1;
    return this.ghostShield;
  }

  get safeTotal() {
    return this.total - this.mineTotal;
  }

  get safeRemaining() {
    return this.safeTotal - this.revealedCount;
  }

  get hiddenRemaining() {
    return this.total - this.revealedCount;
  }

  get remainingMines() {
    return this.mineTotal - this.flagCount;
  }

  get mineDensity() {
    return this.mineTotal / this.total;
  }

  get isOver() {
    return this.phase === 'won' || this.phase === 'lost';
  }

  neighbors(index) {
    const col = index % this.cols;
    const row = Math.floor(index / this.cols);
    const out = [];
    for (let i = 0; i < NEIGHBOR_OFFSETS.length; i++) {
      const [dc, dr] = NEIGHBOR_OFFSETS[i];
      const c = col + dc;
      const r = row + dr;
      if (c >= 0 && c < this.cols && r >= 0 && r < this.rows) {
        out.push(r * this.cols + c);
      }
    }
    return out;
  }

  /** Place mines after the first click, keeping the clicked 3x3 sector clean. */
  placeMines(safeIndex) {
    if (this.minesPlaced) return;

    const safeZone = new Set([safeIndex, ...this.neighbors(safeIndex)]);
    let candidates = [];
    for (let i = 0; i < this.total; i++) {
      if (!safeZone.has(i)) candidates.push(i);
    }

    // If the board is too dense for a full 3x3 safe zone, only protect the click.
    if (candidates.length < this.mineTotal) {
      candidates = [];
      for (let i = 0; i < this.total; i++) if (i !== safeIndex) candidates.push(i);
    }

    // Fisher-Yates shuffle, then take the front slice.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    for (let i = 0; i < this.mineTotal; i++) {
      this.tiles[candidates[i]].mine = true;
    }

    for (let i = 0; i < this.total; i++) {
      if (this.tiles[i].mine) continue;
      let count = 0;
      for (const n of this.neighbors(i)) {
        if (this.tiles[n].mine) count++;
      }
      this.tiles[i].adjacent = count;
    }

    this.minesPlaced = true;
    this.startedAt = performance.now();
  }

  /** Fresh reveal from a left click. Handles chords on revealed numbers. */
  reveal(index) {
    if (this.isOver) return { action: 'none', reason: 'ended' };
    const tile = this.tiles[index];
    if (!tile) return { action: 'none', reason: 'invalid' };
    if (tile.flagged) return { action: 'none', reason: 'flagged' };
    if (tile.revealed) {
      if (tile.adjacent > 0) return this.chord(index);
      return { action: 'none', reason: 'empty' };
    }

    let started = false;
    if (this.phase === 'ready') {
      this.placeMines(index);
      this.phase = 'playing';
      started = true;
    }

    this.actionCount++;
    if (tile.mine) {
      if (this.ghostShield > 0) return this.absorbMine(index, []);
      return this.lose(index, []);
    }

    const cells = this.floodReveal(index);
    const won = this.checkWin();
    if (won) {
      return { action: 'reveal', cells, started, win: true, exploded: -1 };
    }

    return {
      action: 'reveal',
      cells,
      started,
      win: false,
      firstReveal: this.firstReveal,
      exploded: -1,
    };
  }

  /** Right click / long press. */
  toggleFlag(index) {
    if (this.phase === 'won' || this.phase === 'lost') {
      return { action: 'none', reason: 'ended' };
    }
    const tile = this.tiles[index];
    if (!tile || tile.revealed) return { action: 'none', reason: 'revealed' };

    tile.flagged = !tile.flagged;
    this.flagCount += tile.flagged ? 1 : -1;
    this.actionCount++;

    // DATA SIPHON: credit each hostile only once, so flag toggling cannot farm tokens.
    let tokenEarned = false;
    if (tile.flagged && tile.mine && !this.siphonCredited.has(index)) {
      this.siphonCredited.add(index);
      this.siphonProgress++;
      if (this.siphonProgress >= SIPHON_FLAGS_PER_TOKEN) {
        this.siphonProgress -= SIPHON_FLAGS_PER_TOKEN;
        this.siphonTokens++;
        tokenEarned = true;
      }
    }

    return {
      action: 'flag',
      index,
      flagged: tile.flagged,
      remaining: this.remainingMines,
      tokenEarned,
      siphonTokens: this.siphonTokens,
      siphonProgress: this.siphonProgress,
    };
  }

  /** Middle click: open all unflagged neighbours of a satisfied number. */
  chord(index) {
    if (this.isOver) return { action: 'none', reason: 'ended' };
    const tile = this.tiles[index];
    if (!tile || !tile.revealed || tile.adjacent === 0) {
      return { action: 'none', reason: 'no-chord' };
    }

    const adjacent = this.neighbors(index);
    let flags = 0;
    for (const n of adjacent) if (this.tiles[n].flagged) flags++;
    if (flags !== tile.adjacent) {
      return { action: 'none', reason: 'flags' };
    }

    const cells = [];
    for (const n of adjacent) {
      const target = this.tiles[n];
      if (target.revealed || target.flagged) continue;
      if (target.mine) {
        if (this.ghostShield > 0) return this.absorbMine(n, cells);
        return this.lose(n, cells);
      }
      cells.push(...this.floodReveal(n));
    }

    const won = this.checkWin();
    if (won) {
      return { action: 'chord', cells, win: true, exploded: -1 };
    }
    return { action: 'chord', cells, win: false, exploded: -1 };
  }

  floodReveal(startIndex) {
    const cells = [];
    const queue = [startIndex];
    const queued = new Set(queue);

    while (queue.length) {
      const index = queue.shift();
      const tile = this.tiles[index];
      if (tile.revealed || tile.flagged) continue;

      tile.revealed = true;
      tile.flagged = false;
      this.revealedCount++;
      this.firstReveal = false;
      cells.push({ index, adjacent: tile.adjacent });

      if (tile.adjacent === 0) {
        for (const n of this.neighbors(index)) {
          const nt = this.tiles[n];
          if (!nt.revealed && !nt.flagged && !queued.has(n) && !nt.mine) {
            queued.add(n);
            queue.push(n);
          }
        }
      }
    }

    return cells;
  }

  /**
   * GHOST PROTOCOL absorbs one hostile contact. The mine is tagged instead of
   * detonating, so the run continues with the shield offline.
   */
  absorbMine(index, alreadyRevealed) {
    this.ghostShield = 0;
    const tile = this.tiles[index];
    if (!tile.flagged) {
      tile.flagged = true;
      this.flagCount++;
    }
    const won = this.checkWin();
    return {
      action: 'ghost',
      index,
      cells: alreadyRevealed,
      exploded: -1,
      win: won,
      shieldLeft: this.ghostShield,
    };
  }

  lose(explodedIndex, alreadyRevealed) {
    this.phase = 'lost';
    this.explodedIndex = explodedIndex;
    this.endedAt = performance.now();
    this.tiles[explodedIndex].exploded = true;
    this.tiles[explodedIndex].revealed = true;
    this.revealedCount++;
    this.firstReveal = false;

    const mines = [];
    const wrongFlags = [];
    for (let i = 0; i < this.total; i++) {
      const t = this.tiles[i];
      if (t.mine) mines.push(i);
      else if (t.flagged) wrongFlags.push(i);
    }

    return {
      action: 'lose',
      cells: alreadyRevealed,
      exploded: explodedIndex,
      mines,
      wrongFlags,
      win: false,
    };
  }

  checkWin() {
    if (this.revealedCount !== this.safeTotal) return false;

    this.phase = 'won';
    this.endedAt = performance.now();
    this.firstReveal = false;

    // Auto-flag every remaining mine for a tidy victory board.
    for (const tile of this.tiles) {
      if (tile.mine && !tile.flagged) {
        tile.flagged = true;
        this.flagCount++;
      }
    }
    return true;
  }

  getMineIndices() {
    const out = [];
    for (let i = 0; i < this.total; i++) if (this.tiles[i].mine) out.push(i);
    return out;
  }

  getFlaggedMines() {
    const out = [];
    for (let i = 0; i < this.total; i++) {
      if (this.tiles[i].mine && this.tiles[i].flagged) out.push(i);
    }
    return out;
  }

  /** Pick a hidden, safe cell for the Deep Scan power-up. Prefers blank cells. */
  getScanTarget() {
    if (this.phase !== 'playing' || !this.minesPlaced) return -1;
    const blanks = [];
    const safe = [];
    for (let i = 0; i < this.total; i++) {
      const t = this.tiles[i];
      if (t.revealed || t.flagged || t.mine) continue;
      safe.push(i);
      if (t.adjacent === 0) blanks.push(i);
    }
    const pool = blanks.length ? blanks : safe;
    if (!pool.length) return -1;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /** Flag one random unflagged mine for the Ice Break power-up. */
  defuseOne() {
    if (this.phase !== 'playing' || !this.minesPlaced) return -1;
    const pool = [];
    for (let i = 0; i < this.total; i++) {
      const t = this.tiles[i];
      if (t.mine && !t.flagged) pool.push(i);
    }
    if (!pool.length) return -1;
    const index = pool[Math.floor(Math.random() * pool.length)];
    this.tiles[index].flagged = true;
    this.flagCount++;
    return index;
  }

  /**
   * SONAR PING: count hostiles inside a local square without revealing a tile.
   * Reports every hostile in the area, including ones already flagged.
   */
  sonarArea(index, radius = SONAR_RADIUS) {
    const report = {
      center: -1,
      indices: [],
      hostiles: 0,
      flagged: 0,
      hidden: 0,
      total: 0,
    };
    if (!this.minesPlaced || this.isOver || index < 0 || index >= this.total) return report;

    const centerCol = index % this.cols;
    const centerRow = Math.floor(index / this.cols);
    report.center = index;

    for (let r = centerRow - radius; r <= centerRow + radius; r++) {
      if (r < 0 || r >= this.rows) continue;
      for (let c = centerCol - radius; c <= centerCol + radius; c++) {
        if (c < 0 || c >= this.cols) continue;
        const i = r * this.cols + c;
        const tile = this.tiles[i];
        report.indices.push(i);
        report.total++;
        if (!tile.revealed) report.hidden++;
        if (tile.mine) {
          report.hostiles++;
          if (tile.flagged) report.flagged++;
        }
      }
    }
    return report;
  }

  /** True when Data Siphon has enough tokens and refunds remaining. */
  canSiphon() {
    return this.siphonTokens >= SIPHON_TOKENS_PER_REFUND
      && this.siphonRefunds < SIPHON_MAX_REFUNDS;
  }

  /** Spend salvaged tokens. The controller chooses which charge to restore. */
  spendSiphon() {
    if (this.siphonTokens < SIPHON_TOKENS_PER_REFUND) {
      return { ok: false, reason: 'tokens', tokens: this.siphonTokens };
    }
    if (this.siphonRefunds >= SIPHON_MAX_REFUNDS) {
      return { ok: false, reason: 'limit', tokens: this.siphonTokens };
    }
    this.siphonTokens -= SIPHON_TOKENS_PER_REFUND;
    this.siphonRefunds++;
    return {
      ok: true,
      tokens: this.siphonTokens,
      refunds: this.siphonRefunds,
      refundsLeft: SIPHON_MAX_REFUNDS - this.siphonRefunds,
    };
  }

  /** Elapsed time in whole seconds (game clock starts at first reveal). */
  elapsedSeconds() {
    if (!this.startedAt) return 0;
    const end = this.endedAt || performance.now();
    return Math.max(0, Math.floor((end - this.startedAt) / 1000));
  }

  getScore() {
    const progress = this.revealedCount / Math.max(1, this.safeTotal);
    const densityBonus = 1 + this.mineDensity * 2.2;
    let score = this.revealedCount * 12 * densityBonus;
    score += Math.round(progress * progress * 1800 * densityBonus);
    if (this.phase === 'won') score += 2500 + Math.round(this.mineDensity * 3000);
    return Math.round(score);
  }

  getSnapshot() {
    return {
      phase: this.phase,
      cols: this.cols,
      rows: this.rows,
      mineTotal: this.mineTotal,
      flagCount: this.flagCount,
      revealedCount: this.revealedCount,
      remainingMines: this.remainingMines,
      elapsed: this.elapsedSeconds(),
      score: this.getScore(),
      threat: this.remainingMines / Math.max(1, this.hiddenRemaining),
    };
  }
}
