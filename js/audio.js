/* ------------------------------------------------------------------ *
 *  NEONSWEEPER // audio engine
 *  A fully procedural cyberpunk soundtrack + synth SFX. No assets.
 * ------------------------------------------------------------------ */

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

const BPM = 126;
const STEP = 60 / BPM / 4; // 16th note

const PROGRESSION = [
  { root: 38, chord: [50, 53, 57], arp: [62, 65, 69, 72, 77, 81] }, // Dm
  { root: 34, chord: [46, 50, 53], arp: [58, 62, 65, 70, 74, 77] }, // Bb
  { root: 36, chord: [48, 52, 55], arp: [60, 64, 67, 72, 74, 79] }, // C
  { root: 31, chord: [43, 50, 55], arp: [55, 58, 62, 67, 70, 74] }, // Gm
];

const ARP_PATTERN = [0, null, 2, 1, null, 3, 4, null, 2, 1, null, 5, 3, null, 2, 4];
const BASS_PATTERN = [0, null, 0, 12, null, 0, 7, null, 0, null, 3, 0, 10, null, 0, 12];
const KICK_STEPS = new Set([0, 3, 4, 8, 10, 12, 14]);
const SNARE_STEPS = new Set([4, 12]);
const LEAD_PATTERN = [
  null, null, null, null, null, null, null, null,
  null, 0, null, null, 2, null, null, null,
  null, null, null, null, 3, null, 2, null,
  null, null, 4, null, null, null, 1, null,
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.musicEnabled = true;
    this.sfxEnabled = true;
    this.musicPlaying = false;
    this.musicVolume = 0.55;
    this.sfxVolume = 0.7;
    this.step = 0;
    this.nextTime = 0;
    this.schedulerId = null;
    this.noiseBuffer = null;
    this.musicPaused = false;
  }

  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return true;
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;

    this.ctx = new Ctx();
    const ctx = this.ctx;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.knee.value = 22;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.24;
    this.compressor.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.compressor);

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.master);

    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = this.sfxVolume * 0.8;
    this.sfxGain.connect(this.master);

    this.drumBus = ctx.createGain();
    this.drumBus.gain.value = 0.9;
    this.drumBus.connect(this.musicGain);

    // Pumped bus for tonal parts (bass / pads / arps).
    this.sidechain = ctx.createGain();
    this.sidechain.gain.value = 1;
    this.sidechain.connect(this.musicGain);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.4, 3.2);
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.22;
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.master);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.reverbSend.connect(this.reverb);

    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = STEP * 3;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.33;
    this.delayFilter = ctx.createBiquadFilter();
    this.delayFilter.type = 'bandpass';
    this.delayFilter.frequency.value = 1800;
    this.delayFilter.Q.value = 0.6;
    this.delayReturn = ctx.createGain();
    this.delayReturn.gain.value = 0.16;
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 1;
    this.delaySend.connect(this.delay);
    this.delay.connect(this.delayFilter);
    this.delayFilter.connect(this.delayReturn);
    this.delayReturn.connect(this.musicGain);
    this.delayFilter.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delay);

    this.noiseBuffer = this.makeNoise(2.2);

    this.ready = true;
    if (this.musicEnabled && !this.musicPaused) this.startMusic();
    return true;
  }

  makeNoise(seconds) {
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buffer;
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (!this.ctx) return;
    const level = this.musicEnabled && this.musicPlaying ? v * 0.55 : 0;
    this.musicGain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.08);
  }

  setSfxVolume(v) {
    this.sfxVolume = v;
    if (!this.ctx) return;
    this.sfxGain.gain.setTargetAtTime(this.sfxEnabled ? v * 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  setMusicEnabled(enabled) {
    this.musicEnabled = enabled;
    if (!this.ctx) return;
    if (enabled && !this.musicPaused) this.startMusic();
    else this.stopMusic();
  }

  setSfxEnabled(enabled) {
    this.sfxEnabled = enabled;
    if (!this.ctx) return;
    this.sfxGain.gain.setTargetAtTime(enabled ? this.sfxVolume * 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  startMusic() {
    if (!this.ready || !this.musicEnabled || this.musicPaused) return;
    if (this.musicPlaying) {
      this.musicGain.gain.setTargetAtTime(this.musicVolume * 0.55, this.ctx.currentTime, 0.25);
      return;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.musicPlaying = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.musicGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    this.musicGain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, this.musicVolume * 0.55),
      this.ctx.currentTime + 1.1,
    );

    this.schedulerId = window.setInterval(() => this.scheduleAhead(), 25);
    this.scheduleAhead();
  }

  stopMusic(fade = 0.5) {
    if (!this.ctx) return;
    this.musicPlaying = false;
    if (this.schedulerId) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    this.musicGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, fade / 3);
  }

  duckMusic(ducked) {
    if (!this.ctx || !this.musicPlaying) return;
    const level = ducked ? this.musicVolume * 0.16 : this.musicVolume * 0.55;
    this.musicGain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.4);
  }

  pauseAll() {
    if (!this.ctx) return;
    this.musicPaused = true;
    this.stopMusic(0.2);
    this.ctx.suspend?.();
  }

  resumeAll() {
    if (!this.ctx) return;
    this.musicPaused = false;
    this.ctx.resume?.();
    if (this.musicEnabled) {
      this.nextTime = this.ctx.currentTime + 0.1;
      this.startMusic();
    }
  }

  scheduleAhead() {
    if (!this.ctx || !this.musicPlaying) return;
    const now = this.ctx.currentTime;
    if (this.nextTime < now - 0.4) this.nextTime = now + 0.05;

    while (this.nextTime < now + 0.14) {
      this.scheduleStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step++;
    }
  }

  scheduleStep(step, time) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chordIndex = bar % 4;
    const phrase = PROGRESSION[chordIndex];
    const section = Math.floor(bar / 8) % 2;

    // — drums ——————————————————————————————————————————————
    if (KICK_STEPS.has(s)) {
      const ghost = s === 3 || s === 7 || s === 10 || s === 14;
      this.kick(time, ghost ? 0.35 : 0.9);
      if (!ghost) this.pump(time);
    }
    if (SNARE_STEPS.has(s)) this.snare(time, s === 12 ? 0.5 : 0.42);

    if (s % 2 === 1) this.hat(time, 0.05 + Math.random() * 0.03, false, (s % 4) ? 0.3 : -0.3);
    if (s === 6 || s === 14) this.hat(time, 0.08, true, 0.1);
    if (s === 11 && bar % 2 === 1) this.snare(time, 0.18, true);

    if (bar % 8 === 7 && s >= 12) this.snare(time, 0.18 + (s - 12) * 0.08, true);
    if (bar % 8 === 7 && s === 8) this.riser(time);
    if (bar % 4 === 0 && s === 0) this.crash(time);

    // — bass ———————————————————————————————————————————————
    const bassNote = BASS_PATTERN[s];
    if (bassNote !== null) {
      const freq = midiToFreq(phrase.root + bassNote);
      this.bass(freq, time, STEP * 0.82, s % 4 === 0 ? 0.28 : 0.18);
    }

    // — arpeggio —————————————————————————————————————————————
    const arpIndex = ARP_PATTERN[s];
    if (arpIndex !== null) {
      const note = phrase.arp[arpIndex] + (section ? 12 : 0);
      this.arp(midiToFreq(note), time, STEP * 1.6, 0.055, s);
    }

    // — pad at every bar —————————————————————————————————————
    if (s === 0) {
      this.pad(phrase.chord, time, STEP * 16 * 1.05);
      if (section === 1) this.subDrone(midiToFreq(phrase.root - 12), time, STEP * 16 * 1.1);
    }

    // — lead melody in the second half of each 8-bar phrase —————
    if (section === 1) {
      const leadIndex = LEAD_PATTERN[s];
      if (leadIndex !== null && bar % 2 === 1) {
        const note = phrase.arp[leadIndex] + 12;
        this.lead(midiToFreq(note), time, STEP * 2.2);
      }
    }
  }

  pump(time) {
    const g = this.sidechain.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(1, time);
    g.linearRampToValueAtTime(0.42, time + 0.012);
    g.exponentialRampToValueAtTime(1, time + 0.2);
  }

  kick(time, velocity = 1) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const click = ctx.createBufferSource();
    const clickGain = ctx.createGain();
    const clickFilter = ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, time);
    osc.frequency.exponentialRampToValueAtTime(44, time + 0.11);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(velocity, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.34);
    osc.connect(gain);
    gain.connect(this.drumBus);
    osc.start(time);
    osc.stop(time + 0.36);

    click.buffer = this.noiseBuffer;
    clickGain.gain.setValueAtTime(velocity * 0.14, time);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.02);
    clickFilter.type = 'highpass';
    clickFilter.frequency.value = 2200;
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(this.drumBus);
    click.start(time, Math.random() * 1.5, 0.03);
  }

  snare(time, velocity = 0.4, ghost = false) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();

    src.buffer = this.noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.value = ghost ? 2400 : 1700;
    filter.Q.value = 0.8;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(velocity, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + (ghost ? 0.08 : 0.19));
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.drumBus);
    const send = ctx.createGain();
    send.gain.value = 0.18;
    gain.connect(send);
    send.connect(this.reverbSend);
    src.start(time, Math.random(), 0.22);

    body.type = 'triangle';
    body.frequency.setValueAtTime(190, time);
    body.frequency.exponentialRampToValueAtTime(120, time + 0.09);
    bodyGain.gain.setValueAtTime(velocity * 0.45, time);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.1);
    body.connect(bodyGain);
    bodyGain.connect(this.drumBus);
    body.start(time);
    body.stop(time + 0.12);
  }

  hat(time, velocity, open, pan = 0) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();

    src.buffer = this.noiseBuffer;
    filter.type = 'highpass';
    filter.frequency.value = open ? 7600 : 9200;
    gain.gain.setValueAtTime(velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + (open ? 0.18 : 0.035));
    panner.pan.value = pan;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.drumBus);
    src.start(time, Math.random() * 1.8, open ? 0.2 : 0.05);
  }

  crash(time) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = this.noiseBuffer;
    filter.type = 'highpass';
    filter.frequency.value = 5200;
    gain.gain.setValueAtTime(0.08, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.9);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.drumBus);
    const send = ctx.createGain();
    send.gain.value = 0.2;
    gain.connect(send);
    send.connect(this.reverbSend);
    src.start(time, Math.random(), 1.1);
  }

  riser(time) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const duration = STEP * 8;
    src.buffer = this.noiseBuffer;
    filter.type = 'bandpass';
    filter.Q.value = 1.5;
    filter.frequency.setValueAtTime(300, time);
    filter.frequency.exponentialRampToValueAtTime(7800, time + duration);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.055, time + duration * 0.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    gain.connect(this.reverbSend);
    src.start(time, Math.random(), duration + 0.1);
  }

  bass(freq, time, duration, velocity) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    sub.type = 'square';
    sub.frequency.value = freq / 2;
    filter.type = 'lowpass';
    filter.Q.value = 7;
    filter.frequency.setValueAtTime(180, time);
    filter.frequency.exponentialRampToValueAtTime(1250, time + 0.035);
    filter.frequency.exponentialRampToValueAtTime(260, time + duration);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(velocity, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(this.sidechain);
    osc.start(time);
    sub.start(time);
    osc.stop(time + duration + 0.03);
    sub.stop(time + duration + 0.03);
  }

  arp(freq, time, duration, velocity, step) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const panner = ctx.createStereoPanner();

    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc2.type = 'square';
    osc2.frequency.value = freq * 1.005;
    osc2.detune.value = 3;
    filter.type = 'lowpass';
    filter.frequency.value = 3800;
    filter.Q.value = 1.2;
    panner.pan.value = step % 2 ? 0.26 : -0.26;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(velocity, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.sidechain);
    const send = ctx.createGain();
    send.gain.value = 0.28;
    gain.connect(send);
    send.connect(this.delaySend);
    send.connect(this.reverbSend);

    osc.start(time);
    osc2.start(time);
    osc.stop(time + duration + 0.02);
    osc2.stop(time + duration + 0.02);
  }

  pad(chord, time, duration) {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = 'lowpass';
    filter.frequency.value = 720;
    filter.Q.value = 1.8;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.055, time + 0.5);
    gain.gain.linearRampToValueAtTime(0.042, time + duration * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    chord.forEach((note, i) => {
      const osc = ctx.createOscillator();
      const detune = ctx.createOscillator();
      osc.type = i === 0 ? 'sawtooth' : 'triangle';
      detune.type = 'sawtooth';
      osc.frequency.value = midiToFreq(note);
      detune.frequency.value = midiToFreq(note + 12);
      detune.detune.value = 9;
      const panner = ctx.createStereoPanner();
      panner.pan.value = (i - 1) * 0.5;
      osc.connect(panner);
      detune.connect(panner);
      panner.connect(filter);
      osc.start(time);
      detune.start(time);
      osc.stop(time + duration + 0.1);
      detune.stop(time + duration + 0.1);
    });

    filter.connect(gain);
    gain.connect(this.sidechain);
    const send = ctx.createGain();
    send.gain.value = 0.4;
    gain.connect(send);
    send.connect(this.reverbSend);
  }

  subDrone(freq, time, duration) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.05, time + 0.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(gain);
    gain.connect(this.sidechain);
    osc.start(time);
    osc.stop(time + duration);
  }

  lead(freq, time, duration) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = 'square';
    osc.frequency.value = freq;
    osc2.type = 'sawtooth';
    osc2.frequency.value = freq * 0.5;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(5200, time);
    filter.frequency.exponentialRampToValueAtTime(1400, time + duration);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.055, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.sidechain);
    const send = ctx.createGain();
    send.gain.value = 0.4;
    gain.connect(send);
    send.connect(this.delaySend);
    send.connect(this.reverbSend);
    osc.start(time);
    osc2.start(time);
    osc.stop(time + duration + 0.05);
    osc2.stop(time + duration + 0.05);
  }

  /* ————————————————————————— SFX ————————————————————————— */

  tone(freq, time, duration, type = 'triangle', volume = 0.12, dest = null, endFreq = null) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), time + duration);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(gain);
    gain.connect(dest || this.sfxGain);
    osc.start(time);
    osc.stop(time + duration + 0.03);
    return gain;
  }

  noise(time, duration, volume, type = 'bandpass', frequency = 1200, q = 1, endFreq = null) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = this.noiseBuffer;
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, time);
    if (endFreq) filter.frequency.exponentialRampToValueAtTime(endFreq, time + duration);
    filter.Q.value = q;
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.start(time, Math.random() * 1.6, duration + 0.05);
    return gain;
  }

  canSfx() {
    return this.ready && this.sfxEnabled && this.ctx && this.ctx.state === 'running';
  }

  playUi(kind = 'click') {
    if (!this.canSfx()) return;
    const t = this.ctx.currentTime + 0.005;
    if (kind === 'hover') {
      this.tone(1760, t, 0.025, 'sine', 0.012);
    } else if (kind === 'back') {
      this.tone(420, t, 0.07, 'triangle', 0.06, null, 240);
    } else if (kind === 'error') {
      this.tone(130, t, 0.16, 'square', 0.08, null, 90);
      this.tone(124, t + 0.06, 0.16, 'sawtooth', 0.04, null, 80);
    } else {
      this.tone(880, t, 0.055, 'triangle', 0.055, null, 1320);
      this.tone(1320, t + 0.02, 0.04, 'sine', 0.03, null, 1760);
    }
  }

  playReveal(adjacent = 0, cellCount = 1) {
    if (!this.canSfx()) return;
    const t = this.ctx.currentTime + 0.01;
    if (cellCount > 10) {
      const notes = [523, 659, 784, 1046];
      notes.forEach((f, i) => this.tone(f, t + i * 0.035, 0.1, 'triangle', 0.045, null, f * 1.5));
      this.noise(t, 0.2, 0.025, 'highpass', 5200);
    } else if (cellCount > 1) {
      this.tone(523, t, 0.06, 'triangle', 0.05);
      this.tone(784, t + 0.04, 0.09, 'triangle', 0.035);
    } else {
      const base = adjacent === 0 ? 392 : 440 + adjacent * 55;
      this.tone(base, t, 0.08, 'triangle', 0.06, null, base * 1.18);
      this.noise(t, 0.035, 0.012, 'highpass', 6000);
    }
  }

  playFlag(flagged = true) {
    if (!this.canSfx()) return;
    const t = this.ctx.currentTime + 0.005;
    if (flagged) {
      this.tone(1174, t, 0.045, 'square', 0.04);
      this.tone(1568, t + 0.04, 0.06, 'triangle', 0.035, null, 2093);
      this.noise(t, 0.04, 0.022, 'bandpass', 3200, 2);
    } else {
      this.tone(1174, t, 0.06, 'triangle', 0.04, null, 587);
      this.noise(t, 0.03, 0.014, 'bandpass', 2200, 2);
    }
  }

  playExplosion() {
    if (!this.canSfx()) return;
    const t = this.ctx.currentTime + 0.01;
    const sub = this.tone(96, t, 1.15, 'sine', 0.42, null, 28);
    const send = this.ctx.createGain();
    send.gain.value = 0.5;
    sub.connect(send);
    send.connect(this.reverbSend);
    this.noise(t, 0.9, 0.32, 'lowpass', 2200, 0.8, 90);
    this.noise(t + 0.02, 0.35, 0.16, 'highpass', 1800);
    this.tone(300, t + 0.02, 0.45, 'sawtooth', 0.07, null, 45);
  }

  playScan() {
    if (!this.canSfx()) return;
    const t = this.ctx.currentTime + 0.01;
    this.tone(220, t, 0.6, 'sawtooth', 0.05, null, 1760);
    this.tone(880, t + 0.12, 0.45, 'triangle', 0.04, null, 2640);
    this.noise(t, 0.6, 0.035, 'bandpass', 800, 4, 5200);
  }

  playDefuse() {
    if (!this.canSfx()) return;
    const t = this.ctx.currentTime + 0.005;
    this.tone(1760, t, 0.12, 'square', 0.05, null, 220);
    this.tone(880, t + 0.08, 0.14, 'triangle', 0.04, null, 110);
    this.noise(t, 0.16, 0.04, 'bandpass', 2400, 3, 300);
  }

  playSonar() {
    if (!this.canSfx()) return;
    const t = this.ctx.currentTime + 0.01;
    this.tone(1320, t, 0.5, 'sine', 0.055, null, 660);
    this.tone(660, t + 0.16, 0.65, 'triangle', 0.04, null, 330);
    this.noise(t, 0.55, 0.03, 'bandpass', 1400, 6, 4200);
    this.noise(t + 0.1, 0.32, 0.02, 'highpass', 3200, 2, 6800);
  }

  playGhost() {
    if (!this.canSfx()) return;
    const t = this.ctx.currentTime + 0.01;
    this.tone(520, t, 0.5, 'sine', 0.07, null, 96);
    this.tone(260, t + 0.04, 0.7, 'triangle', 0.05, null, 55);
    this.noise(t, 0.5, 0.05, 'lowpass', 900, 2, 140);
    this.tone(1040, t + 0.28, 0.2, 'sine', 0.025, null, 520);
  }

  playSiphon() {
    if (!this.canSfx()) return;
    const t = this.ctx.currentTime + 0.01;
    [659, 880, 1174, 1568].forEach((freq, i) => {
      this.tone(freq, t + i * 0.055, 0.22, 'triangle', 0.045, null, freq * 1.06);
    });
    this.noise(t, 0.4, 0.028, 'highpass', 2600, 2, 7200);
  }

  playSiphonBank() {
    if (!this.canSfx()) return;
    const t = this.ctx.currentTime + 0.005;
    this.tone(988, t, 0.09, 'triangle', 0.045);
    this.tone(1480, t + 0.07, 0.11, 'sine', 0.035, null, 1750);
  }

  playChordFail() {
    if (!this.canSfx()) return;
    const t = this.ctx.currentTime + 0.005;
    this.tone(150, t, 0.1, 'square', 0.055, null, 110);
    this.tone(150, t + 0.11, 0.12, 'square', 0.045, null, 95);
  }

  playWin() {
    if (!this.canSfx()) return;
    const t = this.ctx.currentTime + 0.03;
    const melody = [62, 65, 69, 74, 77, 81, 86];
    melody.forEach((note, i) => {
      const at = t + i * 0.11;
      this.tone(midiToFreq(note), at, 0.5, 'triangle', 0.08);
      this.tone(midiToFreq(note + 12), at, 0.35, 'sine', 0.03);
    });
    this.tone(midiToFreq(74), t + 0.9, 2.2, 'sawtooth', 0.03);
    this.tone(midiToFreq(81), t + 0.9, 2.2, 'sawtooth', 0.025);
    this.tone(midiToFreq(86), t + 0.9, 2.4, 'sawtooth', 0.02);
    this.noise(t + 0.8, 1.2, 0.03, 'highpass', 4000, 1, 9000);
    this.duckMusic(true);
  }

  playLose() {
    if (!this.canSfx()) return;
    const t = this.ctx.currentTime + 0.05;
    this.tone(220, t, 1.4, 'sawtooth', 0.06, null, 55);
    this.tone(110, t, 1.8, 'square', 0.04, null, 27);
    this.noise(t, 1.6, 0.1, 'lowpass', 1600, 1, 90);
    this.duckMusic(true);
  }

  playAbilityReady() {
    if (!this.canSfx()) return;
    const t = this.ctx.currentTime + 0.01;
    this.tone(740, t, 0.08, 'triangle', 0.04);
    this.tone(1110, t + 0.07, 0.12, 'sine', 0.035, null, 1480);
  }
}
