/* ------------------------------------------------------------------ *
 *  NEONSWEEPER // application controller
 * ------------------------------------------------------------------ */

import {
  PRESETS,
  DEFAULT_PRESET,
  FLAVOR,
  clamp,
  formatTime,
  loadStats,
  recordKey,
  recordRun,
  randomOf,
} from './config.js';
import { MinesweeperGame, SIPHON_TOKENS_PER_REFUND, SIPHON_MAX_REFUNDS } from './game.js';
import { GameScene } from './scene.js';
import { GameUI } from './ui.js';
import { AudioEngine } from './audio.js';

const SETTINGS_KEY = 'neonsweeper.settings.v1';

/** Resolve after the browser has painted the current DOM state. */
const nextPaint = () =>
  new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
  });

class NeonSweeperApp {
  constructor() {
    this.hasStarted = false;
    this.presetId = DEFAULT_PRESET;
    const preset = PRESETS.find((p) => p.id === DEFAULT_PRESET) || PRESETS[1];
    this.config = { cols: preset.cols, rows: preset.rows, mines: preset.mines };
    this.customConfig = { cols: 16, rows: 16, mines: 40 };
    this.stats = loadStats();
    this.settings = this.loadSettings();
    this.audio = new AudioEngine();
    this.charges = { scan: 1, defuse: 1, sonar: 2 };
    this.maxCharges = { scan: 1, defuse: 1, sonar: 2 };
    this.sonarArmed = false;
    this.lastSpent = null;
    this.flagMode = false;
    this.pointer = null;
    this.pendingEnd = null;
    this.interactionTimer = null;
    this.firstBreachShown = false;
    this.scene = null;
    this.game = null;
    this.ui = null;
    this.modalOpen = false;
    this.raf = null;
    this.presetRequest = 0;
  }

  async init() {
    await this.loadFonts();
    this.createUI();
    this.createScene();
    this.bindInput();
    this.buildRun({ initial: true });
    this.ui.playBootIntro();
    this.ui.setAudioState({
      music: this.settings.music,
      sfx: this.settings.sfx,
      musicVolume: this.settings.musicVolume,
      sfxVolume: this.settings.sfxVolume,
    });
    this.ui.setBootMeta(this.config, this.presetThreat());
    this.startHudTicker();
    window.addEventListener('resize', () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.scene?.resize();
      }, 120);
    });
    document.addEventListener('visibilitychange', () => this.onVisibilityChange());
  }

  async loadFonts() {
    try {
      await Promise.race([
        Promise.all([
          document.fonts.load('900 64px Orbitron'),
          document.fonts.load('600 24px Rajdhani'),
          document.fonts.load('400 20px "Share Tech Mono"'),
        ]),
        new Promise((resolve) => setTimeout(resolve, 1600)),
      ]);
    } catch {
      /* fall back to system fonts */
    }
  }

  loadSettings() {
    const defaults = { music: true, sfx: true, musicVolume: 55, sfxVolume: 70 };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return defaults;
      return { ...defaults, ...JSON.parse(raw) };
    } catch {
      return defaults;
    }
  }

  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }

  createUI() {
    this.ui = new GameUI({
      onStart: () => this.start(),
      onPreset: (id) => this.selectPreset(id),
      onCustomOpen: () => this.openCustom(),
      onCustomApply: (config) => this.startCustom(config),
      onNewGame: () => this.newRun(),
      onAbility: (type) => this.useAbility(type),
      onFlagModeToggle: () => this.toggleFlagMode(),
      onMusicToggle: () => this.toggleMusic(),
      onSfxToggle: () => this.toggleSfx(),
      onMusicVolume: (value) => this.setMusicVolume(value),
      onSfxVolume: (value) => this.setSfxVolume(value),
      onEndAgain: () => this.newRun(),
      onEndChange: () => this.onEndChange(),
      onModalChange: (open) => this.onModalChange(open),
      onUiSound: (kind) => this.audio.playUi(kind),
    });
    this.ui.renderBests(this.stats);
    this.ui.setAudioState({
      music: this.settings.music,
      sfx: this.settings.sfx,
      musicVolume: this.settings.musicVolume,
      sfxVolume: this.settings.sfxVolume,
    });
  }

  createScene() {
    const stage = document.getElementById('stage');
    try {
      this.scene = new GameScene(stage, {
        getInsets: () => this.computeInsets(),
      });
    } catch (error) {
      console.error(error);
      this.ui.showFatal(
        'WebGL could not start. Update your browser or enable hardware acceleration, then relaunch the uplink.',
      );
      throw error;
    }
  }

  computeInsets() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const topEl = document.querySelector('.hud-top');
    const bottomEl = document.querySelector('.hud-bottom');
    const mobileReadout = document.querySelector('.mobile-readout');
    const leftPanel = document.querySelector('.panel-left');
    const rightPanel = document.querySelector('.panel-right');

    let top = 96;
    if (topEl) top = topEl.getBoundingClientRect().bottom + 8;
    if (mobileReadout && window.getComputedStyle(mobileReadout).display !== 'none') {
      top = Math.max(top, mobileReadout.getBoundingClientRect().bottom + 8);
    }
    let bottom = 94;
    if (bottomEl) bottom = vh - bottomEl.getBoundingClientRect().top + 10;

    let left = 16;
    if (leftPanel && window.getComputedStyle(leftPanel).display !== 'none') {
      const rect = leftPanel.getBoundingClientRect();
      if (rect.width > 0) left = rect.right + 16;
    }
    let right = 16;
    if (rightPanel && window.getComputedStyle(rightPanel).display !== 'none') {
      const rect = rightPanel.getBoundingClientRect();
      if (rect.width > 0) right = vw - rect.left + 16;
    }
    return { left, right, top, bottom };
  }

  buildRun({ initial = false } = {}) {
    clearTimeout(this.pendingEnd);
    clearTimeout(this.interactionTimer);
    if (this.ui.el.endScreen && !this.ui.el.endScreen.classList.contains('is-hidden')) {
      this.ui.hideEnd();
    }
    this.ui.setMode(null);

    this.game = new MinesweeperGame(this.config);
    this.game.armGhost();
    this.charges = { scan: 1, defuse: 1, sonar: 2 };
    this.sonarArmed = false;
    this.lastSpent = null;
    this.flagMode = false;
    this.firstBreachShown = false;
    this.pointer = null;
    this.ui.setFlagMode(false);
    this.scene.setInteractive(false);

    const accent = this.presetId === 'custom' ? '#57ff9a' : this.currentPreset().accent;
    this.scene.setAccent(accent);
    this.scene.buildBoard(this.game);
    this.ui.setPreset(this.presetId, this.config, accent);
    this.ui.setSonarArmed(false);
    this.ui.setAbilities(this.charges.scan, this.charges.defuse, false, this.abilityExtra());
    this.ui.setPhase('ready');
    this.ui.setHUD({
      time: 0,
      mines: this.config.mines,
      score: 0,
      threat: this.computeThreat(),
      phase: 'ready',
    });
    this.ui.setBestTime(this.currentBestTime());
    this.audio.duckMusic(false);

    if (!initial) {
      this.ui.clearLog();
      this.ui.log(
        `SECTOR ${this.currentPresetName()} ONLINE // ${this.config.cols}×${this.config.rows}`,
        'info',
        0,
      );
      this.ui.log(`${this.config.mines} HOSTILE SIGNATURES DETECTED`, 'warn', 0);
      this.ui.log('FIRST BREACH GUARANTEED SAFE', 'dim', 0);
      this.ui.log('AWAITING NEURAL INPUT…', 'dim', 0);
      this.ui.toast(
        'GRID REBOOTED',
        `${this.currentPresetName()} // ${this.config.cols}×${this.config.rows} // ${this.config.mines} HOSTILES`,
        'info',
        3200,
      );
      this.interactionTimer = setTimeout(() => this.syncInteractivity(), 1300);
    }
  }

  /* ————————————————————————— flow ————————————————————————— */

  async start() {
    this.settings.music = this.settings.music !== false;
    this.prepareAudioSettings();
    try {
      await this.audio.init();
    } catch (error) {
      console.warn('Audio engine unavailable:', error);
    }
    this.applyAudioSettings();
    this.hasStarted = true;
    this.scene.startRun();
    await this.ui.hideBoot();
    this.scene.resize();
    setTimeout(() => this.scene.resize(), 700);
    setTimeout(() => this.scene.resize(), 1800);

    this.ui.clearLog();
    this.ui.log(`NEURAL LINK ESTABLISHED // ${this.config.cols}×${this.config.rows}`, 'success', 0);
    this.ui.log(`${this.config.mines} HOSTILES BURIED IN THE GRID`, 'warn', 0);
    this.ui.log('FIRST BREACH SAFE // COUNTERMEASURES STANDBY', 'dim', 0);
    this.ui.log('AWAITING INPUT…', 'dim', 0);
    this.ui.toast(
      'LINK ESTABLISHED',
      `${this.currentPresetName()} // ${this.config.cols}×${this.config.rows} // FIRST BREACH SAFE`,
      'success',
      4200,
    );

    this.interactionTimer = setTimeout(() => this.syncInteractivity(), 900);
    this.audio.playAbilityReady();
  }

  prepareAudioSettings() {
    this.audio.musicEnabled = this.settings.music;
    this.audio.sfxEnabled = this.settings.sfx;
    this.audio.setMusicVolume(this.settings.musicVolume / 100);
    this.audio.setSfxVolume(this.settings.sfxVolume / 100);
  }

  applyAudioSettings() {
    this.audio.setMusicEnabled(this.settings.music);
    this.audio.setSfxEnabled(this.settings.sfx);
    this.audio.setMusicVolume(this.settings.musicVolume / 100);
    this.audio.setSfxVolume(this.settings.sfxVolume / 100);
    this.ui.setAudioState({
      music: this.settings.music,
      sfx: this.settings.sfx,
      musicVolume: this.settings.musicVolume,
      sfxVolume: this.settings.sfxVolume,
    });
  }

  async selectPreset(id) {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    this.presetId = preset.id;
    this.config = { cols: preset.cols, rows: preset.rows, mines: preset.mines };

    // Paint the selector/accent immediately, then rebuild the heavier 3D board.
    const request = ++this.presetRequest;
    this.ui.setPresetVisual(this.presetId, this.config, preset.accent);
    this.scene.setAccent(preset.accent);
    await nextPaint();
    if (request !== this.presetRequest) return;
    this.buildRun();
  }

  async startCustom(config) {
    const cols = clamp(Math.floor(config.cols), 6, 30);
    const rows = clamp(Math.floor(config.rows), 6, 20);
    const densityCap = Math.max(5, Math.floor(cols * rows * 0.35));
    const mines = clamp(Math.floor(config.mines), 5, densityCap);
    this.presetId = 'custom';
    this.config = { cols, rows, mines };
    this.customConfig = { cols, rows, mines };

    const request = ++this.presetRequest;
    this.ui.setPresetVisual('custom', this.config, '#57ff9a');
    this.scene.setAccent('#57ff9a');
    await nextPaint();
    if (request !== this.presetRequest) return;
    this.buildRun();
  }

  openCustom() {
    this.ui.openCustom(this.customConfig);
  }

  newRun() {
    if (!this.hasStarted) return;
    this.presetRequest += 1;
    this.buildRun();
  }

  onEndChange() {
    this.ui.setMode(null);
    this.ui.toast('SECTOR SELECT', 'Choose a difficulty from the top deck to redeploy.', 'info', 3600);
  }

  onModalChange(open) {
    this.modalOpen = open;
    if (open && this.sonarArmed) this.setSonarArmed(false);
    this.syncInteractivity();
  }

  currentPreset() {
    return PRESETS.find((p) => p.id === this.presetId) || PRESETS[1];
  }

  currentPresetName() {
    return this.presetId === 'custom' ? 'CUSTOM' : this.currentPreset().name;
  }

  presetThreat() {
    return this.presetId === 'custom' ? 'CUSTOM' : this.currentPreset().threat;
  }

  currentBestTime() {
    const key = recordKey(this.config, this.presetId);
    return this.stats.records?.[key]?.time ?? null;
  }

  /* ————————————————————————— actions ————————————————————————— */

  canInteract() {
    return Boolean(
      this.hasStarted
      && this.game
      && !this.game.isOver
      && !this.modalOpen
      && this.scene
      && !this.scene.introActive,
    );
  }

  syncInteractivity() {
    if (!this.scene) return;
    this.scene.setInteractive(this.canInteract());
  }

  doReveal(index) {
    if (!this.canInteract() || index < 0) return;
    if (this.sonarArmed) {
      this.fireSonar(index);
      return;
    }
    const result = this.game.reveal(index);
    if (result.action === 'none' && result.reason === 'flags') {
      this.audio.playChordFail();
      this.ui.log('CHORD DENIED // FLAG COUNT MISMATCH', 'warn', this.game.elapsedSeconds());
      return;
    }
    this.handleResult(result, index);
  }

  doFlag(index) {
    if (!this.canInteract() || index < 0) return;
    const result = this.game.toggleFlag(index);
    if (result.action !== 'flag') {
      if (result.reason === 'revealed') this.audio.playUi('error');
      return;
    }

    this.scene.setFlag(index, result.flagged);
    this.audio.playFlag(result.flagged);
    const time = this.game.elapsedSeconds();
    if (result.flagged) {
      this.ui.log(`${randomOf(FLAVOR.flags)} // ${this.coord(index)}`, 'flag', time);
    } else {
      this.ui.log(`${randomOf(FLAVOR.unflags)} // ${this.coord(index)}`, 'dim', time);
    }
    if (result.tokenEarned) {
      this.audio.playSiphonBank();
      this.ui.log(
        `DATA SIPHON // SALVAGE TOKEN ${this.game.siphonTokens} BANKED`,
        'siphon',
        time,
      );
      this.ui.toast(
        'SALVAGE TOKEN BANKED',
        `${this.game.siphonTokens} TOKEN${this.game.siphonTokens === 1 ? '' : 'S'} // SPEND ${SIPHON_TOKENS_PER_REFUND} TO REFUND A CHARGE`,
        'siphon',
        3400,
      );
    }
    this.refreshHUD();
    this.audio.playUi('click');
  }

  doChord(index) {
    if (!this.canInteract() || index < 0) return;
    const result = this.game.chord(index);
    if (result.action === 'none') {
      if (result.reason === 'flags') {
        this.audio.playChordFail();
        this.ui.log('CHORD DENIED // FLAG COUNT MISMATCH', 'warn', this.game.elapsedSeconds());
      }
      return;
    }
    this.handleResult(result, index);
  }

  handleResult(result, origin) {
    if (!result || result.action === 'none') return;

    if (result.cells?.length) {
      this.scene.revealCells(result.cells, origin, Boolean(result.started));
      const maxAdjacent = Math.max(0, ...result.cells.map((c) => c.adjacent));
      this.audio.playReveal(maxAdjacent, result.cells.length);
    }

    if (result.started) this.onFirstBreach();

    if (result.action === 'ghost') {
      this.lastSpent = 'ghost';
      this.scene.setFlag(result.index, true);
      this.scene.ghostFx(result.index);
      this.audio.playGhost();
      const time = this.game.elapsedSeconds();
      this.ui.log(`GHOST PROTOCOL // ${this.coord(result.index)} BREACH ABSORBED`, 'ghost', time);
      this.ui.toast(
        'GHOST PROTOCOL // SHIELD BURNED',
        'Hostile contact absorbed. The run continues — shield offline.',
        'ghost',
        4200,
      );
      this.ui.flashImpact('ghost');
      this.refreshAbilityUI();
      this.refreshHUD();

      if (result.win || this.game.phase === 'won') {
        this.handleWin();
        return;
      }
      this.syncInteractivity();
      return;
    }

    if (result.action === 'lose' || this.game.phase === 'lost') {
      this.handleLoss(result);
      return;
    }

    if (result.win || this.game.phase === 'won') {
      this.handleWin(result);
      return;
    }

    this.logReveal(result);
    this.refreshHUD();
    this.syncInteractivity();
  }

  onFirstBreach() {
    if (this.firstBreachShown) return;
    this.firstBreachShown = true;
    this.ui.setPhase('playing');
    this.ui.setAbilities(this.charges.scan, this.charges.defuse, true, this.abilityExtra());
    this.audio.playAbilityReady();
    this.ui.log('FIRST CONTACT // CLOCK RUNNING', 'success', this.game.elapsedSeconds());
    this.ui.log('COUNTERMEASURES ARMED // FIVE SYSTEMS ONLINE', 'dim', this.game.elapsedSeconds());
    this.ui.toast('BREACH SUCCESSFUL', 'Safe pocket decrypted. The trace has started.', 'success', 3000);
    this.refreshHUD();
    this.syncInteractivity();
  }

  logReveal(result) {
    if (!result.cells?.length) return;
    const n = result.cells.length;
    const time = this.game.elapsedSeconds();
    if (n >= 8) {
      this.ui.log(`${randomOf(FLAVOR.flood)} // ${n} NODES`, 'success', time);
    } else if (Math.random() < 0.24) {
      this.ui.log(
        `${randomOf(FLAVOR.reveal)} // ${this.coord(result.cells[Math.floor(Math.random() * n)].index)}`,
        'dim',
        time,
      );
    }
  }

  coord(index) {
    const row = Math.floor(index / this.config.cols) + 1;
    const col = (index % this.config.cols) + 1;
    return `NODE ${String(row).padStart(2, '0')}:${String(col).padStart(2, '0')}`;
  }

  handleWin() {
    if (this.game.phase !== 'won') return;
    this.setSonarArmed(false);
    const time = this.game.elapsedSeconds();
    const score = this.game.getScore();
    const key = recordKey(this.config, this.presetId);
    const { newBest, previousBest } = recordRun(this.stats, key, { won: true, time, score });
    const bestTime = this.stats.records[key]?.time ?? null;
    const runNumber = (this.stats.wins || 0) + (this.stats.losses || 0);

    this.ui.renderBests(this.stats);
    this.ui.setBestTime(bestTime);
    this.ui.setPhase('won');
    this.ui.setAbilities(0, 0, false, this.abilityExtra({ available: false }));
    this.ui.setMode('victory');
    this.scene.setInteractive(false);
    this.scene.showWin(this.game);
    this.audio.playWin();
    this.ui.flashImpact('success');
    this.ui.log('SECTOR SECURED // ALL HOSTILES NEUTRALIZED', 'success', time);
    this.refreshHUD();

    if (newBest) {
      this.ui.toast(
        'NEW PERSONAL BEST',
        `${formatTime(time)} // ${this.currentPresetName()} // SCORE ${score}`,
        'success',
        6200,
      );
    } else {
      this.ui.toast('SECTOR CLEARED', `${formatTime(time)} // SCORE ${score}`, 'success', 4200);
    }

    clearTimeout(this.pendingEnd);
    this.pendingEnd = setTimeout(() => {
      this.ui.showEnd({
        won: true,
        time,
        score,
        mines: this.config.mines,
        decryptPct: 100,
        newBest,
        bestTime,
        previousBest,
        runNumber,
        presetName: this.currentPresetName(),
      });
    }, 1900);
  }

  handleLoss(result) {
    if (this.game.phase !== 'lost') return;
    this.setSonarArmed(false);
    const time = this.game.elapsedSeconds();
    const score = this.game.getScore();
    const key = recordKey(this.config, this.presetId);
    recordRun(this.stats, key, { won: false, time, score });
    const bestTime = this.stats.records[key]?.time ?? null;
    const runNumber = (this.stats.wins || 0) + (this.stats.losses || 0);
    const decryptPct = (this.game.revealedCount / Math.max(1, this.game.safeTotal)) * 100;

    this.ui.renderBests(this.stats);
    this.ui.setBestTime(bestTime);
    this.ui.setPhase('lost');
    this.ui.setAbilities(0, 0, false, this.abilityExtra({ available: false }));
    this.ui.setMode('defeat');
    this.scene.setInteractive(false);
    this.scene.showLoss(result);
    this.audio.playExplosion();
    setTimeout(() => this.audio.playLose(), 420);
    this.ui.flashImpact('danger');
    this.ui.log('TRACE COMPLETE // YOUR SIGNAL WAS FLATTENED', 'danger', time);
    this.ui.toast('CONNECTION SEVERED', 'The ICE traced your uplink. Grid lost.', 'danger', 5000);
    this.refreshHUD();

    clearTimeout(this.pendingEnd);
    this.pendingEnd = setTimeout(() => {
      this.ui.showEnd({
        won: false,
        time,
        score,
        mines: this.config.mines,
        decryptPct,
        newBest: false,
        bestTime,
        runNumber,
        presetName: this.currentPresetName(),
      });
    }, 2300);
  }

  useAbility(type) {
    if (!this.hasStarted) return;
    if (!this.game) return;

    if (type === 'ghost') {
      if (this.game.isOver) return;
      if (this.game.phase === 'ready') {
        this.ui.toast('COUNTERMEASURES LOCKED', 'Breach the grid before deploying tools.', 'danger', 3000);
        this.audio.playUi('error');
        return;
      }
      if (this.game.ghostShield > 0) {
        this.ui.toast(
          'GHOST PROTOCOL // ARMED',
          'Passive shield. The next hostile breach is absorbed automatically.',
          'ghost',
          3600,
        );
        this.audio.playUi('back');
      } else {
        this.ui.toast(
          'GHOST PROTOCOL // OFFLINE',
          'Shield already spent. Data Siphon can restore it.',
          'danger',
          3200,
        );
        this.audio.playUi('error');
      }
      return;
    }

    if (this.game.isOver) return;
    if (this.game.phase === 'ready') {
      this.ui.toast('COUNTERMEASURES LOCKED', 'Breach the grid before deploying tools.', 'danger', 3000);
      this.audio.playUi('error');
      return;
    }
    if (this.modalOpen || this.game.phase !== 'playing') return;

    if (type === 'sonar') {
      this.toggleSonar();
      return;
    }

    if (type === 'siphon') {
      this.refundWithSiphon();
      return;
    }

    if (this.charges[type] <= 0) {
      const name = this.abilityLabel(type);
      this.ui.toast(`${name} DEPLETED`, 'Data Siphon can restore one charge.', 'danger', 3000);
      this.audio.playUi('error');
      return;
    }

    if (type === 'scan') {
      const target = this.game.getScanTarget();
      if (target < 0) {
        this.ui.toast('NO SIGNAL', 'No safe hidden nodes remain.', 'danger', 3000);
        return;
      }
      this.charges.scan--;
      this.lastSpent = 'scan';
      this.refreshAbilityUI();
      this.scene.scanFx(target);
      this.audio.playScan();
      this.ui.log(`DEEP SCAN // ${this.coord(target)} DECRYPTED`, 'scan', this.game.elapsedSeconds());
      const result = this.game.reveal(target);
      this.handleResult(result, target);
      this.refreshAbilityUI();
    } else if (type === 'defuse') {
      const index = this.game.defuseOne();
      if (index < 0) {
        this.ui.toast('NO HOSTILES FOUND', 'Every hostile is already flagged.', 'info', 3000);
        return;
      }
      this.charges.defuse--;
      this.lastSpent = 'defuse';
      this.refreshAbilityUI();
      this.scene.defuseFx(index);
      this.audio.playDefuse();
      this.scene.setFlag(index, true);
      this.ui.log(`ICE BREAK // ${this.coord(index)} LOCKED DOWN`, 'scan', this.game.elapsedSeconds());
      this.ui.toast('ICE BREAK', 'One hostile tagged automatically.', 'scan', 3000);
      this.refreshHUD();
    }
  }

  abilityLabel(type) {
    return {
      scan: 'DEEP SCAN',
      defuse: 'ICE BREAK',
      sonar: 'SONAR PING',
      ghost: 'GHOST PROTOCOL',
      siphon: 'DATA SIPHON',
    }[type] || type.toUpperCase();
  }

  abilityExtra({ available } = {}) {
    const game = this.game;
    const tokens = game?.siphonTokens ?? 0;
    const refunds = game?.siphonRefunds ?? 0;
    const siphonMaxed = refunds >= SIPHON_MAX_REFUNDS;
    return {
      sonar: this.charges.sonar,
      ghost: game?.ghostShield ?? 0,
      tokens,
      tokenGoal: SIPHON_TOKENS_PER_REFUND,
      siphonReady:
        tokens >= SIPHON_TOKENS_PER_REFUND
        && !siphonMaxed
        && this.findRefundTarget() !== null,
      siphonMaxed,
      refundsLeft: Math.max(0, SIPHON_MAX_REFUNDS - refunds),
      available: available ?? game?.phase === 'playing',
    };
  }

  setSonarArmed(armed) {
    this.sonarArmed = Boolean(armed);
    this.ui.setSonarArmed(this.sonarArmed);
  }

  toggleSonar() {
    if (this.sonarArmed) {
      this.setSonarArmed(false);
      this.audio.playUi('back');
      this.ui.toast('SONAR PING // STANDBY', 'Sweep cancelled. Charge retained.', 'info', 2200);
      return;
    }
    if (this.charges.sonar <= 0) {
      this.ui.toast('SONAR PING DEPLETED', 'Data Siphon can restore one charge.', 'danger', 3000);
      this.audio.playUi('error');
      return;
    }
    this.setSonarArmed(true);
    this.audio.playUi('open');
    this.ui.log('SONAR PING ARMED // SELECT A SECTOR', 'sonar', this.game.elapsedSeconds());
    this.ui.toast(
      'SONAR PING ARMED',
      'Click any node to sweep its 5×5 sector. Esc cancels.',
      'sonar',
      3600,
    );
  }

  fireSonar(index) {
    if (!this.sonarArmed || this.charges.sonar <= 0) return;
    const report = this.game.sonarArea(index);
    this.setSonarArmed(false);
    if (!report.total) {
      this.ui.toast('NO SIGNAL', 'That sector returned no data.', 'danger', 2400);
      return;
    }

    this.charges.sonar--;
    this.lastSpent = 'sonar';
    this.scene.sonarFx(report);
    this.audio.playSonar();
    const word = report.hostiles === 1 ? 'HOSTILE' : 'HOSTILES';
    const time = this.game.elapsedSeconds();
    this.ui.log(
      `SONAR PING // ${report.hostiles} ${word} IN 5×5 SWEEP`,
      report.hostiles ? 'sonar' : 'success',
      time,
    );
    this.ui.toast(
      `SONAR // ${report.hostiles} ${word}`,
      `${report.hidden} HIDDEN NODES SWEPT // ${report.flagged} ALREADY TAGGED`,
      report.hostiles ? 'sonar' : 'success',
      4000,
    );
    this.refreshAbilityUI();
    this.refreshHUD();
  }

  refundWithSiphon() {
    if (!this.game.canSiphon()) {
      if (this.game.siphonRefunds >= SIPHON_MAX_REFUNDS) {
        this.ui.toast('SIPHON LIMIT REACHED', 'Two refunds per run. Spend them well.', 'danger', 3000);
      } else {
        this.ui.toast(
          'SALVAGE INSUFFICIENT',
          `${this.game.siphonTokens}/${SIPHON_TOKENS_PER_REFUND} tokens banked. Flag hostiles to earn more.`,
          'danger',
          3200,
        );
      }
      this.audio.playUi('error');
      return;
    }

    const target = this.findRefundTarget();
    if (!target) {
      this.ui.toast('ALL SYSTEMS CHARGED', 'Nothing to restore right now.', 'info', 2800);
      this.audio.playUi('error');
      return;
    }

    const spend = this.game.spendSiphon();
    if (!spend.ok) return;
    this.restoreCharge(target);
    this.audio.playSiphon();
    this.scene.siphonFx();
    this.ui.log(
      `DATA SIPHON // ${this.abilityLabel(target)} CHARGE RESTORED`,
      'siphon',
      this.game.elapsedSeconds(),
    );
    this.ui.toast(
      'CHARGE RESTORED',
      `${this.abilityLabel(target)} // ${spend.refundsLeft} REFUND${spend.refundsLeft === 1 ? '' : 'S'} LEFT`,
      'siphon',
      3400,
    );
    this.refreshAbilityUI();
    this.refreshHUD();
  }

  findRefundTarget() {
    const order = [this.lastSpent, 'scan', 'defuse', 'sonar', 'ghost'].filter(Boolean);
    for (const type of new Set(order)) {
      if (type === 'ghost') {
        if (this.game.ghostShield < 1) return type;
        continue;
      }
      const max = this.maxCharges[type] ?? 0;
      if (this.charges[type] < max) return type;
    }
    return null;
  }

  restoreCharge(type) {
    if (type === 'ghost') {
      this.game.armGhost();
      return;
    }
    const max = this.maxCharges[type] ?? 0;
    this.charges[type] = Math.min(max, this.charges[type] + 1);
  }

  refreshAbilityUI() {
    this.ui.setAbilities(
      this.charges.scan,
      this.charges.defuse,
      this.game?.phase === 'playing',
      this.abilityExtra(),
    );
  }

  toggleFlagMode() {
    if (!this.hasStarted) return;
    this.flagMode = !this.flagMode;
    this.ui.setFlagMode(this.flagMode);
    this.audio.playUi('click');
    if (this.flagMode) {
      this.ui.toast('FLAG MODE ENGAGED', 'Left click / tap to tag hostiles.', 'info', 2600);
    }
  }

  refreshHUD() {
    if (!this.ui || !this.game) return;
    const phase = this.game.phase;
    const threat = this.computeThreat();
    this.ui.setHUD({
      time: this.game.elapsedSeconds(),
      mines: this.game.remainingMines,
      score: this.game.getScore(),
      threat,
      phase,
    });
    this.scene?.setThreat(threat);
    if (phase === 'playing') this.refreshAbilityUIIfNeeded();
  }

  refreshAbilityUIIfNeeded() {
    const available = this.game.phase === 'playing';
    this.ui.setAbilities(this.charges.scan, this.charges.defuse, available, this.abilityExtra());
  }

  computeThreat() {
    if (!this.game) return 0;
    if (this.game.phase === 'won') return 0;
    const hidden = Math.max(1, this.game.hiddenRemaining);
    return clamp(this.game.remainingMines / hidden, 0, 1);
  }

  startHudTicker() {
    clearInterval(this.hudTimer);
    this.hudTimer = setInterval(() => {
      if (!this.game) return;
      if (this.game.phase === 'playing' || this.game.phase === 'won' || this.game.phase === 'lost') {
        this.refreshHUD();
      }
    }, 260);
  }

  /* ————————————————————————— input ————————————————————————— */

  bindInput() {
    const canvas = this.scene.canvas;
    canvas.style.cursor = 'grab';

    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('auxclick', (event) => {
      if (event.button === 1) event.preventDefault();
    });

    canvas.addEventListener('pointerdown', (event) => {
      if (!this.canInteract()) return;
      if (event.button === 1) event.preventDefault();
      const index = this.scene.pick(event.clientX, event.clientY);
      this.pointer = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        time: performance.now(),
        index,
        button: event.button,
        pointerType: event.pointerType,
        moved: false,
        longPressFired: false,
        longPressTimer: null,
      };
      if (event.pointerType === 'touch' && index >= 0 && !this.flagMode) {
        this.pointer.longPressTimer = setTimeout(() => {
          if (!this.pointer || this.pointer.moved || !this.canInteract()) return;
          this.pointer.longPressFired = true;
          this.doFlag(index);
          this.audio.playUi('back');
          navigator.vibrate?.(18);
        }, 430);
        canvas.style.cursor = 'grabbing';
      }
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!this.pointer) return;
      if (Math.hypot(event.clientX - this.pointer.x, event.clientY - this.pointer.y) > 9) {
        this.pointer.moved = true;
        clearTimeout(this.pointer.longPressTimer);
      }
    });

    const finish = (event) => {
      const pointer = this.pointer;
      if (!pointer) return;
      clearTimeout(pointer.longPressTimer);
      this.pointer = null;
      canvas.style.cursor = 'grab';
      if (!this.canInteract()) return;
      if (pointer.longPressFired) return;
      const moved = Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y);
      if (pointer.moved || moved > 9) return;

      const index = this.scene.pick(event.clientX, event.clientY);
      if (index < 0) return;

      if (pointer.pointerType === 'touch') {
        if (this.flagMode && !this.sonarArmed) this.doFlag(index);
        else this.doReveal(index);
        return;
      }

      if (event.button === 0) {
        if (event.shiftKey) this.doFlag(index);
        else this.doReveal(index);
      } else if (event.button === 2) {
        this.doFlag(index);
      } else if (event.button === 1) {
        this.doChord(index);
      }
    };

    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', () => {
      if (this.pointer) clearTimeout(this.pointer.longPressTimer);
      this.pointer = null;
      canvas.style.cursor = 'grab';
    });

    window.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  onKeyDown(event) {
    if (event.repeat) return;
    if (this.ui.isModalOpen()) return;
    const key = event.key.toLowerCase();
    const endOpen = !document.getElementById('end-screen').classList.contains('is-hidden');

    if (!this.hasStarted) return;

    if (key === 'm') {
      this.toggleMusic();
      return;
    }
    if (key === 's') {
      this.toggleSfx();
      return;
    }
    if (key === 'r' || key === 'n') {
      event.preventDefault();
      if (endOpen) this.ui.hideEnd();
      this.newRun();
      return;
    }
    if (key === '1' || key === '2' || key === '3') {
      const preset = PRESETS[Number(key) - 1];
      if (preset) {
        if (endOpen) this.ui.hideEnd();
        this.selectPreset(preset.id);
      }
      return;
    }
    if (key === 'c') {
      if (endOpen) this.ui.hideEnd();
      this.openCustom();
      return;
    }
    if (key === 'f') {
      this.toggleFlagMode();
      return;
    }
    if (key === 'escape' && this.sonarArmed) {
      this.setSonarArmed(false);
      this.audio.playUi('back');
      this.ui.toast('SONAR PING // STANDBY', 'Sweep cancelled. Charge retained.', 'info', 2200);
      return;
    }
    if (!this.canInteract()) return;
    if (key === 'q') {
      this.useAbility('scan');
    } else if (key === 'e') {
      this.useAbility('defuse');
    } else if (key === 't') {
      this.useAbility('sonar');
    } else if (key === 'g') {
      this.useAbility('ghost');
    } else if (key === 'x') {
      this.useAbility('siphon');
    }
  }

  /* ————————————————————————— audio ————————————————————————— */

  toggleMusic() {
    this.settings.music = !this.settings.music;
    this.audio.setMusicEnabled(this.settings.music);
    this.ui.setAudioState({ music: this.settings.music });
    this.saveSettings();
    this.ui.toast(
      this.settings.music ? 'SOUNDTRACK ONLINE' : 'SOUNDTRACK MUTED',
      this.settings.music ? 'Synthwave feed restored.' : 'Silence is also a weapon.',
      'info',
      2200,
    );
  }

  toggleSfx() {
    this.settings.sfx = !this.settings.sfx;
    this.audio.setSfxEnabled(this.settings.sfx);
    this.ui.setAudioState({ sfx: this.settings.sfx });
    this.saveSettings();
    if (this.settings.sfx) this.audio.playUi('click');
    this.ui.toast(
      this.settings.sfx ? 'SFX ONLINE' : 'SFX MUTED',
      this.settings.sfx ? 'Impact audio armed.' : 'All effects silenced.',
      'info',
      2000,
    );
  }

  setMusicVolume(value) {
    this.settings.musicVolume = Math.round(value * 100);
    this.audio.setMusicVolume(value);
    this.saveSettings();
  }

  setSfxVolume(value) {
    this.settings.sfxVolume = Math.round(value * 100);
    this.audio.setSfxVolume(value);
    this.saveSettings();
  }

  onVisibilityChange() {
    if (!this.audio.ready) return;
    if (document.hidden) {
      this.audio.pauseAll();
    } else if (this.hasStarted) {
      this.audio.resumeAll();
    }
  }
}

const app = new NeonSweeperApp();
app.init().catch((error) => {
  console.error(error);
  const fatal = document.getElementById('fatal');
  const message = document.getElementById('fatal-message');
  if (fatal && message) {
    message.textContent = error?.message || 'Uplink initialization failed.';
    fatal.classList.remove('is-hidden');
  }
});

window.__NEONSWEEPER__ = app;
