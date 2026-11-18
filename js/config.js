/* ------------------------------------------------------------------ *
 *  NEONSWEEPER // shared configuration
 * ------------------------------------------------------------------ */

export const PRESETS = [
  {
    id: 'rookie',
    name: 'ROOKIE',
    tag: 'TRAINING GRID',
    cols: 9,
    rows: 9,
    mines: 10,
    accent: '#23f4ff',
    threat: 'LOW',
  },
  {
    id: 'runner',
    name: 'RUNNER',
    tag: 'STANDARD ICE',
    cols: 16,
    rows: 16,
    mines: 40,
    accent: '#ff2bd6',
    threat: 'MID',
  },
  {
    id: 'blackice',
    name: 'BLACK ICE',
    tag: 'CORPO SECURITY',
    cols: 30,
    rows: 16,
    mines: 99,
    accent: '#ffd42a',
    threat: 'HIGH',
  },
];

export const DEFAULT_PRESET = 'runner';

export const NUMBER_COLORS = [
  '#ffffff',
  '#38f6ff', // 1
  '#ff3bd4', // 2
  '#ffe14d', // 3
  '#72ff89', // 4
  '#ff9d3d', // 5
  '#b46bff', // 6
  '#ff5c7a', // 7
  '#f4f8ff', // 8
];

export const FLAVOR = {
  flags: [
    'HOSTILE TAGGED',
    'TRACE BEACON LOCKED',
    'COUNTERMEASURE ARMED',
    'ICE SIGNATURE MARKED',
  ],
  unflags: [
    'BEACON RECALLED',
    'MARKER DISARMED',
    'SIGNAL RELEASED',
  ],
  reveal: [
    'NODE DECRYPTED',
    'SECTOR UNSEALED',
    'GRID FRAGMENT COMPROMISED',
    'DATA LOOTED',
    'PATH CLEARED',
  ],
  flood: [
    'MASS DECRYPT // CASCADE',
    'SUBNET BREACHED',
    'FIREWALL MELTED',
    'NODE CLUSTER OPENED',
  ],
  safe: [
    'SCAN CONFIRMS: NO HOSTILES',
    'SECTOR SANITIZED',
    'UPLINK STABLE',
  ],
  danger: [
    'TRACE DETECTED',
    'ICE PROXIMITY ALERT',
    'COUNTER-INTRUSION ACTIVE',
    'THREAT SPIKE',
  ],
};

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function randomOf(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(s / 60);
  return `${String(minutes).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function safeStorage() {
  try {
    const test = '__neon_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return localStorage;
  } catch {
    return null;
  }
}

const STORE_KEY = 'neonsweeper.stats.v1';

export function loadStats() {
  const storage = safeStorage();
  const empty = { records: {}, wins: 0, losses: 0 };
  if (!storage) return empty;
  try {
    const raw = storage.getItem(STORE_KEY);
    if (!raw) return empty;
    const data = JSON.parse(raw);
    return { ...empty, ...data, records: data.records || {} };
  } catch {
    return empty;
  }
}

export function saveStats(stats) {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(STORE_KEY, JSON.stringify(stats));
  } catch {
    /* storage full / private mode */
  }
}

export function recordKey(config, presetId) {
  if (presetId && presetId !== 'custom') return presetId;
  return `custom-${config.cols}x${config.rows}-${config.mines}`;
}

/**
 * Persist a completed run. Returns { newBest, previousBest }.
 */
export function recordRun(stats, key, { won, time, score }) {
  const previousBest = stats.records[key]?.time ?? null;
  if (won) {
    stats.wins = (stats.wins || 0) + 1;
    if (!previousBest || time < previousBest) {
      stats.records[key] = { time, score, at: Date.now() };
      saveStats(stats);
      return { newBest: true, previousBest };
    }
    stats.records[key] = {
      ...(stats.records[key] || {}),
      score: Math.max(score, stats.records[key]?.score || 0),
    };
  } else {
    stats.losses = (stats.losses || 0) + 1;
  }
  saveStats(stats);
  return { newBest: false, previousBest };
}
