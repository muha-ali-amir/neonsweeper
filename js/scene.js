/* ------------------------------------------------------------------ *
 *  NEONSWEEPER // three.js scene
 * ------------------------------------------------------------------ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildTextures } from './textures.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function mulberry32(a) {
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CyberGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGlitch: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGlitch;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 center = uv - 0.5;
      float dist = length(center);
      vec2 dir = normalize(center + vec2(0.00001));

      // chromatic aberration, stronger toward the edges
      float ca = 0.0008 + uGlitch * 0.012;
      float edge = 0.25 + dist;
      vec2 uvR = uv + dir * ca * edge;
      vec2 uvB = uv - dir * ca * edge;

      // horizontal glitch bands
      float bandRow = floor(uv.y * 54.0);
      float band = step(0.83, hash(vec2(bandRow, floor(uTime * 15.0))));
      float shift = (hash(vec2(bandRow, floor(uTime * 8.0))) - 0.5) * 0.16 * uGlitch * band;
      uvR.x += shift;
      uvB.x -= shift * 0.65;

      vec3 col;
      col.r = texture2D(tDiffuse, uvR).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uvB).b;

      // scanlines
      float scan = sin(uv.y * 1200.0 + uTime * 5.0) * 0.5 + 0.5;
      col *= 1.0 - scan * 0.022;

      // slow bright scanline
      float sweep = smoothstep(0.996, 1.0, sin((uv.y + uTime * 0.055) * 6.28318));
      col += vec3(0.05, 0.16, 0.20) * sweep;

      // vignette
      float vig = smoothstep(0.92, 0.28, dist);
      col *= mix(0.52, 1.0, vig);

      // film grain
      float grain = hash(uv * uResolution * 0.5 + uTime * 13.0) - 0.5;
      col += grain * (0.018 + uGlitch * 0.09);

      // glitch color tearing
      col.r += band * uGlitch * 0.10;
      col.b += band * uGlitch * 0.16;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/* ————————————————————————————— sparks ————————————————————————————— */

class SparkPool {
  constructor(scene, glowTexture, max = 1100) {
    this.max = max;
    this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.base = new Float32Array(max * 3);
    this.gravity = new Float32Array(max);

    for (let i = 0; i < max; i++) {
      this.pos[i * 3 + 1] = -999;
      this.col[i * 3] = 0;
      this.col[i * 3 + 1] = 0;
      this.col[i * 3 + 2] = 0;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));

    const material = new THREE.PointsMaterial({
      size: 0.17,
      map: glowTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      sizeAttenuation: true,
      toneMapped: false,
      alphaTest: 0.001,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.tmpColor = new THREE.Color();
  }

  spawn(x, y, z, color, count = 24, speed = 3.2, opts = {}) {
    const spread = opts.spread ?? 1;
    const upward = opts.upward ?? 1.4;
    const life = opts.life ?? 0.9;
    const gravity = opts.gravity ?? 5.5;
    this.tmpColor.set(color);

    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const i3 = i * 3;
      this.pos[i3] = x + (Math.random() - 0.5) * 0.25;
      this.pos[i3 + 1] = y + (Math.random() - 0.5) * 0.2;
      this.pos[i3 + 2] = z + (Math.random() - 0.5) * 0.25;

      const theta = Math.random() * TAU;
      const phi = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.25 + Math.random() * 0.95) * spread;
      this.vel[i3] = Math.sin(phi) * Math.cos(theta) * s;
      this.vel[i3 + 1] = Math.abs(Math.cos(phi)) * s * upward;
      this.vel[i3 + 2] = Math.sin(phi) * Math.sin(theta) * s;

      const shade = 0.65 + Math.random() * 0.55;
      this.base[i3] = this.tmpColor.r * shade;
      this.base[i3 + 1] = this.tmpColor.g * shade;
      this.base[i3 + 2] = this.tmpColor.b * shade;
      this.col[i3] = this.base[i3];
      this.col[i3 + 1] = this.base[i3 + 1];
      this.col[i3 + 2] = this.base[i3 + 2];
      this.maxLife[i] = life * (0.55 + Math.random() * 0.9);
      this.life[i] = this.maxLife[i];
      this.gravity[i] = gravity;
    }
  }

  update(dt) {
    let dirty = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      dirty = true;
      const i3 = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i3 + 1] = -999;
        this.col[i3] = 0;
        this.col[i3 + 1] = 0;
        this.col[i3 + 2] = 0;
        continue;
      }
      this.vel[i3 + 1] -= this.gravity[i] * dt;
      this.vel[i3] *= 1 - 0.9 * dt;
      this.vel[i3 + 2] *= 1 - 0.9 * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const k = Math.pow(this.life[i] / this.maxLife[i], 1.1);
      this.col[i3] = this.base[i3] * k;
      this.col[i3 + 1] = this.base[i3 + 1] * k;
      this.col[i3 + 2] = this.base[i3 + 2] * k;
    }
    if (dirty) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }
  }
}

/* ————————————————————————————— scene ————————————————————————————— */

export class GameScene {
  constructor(container, opts = {}) {
    this.container = container;
    this.getInsets = opts.getInsets || (() => ({ left: 0, right: 0, top: 0, bottom: 0 }));
    this.time = 0;
    this.cols = 9;
    this.rows = 9;
    this.cellCount = 81;
    this.spacing = 1;
    this.tiles = [];
    this.hovered = -1;
    this.accent = new THREE.Color('#23f4ff');
    this.accentHex = '#23f4ff';
    this.interactive = false;
    this.introActive = true;
    this.introEndTime = 0;
    this.boardIntro = 0;
    this.started = false;
    this.lossMode = false;
    this.winMode = false;
    this.winStart = 0;
    this.celebrateTime = 0;
    this.celebrateClock = 0;
    this.fx = { rings: [], flashes: [], light: null, shake: 0, shakeTime: 0, shakeDuration: 0 };
    this.glitch = 0;
    this.threat = 0.3;
    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.dummy = new THREE.Object3D();
    this.cameraTween = null;
    this.userOrbited = false;
    this.lowPower = window.matchMedia('(pointer: coarse)').matches;
    // touch devices get a lower resolution budget and lighter particle load
    this.quality = {
      maxPixelRatio: this.lowPower ? 1.3 : 1.8,
      maxComposerRatio: this.lowPower ? 1.05 : 1.6,
      sparks: this.lowPower ? 820 : 1300,
      rings: this.lowPower ? 6 : 10,
      flashes: this.lowPower ? 6 : 8,
    };

    this.createRenderer();
    this.createScene();
    this.textures = buildTextures(this.renderer);
    this.buildEnvironment();
    this.buildPost();
    this.createEffects();
    this.bindEvents();

    this.resize();
    this.animate = this.animate.bind(this);
    this.clock = new THREE.Clock();
    this.raf = requestAnimationFrame(this.animate);
  }

  createRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setClearColor(0x02030a, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio));
    this.renderer.domElement.className = 'webgl';
    this.canvas = this.renderer.domElement;
    this.container.appendChild(this.canvas);
  }

  createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02030a);
    this.scene.fog = new THREE.FogExp2(0x050312, 0.0062);

    this.camera = new THREE.PerspectiveCamera(44, 1, 0.1, 900);
    this.camera.position.set(0, 24, 30);
    this.basePhi = 0.82;
    this.baseTheta = 0;

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = this.lowPower ? 0.42 : 0.55;
    this.controls.zoomSpeed = 0.75;
    this.controls.minPolarAngle = 0.18;
    this.controls.maxPolarAngle = 1.28;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 120;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.target.set(0, 0, 0);
    this.controls.addEventListener('start', () => {
      this.userOrbited = true;
    });

    this.scene.add(new THREE.HemisphereLight(0x2f6dff, 0x080216, 0.85));
    this.scene.add(new THREE.AmbientLight(0x1b2742, 0.7));

    const key = new THREE.DirectionalLight(0x2ce8ff, 2.1);
    key.position.set(16, 30, 18);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0xff2bd6, 2.0);
    rim.position.set(-20, 12, -18);
    this.scene.add(rim);

    const fill = new THREE.DirectionalLight(0x5a7dff, 0.7);
    fill.position.set(0, -12, 8);
    this.scene.add(fill);

    this.underLight = new THREE.PointLight(0x23f4ff, 110, 42, 2);
    this.underLight.position.set(0, -4.5, 0);
    this.scene.add(this.underLight);

    this.rimPoint = new THREE.PointLight(0xff2bd6, 80, 50, 2);
    this.rimPoint.position.set(-18, 6, -16);
    this.scene.add(this.rimPoint);

    this.boardGroup = new THREE.Group();
    this.scene.add(this.boardGroup);

    this.clock = new THREE.Clock();
  }

  buildEnvironment() {
    const rng = mulberry32(20770421);

    // — sky dome —
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          float h = normalize(vWorld).y;
          vec3 bottom = vec3(0.012, 0.006, 0.026);
          vec3 horizon = vec3(0.12, 0.012, 0.12);
          vec3 top = vec3(0.002, 0.004, 0.014);
          vec3 col = mix(bottom, horizon, smoothstep(-0.25, 0.05, h));
          col = mix(col, top, smoothstep(0.02, 0.72, h));
          float glow = pow(max(0.0, 1.0 - abs(h + 0.01)), 7.0);
          col += vec3(0.20, 0.015, 0.18) * glow * 0.8;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(340, 32, 16), skyMat);
    this.scene.add(sky);

    // — ground —
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(520, 520),
      new THREE.MeshStandardMaterial({ color: 0x02040a, roughness: 0.94, metalness: 0.2 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -56;
    this.scene.add(ground);

    const gridTex = this.textures.grid.clone();
    gridTex.needsUpdate = true;
    gridTex.wrapS = THREE.RepeatWrapping;
    gridTex.wrapT = THREE.RepeatWrapping;
    gridTex.repeat.set(90, 90);
    this.groundTex = gridTex;
    const grid = new THREE.Mesh(
      new THREE.PlaneGeometry(520, 520),
      new THREE.MeshBasicMaterial({
        map: gridTex,
        color: 0x2bd9ee,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = -55.9;
    this.scene.add(grid);

    // — skyline —
    const palette = [0x9feeff, 0x9feeff, 0x9feeff, 0xd5c4ff, 0xff9fe9, 0xa8d6ff];
    const buildingCount = 88;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const cityMat = new THREE.MeshBasicMaterial({
      map: this.textures.windows,
      color: 0xffffff,
      toneMapped: false,
      fog: true,
    });
    this.city = new THREE.InstancedMesh(box, cityMat, buildingCount);
    this.city.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const capGeo = new THREE.BoxGeometry(1, 1, 1);
    const capMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.cityCaps = new THREE.InstancedMesh(capGeo, capMat, buildingCount);
    this.cityCaps.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const beaconPositions = [];
    const beaconColors = [];
    const capColors = [0x23f4ff, 0xff2bd6, 0xffd42a, 0x6c8bff];
    const color = new THREE.Color();
    const dummy = new THREE.Object3D();

    for (let i = 0; i < buildingCount; i++) {
      const mega = rng() < 0.09;
      const angle = rng() * TAU;
      const radius = 42 + Math.pow(rng(), 0.65) * 120;
      const width = mega ? 12 + rng() * 15 : 3.5 + rng() * 9;
      const depth = mega ? 12 + rng() * 15 : 3.5 + rng() * 9;
      let height = mega ? 80 + rng() * 70 : 18 + Math.pow(rng(), 1.4) * 62;
      if (radius < 55) height *= 0.75;

      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      dummy.position.set(x, -56 + height / 2, z);
      dummy.rotation.set(0, rng() * TAU, 0);
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();
      this.city.setMatrixAt(i, dummy.matrix);
      color.set(palette[Math.floor(rng() * palette.length)]);
      color.multiplyScalar(0.45 + rng() * 0.5);
      this.city.setColorAt(i, color);

      dummy.position.set(x, -56 + height + 0.15, z);
      dummy.scale.set(width * 0.94, 0.22 + rng() * 0.5, depth * 0.94);
      dummy.updateMatrix();
      this.cityCaps.setMatrixAt(i, dummy.matrix);
      color.set(capColors[Math.floor(rng() * capColors.length)]);
      color.multiplyScalar(0.55 + rng() * 0.5);
      this.cityCaps.setColorAt(i, color);

      if (mega || rng() < 0.28) {
        beaconPositions.push(x, -56 + height + 0.6, z);
        color.set(rng() < 0.4 ? 0xff3158 : rng() < 0.5 ? 0x23f4ff : 0xff2bd6);
        beaconColors.push(color.r, color.g, color.b);
      }
    }
    this.city.instanceMatrix.needsUpdate = true;
    this.city.instanceColor.needsUpdate = true;
    this.cityCaps.instanceMatrix.needsUpdate = true;
    this.cityCaps.instanceColor.needsUpdate = true;
    this.scene.add(this.city);
    this.scene.add(this.cityCaps);

    const beaconGeo = new THREE.BufferGeometry();
    beaconGeo.setAttribute('position', new THREE.Float32BufferAttribute(beaconPositions, 3));
    beaconGeo.setAttribute('color', new THREE.Float32BufferAttribute(beaconColors, 3));
    const beaconMat = new THREE.PointsMaterial({
      size: 1.7,
      map: this.textures.glow,
      transparent: true,
      opacity: 0.9,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
    });
    this.beacons = new THREE.Points(beaconGeo, beaconMat);
    this.beacons.frustumCulled = false;
    this.scene.add(this.beacons);

    // — billboards —
    const signs = [
      ['NEO-KOWLOON', '#23f4ff', [-38, 12, -30], 17],
      ['ZAIBATSU', '#ff2bd6', [44, 18, -28], 14],
      ['NO FUTURE', '#ffd42a', [-46, -2, 14], 13],
      ['24H RAMEN', '#ff5c7a', [36, -5, 30], 11],
      ['GRID//07', '#9a6bff', [8, 26, -52], 18],
      ['RUN THE NIGHT', '#23f4ff', [-24, 23, -58], 21],
      ['ICE-9', '#ff2bd6', [56, 3, 8], 9],
      ['SYNTH CITY', '#23f4ff', [-62, 1, -6], 12],
    ];
    for (const [text, colorHex, [x, y, z], width] of signs) {
      const tex = this.textures.sign(text, colorHex);
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.92,
        toneMapped: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(x, y, z);
      sprite.scale.set(width, width * 0.31, 1);
      this.scene.add(sprite);
    }

    // — horizon glow sprites —
    [
      [0x2b0c46, 0, 4, -180, 210, 0.34],
      [0x033a4a, 110, -4, -150, 140, 0.25],
      [0x4a0a38, -120, -2, -140, 130, 0.22],
    ].forEach(([c, x, y, z, size, opacity]) => {
      const mat = new THREE.SpriteMaterial({
        map: this.textures.glow,
        color: c,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
      });
      const sp = new THREE.Sprite(mat);
      sp.position.set(x, y, z);
      sp.scale.set(size, size * 0.6, 1);
      this.scene.add(sp);
    });

    // — airborne traffic —
    this.traffic = [];
    const carCount = 20;
    const carGeo = new THREE.BoxGeometry(0.9, 0.09, 0.18);
    const carMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.cars = new THREE.InstancedMesh(carGeo, carMat, carCount);
    this.cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const trailGeo = new THREE.BoxGeometry(3.2, 0.045, 0.055);
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.carTrails = new THREE.InstancedMesh(trailGeo, trailMat, carCount);
    this.carTrails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const carColors = [0x23f4ff, 0xff2bd6, 0xffd42a, 0xffffff, 0x7d8cff];
    for (let i = 0; i < carCount; i++) {
      this.traffic.push({
        radius: 34 + rng() * 62,
        angle: rng() * TAU,
        speed: 0.035 + rng() * 0.075,
        y: rng() < 0.45 ? 6 + rng() * 22 : -28 + rng() * 17,
        bob: rng() * TAU,
      });
      color.set(carColors[Math.floor(rng() * carColors.length)]);
      this.cars.setColorAt(i, color);
      this.carTrails.setColorAt(i, color);
    }
    this.cars.instanceColor.needsUpdate = true;
    this.carTrails.instanceColor.needsUpdate = true;
    this.scene.add(this.cars);
    this.scene.add(this.carTrails);

    // — drifting data motes —
    const dustCount = 700;
    const dustPositions = new Float32Array(dustCount * 3);
    const dustColors = new Float32Array(dustCount * 3);
    this.dustSpeed = new Float32Array(dustCount);
    for (let i = 0; i < dustCount; i++) {
      dustPositions[i * 3] = (rng() - 0.5) * 150;
      dustPositions[i * 3 + 1] = -28 + rng() * 68;
      dustPositions[i * 3 + 2] = (rng() - 0.5) * 150;
      const c = rng();
      color.set(c < 0.55 ? 0x66f6ff : c < 0.8 ? 0xff6be6 : 0xfff2b0);
      color.multiplyScalar(0.3 + rng() * 0.7);
      dustColors[i * 3] = color.r;
      dustColors[i * 3 + 1] = color.g;
      dustColors[i * 3 + 2] = color.b;
      this.dustSpeed[i] = 0.35 + rng() * 1.7;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3).setUsage(THREE.DynamicDrawUsage));
    dustGeo.setAttribute('color', new THREE.BufferAttribute(dustColors, 3));
    const dustMat = new THREE.PointsMaterial({
      size: 0.22,
      map: this.textures.glow,
      transparent: true,
      opacity: 0.7,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
    });
    this.dust = new THREE.Points(dustGeo, dustMat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
    this.dustPositions = dustPositions;
    this.dustCount = dustCount;

    // — supporting energy column —
    this.column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 2.6, 14, 26, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x23f4ff,
        transparent: true,
        opacity: 0.055,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    this.column.position.y = -7.6;
    this.scene.add(this.column);

    this.columnCore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.3, 14, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x9ffcff,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    this.columnCore.position.y = -7.6;
    this.scene.add(this.columnCore);
  }

  buildPost() {
    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.maxComposerRatio));
    this.composer.setSize(size.x, size.y);

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new UnrealBloomPass(size, 0.62, 0.55, 0.34);
    this.composer.addPass(this.bloom);

    this.gradePass = new ShaderPass(CyberGradeShader);
    this.composer.addPass(this.gradePass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
    this.gradePass.uniforms.uResolution.value.set(size.x, size.y);
  }

  createEffects() {
    this.sparks = new SparkPool(this.scene, this.textures.glow, this.quality.sparks);

    for (let i = 0; i < this.quality.rings; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x23f4ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const geo = new THREE.RingGeometry(0.82, 1, 80);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.fx.rings.push({ mesh, life: 0, max: 1, from: 0.3, to: 4 });
    }

    for (let i = 0; i < this.quality.flashes; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.textures.glow,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.scene.add(sprite);
      this.fx.flashes.push({ sprite, life: 0, max: 1, from: 1, to: 4, stretch: 1 });
    }

    const light = new THREE.PointLight(0xff3158, 0, 34, 2);
    this.scene.add(light);
    this.fx.light = light;
    this.fx.lightLife = 0;
  }

  bindEvents() {
    this.onPointerMove = (event) => {
      if (event.pointerType === 'touch') return;
      if (!this.interactive) return;
      const next = this.pick(event.clientX, event.clientY);
      if (next !== this.hovered) {
        this.hovered = next;
        this.canvas.style.cursor = next >= 0 ? 'pointer' : 'grab';
      }
    };
    this.onPointerLeave = () => {
      this.hovered = -1;
      this.canvas.style.cursor = 'grab';
    };
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setSize(w, h);
      this.gradePass.uniforms.uResolution.value.set(w, h);
    }
    const prevFit = this.fitDistance;
    this.fitDistance = this.computeFitDistance();
    this.applyZoomLimits();
    if (this.hasBoard && !this.cameraTween) {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      // keep whatever zoom the player chose: mobile toolbars collapse and fire
      // resize mid-game, which would otherwise yank the camera back to fit
      const ratio = prevFit > 0 ? this.camera.position.distanceTo(this.controls.target) / prevFit : 1;
      const nextDist = clamp(
        ratio * this.fitDistance,
        this.controls.minDistance,
        this.controls.maxDistance,
      );
      this.camera.position.copy(this.controls.target).addScaledVector(dir, nextDist);
      this.controls.update();
    }
  }

  computeFitDistance() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const insets = this.getInsets();
    const xMin = -1 + (2 * insets.left) / vw + 0.035;
    const xMax = 1 - (2 * insets.right) / vw - 0.035;
    const yMax = 1 - (2 * insets.top) / vh - 0.025;
    const yMin = -1 + (2 * insets.bottom) / vh + 0.025;

    const halfW = this.cols / 2 + 0.85;
    const halfD = this.rows / 2 + 0.85;
    const corners = [
      new THREE.Vector3(-halfW, 0, -halfD),
      new THREE.Vector3(halfW, 0, -halfD),
      new THREE.Vector3(-halfW, 0, halfD),
      new THREE.Vector3(halfW, 0, halfD),
      new THREE.Vector3(-halfW, 0.4, -halfD),
      new THREE.Vector3(halfW, 0.4, halfD),
      new THREE.Vector3(0, 1.1, 0),
    ];

    const oldPos = this.camera.position.clone();
    let lo = 6;
    let hi = 260;
    const phi = this.basePhi;
    for (let iter = 0; iter < 26; iter++) {
      const d = (lo + hi) / 2;
      this.camera.position.set(
        Math.sin(phi) * Math.sin(this.baseTheta) * d,
        Math.cos(phi) * d,
        Math.sin(phi) * Math.cos(this.baseTheta) * d,
      );
      this.camera.lookAt(0, 0, 0);
      this.camera.updateMatrixWorld();
      let fits = true;
      for (const corner of corners) {
        const p = corner.clone().project(this.camera);
        if (p.x < xMin || p.x > xMax || p.y < yMin || p.y > yMax) {
          fits = false;
          break;
        }
      }
      if (fits) hi = d;
      else lo = d;
    }

    this.camera.position.copy(oldPos);
    this.camera.lookAt(this.controls.target);
    return Math.max(7, hi * 1.035);
  }

  /** Touch screens may zoom closer than a mouse, so dense grids stay tappable. */
  applyZoomLimits() {
    const floor = this.lowPower ? 0.44 : 0.58;
    const ceiling = this.lowPower ? 2.4 : 2.1;
    this.controls.minDistance = this.fitDistance * floor;
    this.controls.maxDistance = this.fitDistance * ceiling;
  }

  setAccent(hex) {
    this.accentHex = hex;
    this.accent = new THREE.Color(hex);
    this.underLight.color.copy(this.accent);
    if (this.column) {
      this.column.material.color.copy(this.accent);
      this.columnCore.material.color.copy(this.accent).lerp(new THREE.Color('#ffffff'), 0.4);
    }
    if (this.accentMaterials) {
      for (const mat of this.accentMaterials) mat.color.copy(this.accent);
    }
    this.applyMoodColors();
  }

  applyMoodColors() {
    if (!this.accentMaterials) return;
    let target = this.accent;
    if (this.lossMode) target = new THREE.Color('#ff3158');
    else if (this.winMode) target = new THREE.Color('#ffd42a');
    for (const mat of this.accentMaterials) mat.color.copy(target);
    this.underLight.color.copy(target);
  }

  /* ————————————————————————— board ————————————————————————— */

  buildBoard(game) {
    this.gameRef = game;
    this.cols = game.cols;
    this.rows = game.rows;
    this.cellCount = game.total;
    this.spacing = 1;
    this.clearBoard();
    this.lossMode = false;
    this.winMode = false;
    this.solvedFlash = false;
    this.gameOver = false;
    this.boardIntro = 0;
    this.introActive = true;
    this.introEndTime = this.time + 1.15;
    this.hovered = -1;
    this.boardGroup = new THREE.Group();
    this.scene.add(this.boardGroup);
    this.tiles = [];

    this.buildTiles(game);
    this.buildFrame();
    this.applyMoodColors();
    this.controls.target.set(0, 0, 0);
    this.fitDistance = this.computeFitDistance();
    this.applyZoomLimits();

    if (!this.started) {
      this.setScenicCamera();
    } else {
      this.animateCameraToFit(1300);
    }
    this.hasBoard = true;
    this.userOrbited = false;
  }

  clearBoard() {
    if (!this.boardGroup) return;
    this.boardGroup.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of materials) {
          if (obj.userData.sharedMaterial) continue;
          mat.dispose();
        }
      }
    });
    this.scene.remove(this.boardGroup);
    this.boardGroup = null;
    this.accentMaterials = [];
    this.tiles = [];
    this.hoverMesh = null;
    this.hoverMarker = null;
    this.mineMesh = null;
    this.markerMeshes = null;
    this.scanPlane = null;
    if (this.floorTex) {
      this.floorTex.dispose();
      this.floorTex = null;
    }
  }

  buildTiles(game) {
    const count = this.cellCount;
    const bodyGeo = new RoundedBoxGeometry(0.9, 0.16, 0.9, 2, 0.035);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.62,
      roughness: 0.28,
      emissive: 0x061827,
      emissiveIntensity: 0.85,
    });

    this.tileBodies = new THREE.InstancedMesh(bodyGeo, bodyMat, count);
    this.tileBodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tileBodies.castShadow = false;
    this.tileBodies.receiveShadow = false;
    this.boardGroup.add(this.tileBodies);

    const planeGeo = new THREE.PlaneGeometry(1, 1);
    planeGeo.rotateX(-Math.PI / 2);

    const hiddenMat = new THREE.MeshBasicMaterial({
      map: this.textures.hidden,
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.hiddenOverlay = new THREE.InstancedMesh(planeGeo, hiddenMat, count);
    this.hiddenOverlay.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.hiddenOverlay.renderOrder = 1;
    this.boardGroup.add(this.hiddenOverlay);

    const revealedMat = new THREE.MeshBasicMaterial({
      map: this.textures.revealed,
      color: 0x9feaff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.revealedOverlay = new THREE.InstancedMesh(planeGeo, revealedMat, count);
    this.revealedOverlay.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.revealedOverlay.renderOrder = 1;
    this.boardGroup.add(this.revealedOverlay);

    // Markers (numbers, flags, wrong flags)
    const markerDefs = [
      ['1', this.textures.numbers[1]],
      ['2', this.textures.numbers[2]],
      ['3', this.textures.numbers[3]],
      ['4', this.textures.numbers[4]],
      ['5', this.textures.numbers[5]],
      ['6', this.textures.numbers[6]],
      ['7', this.textures.numbers[7]],
      ['8', this.textures.numbers[8]],
      ['flag', this.textures.flag],
      ['wrong', this.textures.wrong],
    ];
    this.markerMeshes = {};
    for (const [key, tex] of markerDefs) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.InstancedMesh(planeGeo, mat, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.renderOrder = key === 'flag' || key === 'wrong' ? 3 : 2;
      this.markerMeshes[key] = mesh;
      this.boardGroup.add(mesh);
    }

    const mineGeo = new THREE.IcosahedronGeometry(0.2, 1);
    const mineMat = new THREE.MeshStandardMaterial({
      color: 0x2a0009,
      emissive: 0xff1745,
      emissiveIntensity: 2.4,
      metalness: 0.9,
      roughness: 0.2,
    });
    this.mineMesh = new THREE.InstancedMesh(mineGeo, mineMat, count);
    this.mineMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mineMesh.count = 0;
    this.mineMesh.renderOrder = 2;
    this.boardGroup.add(this.mineMesh);

    const hoverMat = new THREE.MeshBasicMaterial({
      map: this.textures.target,
      color: this.accent,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.hoverMarker = new THREE.Mesh(planeGeo, hoverMat);
    this.hoverMarker.scale.setScalar(1.02);
    this.hoverMarker.renderOrder = 5;
    this.hoverMarker.visible = false;
    this.boardGroup.add(this.hoverMarker);

    // colors
    this.cHidden = new THREE.Color('#0a1531');
    this.cHiddenFlag = new THREE.Color('#2f0b2b');
    this.cHiddenHover = new THREE.Color('#1b4f6d');
    this.cRevealed = new THREE.Color('#06101f');
    this.cRevealedHover = new THREE.Color('#0c2940');
    this.cMine = new THREE.Color('#28060b');
    this.cWin = new THREE.Color('#3a2c08');
    this.tmpColor = new THREE.Color();
    this.tmpColor2 = new THREE.Color();

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const index = row * this.cols + col;
        const tile = {
          index,
          row,
          col,
          x: (col - (this.cols - 1) / 2) * this.spacing,
          z: (row - (this.rows - 1) / 2) * this.spacing,
          revealed: false,
          flagged: false,
          marker: 'none',
          wrongFlag: false,
          mineRevealed: false,
          exploded: false,
          frontier: false,
          revealDelay: 0,
          mineDelay: 0,
          markerScale: 0,
          lift: 0.16,
          bodyColor: new THREE.Color('#0a1531').offsetHSL((Math.random() - 0.5) * 0.03, 0, (Math.random() - 0.5) * 0.035),
          overlayColor: this.accent.clone().multiplyScalar(0.55 + Math.random() * 0.25),
          intro: 0,
          introTimer: 0,
          introDelay: ((row + col) / (this.rows + this.cols)) * 0.25 + Math.random() * 0.06,
          phase: Math.random() * TAU,
        };
        this.tiles.push(tile);
        this.tileBodies.setColorAt(index, tile.bodyColor);
        const col2 = this.tmpColor.copy(this.accent).multiplyScalar(0.62 + Math.random() * 0.2);
        this.hiddenOverlay.setColorAt(index, col2);
        this.revealedOverlay.setColorAt(index, this.tmpColor2.setRGB(0.05, 0.12, 0.14));
      }
    }

    this.tileBodies.instanceColor.needsUpdate = true;
    this.hiddenOverlay.instanceColor.needsUpdate = true;
    this.revealedOverlay.instanceColor.needsUpdate = true;

    this.tileBodies.instanceMatrix.needsUpdate = true;
    this.hiddenOverlay.instanceMatrix.needsUpdate = true;
    this.revealedOverlay.instanceMatrix.needsUpdate = true;

    this.updateTileMatrices(0, true);
  }

  buildFrame() {
    const w = this.cols * this.spacing;
    const d = this.rows * this.spacing;
    this.boardW = w;
    this.boardD = d;

    const platformGeo = new RoundedBoxGeometry(w + 1.2, 0.42, d + 1.2, 3, 0.1);
    const platformMat = new THREE.MeshStandardMaterial({
      color: 0x050b17,
      metalness: 0.8,
      roughness: 0.36,
      emissive: 0x03111c,
      emissiveIntensity: 0.7,
    });
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.position.y = -0.3;
    this.boardGroup.add(platform);

    const floorTex = this.textures.grid.clone();
    floorTex.needsUpdate = true;
    floorTex.wrapS = THREE.RepeatWrapping;
    floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(this.cols, this.rows);
    this.floorTex = floorTex;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({
        map: floorTex,
        color: 0x93eaff,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.075;
    this.boardGroup.add(floor);

    this.accentMaterials = [];
    const accentBarMat = new THREE.MeshBasicMaterial({
      color: this.accent,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.accentMaterials.push(accentBarMat);

    const barY = 0.015;
    const barThickness = 0.05;
    const bars = [
      [0, barY, -d / 2 - 0.58, w + 1.15, 1],
      [0, barY, d / 2 + 0.58, w + 1.15, 1],
      [-w / 2 - 0.58, barY, 0, d + 1.15, 0],
      [w / 2 + 0.58, barY, 0, d + 1.15, 0],
    ];
    for (const [x, y, z, len, horizontal] of bars) {
      const geo = new THREE.BoxGeometry(horizontal ? len : barThickness, 0.035, horizontal ? barThickness : len);
      const bar = new THREE.Mesh(geo, accentBarMat);
      bar.position.set(x, y, z);
      this.boardGroup.add(bar);
    }

    const cornerMat = new THREE.MeshBasicMaterial({
      color: this.accent,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.accentMaterials.push(cornerMat);

    const cw = w / 2 + 0.58;
    const cd = d / 2 + 0.58;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const block = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.36), cornerMat);
      block.position.set(sx * cw, 0.02, sz * cd);
      this.boardGroup.add(block);

      const l1 = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.06, 0.07), accentBarMat);
      l1.position.set(sx * cw - sx * 0.45, 0.03, sz * cd);
      this.boardGroup.add(l1);
      const l2 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 1.05), accentBarMat);
      l2.position.set(sx * cw, 0.03, sz * cd - sz * 0.45);
      this.boardGroup.add(l2);
    }

    // perimeter tick marks
    const tickPoints = [];
    for (let c = 0; c <= this.cols; c += 1) {
      const x = -w / 2 + c * this.spacing;
      tickPoints.push(x, 0.055, -d / 2 - 0.46, x, 0.055, -d / 2 - 0.62);
      tickPoints.push(x, 0.055, d / 2 + 0.46, x, 0.055, d / 2 + 0.62);
    }
    for (let r = 0; r <= this.rows; r += 1) {
      const z = -d / 2 + r * this.spacing;
      tickPoints.push(-w / 2 - 0.46, 0.055, z, -w / 2 - 0.62, 0.055, z);
      tickPoints.push(w / 2 + 0.46, 0.055, z, w / 2 + 0.62, 0.055, z);
    }
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickPoints, 3));
    const tickMat = new THREE.LineBasicMaterial({
      color: this.accent,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.accentMaterials.push(tickMat);
    this.boardGroup.add(new THREE.LineSegments(tickGeo, tickMat));

    // underglow
    const underMat = new THREE.MeshBasicMaterial({
      map: this.textures.glow,
      color: this.accent,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const underGeo = new THREE.PlaneGeometry(w * 1.9, d * 1.9);
    underGeo.rotateX(-Math.PI / 2);
    this.underGlow = new THREE.Mesh(underGeo, underMat);
    this.underGlow.position.set(0, -0.55, 0);
    this.underGlow.renderOrder = 0;
    this.boardGroup.add(this.underGlow);

    // corner energy pillars
    const pylonMat = new THREE.MeshBasicMaterial({
      color: this.accent,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.accentMaterials.push(pylonMat);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.18, 3.2, 8, 1, true), pylonMat);
      pylon.position.set(sx * cw, -1.65, sz * cd);
      this.boardGroup.add(pylon);
    }

    // rotating holo rings
    this.holoRings = [];
    const ringMat = new THREE.MeshBasicMaterial({
      color: this.accent,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.accentMaterials.push(ringMat);
    const maxDim = Math.max(w, d);
    for (let i = 0; i < 3; i++) {
      const radius = maxDim * (0.63 + i * 0.075);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.018, 6, 160), ringMat.clone());
      ring.rotation.x = Math.PI / 2;
      ring.rotation.z = i * 0.5;
      ring.position.y = -0.65 - i * 0.18;
      ring.userData.speed = 0.08 + i * 0.035;
      ring.userData.tilt = 0.04 + i * 0.04;
      this.holoRings.push(ring);
      this.accentMaterials.push(ring.material);
      this.boardGroup.add(ring);
    }

    // scan sweep
    const scanMat = new THREE.MeshBasicMaterial({
      map: this.textures.scan,
      color: this.accent,
      transparent: true,
      opacity: 0.23,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.accentMaterials.push(scanMat);
    this.scanPlane = new THREE.Mesh(new THREE.PlaneGeometry(w, d), scanMat);
    this.scanPlane.rotation.x = -Math.PI / 2;
    this.scanPlane.position.y = 0.5;
    this.boardGroup.add(this.scanPlane);

    this.boardGroup.scale.setScalar(0.9);
  }

  setScenicCamera() {
    const d = this.fitDistance * 1.28;
    const phi = 0.95;
    const theta = 0.55;
    this.camera.position.set(
      Math.sin(phi) * Math.sin(theta) * d,
      Math.cos(phi) * d,
      Math.sin(phi) * Math.cos(theta) * d,
    );
    this.controls.target.set(0, 0, 0);
    this.camera.lookAt(0, 0, 0);
    this.controls.autoRotate = true;
    this.controls.update();
  }

  startRun() {
    this.started = true;
    this.controls.autoRotate = false;
    this.animateCameraToFit(2200);
  }

  animateCameraToFit(duration = 1400) {
    const to = new THREE.Vector3(
      Math.sin(this.basePhi) * Math.sin(this.baseTheta) * this.fitDistance,
      Math.cos(this.basePhi) * this.fitDistance,
      Math.sin(this.basePhi) * Math.cos(this.baseTheta) * this.fitDistance,
    );
    this.cameraTween = {
      from: this.camera.position.clone(),
      to,
      t: 0,
      duration: duration / 1000,
    };
    this.controls.enabled = false;
    this.controls.autoRotate = false;
  }

  updateCameraTween(dt) {
    if (!this.cameraTween) return;
    const tw = this.cameraTween;
    tw.t += dt;
    const p = clamp(tw.t / tw.duration, 0, 1);
    const k = easeInOutCubic(p);
    this.camera.position.lerpVectors(tw.from, tw.to, k);
    this.camera.lookAt(0, 0, 0);
    if (p >= 1) {
      this.cameraTween = null;
      this.controls.enabled = true;
      this.controls.update();
    }
  }

  frameIndex(index) {
    const tile = this.tiles[index];
    return tile ? new THREE.Vector3(tile.x, 0.3, tile.z) : new THREE.Vector3();
  }

  tileTop(index) {
    const tile = this.tiles[index];
    if (!tile) return 0.24;
    return tile.lift + 0.09;
  }

  /* ———————————————————————— tile updates ———————————————————————— */

  updateTileMatrices(dt, initial = false) {
    if (!this.tileBodies || !this.tiles.length) return;

    const markerTypes = ['1', '2', '3', '4', '5', '6', '7', '8', 'flag', 'wrong'];
    const counts = {};
    for (const type of markerTypes) counts[type] = 0;

    let mineCount = 0;
    const winActive = this.winMode;
    const accent = this.accent;
    const introScale = 0.9 + 0.1 * easeOutCubic(this.boardIntro);

    for (let i = 0; i < this.tiles.length; i++) {
      const tile = this.tiles[i];

      tile.revealDelay = Math.max(0, tile.revealDelay - dt);
      tile.mineDelay = Math.max(0, tile.mineDelay - dt);

      // staged reveal
      if (!initial) {
        if (tile.revealDelay <= 0 && tile.revealed && tile.marker === 'none') {
          // marker already set elsewhere
        }
      }

      // intro assembly
      tile.introTimer += dt;
      const ip = clamp((tile.introTimer - tile.introDelay) / 0.55, 0, 1);
      tile.intro = easeOutCubic(ip);
      const introOffset = -(1 - tile.intro) * 2.4;

      const hovered = this.hovered === i && this.interactive;
      const open = tile.revealed && tile.revealDelay <= 0;
      const targetLift = open
        ? hovered ? -0.045 : -0.02
        : hovered ? 0.2 : tile.flagged ? 0.19 : 0.16;

      if (initial) tile.lift = targetLift;
      else tile.lift += (targetLift - tile.lift) * Math.min(1, dt * 13);

      const winWave = winActive ? Math.sin(this.time * 3 - (tile.row + tile.col) * 0.22) * 0.03 : 0;
      const y = tile.lift + introOffset + winWave;

      this.dummy.position.set(tile.x, y, tile.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.tileBodies.setMatrixAt(i, this.dummy.matrix);

      // body color
      let bodyTarget;
      if (open) bodyTarget = hovered ? this.cRevealedHover : this.cRevealed;
      else if (hovered) bodyTarget = this.cHiddenHover;
      else bodyTarget = tile.bodyColorBase || (tile.bodyColorBase = this.cHidden.clone().offsetHSL((Math.random() - 0.5) * 0.025, 0, (Math.random() - 0.5) * 0.025));
      if (tile.flagged && !open) bodyTarget = this.cHiddenFlag;
      if (this.lossMode) {
        bodyTarget = this.tmpColor.copy(bodyTarget).lerp(this.cMine, tile.mineRevealed ? 0.75 : 0.25);
      }
      if (winActive) {
        bodyTarget = this.tmpColor.copy(bodyTarget).lerp(this.cWin, 0.35);
      }
      if (initial) tile.bodyColor.copy(bodyTarget);
      else tile.bodyColor.lerp(bodyTarget, Math.min(1, dt * 11));
      this.tileBodies.setColorAt(i, tile.bodyColor);

      // hidden overlay
      const overlayVisible = !open && tile.intro > 0.55;
      if (overlayVisible) {
        let intensity = 0.54 + Math.sin(this.time * 1.8 + tile.phase) * 0.07;
        if (tile.frontier) intensity += 0.3 + Math.sin(this.time * 4 + tile.phase) * 0.14;
        if (hovered) intensity = 1.35;
        if (tile.flagged) intensity = 1.05;
        if (this.lossMode) intensity = 0.2;
        this.tmpColor.copy(accent).multiplyScalar(intensity);
        if (this.lossMode) this.tmpColor.copy(this.cMine).multiplyScalar(1.4);
        tile.overlayColor.lerp(this.tmpColor, initial ? 1 : Math.min(1, dt * 9));
        if (hovered && !tile.flagged) tile.overlayColor.lerp(this.tmpColor2.setRGB(1, 1, 1), 0.35);
        this.hiddenOverlay.setColorAt(i, tile.overlayColor);

        const overlayScale = introScale * 0.88;
        this.dummy.position.set(tile.x, y + 0.086, tile.z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(overlayScale, 1, overlayScale);
        this.dummy.updateMatrix();
        this.hiddenOverlay.setMatrixAt(i, this.dummy.matrix);
      } else {
        this.dummy.position.set(tile.x, y, tile.z);
        this.dummy.scale.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.hiddenOverlay.setMatrixAt(i, this.dummy.matrix);
      }

      // revealed overlay
      if (open && tile.intro > 0.55) {
        const pulse = winActive ? 0.45 + Math.sin(this.time * 4 - (tile.row + tile.col) * 0.3) * 0.25 : 0.16;
        this.tmpColor.copy(accent).multiplyScalar(pulse);
        if (this.winMode) this.tmpColor.lerp(this.tmpColor2.setHex(0xffd42a), 0.65);
        this.revealedOverlay.setColorAt(i, this.tmpColor);
        const revealScale = introScale * 0.94;
        this.dummy.position.set(tile.x, y + 0.086, tile.z);
        this.dummy.scale.set(revealScale, 1, revealScale);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.revealedOverlay.setMatrixAt(i, this.dummy.matrix);
      } else {
        this.dummy.position.set(tile.x, y, tile.z);
        this.dummy.scale.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.revealedOverlay.setMatrixAt(i, this.dummy.matrix);
      }

      // markers
      const markerVisibleNow = tile.marker !== 'none'
        && (open || tile.marker === 'flag' || tile.marker === 'wrong');
      if (markerVisibleNow) {
        tile.markerScale = Math.min(1, tile.markerScale + dt * (initial ? 10 : 6));
      } else {
        tile.markerScale = Math.max(0, tile.markerScale - dt * 8);
      }

      const isFlag = tile.marker === 'flag';
      if (markerVisibleNow && this.markerMeshes[tile.marker] && tile.markerScale > 0.01) {
        const popped = easeOutBack(clamp(tile.markerScale, 0, 1));
        const scale = (isFlag ? 0.86 : tile.marker === 'wrong' ? 0.9 : 0.73) * Math.max(0.001, popped);
        const bob = isFlag ? Math.sin(this.time * 2.6 + tile.phase) * 0.035 : 0;
        this.dummy.position.set(tile.x, y + 0.2 + bob, tile.z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(scale, scale, scale);
        this.dummy.updateMatrix();
        const idx = counts[tile.marker]++;
        this.markerMeshes[tile.marker].setMatrixAt(idx, this.dummy.matrix);
      }

      // mines
      if (tile.mineRevealed && tile.mineDelay <= 0) {
        const exploded = tile.exploded;
        const bob = Math.sin(this.time * 2.2 + tile.phase) * 0.055;
        const pop = easeOutBack(clamp(1 - tile.mineDelay / 0.2, 0, 1));
        this.dummy.position.set(tile.x, y + 0.25 + bob, tile.z);
        this.dummy.rotation.set(0.28, this.time * 1.4 + tile.phase, 0.12);
        const s = (exploded ? 1.75 : 0.9) * (0.9 + Math.sin(this.time * 3 + tile.phase) * 0.08);
        this.dummy.scale.set(s, s, s);
        this.dummy.updateMatrix();
        this.mineMesh.setMatrixAt(mineCount++, this.dummy.matrix);
      }
    }

    for (const type of markerTypes) {
      const mesh = this.markerMeshes[type];
      mesh.count = Math.min(counts[type], mesh.instanceMatrix.count);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.mineMesh.count = Math.min(mineCount, this.cellCount);
    this.mineMesh.instanceMatrix.needsUpdate = true;

    this.tileBodies.instanceMatrix.needsUpdate = true;
    this.tileBodies.instanceColor.needsUpdate = true;
    this.hiddenOverlay.instanceMatrix.needsUpdate = true;
    this.hiddenOverlay.instanceColor.needsUpdate = true;
    this.revealedOverlay.instanceMatrix.needsUpdate = true;
    this.revealedOverlay.instanceColor.needsUpdate = true;

    // hover marker
    if (this.hovered >= 0 && this.interactive && !this.introActive) {
      const tile = this.tiles[this.hovered];
      const open = tile.revealed;
      this.hoverMarker.visible = true;
      this.hoverMarker.position.set(tile.x, tile.lift + 0.19 + Math.sin(this.time * 4) * 0.012, tile.z);
      const s = 1.02 + Math.sin(this.time * 5) * 0.035;
      this.hoverMarker.scale.set(s, 1, s);
      this.hoverMarker.rotation.y = Math.sin(this.time * 0.7) * 0.06;
      this.hoverMarker.material.color.copy(open ? this.accent : new THREE.Color('#ffffff')).lerp(this.accent, open ? 0.45 : 0.15);
    } else if (this.hoverMarker) {
      this.hoverMarker.visible = false;
    }
  }

  /* ————————————————————————— game API ————————————————————————— */

  revealCells(cells, originIndex, started = false) {
    if (!cells || !cells.length) return;
    const origin = this.tiles[originIndex] || cells[0];
    for (const cell of cells) {
      const tile = this.tiles[cell.index];
      if (!tile) continue;
      tile.revealed = true;
      tile.flagged = false;
      tile.frontier = false;
      tile.marker = cell.adjacent > 0 ? String(cell.adjacent) : 'none';
      tile.markerScale = 0;
      tile.revealDelay = Math.min(
        0.48,
        0.012 * (Math.abs(tile.row - origin.row) + Math.abs(tile.col - origin.col)),
      );
      if (cell.adjacent === 0) {
        for (const n of this.neighborIndices(tile.index)) {
          const nt = this.tiles[n];
          if (nt && !nt.revealed) nt.frontier = true;
        }
      }
    }

    const pos = this.frameIndex(originIndex);
    const big = cells.length > 8;
    this.pulseTile(originIndex, big ? '#7cf8ff' : '#54eaff', big ? 35 : 14, big ? 0.7 : 0.35);
    if (big) {
      this.spawnRing(pos, this.accentHex, 0.4, Math.min(7, 1.2 + cells.length * 0.09), 0.8);
      this.triggerGlitch(0.18);
    }
    if (started) {
      this.spawnRing(new THREE.Vector3(0, 0.6, 0), this.accentHex, 0.4, Math.max(this.boardW, this.boardD) * 0.75, 1.2);
      this.triggerGlitch(0.4);
    }
  }

  setFlag(index, flagged) {
    const tile = this.tiles[index];
    if (!tile) return;
    tile.flagged = flagged;
    if (flagged) {
      tile.marker = 'flag';
      tile.markerScale = 0;
      const pos = this.frameIndex(index);
      this.sparks.spawn(pos.x, 0.35, pos.z, '#ff3cd6', 18, 1.9, { life: 0.7, gravity: 2.6, upward: 1.8 });
      this.spawnRing(pos, '#ff2bd6', 0.2, 1.2, 0.45);
    } else {
      tile.marker = 'none';
      tile.markerScale = 0;
      const pos = this.frameIndex(index);
      this.sparks.spawn(pos.x, 0.3, pos.z, '#9ff6ff', 8, 1.1, { life: 0.5, gravity: 2 });
    }
  }

  showLoss(result) {
    this.lossMode = true;
    this.winMode = false;
    this.gameOver = true;
    this.controls.autoRotate = false;
    this.applyMoodColors();

    const exploded = result.exploded;
    const origin = this.tiles[exploded] || this.tiles[0];
    for (const index of result.mines) {
      const tile = this.tiles[index];
      if (!tile) continue;
      tile.mineRevealed = true;
      tile.flagged = false;
      tile.marker = 'none';
      tile.wrongFlag = false;
      tile.revealDelay = 0;
      const dist = Math.abs(tile.row - origin.row) + Math.abs(tile.col - origin.col);
      tile.mineDelay = Math.min(0.85, 0.08 + dist * 0.035);
      tile.exploded = index === exploded;
    }
    for (const index of result.wrongFlags) {
      const tile = this.tiles[index];
      if (!tile) continue;
      tile.wrongFlag = true;
      tile.flagged = false;
      tile.marker = 'wrong';
      tile.markerScale = 0;
    }
    if (this.tiles[exploded]) {
      this.tiles[exploded].exploded = true;
      this.tiles[exploded].mineDelay = 0;
      this.tiles[exploded].revealDelay = 0;
      this.tiles[exploded].mineRevealed = true;
    }

    const pos = this.frameIndex(exploded);
    this.triggerImpact(pos, '#ff3158');
    this.triggerShake(13, 0.9);
    this.triggerGlitch(1.2);
    this.spawnFlash(pos, '#fff0f2', 7, 0.5);
    this.spawnFlash(pos, '#ff3158', 18, 0.9, 5);
    this.fx.light.position.set(pos.x, 1.2, pos.z);
    this.fx.light.color.set('#ff3158');
    this.fx.lightLife = 0.85;
    this.spawnRing(pos, '#ff3158', 0.4, 9, 0.9);
    this.spawnRing(pos, '#ff8b3d', 0.2, 5.5, 0.6);
    this.sparks.spawn(pos.x, 0.35, pos.z, '#ff3158', 160, 6.5, { life: 1.4, gravity: 5, spread: 1.2 });
    this.sparks.spawn(pos.x, 0.35, pos.z, '#ffb03d', 70, 4.5, { life: 1.1, gravity: 3.5 });
    for (let i = 0; i < 7; i++) {
      const t = this.tiles[Math.floor(Math.random() * this.tiles.length)];
      this.sparks.spawn(t.x, 0.3, t.z, '#ff3158', 12, 2.2, { life: 0.9, gravity: 3 });
    }
  }

  showWin(game) {
    this.winMode = true;
    this.lossMode = false;
    this.gameOver = true;
    this.controls.autoRotate = false;
    this.winStart = this.time;
    this.celebrateTime = 4.5;
    this.applyMoodColors();

    for (const index of game.getMineIndices()) {
      const tile = this.tiles[index];
      if (!tile) continue;
      tile.flagged = true;
      tile.flagged = true;
      tile.marker = 'flag';
      tile.markerScale = 0.2 + Math.random() * 0.5;
    }
    this.spawnRing(new THREE.Vector3(0, 0.6, 0), '#ffeaa0', 0.6, Math.max(this.boardW, this.boardD) * 1.25, 1.6);
    this.spawnRing(new THREE.Vector3(0, 0.6, 0), '#23f4ff', 0.4, Math.max(this.boardW, this.boardD) * 0.9, 1.1);
    this.triggerGlitch(0.55);
    this.triggerShake(4, 0.55);
    for (let i = 0; i < 6; i++) {
      const tile = this.tiles[Math.floor(Math.random() * this.tiles.length)];
      this.sparks.spawn(tile.x, 0.4, tile.z, i % 2 ? '#ffd42a' : '#7cf8ff', 18, 2.6, { life: 1.3, gravity: 1.6 });
    }
  }

  scanFx(index) {
    const pos = this.frameIndex(index);
    this.spawnRing(new THREE.Vector3(0, 0.2, 0), '#7cf8ff', 0.35, Math.max(this.boardW, this.boardD) * 0.8, 0.85);
    this.spawnRing(pos, '#57ff9a', 0.3, 2.4, 0.8);
    this.spawnFlash(pos, '#57ff9a', 8, 0.6);
    this.sparks.spawn(pos.x, 0.4, pos.z, '#57ff9a', 30, 2.6, { life: 0.9, gravity: 1.5 });
    this.triggerGlitch(0.28);
  }

  defuseFx(index) {
    const pos = this.frameIndex(index);
    this.spawnFlash(pos, '#ff2bd6', 4, 0.35);
    this.spawnRing(pos, '#ff2bd6', 0.3, 1.8, 0.5);
    this.sparks.spawn(pos.x, 0.35, pos.z, '#ff2bd6', 22, 2.2, { life: 0.8, gravity: 2.2 });
    this.triggerGlitch(0.2);
  }

  /** SONAR PING: mark the swept 5x5 sector without exposing any tile value. */
  sonarFx(report) {
    if (!report?.indices?.length) return;
    const pos = this.frameIndex(report.center);
    for (const index of report.indices) {
      this.pulseTile(index, '#57ff9a', 4, 0.3);
    }
    this.spawnRing(new THREE.Vector3(0, 0.18, 0), '#2ef2ff', 0.5, Math.max(this.boardW, this.boardD) * 0.82, 1);
    this.spawnRing(pos, '#57ff9a', 0.4, 4.2, 0.9);
    this.spawnFlash(pos, '#57ff9a', 5, 0.45);
    this.sparks.spawn(pos.x, 0.4, pos.z, '#57ff9a', 26, 2.4, { life: 0.9, gravity: 0.9 });
    this.triggerGlitch(0.16);
  }

  /** GHOST PROTOCOL: show the violet shield collapsing around the absorbed hit. */
  ghostFx(index) {
    const pos = this.frameIndex(index);
    this.spawnRing(pos, '#b46bff', 4.6, 0.35, 0.9);
    this.spawnRing(pos, '#b46bff', 0.3, 2.9, 0.7);
    this.spawnFlash(pos, '#b46bff', 6, 0.6);
    this.sparks.spawn(pos.x, 0.5, pos.z, '#b46bff', 34, 2.8, { life: 1.05, gravity: -0.4, upward: 2.2 });
    this.triggerGlitch(0.3);
    this.triggerShake(2.4, 0.4);
  }

  /** DATA SIPHON: gold salvage pulled from the grid into the charge bank. */
  siphonFx() {
    const pos = new THREE.Vector3(0, 0.2, 0);
    this.spawnRing(pos, '#ffd42a', Math.max(this.boardW, this.boardD) * 0.7, 0.4, 0.95);
    this.spawnFlash(pos, '#ffd42a', 7, 0.55);
    for (let i = 0; i < 7; i++) {
      const tile = this.tiles[Math.floor(Math.random() * this.tiles.length)];
      this.sparks.spawn(tile.x, 0.35, tile.z, '#ffd42a', 10, 1.9, { life: 0.8, gravity: 1.2, upward: 2.2 });
    }
    this.triggerGlitch(0.18);
  }

  triggerImpact(pos, colorHex) {
    const color = new THREE.Color(colorHex);
    for (let i = 0; i < 3; i++) {
      this.sparks.spawn(pos.x, pos.y, pos.z, color, 30, 4 + i, { life: 0.7 + i * 0.2, gravity: 3 });
    }
    this.spawnRing(pos, colorHex, 0.3, 4.5, 0.6);
    this.spawnFlash(pos, colorHex, 5, 0.5);
  }

  pulseTile(index, color, count = 12, speed = 0.5) {
    const pos = this.frameIndex(index);
    this.sparks.spawn(pos.x, 0.36, pos.z, color, count, 1.2 + speed, { life: 0.55, gravity: 2.4, upward: 1.9 });
  }

  spawnRing(pos, colorHex, from, to, duration) {
    let slot = this.fx.rings.find((r) => r.life <= 0);
    if (!slot) slot = this.fx.rings[0];
    slot.life = duration;
    slot.max = duration;
    slot.from = from;
    slot.to = to;
    slot.mesh.visible = true;
    slot.mesh.position.set(pos.x, Math.max(0.35, pos.y), pos.z);
    slot.mesh.scale.setScalar(from);
    slot.mesh.material.color.set(colorHex);
    slot.mesh.material.opacity = 0.8;
  }

  spawnFlash(pos, colorHex, from, duration, stretch = 1) {
    let slot = this.fx.flashes.find((f) => f.life <= 0);
    if (!slot) slot = this.fx.flashes[0];
    slot.life = duration;
    slot.max = duration;
    slot.from = from;
    slot.to = from * 2.2;
    slot.stretch = stretch;
    slot.sprite.visible = true;
    slot.sprite.position.copy(pos);
    slot.sprite.material.color.set(colorHex);
    slot.sprite.material.opacity = 0.9;
    slot.sprite.scale.set(from, from * stretch, 1);
  }

  triggerShake(mag, duration) {
    this.fx.shake = mag;
    this.fx.shakeTime = duration;
    this.fx.shakeDuration = duration;
  }

  triggerGlitch(amount) {
    this.glitch = Math.max(this.glitch, amount);
  }

  setThreat(value) {
    this.threat = clamp(value, 0, 1);
  }

  setInteractive(enabled) {
    this.interactive = enabled;
    if (!enabled) {
      this.hovered = -1;
      if (this.hoverMarker) this.hoverMarker.visible = false;
    }
  }

  pick(clientX, clientY, tolerance = 0) {
    if (!this.tileBodies || this.introActive || this.gameOver) return -1;
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObject(this.tileBodies, false);
    if (hits.length) return hits[0].instanceId ?? -1;
    if (tolerance <= 0) return -1;

    // A fingertip is much wider than a cell on a dense grid: when the ray slips
    // between nodes, snap to the closest hidden node centre within tolerance.
    const v = this.tmpProbe || (this.tmpProbe = new THREE.Vector3());
    let best = -1;
    let bestDist = tolerance;
    for (let i = 0; i < this.tiles.length; i += 1) {
      const tile = this.tiles[i];
      if (!tile || tile.revealed) continue;
      v.set(tile.x, 0.35, tile.z).project(this.camera);
      if (v.z > 1) continue;
      const sx = rect.left + (v.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestDist) {
        best = i;
        bestDist = d;
      }
    }
    return best;
  }

  neighborIndices(index) {
    const col = index % this.cols;
    const row = Math.floor(index / this.cols);
    const out = [];
    for (const [dc, dr] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
      const c = col + dc;
      const r = row + dr;
      if (c >= 0 && c < this.cols && r >= 0 && r < this.rows) out.push(r * this.cols + c);
    }
    return out;
  }

  /* ————————————————————————— loop ————————————————————————— */

  updateEnvironment(dt) {
    const t = this.time;
    if (this.introActive) {
      this.boardIntro = Math.min(1, this.boardIntro + dt * 1.5);
      if (this.boardGroup) this.boardGroup.scale.setScalar(0.9 + 0.1 * easeOutCubic(this.boardIntro));
      if (t > this.introEndTime) this.introActive = false;
    } else if (this.boardGroup && this.boardGroup.scale.x !== 1) {
      this.boardGroup.scale.setScalar(1);
    }

    if (this.holoRings) {
      for (const ring of this.holoRings) {
        ring.rotation.z += dt * ring.userData.speed;
        ring.rotation.x = Math.PI / 2 + Math.sin(t * 0.3 + ring.userData.speed * 10) * ring.userData.tilt;
        ring.material.opacity = 0.24 + Math.sin(t * 1.2 + ring.userData.speed * 20) * 0.08;
      }
    }

    if (this.scanPlane) {
      const cycle = (t % 8.5) / 8.5;
      this.scanPlane.position.z = lerp(-this.boardD / 2 - 1.2, this.boardD / 2 + 1.2, cycle);
      this.scanPlane.material.opacity = 0.1 + Math.sin(cycle * Math.PI) * 0.18;
    }

    if (this.underGlow) {
      const base = this.lossMode ? 0.18 + Math.sin(t * 8) * 0.1 : this.winMode ? 0.55 + Math.sin(t * 4) * 0.2 : 0.3 + Math.sin(t * 1.4) * 0.07;
      this.underGlow.material.opacity = base + this.threat * 0.1;
    }

    if (this.underLight) {
      this.underLight.intensity = 95 + Math.sin(t * 1.8) * 18 + (this.lossMode ? Math.sin(t * 10) * 35 : 0);
    }

    if (this.column) {
      this.column.rotation.y += dt * 0.15;
      this.columnCore.rotation.y -= dt * 0.4;
      const col = this.lossMode ? this.tmpColor2.set('#ff3158') : this.winMode ? this.tmpColor2.set('#ffd42a') : this.accent;
      this.column.material.color.copy(col);
      this.columnCore.material.color.copy(col);
    }

    if (this.groundTex) {
      this.groundTex.offset.y += dt * 0.006;
      this.groundTex.offset.x -= dt * 0.002;
    }

    if (this.dust) {
      const pos = this.dust.geometry.attributes.position.array;
      for (let i = 0; i < this.dustCount; i++) {
        pos[i * 3 + 1] += this.dustSpeed[i] * dt;
        pos[i * 3] += Math.sin(t * 0.4 + i) * dt * 0.08;
        if (pos[i * 3 + 1] > 42) {
          pos[i * 3 + 1] = -30;
          pos[i * 3] = (Math.random() - 0.5) * 150;
          pos[i * 3 + 2] = (Math.random() - 0.5) * 150;
        }
      }
      this.dust.geometry.attributes.position.needsUpdate = true;
      this.dust.material.opacity = 0.55 + Math.sin(t * 0.8) * 0.12;
    }

    if (this.beacons) {
      this.beacons.material.opacity = 0.65 + Math.sin(t * 2.2) * 0.25;
    }

    if (this.cars) {
      const dummy = this.dummy;
      const colorTemp = this.tmpColor;
      for (let i = 0; i < this.traffic.length; i++) {
        const car = this.traffic[i];
        car.angle += car.speed * dt;
        const bob = Math.sin(t * 1.8 + car.bob) * 0.12;
        const x = Math.cos(car.angle) * car.radius;
        const z = Math.sin(car.angle) * car.radius;
        const tx = -Math.sin(car.angle);
        const tz = Math.cos(car.angle);
        const yaw = -car.angle - Math.PI / 2;

        dummy.position.set(x, car.y + bob, z);
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.cars.setMatrixAt(i, dummy.matrix);

        dummy.position.set(x - tx * 1.55, car.y + bob, z - tz * 1.55);
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.carTrails.setMatrixAt(i, dummy.matrix);
      }
      this.cars.instanceMatrix.needsUpdate = true;
      this.carTrails.instanceMatrix.needsUpdate = true;
    }

    if (this.celebrateTime > 0) {
      this.celebrateTime -= dt;
      this.celebrateClock -= dt;
      if (this.celebrateClock <= 0) {
        this.celebrateClock = 0.09;
        const tile = this.tiles[Math.floor(Math.random() * this.tiles.length)];
        if (tile) {
          const colors = ['#ffd42a', '#23f4ff', '#ff2bd6', '#fff6bb'];
          this.sparks.spawn(tile.x, 0.45, tile.z, colors[Math.floor(Math.random() * colors.length)], 15, 2.7, {
            life: 1.4,
            gravity: 1.1,
            upward: 2.3,
          });
        }
      }
    }
  }

  updateEffects(dt) {
    for (const ring of this.fx.rings) {
      if (ring.life <= 0) continue;
      ring.life -= dt;
      if (ring.life <= 0) {
        ring.mesh.visible = false;
        continue;
      }
      const p = 1 - ring.life / ring.max;
      const scale = lerp(ring.from, ring.to, easeOutCubic(p));
      ring.mesh.scale.setScalar(scale);
      ring.mesh.material.opacity = (1 - p) * 0.8;
    }

    for (const flash of this.fx.flashes) {
      if (flash.life <= 0) continue;
      flash.life -= dt;
      if (flash.life <= 0) {
        flash.sprite.visible = false;
        continue;
      }
      const p = 1 - flash.life / flash.max;
      const scale = lerp(flash.from, flash.to, easeOutCubic(p));
      flash.sprite.scale.set(scale, scale * flash.stretch, 1);
      flash.sprite.material.opacity = (1 - p) * 0.85;
    }

    if (this.fx.lightLife > 0) {
      this.fx.lightLife -= dt;
      this.fx.light.intensity = Math.max(0, this.fx.lightLife * 500);
    } else {
      this.fx.light.intensity = 0;
    }

    this.glitch *= Math.exp(-dt * 3.4);
    if (this.glitch < 0.004) this.glitch = 0;
  }

  updateShake(dt) {
    const canvas = this.canvas;
    if (this.fx.shakeTime > 0) {
      this.fx.shakeTime -= dt;
      const k = Math.max(0, this.fx.shakeTime / this.fx.shakeDuration);
      const amp = this.fx.shake * k;
      const x = (Math.random() - 0.5) * amp * 2;
      const y = (Math.random() - 0.5) * amp * 2;
      const rot = (Math.random() - 0.5) * amp * 0.08;
      canvas.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rot}deg) scale(1.015)`;
    } else if (canvas.style.transform) {
      canvas.style.transform = '';
    }
  }

  animate() {
    this.raf = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;

    if (this.cameraTween) this.updateCameraTween(dt);
    else this.controls.update();

    if (this.tiles.length) this.updateTileMatrices(dt);
    this.updateEnvironment(dt);
    this.updateEffects(dt);
    this.sparks.update(dt);
    this.updateShake(dt);

    this.gradePass.uniforms.uTime.value = this.time;
    this.gradePass.uniforms.uGlitch.value = this.glitch;

    this.composer.render();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
