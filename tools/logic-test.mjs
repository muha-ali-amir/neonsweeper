import assert from 'node:assert/strict';
import { MinesweeperGame, SIPHON_TOKENS_PER_REFUND, SIPHON_MAX_REFUNDS } from '../js/game.js';
import { formatTime, recordKey, PRESETS } from '../js/config.js';

let checks = 0;
const ok = (label) => { checks++; if (process.env.VERBOSE) console.log('  ✓', label); };

/* ————— formatTime ————— */
assert.equal(formatTime(0), '00:00'); ok('formatTime 0');
assert.equal(formatTime(5), '00:05'); ok('formatTime 5s');
assert.equal(formatTime(59), '00:59'); ok('formatTime 59s');
assert.equal(formatTime(60), '01:00'); ok('formatTime 60s');
assert.equal(formatTime(61), '01:01'); ok('formatTime 61s');
assert.equal(formatTime(3599), '59:59'); ok('formatTime 1h');
assert.equal(formatTime(-5), '00:00'); ok('formatTime negative');

assert.equal(recordKey({ cols: 9, rows: 9, mines: 10 }, 'rookie'), 'rookie'); ok('recordKey preset');
assert.equal(recordKey({ cols: 12, rows: 8, mines: 20 }, 'custom'), 'custom-12x8-20'); ok('recordKey custom');

/* ————— randomized first breach / board invariants ————— */
for (const preset of PRESETS) {
  for (let run = 0; run < 120; run++) {
    const game = new MinesweeperGame(preset);
    const first = Math.floor(Math.random() * game.total);
    const result = game.reveal(first);
    assert.equal(game.phase, 'playing', `${preset.id}: phase after first reveal`);
    assert.ok(result.cells.length > 0, `${preset.id}: first reveal produced cells`);
    assert.ok(!game.tiles[first].mine, `${preset.id}: first click never a mine`);
    const safeZone = new Set([first, ...game.neighbors(first)]);
    for (const n of safeZone) assert.ok(!game.tiles[n].mine, `${preset.id}: 3x3 first-click zone safe`);
    assert.equal(game.getMineIndices().length, preset.mines, `${preset.id}: mine count`);

    // revealed cells must never be mines and numbers must be accurate
    for (let i = 0; i < game.total; i++) {
      const tile = game.tiles[i];
      if (!tile.revealed) continue;
      assert.ok(!tile.mine, `${preset.id}: revealed cell ${i} is not a mine`);
      let adj = 0;
      for (const n of game.neighbors(i)) if (game.tiles[n].mine) adj++;
      assert.equal(tile.adjacent, adj, `${preset.id}: adjacent count for ${i}`);
    }
    ok(`${preset.id} run ${run} first reveal`);
  }
}

/* ————— flags, scan, defuse, chord, loss ————— */
for (let run = 0; run < 80; run++) {
  const game = new MinesweeperGame({ cols: 12, rows: 10, mines: 24 });
  game.reveal(Math.floor(game.total / 2));

  const hiddenSafe = game.tiles.findIndex((t) => !t.revealed && !t.mine);
  const flag = game.toggleFlag(hiddenSafe);
  assert.equal(flag.action, 'flag');
  assert.equal(flag.flagged, true);
  assert.equal(game.remainingMines, 23);
  assert.equal(game.toggleFlag(hiddenSafe).flagged, false);
  assert.equal(game.remainingMines, 24);
  ok('flag toggle + counter');

  const scan = game.getScanTarget();
  assert.ok(scan >= 0 && !game.tiles[scan].mine && !game.tiles[scan].revealed, 'scan target safe');
  const scanResult = game.reveal(scan);
  assert.notEqual(scanResult.action, 'lose', 'scan reveal cannot lose');
  ok('deep scan target');

  const defused = game.defuseOne();
  assert.ok(defused >= 0 && game.tiles[defused].mine && game.tiles[defused].flagged, 'ice break flags a mine');
  assert.equal(game.remainingMines, 23);
  ok('ice break flags mine');

  // Find a revealed number whose adjacent mines can all be flagged for a safe chord
  let chordTested = false;
  for (let i = 0; i < game.total; i++) {
    const tile = game.tiles[i];
    if (!tile.revealed || tile.adjacent === 0) continue;
    const adj = game.neighbors(i);
    const mines = adj.filter((n) => game.tiles[n].mine);
    if (mines.length !== tile.adjacent) continue;
    if (mines.some((n) => game.tiles[n].revealed)) continue;
    for (const n of adj) {
      if (!game.tiles[n].mine && !game.tiles[n].flagged) continue;
    }
    for (const n of mines) if (!game.tiles[n].flagged) game.toggleFlag(n);
    const chord = game.chord(i);
    assert.notEqual(chord.action, 'none', 'chord executed');
    assert.notEqual(chord.action, 'lose', 'safe chord did not explode');
    chordTested = true;
    break;
  }
  if (chordTested) ok('safe chord');

  // Loss path on a fresh game
  const lossGame = new MinesweeperGame({ cols: 9, rows: 9, mines: 10 });
  lossGame.reveal(40);
  const mine = lossGame.tiles.findIndex((t) => t.mine);
  const lost = lossGame.reveal(mine);
  assert.equal(lost.action, 'lose');
  assert.equal(lossGame.phase, 'lost');
  assert.ok(lossGame.isOver);
  assert.equal(lossGame.explodedIndex, mine);
  ok('mine loss');
}

/* ————— win and scoring ————— */
for (const preset of PRESETS) {
  const game = new MinesweeperGame(preset);
  game.reveal(0);
  const before = game.getScore();
  for (let i = 0; i < game.total; i++) {
    if (game.phase === 'won') break;
    if (game.tiles[i].mine || game.tiles[i].revealed) continue;
    game.reveal(i);
  }
  assert.equal(game.phase, 'won', `${preset.id}: win reached`);
  assert.equal(game.safeRemaining, 0, `${preset.id}: all safe cells revealed`);
  assert.equal(game.remainingMines, 0, `${preset.id}: all mines auto-flagged`);
  assert.ok(game.getScore() > before, `${preset.id}: winning score greater than progress score`);
  assert.ok(game.getScore() > 2500, `${preset.id}: win bonus applied`);
  ok(`${preset.id} win + score`);
}

/* ————— custom density safety ————— */
for (let run = 0; run < 200; run++) {
  const cols = 6 + Math.floor(Math.random() * 25);
  const rows = 6 + Math.floor(Math.random() * 15);
  const cap = Math.max(5, Math.floor(cols * rows * 0.35));
  const mines = 5 + Math.floor(Math.random() * (cap - 4));
  const game = new MinesweeperGame({ cols, rows, mines });
  const first = Math.floor(Math.random() * game.total);
  game.reveal(first);
  assert.ok(!game.tiles[first].mine, 'custom first click safe');
  assert.equal(game.getMineIndices().length, mines, 'custom mine count');
  ok('custom grid');
}

/* ————— new countermeasures: ghost, sonar, siphon ————— */
for (let run = 0; run < 40; run++) {
  // GHOST PROTOCOL absorbs exactly one hostile contact.
  const ghostGame = new MinesweeperGame({ cols: 9, rows: 9, mines: 10 });
  assert.equal(ghostGame.ghostShield, 0, 'ghost is disarmed until armed');
  ghostGame.armGhost();
  ghostGame.reveal(40);
  const ghostMine = ghostGame.tiles.findIndex((t) => t.mine);
  const absorbed = ghostGame.reveal(ghostMine);
  assert.equal(absorbed.action, 'ghost', 'first mine hit is absorbed');
  assert.equal(ghostGame.ghostShield, 0, 'ghost shield spent');
  assert.equal(ghostGame.phase, 'playing', 'ghost absorption keeps the run alive');
  assert.equal(ghostGame.tiles[ghostMine].flagged, true, 'absorbed mine is tagged');
  const secondMine = ghostGame.tiles.findIndex((t, i) => t.mine && i !== ghostMine);
  assert.equal(ghostGame.reveal(secondMine).action, 'lose', 'second mine hit kills');
  ok('ghost protocol absorbs one hit');

  // SONAR PING reports a local hostile count without revealing anything.
  const sonarGame = new MinesweeperGame({ cols: 12, rows: 10, mines: 24 });
  sonarGame.reveal(Math.floor(sonarGame.total / 2));
  const centerIndex = Math.floor(sonarGame.rows / 2) * sonarGame.cols + Math.floor(sonarGame.cols / 2);
  const revealedBefore = sonarGame.tiles.map((t) => t.revealed);
  const report = sonarGame.sonarArea(centerIndex);
  assert.equal(report.total, 25, 'sonar sweeps a full 5x5 sector');
  assert.equal(report.indices.length, 25, 'sonar returns all swept indices');
  let expected = 0;
  for (const i of report.indices) if (sonarGame.tiles[i].mine) expected++;
  assert.equal(report.hostiles, expected, 'sonar hostile count matches the grid');
  assert.deepEqual(sonarGame.tiles.map((t) => t.revealed), revealedBefore, 'sonar reveals nothing');
  const edge = sonarGame.sonarArea(0);
  assert.equal(edge.total, 9, 'sonar clamps at the board edge');
  assert.ok(edge.hostiles <= edge.total, 'edge count is sane');
  ok('sonar ping count');

  // DATA SIPHON banks one token per three unique correct flags and caps refunds.
  const siphonGame = new MinesweeperGame({ cols: 12, rows: 10, mines: 24 });
  siphonGame.reveal(Math.floor(siphonGame.total / 2));
  const mineIndices = siphonGame.tiles
    .map((t, i) => (t.mine ? i : -1))
    .filter((i) => i >= 0 && !siphonGame.tiles[i].flagged);
  for (let i = 0; i < 3; i++) {
    const flagged = siphonGame.toggleFlag(mineIndices[i]);
    assert.equal(flagged.action, 'flag');
  }
  assert.equal(siphonGame.siphonTokens, 1, 'three correct flags bank one token');
  assert.equal(siphonGame.siphonProgress, 0, 'progress rolls over');
  siphonGame.toggleFlag(mineIndices[0]);
  siphonGame.toggleFlag(mineIndices[0]);
  assert.equal(siphonGame.siphonTokens, 1, 're-flagging the same mine cannot farm tokens');
  for (let i = 3; i < 9; i++) siphonGame.toggleFlag(mineIndices[i]);
  assert.equal(siphonGame.siphonTokens, 3, 'nine correct flags bank three tokens');
  const spend = siphonGame.spendSiphon();
  assert.equal(spend.ok, true, 'siphon spends when affordable');
  assert.equal(siphonGame.siphonTokens, 0);
  assert.equal(siphonGame.siphonRefunds, 1);
  for (let i = 9; i < mineIndices.length; i++) siphonGame.toggleFlag(mineIndices[i]);
  assert.ok(siphonGame.siphonTokens >= SIPHON_TOKENS_PER_REFUND, 'late flags bank more tokens');
  assert.equal(siphonGame.spendSiphon().ok, true, 'second refund allowed');
  assert.equal(siphonGame.siphonRefunds, SIPHON_MAX_REFUNDS);
  assert.equal(siphonGame.canSiphon(), false, 'refund cap blocks further siphons');
  assert.equal(siphonGame.spendSiphon().ok, false, 'third refund rejected');
  ok('data siphon tokens + refund cap');
}

console.log(`\nALL GAME-LOGIC CHECKS PASSED (${checks} assertions groups)`);
