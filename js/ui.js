/* ------------------------------------------------------------------ *
 *  NEONSWEEPER // UI controller (anime.js)
 * ------------------------------------------------------------------ */

import { PRESETS, formatTime, hexToRgb, clamp, loadStats } from './config.js';

const anime = window.anime;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const THREAT_COPY = {
  LOW: 'TRACE SIGNAL WEAK',
  MID: 'TRACE SIGNAL DETECTED',
  HIGH: 'COUNTER-INTRUSION ACTIVE',
  CRITICAL: 'ICE LOCK IMMINENT',
};

function threatLevel(value) {
  if (value < 0.1) return 'LOW';
  if (value < 0.2) return 'MID';
  if (value < 0.32) return 'HIGH';
  return 'CRITICAL';
}

export class GameUI {
  constructor(callbacks = {}) {
    this.cb = callbacks;
    this.el = {
      app: $('#app'),
      boot: $('#boot'),
      bootFrame: $('.boot-frame'),
      jackIn: $('#jack-in-btn'),
      hudTop: $('#hud-top'),
      hudBottom: $('#hud-bottom'),
      panelLeft: $('#panel-left'),
      panelRight: $('#panel-right'),
      timer: $('#timer'),
      mineCount: $('#mine-count'),
      score: $('#score'),
      threatFill: $('#threat-fill'),
      threatLabel: $('#threat-label'),
      threatNote: $('#threat-note'),
      threatPercent: $('#threat-percent'),
      missionLog: $('#mission-log'),
      bestList: $('#best-list'),
      bestTime: $('#best-time'),
      stabilityBars: $('#stability-bars'),
      stabilityVal: $('#stability-val'),
      tickerTrack: $('#ticker-track'),
      toastLayer: $('#toast-layer'),
      impactFlash: $('#impact-flash'),
      flagBtn: $('#flag-btn'),
      newGameBtn: $('#new-game-btn'),
      endScreen: $('#end-screen'),
      endPanel: $('#end-panel'),
      endTitle: $('#end-title'),
      endSub: $('#end-sub'),
      endStatus: $('#end-status'),
      endTime: $('#end-time'),
      endScore: $('#end-score'),
      endMines: $('#end-mines'),
      endCells: $('#end-cells'),
      endRecord: $('#end-record'),
      endCode: $('#end-code'),
      endDate: $('#end-date'),
      helpModal: $('#help-modal'),
      customModal: $('#custom-modal'),
      musicBtn: $('#music-btn'),
      sfxBtn: $('#sfx-btn'),
      fullscreenBtn: $('#fullscreen-btn'),
      scanButtons: $$('[data-ability="scan"]'),
      defuseButtons: $$('[data-ability="defuse"]'),
      sonarButtons: $$('[data-ability="sonar"]'),
      ghostButtons: $$('[data-ability="ghost"]'),
      siphonButtons: $$('[data-ability="siphon"]'),
      scanCharges: $$('[data-scan-charges]'),
      defuseCharges: $$('[data-defuse-charges]'),
      sonarCharges: $$('[data-sonar-charges]'),
      ghostCharges: $$('[data-ghost-charges]'),
      siphonTokens: $$('[data-siphon-tokens]'),
      mobileTimer: $('#m-timer'),
      mobileMines: $('#m-mines'),
      mobileScore: $('#m-score'),
      musicVolume: $('#music-volume'),
      sfxVolume: $('#sfx-volume'),
      musicVolumeVal: $('#music-volume-val'),
      sfxVolumeVal: $('#sfx-volume-val'),
      customCols: $('#custom-cols'),
      customRows: $('#custom-rows'),
      customMines: $('#custom-mines'),
      customColsVal: $('#custom-cols-val'),
      customRowsVal: $('#custom-rows-val'),
      customMinesVal: $('#custom-mines-val'),
      customDensityVal: $('#custom-density-val'),
      customMinesMax: $('#custom-mines-max'),
      customPreviewText: $('#custom-preview-text'),
      customWarn: $('#custom-warn'),
      fatal: $('#fatal'),
      fatalMessage: $('#fatal-message'),
    };

    this.presets = PRESETS;
    this.currentPreset = 'runner';
    this.currentConfig = { cols: 16, rows: 16, mines: 40 };
    this.starting = false;
    this.bootHidden = false;
    this.activeModal = null;
    this.activeOverlay = null;
    this.flagMode = false;
    this.sonarArmed = false;
    this.stats = loadStats();
    this.displayScore = 0;
    this.lastMineValue = null;
    this.lastTimer = '';
    this.audioState = { music: true, sfx: true, musicVolume: 55, sfxVolume: 70 };
    this.stabilitySegments = [];
    this.customConfig = { cols: 16, rows: 16, mines: 40 };
    this.tickerTimer = null;

    this.buildStabilityBars();
    this.bind();
    this.renderBests();
    this.setAudioState(this.audioState);
    this.setTicker(this.currentConfig);
    this.updateCustomPreview();
  }

  /* ————————————————————————— setup ————————————————————————— */

  buildStabilityBars() {
    this.el.stabilityBars.innerHTML = '';
    for (let i = 0; i < 16; i++) {
      const seg = document.createElement('i');
      this.el.stabilityBars.appendChild(seg);
      this.stabilitySegments.push(seg);
    }
  }

  bind() {
    const sound = (kind = 'click') => this.cb.onUiSound?.(kind);

    document.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (button && !button.disabled) sound('click');
    });

    $$('.diff').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.preset;
        if (preset === 'custom') {
          this.cb.onCustomOpen?.();
        } else {
          this.cb.onPreset?.(preset);
        }
      });
    });

    this.el.musicBtn.addEventListener('click', () => this.cb.onMusicToggle?.());
    this.el.sfxBtn.addEventListener('click', () => this.cb.onSfxToggle?.());
    this.el.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    $('#help-btn').addEventListener('click', () => this.openHelp());

    this.el.scanButtons.forEach((btn) =>
      btn.addEventListener('click', () => {
        if (btn.classList.contains('is-fired')) return;
        btn.classList.add('is-fired');
        setTimeout(() => btn.classList.remove('is-fired'), 450);
        this.cb.onAbility?.('scan');
      }),
    );
    this.el.defuseButtons.forEach((btn) =>
      btn.addEventListener('click', () => {
        if (btn.classList.contains('is-fired')) return;
        btn.classList.add('is-fired');
        setTimeout(() => btn.classList.remove('is-fired'), 450);
        this.cb.onAbility?.('defuse');
      }),
    );
    [
      [this.el.sonarButtons, 'sonar'],
      [this.el.ghostButtons, 'ghost'],
      [this.el.siphonButtons, 'siphon'],
    ].forEach(([buttons, type]) => {
      buttons.forEach((btn) =>
        btn.addEventListener('click', () => {
          if (btn.classList.contains('is-fired')) return;
          btn.classList.add('is-fired');
          setTimeout(() => btn.classList.remove('is-fired'), 450);
          this.cb.onAbility?.(type);
        }),
      );
    });

    this.el.flagBtn.addEventListener('click', () => this.cb.onFlagModeToggle?.());
    this.el.newGameBtn.addEventListener('click', () => {
      anime({
        targets: this.el.newGameBtn,
        scale: [1, 0.96, 1],
        duration: 380,
        easing: 'easeOutQuad',
      });
      this.cb.onNewGame?.();
    });

    this.el.jackIn.addEventListener('click', async () => {
      if (this.starting) return;
      this.starting = true;
      this.setBootLoading(true);
      try {
        await this.cb.onStart?.();
      } catch (error) {
        console.error(error);
        this.setBootLoading(false);
        this.starting = false;
        this.showFatal(error?.message || 'The grid could not be initialized.');
      }
    });

    this.el.endScreen.querySelector('#end-again').addEventListener('click', () => {
      this.hideEnd();
      this.cb.onEndAgain?.();
    });
    this.el.endScreen.querySelector('#end-change').addEventListener('click', () => {
      this.hideEnd();
      this.cb.onEndChange?.();
    });
    this.el.endScreen.querySelector('#end-close').addEventListener('click', () => this.hideEnd());

    $$('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => this.closeModal(btn.dataset.close));
    });

    [this.el.helpModal, this.el.customModal, this.el.endScreen].forEach((overlay) => {
      overlay.addEventListener('pointerdown', (event) => {
        if (event.target !== overlay) return;
        if (overlay === this.el.endScreen) this.hideEnd();
        else this.closeModal(overlay.id);
      });
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (this.activeModal) {
          this.closeModal(this.activeModal);
        } else if (!this.el.endScreen.classList.contains('is-hidden')) {
          this.hideEnd();
        }
      }
      if ((event.key === 'h' || event.key === 'H') && this.bootHidden) {
        if (this.activeModal === 'help-modal') this.closeModal('help-modal');
        else if (!this.activeModal) this.openHelp();
      }
    });

    this.bindCustomSliders();
    this.bindAudioSliders();
    document.addEventListener('fullscreenchange', () => {
      this.el.fullscreenBtn.classList.toggle('is-on', Boolean(document.fullscreenElement));
    });
  }

  bindCustomSliders() {
    const update = () => {
      const cols = Number(this.el.customCols.value);
      const rows = Number(this.el.customRows.value);
      const densityCap = Math.floor(cols * rows * 0.35);
      this.el.customMines.max = String(Math.max(5, densityCap));
      if (Number(this.el.customMines.value) > densityCap) this.el.customMines.value = String(densityCap);
      this.customConfig = {
        cols,
        rows,
        mines: Number(this.el.customMines.value),
      };
      this.updateCustomPreview();
    };
    [this.el.customCols, this.el.customRows, this.el.customMines].forEach((input) => {
      input.addEventListener('input', () => {
        this.cb.onUiSound?.('hover');
        update();
      });
    });

    $('#custom-deploy').addEventListener('click', () => {
      const config = {
        cols: clamp(Number(this.el.customCols.value), 6, 30),
        rows: clamp(Number(this.el.customRows.value), 6, 20),
        mines: Number(this.el.customMines.value),
      };
      this.closeModal('custom-modal');
      this.cb.onCustomApply?.(config);
    });
  }

  bindAudioSliders() {
    const syncMusic = () => {
      const v = Number(this.el.musicVolume.value);
      this.audioState.musicVolume = v;
      this.el.musicVolumeVal.textContent = String(v);
      this.cb.onMusicVolume?.(v / 100);
    };
    const syncSfx = () => {
      const v = Number(this.el.sfxVolume.value);
      this.audioState.sfxVolume = v;
      this.el.sfxVolumeVal.textContent = String(v);
      this.cb.onSfxVolume?.(v / 100);
    };
    this.el.musicVolume.addEventListener('input', syncMusic);
    this.el.sfxVolume.addEventListener('input', syncSfx);
  }

  /* ————————————————————————— boot ————————————————————————— */

  playBootIntro() {
    const selectors = [
      '.boot-topline', '.boot-kicker', '.boot-title', '.boot-sub',
      '.boot-brief', '.boot-meta', '.boot-bottom', '.boot-footer',
      '.boot-side',
    ];
    anime.set(selectors, { opacity: 0 });
    anime.set('.boot-frame', { opacity: 0, scale: 0.985 });
    anime.timeline({ easing: 'easeOutExpo' })
      .add({ targets: '.boot-frame', opacity: [0, 1], scale: [0.985, 1], duration: 900 })
      .add({ targets: '.boot-topline', opacity: [0, 1], translateY: [-8, 0], duration: 500 }, 250)
      .add({ targets: '.boot-kicker', opacity: [0, 1], letterSpacing: ['0.2em', '0.5em'], duration: 900 }, 400)
      .add({ targets: '.boot-title', opacity: [0, 1], scale: [1.08, 1], duration: 900 }, 460)
      .add({ targets: '.boot-sub', opacity: [0, 1], letterSpacing: ['0.1em', '0.5em'], duration: 900 }, 600)
      .add({ targets: '.boot-brief', opacity: [0, 1], translateX: [-18, 0], duration: 600 }, 800)
      .add({ targets: '.boot-line', opacity: [0, 1], translateX: [-12, 0], duration: 400, delay: anime.stagger(80) }, 900)
      .add({ targets: '.boot-meta', opacity: [0, 1], translateX: [18, 0], duration: 600 }, 900)
      .add({ targets: '.boot-meta > div', opacity: [0, 1], duration: 300, delay: anime.stagger(70) }, 1000)
      .add({ targets: '.boot-bottom', opacity: [0, 1], translateY: [16, 0], duration: 700 }, 1100)
      .add({ targets: '.boot-footer', opacity: [0, 1], duration: 600 }, 1200)
      .add({ targets: '.boot-side', opacity: [0, 0.55], duration: 800 }, 500);

    anime({
      targets: '.boot-side-left',
      translateX: [-30, 0],
      duration: 1200,
      delay: 300,
      easing: 'easeOutExpo',
    });
    anime({
      targets: '.boot-side-right',
      translateX: [30, 0],
      duration: 1200,
      delay: 300,
      easing: 'easeOutExpo',
    });

    this.pulseStartButton();
  }

  pulseStartButton() {
    if (!this.el.jackIn) return;
    anime({
      targets: this.el.jackIn,
      boxShadow: [
        '0 0 0 rgba(35,244,255,0)',
        '0 0 38px rgba(35,244,255,0.35)',
        '0 0 0 rgba(35,244,255,0)',
      ],
      duration: 2800,
      loop: true,
      easing: 'easeInOutSine',
    });
  }

  setBootLoading(loading) {
    this.el.jackIn.disabled = loading;
    this.el.jackIn.classList.toggle('is-loading', loading);
    const label = $('.start-label', this.el.jackIn);
    const sub = $('.start-sub', this.el.jackIn);
    if (loading) {
      label.textContent = 'LINKING…';
      sub.textContent = 'NEGOTIATING NEURAL HANDSHAKE';
    } else {
      label.textContent = 'JACK IN';
      sub.textContent = 'INITIATE SEQUENCE // CLICK TO ARM AUDIO';
    }
  }

  setBootMeta(config, threatLabel = 'MID') {
    const grid = $('#boot-grid');
    const mines = $('#boot-mines');
    const threat = $('#boot-threat');
    if (grid) grid.textContent = `${config.cols} × ${config.rows}`;
    if (mines) mines.textContent = String(config.mines).padStart(3, '0');
    if (threat) threat.textContent = threatLabel;
  }

  async hideBoot() {
    if (this.bootHidden) return;
    this.bootHidden = true;
    this.el.jackIn.disabled = true;

    const hudTargets = ['.hud-top', '.hud-bottom'];
    anime.set(hudTargets, { opacity: 0 });
    anime({
      targets: '.hud-top',
      opacity: [0, 1],
      translateY: [-22, 0],
      duration: 900,
      delay: 250,
      easing: 'easeOutExpo',
    });
    anime({
      targets: '.hud-bottom',
      opacity: [0, 1],
      translateY: [22, 0],
      duration: 900,
      delay: 420,
      easing: 'easeOutExpo',
    });
    anime({
      targets: '#panel-left',
      opacity: [0, 1],
      translateX: [-50, 0],
      duration: 1000,
      delay: 350,
      easing: 'easeOutExpo',
    });
    anime({
      targets: '#panel-right',
      opacity: [0, 1],
      translateX: [50, 0],
      duration: 1000,
      delay: 440,
      easing: 'easeOutExpo',
    });
    anime({
      targets: '.top-actions .icon-btn',
      opacity: [0, 1],
      scale: [0.6, 1],
      duration: 700,
      delay: anime.stagger(70, { start: 700 }),
      easing: 'easeOutBack',
    });
    anime({
      targets: '.mobile-readout',
      opacity: [0, 1],
      translateY: [-10, 0],
      duration: 700,
      delay: 500,
      easing: 'easeOutExpo',
    });
    anime({
      targets: '.ticker',
      opacity: [0, 1],
      translateY: [20, 0],
      duration: 700,
      delay: 550,
      easing: 'easeOutExpo',
    });

    await new Promise((resolve) => {
      anime({
        targets: '.boot-frame',
        opacity: [1, 0],
        scale: [1, 1.035],
        translateY: [0, -18],
        duration: 650,
        easing: 'easeInCubic',
      });
      anime({
        targets: '.overlay-boot',
        opacity: [1, 0],
        duration: 850,
        delay: 250,
        easing: 'easeInQuad',
        complete: () => {
          this.el.boot.classList.add('is-hidden');
          this.el.app.classList.remove('is-booting');
          resolve();
        },
      });
    });
  }

  showFatal(message) {
    this.el.fatalMessage.textContent = message;
    this.el.fatal.classList.remove('is-hidden');
  }

  /* ————————————————————————— presets / HUD ————————————————————————— */

  setPreset(presetId, config, accent) {
    this.setPresetVisual(presetId, config, accent);
    this.setTicker(config);
    this.setBootMeta(config);
    this.setBestTime(this.getBestForCurrent());
  }

  /** Cheap selector + accent refresh that can be painted before a board rebuild. */
  setPresetVisual(presetId, config, accent) {
    this.currentPreset = presetId;
    this.currentConfig = config;
    $$('.diff').forEach((btn) => {
      const active = btn.dataset.preset === presetId;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const customMeta = $('#custom-meta');
    if (customMeta) {
      customMeta.textContent = presetId === 'custom' ? `${config.cols}×${config.rows} · ${config.mines}` : 'TUNE GRID';
    }
    const hex = accent || this.presets.find((p) => p.id === presetId)?.accent || '#23f4ff';
    this.applyAccent(hex);
  }

  applyAccent(hex) {
    const { r, g, b } = hexToRgb(hex);
    const root = document.documentElement;
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
    root.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.16)`);
  }

  setTicker(config) {
    if (!this.el.tickerTrack) return;
    const preset = this.presets.find((p) => p.id === this.currentPreset);
    const name = preset ? preset.name : 'CUSTOM';
    const items = [
      `SECTOR ${name} ACTIVE`,
      `${config.cols}×${config.rows} GRID // ${config.mines} HOSTILE SIGNATURES`,
      'NEURAL LINK STABLE',
      'NIGHT CITY GRID DIVISION',
      'TRUST NO NODE',
      'AUDIO SYNTHESIZED IN REAL TIME',
      'FIRST BREACH GUARANTEED SAFE',
      'FIVE COUNTERMEASURES ONLINE',
      'GHOST PROTOCOL SHIELD ARMED',
      'SONAR PING SWEEPS 5×5 SECTORS',
      'DATA SIPHON RECYCLES SPENT CHARGES',
    ];
    const text = items.join(' &nbsp;◆&nbsp; ');
    this.el.tickerTrack.innerHTML = `<span class="ticker-group">${text} &nbsp;◆&nbsp; </span><span class="ticker-group" aria-hidden="true">${text} &nbsp;◆&nbsp; </span>`;
  }

  setHUD({ time, mines, score, threat, phase }) {
    const timeStr = formatTime(time);
    if (timeStr !== this.lastTimer) {
      this.lastTimer = timeStr;
      this.el.timer.textContent = timeStr;
      if (this.el.mobileTimer) this.el.mobileTimer.textContent = timeStr;
    }
    if (this.lastMineValue !== mines) {
      this.lastMineValue = mines;
      this.el.mineCount.textContent = mines < 0 ? `-${String(Math.abs(mines)).padStart(2, '0')}` : String(mines).padStart(2, '0');
      if (this.el.mobileMines) this.el.mobileMines.textContent = String(mines);
      this.bump(this.el.mineCount);
    }
    const scoreStr = String(score).padStart(5, '0');
    if (this.el.score.textContent !== scoreStr) {
      this.displayScore = score;
      this.el.score.textContent = scoreStr;
      if (this.el.mobileScore) this.el.mobileScore.textContent = String(score);
      this.bump(this.el.score, 260);
    }

    const level = threatLevel(threat);
    const pct = Math.round(clamp(threat, 0, 1) * 100);
    this.el.threatFill.style.width = `${pct}%`;
    this.el.threatLabel.textContent = level;
    this.el.threatLabel.dataset.level = level;
    this.el.threatNote.textContent = THREAT_COPY[level];
    this.el.threatPercent.textContent = `${pct}%`;
    this.el.threatFill.dataset.level = level;

    const stability = Math.round(clamp(1 - threat * 0.9, 0, 1) * 100);
    this.el.stabilityVal.textContent = `${stability}%`;
    this.el.stabilityVal.dataset.level = level;
    const lit = Math.round((stability / 100) * this.stabilitySegments.length);
    this.stabilitySegments.forEach((seg, i) => {
      seg.classList.toggle('is-on', i < lit);
      seg.classList.toggle('is-hot', i >= this.stabilitySegments.length - 3);
    });
    this.el.stabilityBars.dataset.level = level;

    if (phase) this.setPhase(phase);
  }

  bump(el, duration = 180) {
    if (!el) return;
    anime.remove(el);
    anime({
      targets: el,
      scale: [1.16, 1],
      color: ['#ffffff', ''],
      duration,
      easing: 'easeOutQuad',
    });
  }

  setPhase(phase) {
    this.el.app.dataset.phase = phase;
    const disabled = phase === 'won' || phase === 'lost';
    [
      this.el.scanButtons,
      this.el.defuseButtons,
      this.el.sonarButtons,
      this.el.ghostButtons,
      this.el.siphonButtons,
    ].forEach((buttons) => {
      buttons.forEach((btn) => {
        if (disabled) btn.classList.add('is-inactive');
        else btn.classList.remove('is-inactive');
      });
    });
  }

  setAbilities(scan, defuse, available = true, extra = {}) {
    const sonar = extra.sonar ?? 0;
    const ghost = extra.ghost ?? 0;
    const tokens = extra.tokens ?? 0;
    const goal = extra.tokenGoal ?? 3;
    const siphonReady = Boolean(extra.siphonReady);
    const siphonMaxed = Boolean(extra.siphonMaxed);

    this.el.scanCharges.forEach((el) => {
      el.textContent = `×${scan}`;
    });
    this.el.defuseCharges.forEach((el) => {
      el.textContent = `×${defuse}`;
    });
    this.el.sonarCharges.forEach((el) => {
      el.textContent = `×${sonar}`;
    });
    this.el.ghostCharges.forEach((el) => {
      el.textContent = `×${ghost}`;
    });
    this.el.siphonTokens.forEach((el) => {
      el.textContent = siphonMaxed ? 'MAX' : `${tokens}/${goal}`;
    });

    this.el.scanButtons.forEach((btn) => {
      btn.disabled = !available || scan <= 0;
      btn.classList.toggle('is-empty', scan <= 0);
    });
    this.el.defuseButtons.forEach((btn) => {
      btn.disabled = !available || defuse <= 0;
      btn.classList.toggle('is-empty', defuse <= 0);
    });
    this.el.sonarButtons.forEach((btn) => {
      btn.disabled = !available || sonar <= 0;
      btn.classList.toggle('is-empty', sonar <= 0);
    });
    this.el.ghostButtons.forEach((btn) => {
      btn.disabled = !available || ghost <= 0;
      btn.classList.toggle('is-empty', ghost <= 0);
    });
    this.el.siphonButtons.forEach((btn) => {
      btn.disabled = !available || !siphonReady;
      btn.classList.toggle('is-empty', !siphonReady);
      btn.classList.toggle('is-ready', Boolean(available) && siphonReady);
    });
  }

  setSonarArmed(armed) {
    this.sonarArmed = Boolean(armed);
    this.el.sonarButtons.forEach((btn) => btn.classList.toggle('is-armed', this.sonarArmed));
    document.body.classList.toggle('sonar-mode', this.sonarArmed);
  }

  setBestTime(seconds) {
    this.el.bestTime.textContent = Number.isFinite(seconds) ? formatTime(seconds) : '--:--';
  }

  setFlagMode(enabled) {
    this.flagMode = enabled;
    this.el.flagBtn.classList.toggle('is-active', enabled);
    this.el.flagBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    document.body.classList.toggle('flag-mode', enabled);
  }

  setAudioState({ music, sfx, musicVolume, sfxVolume }) {
    if (typeof music === 'boolean') {
      this.audioState.music = music;
      this.el.musicBtn.classList.toggle('is-on', music);
      this.el.musicBtn.setAttribute('aria-pressed', music ? 'true' : 'false');
      this.el.musicBtn.dataset.tip = music ? 'MUSIC ON // M' : 'MUSIC OFF // M';
    }
    if (typeof sfx === 'boolean') {
      this.audioState.sfx = sfx;
      this.el.sfxBtn.classList.toggle('is-on', sfx);
      this.el.sfxBtn.setAttribute('aria-pressed', sfx ? 'true' : 'false');
      this.el.sfxBtn.dataset.tip = sfx ? 'SFX ON // S' : 'SFX OFF // S';
    }
    if (typeof musicVolume === 'number') {
      this.audioState.musicVolume = musicVolume;
      this.el.musicVolume.value = String(Math.round(musicVolume));
      this.el.musicVolumeVal.textContent = String(Math.round(musicVolume));
    }
    if (typeof sfxVolume === 'number') {
      this.audioState.sfxVolume = sfxVolume;
      this.el.sfxVolume.value = String(Math.round(sfxVolume));
      this.el.sfxVolumeVal.textContent = String(Math.round(sfxVolume));
    }
  }

  /* ————————————————————————— logs / toasts ————————————————————————— */

  log(message, type = 'info', time = null) {
    const li = document.createElement('li');
    li.className = `log-entry ${type}`;
    const timeEl = document.createElement('span');
    timeEl.className = 'log-time';
    timeEl.textContent = time !== null ? `[${formatTime(time)}]` : '[--:--]';
    const msgEl = document.createElement('span');
    msgEl.className = 'log-msg';
    msgEl.textContent = message;
    li.append(timeEl, msgEl);
    this.el.missionLog.prepend(li);

    const entries = $$('.log-entry', this.el.missionLog);
    if (entries.length > 7) entries[entries.length - 1].remove();

    anime({
      targets: li,
      opacity: [0, 1],
      translateX: [18, 0],
      duration: 420,
      easing: 'easeOutExpo',
    });
  }

  clearLog() {
    this.el.missionLog.innerHTML = '';
  }

  toast(title, message = '', type = 'info', duration = 4200) {
    while (this.el.toastLayer.children.length >= 4) {
      this.el.toastLayer.firstElementChild.remove();
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const tag = document.createElement('span');
    tag.className = 'toast-tag';
    tag.textContent = type === 'danger'
      ? 'ALERT'
      : type === 'success'
        ? 'SECURED'
        : type === 'scan'
          ? 'SCAN'
          : type === 'sonar'
            ? 'SONAR'
            : type === 'ghost'
              ? 'GHOST'
              : type === 'siphon'
                ? 'SIPHON'
                : 'SYSTEM';
    const copy = document.createElement('div');
    copy.className = 'toast-copy';
    const heading = document.createElement('b');
    heading.textContent = title;
    copy.appendChild(heading);
    if (message) {
      const small = document.createElement('small');
      small.textContent = message;
      copy.appendChild(small);
    }
    const close = document.createElement('button');
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    const remove = () => {
      anime.remove(toast);
      anime({
        targets: toast,
        opacity: 0,
        translateX: 40,
        duration: 300,
        easing: 'easeInQuad',
        complete: () => toast.remove(),
      });
    };
    close.addEventListener('click', remove);
    toast.append(tag, copy, close);
    this.el.toastLayer.appendChild(toast);

    anime({
      targets: toast,
      opacity: [0, 1],
      translateX: [54, 0],
      scale: [0.96, 1],
      duration: 550,
      easing: 'easeOutExpo',
    });
    anime({
      targets: toast.querySelector('.toast-tag'),
      opacity: [1, 0.45, 1],
      duration: 1600,
      loop: 2,
      easing: 'easeInOutSine',
      delay: 300,
    });
    setTimeout(remove, duration);
  }

  /* ————————————————————————— end screen ————————————————————————— */

  showEnd(data) {
    const {
      won,
      time,
      score,
      mines,
      decryptPct,
      newBest,
      bestTime,
      runNumber,
      presetName,
    } = data;

    this.el.endScreen.classList.remove('is-hidden');
    this.el.endScreen.classList.toggle('is-win', won);
    this.el.endScreen.classList.toggle('is-loss', !won);
    this.el.endPanel.classList.toggle('is-win', won);
    this.el.endPanel.classList.toggle('is-loss', !won);
    this.el.endTitle.textContent = won ? 'SECTOR SECURED' : 'CONNECTION SEVERED';
    this.el.endTitle.dataset.text = this.el.endTitle.textContent;
    this.el.endSub.textContent = won
      ? 'ALL HOSTILES NEUTRALIZED. GRID UNDER CONTROL.'
      : 'TRACE COMPLETE. YOUR SIGNAL HAS BEEN FLATTENED.';
    this.el.endStatus.textContent = won ? 'STATUS // BREACH COMPLETE' : 'STATUS // FLATLINED';
    this.el.endStatus.className = `end-status ${won ? 'is-win' : 'is-loss'}`;
    this.el.endCode.textContent = `MISSION REPORT // ${String(runNumber || 1).padStart(3, '0')}${presetName ? ' — ' + presetName : ''}`;
    this.el.endDate.textContent = new Date().toISOString().slice(0, 10).replaceAll('-', '.');
    this.el.endTime.textContent = formatTime(time);
    this.el.endMines.textContent = String(mines);
    this.el.endCells.textContent = `${Math.round(decryptPct)}%`;

    const countObj = { value: 0 };
    this.el.endScore.textContent = '0';
    anime({
      targets: countObj,
      value: score,
      round: 1,
      duration: 1600,
      delay: 500,
      easing: 'easeOutExpo',
      update: () => {
        this.el.endScore.textContent = String(Math.round(countObj.value)).padStart(5, '0');
      },
    });

    if (newBest) {
      this.el.endRecord.classList.remove('is-hidden');
      this.el.endRecord.textContent = '★ NEW PERSONAL BEST ★';
    } else if (bestTime) {
      this.el.endRecord.classList.remove('is-hidden');
      this.el.endRecord.textContent = `PERSONAL BEST // ${formatTime(bestTime)}`;
    } else {
      this.el.endRecord.classList.add('is-hidden');
    }

    this.el.endScreen.classList.toggle('new-record', Boolean(newBest));
    anime.remove([this.el.endPanel, '.end-stats > div', '.end-actions > *', '.end-top, .end-status, .end-title, .end-sub, .end-record']);
    anime({
      targets: this.el.endScreen,
      opacity: [0, 1],
      duration: 400,
      easing: 'easeOutQuad',
    });
    anime({
      targets: this.el.endPanel,
      scale: [0.92, 1],
      translateY: [30, 0],
      opacity: [0, 1],
      duration: 800,
      easing: 'easeOutExpo',
    });
    anime({
      targets: '.end-title',
      opacity: [0, 1],
      scale: [1.12, 1],
      duration: 900,
      delay: 200,
      easing: 'easeOutExpo',
    });
    anime({
      targets: '.end-stats > div',
      opacity: [0, 1],
      translateY: [16, 0],
      duration: 600,
      delay: anime.stagger(90, { start: 380 }),
      easing: 'easeOutExpo',
    });
    anime({
      targets: '.end-actions > *',
      opacity: [0, 1],
      translateY: [12, 0],
      duration: 500,
      delay: anime.stagger(100, { start: 700 }),
      easing: 'easeOutExpo',
    });
    if (newBest) {
      anime({
        targets: this.el.endRecord,
        opacity: [0, 1],
        scale: [0.8, 1],
        duration: 800,
        delay: 1100,
        easing: 'easeOutBack',
      });
    }
    this.setMode(won ? 'victory' : 'defeat');
  }

  hideEnd() {
    if (this.el.endScreen.classList.contains('is-hidden')) return;
    anime({
      targets: this.el.endScreen,
      opacity: [1, 0],
      duration: 300,
      easing: 'easeInQuad',
      complete: () => {
        this.el.endScreen.classList.add('is-hidden');
        this.el.endScreen.style.opacity = '';
        this.setMode(null);
      },
    });
    anime({
      targets: this.el.endPanel,
      scale: 0.96,
      translateY: 16,
      duration: 300,
      easing: 'easeInQuad',
    });
  }

  setMode(mode) {
    this.el.app.classList.remove('mode-victory', 'mode-defeat');
    if (mode === 'victory') this.el.app.classList.add('mode-victory');
    else if (mode === 'defeat') this.el.app.classList.add('mode-defeat');
  }

  /* ————————————————————————— effects ————————————————————————— */

  flashImpact(kind = 'danger') {
    const flash = this.el.impactFlash;
    flash.className = `fx-impact flash-${kind}`;
    anime.remove(flash);
    anime({
      targets: flash,
      opacity: [0, kind === 'danger' ? 0.6 : kind === 'success' ? 0.34 : 0.2, 0],
      duration: kind === 'danger' ? 650 : 480,
      easing: 'easeOutQuad',
    });

    this.el.app.classList.remove('is-hit');
    void this.el.app.offsetWidth;
    this.el.app.classList.add('is-hit');
    setTimeout(() => this.el.app.classList.remove('is-hit'), 650);

    const targets = ['.hud-top', '#panel-left', '#panel-right', '.hud-bottom'];
    anime.remove(targets);
    anime({
      targets,
      translateY: [
        { value: kind === 'danger' ? 5 : 2, duration: 50 },
        { value: kind === 'danger' ? -3 : 1, duration: 60 },
        { value: 0, duration: 120 },
      ],
      duration: 240,
      easing: 'easeOutQuad',
    });
  }

  /* ————————————————————————— custom grid ————————————————————————— */

  openCustom(config = this.customConfig) {
    this.customConfig = { ...config };
    this.el.customCols.value = String(config.cols);
    this.el.customRows.value = String(config.rows);
    const cap = Math.min(Number(this.el.customMines.max), Math.floor(config.cols * config.rows * 0.35));
    this.el.customMines.value = String(Math.min(config.mines, cap));
    this.updateCustomPreview();
    this.openModal('custom-modal');
  }

  updateCustomPreview() {
    const cols = Number(this.el.customCols.value);
    const rows = Number(this.el.customRows.value);
    const mines = Number(this.el.customMines.value);
    const densityCap = Math.max(5, Math.floor(cols * rows * 0.35));
    this.el.customMines.max = String(densityCap);
    this.el.customMinesMax.textContent = `MAX ${densityCap}`;
    this.el.customColsVal.textContent = String(cols);
    this.el.customRowsVal.textContent = String(rows);
    this.el.customMinesVal.textContent = String(mines);
    const density = Math.round((mines / (cols * rows)) * 100);
    this.el.customDensityVal.textContent = `${density}%`;
    this.el.customPreviewText.textContent = `${cols} × ${rows} GRID // ${mines} HOSTILES // ${density}% DENSITY`;
    const warn = this.el.customWarn;
    if (density > 30) {
      warn.textContent = '!! DENSITY CRITICAL — EXPECT HEAVY LOSSES';
    } else if (density > 22) {
      warn.textContent = '!! HIGH DENSITY — BRING BACKUP';
    } else {
      warn.textContent = '';
    }
    this.customConfig = { cols, rows, mines };
  }

  /* ————————————————————————— modals ————————————————————————— */

  openModal(id) {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    if (this.activeModal && this.activeModal !== id) {
      const prev = document.getElementById(this.activeModal);
      if (prev) prev.classList.add('is-hidden');
    }
    this.activeModal = id;
    overlay.classList.remove('is-hidden');
    overlay.setAttribute('aria-hidden', 'false');
    this.cb.onModalChange?.(true, id);
    const modal = $('.modal', overlay);
    anime.remove([overlay, modal]);
    anime({
      targets: overlay,
      opacity: [0, 1],
      duration: 300,
      easing: 'easeOutQuad',
    });
    anime({
      targets: modal,
      opacity: [0, 1],
      scale: [0.95, 1],
      translateY: [18, 0],
      duration: 550,
      easing: 'easeOutExpo',
    });
  }

  closeModal(id = this.activeModal) {
    if (!id) return;
    const overlay = document.getElementById(id);
    if (!overlay) return;
    const modal = $('.modal', overlay);
    anime.remove([overlay, modal]);
    anime({
      targets: modal,
      opacity: [1, 0],
      scale: 0.97,
      translateY: 10,
      duration: 220,
      easing: 'easeInQuad',
    });
    anime({
      targets: overlay,
      opacity: [1, 0],
      duration: 260,
      easing: 'easeInQuad',
      complete: () => {
        overlay.classList.add('is-hidden');
        overlay.removeAttribute('aria-hidden');
        overlay.style.opacity = '';
        if (modal) modal.style = '';
        this.cb.onModalChange?.(false, id);
      },
    });
    if (this.activeModal === id) this.activeModal = null;
  }

  openHelp() {
    this.openModal('help-modal');
  }

  isModalOpen() {
    return Boolean(this.activeModal);
  }

  /* ————————————————————————— best runs / audio ————————————————————————— */

  getBestForCurrent() {
    if (!this.stats || !this.stats.records) return null;
    if (this.currentPreset === 'custom') {
      return this.stats.records[`custom-${this.currentConfig.cols}x${this.currentConfig.rows}-${this.currentConfig.mines}`]?.time ?? null;
    }
    return this.stats.records[this.currentPreset]?.time ?? null;
  }

  renderBests(stats = this.stats) {
    this.stats = stats;
    if (!this.el.bestList) return;
    this.el.bestList.innerHTML = '';
    const rows = this.presets.map((preset) => {
      const record = stats.records?.[preset.id];
      return { name: preset.name, time: record?.time ?? null };
    });
    const bestCustomKey = Object.keys(stats.records || {}).find((key) => key.startsWith('custom-'));
    if (bestCustomKey) {
      rows.push({ name: 'CUSTOM', time: stats.records[bestCustomKey].time });
    }
    rows.slice(0, 4).forEach((row) => {
      const div = document.createElement('div');
      div.className = 'best-row';
      const name = document.createElement('span');
      name.textContent = row.name;
      const time = document.createElement('b');
      time.textContent = Number.isFinite(row.time) ? formatTime(row.time) : '--:--';
      if (Number.isFinite(row.time)) div.classList.add('has-record');
      div.append(name, time);
      this.el.bestList.appendChild(div);
    });
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.();
    }
  }
}
