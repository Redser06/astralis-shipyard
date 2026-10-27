/* Star Ship Navigator
 * Three.js r132 (UMD build, no bundler).
 *
 * Fixes vs the earlier version:
 *  - procedural nebula skybox generated on a canvas (the old texture URL 404'd)
 *  - PMREM environment map so metallic hull materials are lit from all angles
 *  - per-model axis normalisation (models are authored on X, Y or Z forward)
 *  - a real spacedock (ring + pylons + deck) sized from the ship
 *  - lazy loading: the 125 MB models no longer block the scene
 *  - every failure is surfaced in the UI panel, never a silent blank canvas
 */

const SHIP_LENGTH = 10;        // every hull is normalised to this many world units
const DOCK_RADIUS = 15;

// ---------------------------------------------------------------- renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
document.getElementById('canvas-container').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 20000);
camera.position.set(13.5, 7.5, 20);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 6;
controls.maxDistance = 400;
controls.target.set(0, 0.6, -5);

// ------------------------------------------------- procedural sky + light ---
// One canvas texture is used twice: as the visible skybox and, through PMREM,
// as the environment map that gives the hulls their reflections.
function makeSpaceTexture() {
  const W = 2048, H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // deep space base with a cool gradient
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0.0, '#02030a');
  base.addColorStop(0.45, '#050a1c');
  base.addColorStop(0.7, '#03060f');
  base.addColorStop(1.0, '#010208');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // nebula clouds: layered radial gradients, additive
  ctx.globalCompositeOperation = 'lighter';
  const clouds = [
    { x: 0.30, y: 0.42, r: 0.34, c: [90, 40, 190] },
    { x: 0.44, y: 0.34, r: 0.20, c: [40, 120, 220] },
    { x: 0.66, y: 0.55, r: 0.26, c: [190, 60, 110] },
    { x: 0.78, y: 0.30, r: 0.16, c: [40, 170, 190] },
    { x: 0.12, y: 0.66, r: 0.18, c: [120, 50, 170] },
  ];
  for (const cl of clouds) {
    for (let i = 0; i < 26; i++) {
      const cx = (cl.x + (Math.random() - 0.5) * cl.r * 1.6) * W;
      const cy = (cl.y + (Math.random() - 0.5) * cl.r) * H;
      const rad = (0.03 + Math.random() * 0.14) * W;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      const a = 0.035 + Math.random() * 0.05;
      g.addColorStop(0, `rgba(${cl.c[0]},${cl.c[1]},${cl.c[2]},${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
    }
  }

  // a distant star, blown out, upper-left — doubles as the key reflection source
  const sun = ctx.createRadialGradient(W * 0.17, H * 0.28, 0, W * 0.17, H * 0.28, W * 0.16);
  sun.addColorStop(0.00, 'rgba(255,255,255,1)');
  sun.addColorStop(0.05, 'rgba(255,246,214,0.95)');
  sun.addColorStop(0.18, 'rgba(255,206,120,0.32)');
  sun.addColorStop(1.00, 'rgba(255,180,80,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, W, H);

  // star field, three brightness bands
  for (let i = 0; i < 5200; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const m = Math.random();
    const r = m > 0.985 ? 1.9 : m > 0.93 ? 1.15 : 0.6;
    const a = m > 0.985 ? 0.95 : m > 0.93 ? 0.6 : 0.32;
    const tint = Math.random();
    ctx.fillStyle = tint > 0.9 ? `rgba(180,205,255,${a})`
                  : tint < 0.1 ? `rgba(255,215,180,${a})`
                  : `rgba(255,255,255,${a})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

const spaceTex = makeSpaceTexture();
scene.background = spaceTex;

const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
scene.environment = pmrem.fromEquirectangular(spaceTex).texture;

// ---------------------------------------------------------------- lighting ---
// Key light matches the painted sun direction (upper-left, behind the camera at
// spawn) so highlights land on the hull, plus cool fill so the shadow side is
// readable rather than black.
const key = new THREE.DirectionalLight(0xfff2d6, 1.0);
key.position.set(-40, 32, -18);
scene.add(key);

const fill = new THREE.DirectionalLight(0x6f9bff, 0.45);
fill.position.set(26, 6, 24);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xff8fd0, 0.3);
rim.position.set(6, -14, -30);
scene.add(rim);

scene.add(new THREE.HemisphereLight(0x334466, 0x0a0a12, 0.35));

// bounce from the deck so the underside of a hull is not pitch black when the
// camera drops below the ring
const bounce = new THREE.DirectionalLight(0x8fb4ff, 0.4);
bounce.position.set(-4, -18, 6);
scene.add(bounce);

// dock floodlights: one per berth, mounted above the end of each spoke and aimed
// down at that hull, the way a real spacedock lights what it is working on
const floods = [];
function buildFloods(count) {
  for (let i = 0; i < count; i++) {
    const a = Math.PI / 2 + (i * Math.PI * 2) / count;
    const r = SHIP_LENGTH * 2.2;
    const flood = new THREE.SpotLight(0xcfe4ff, 26, 34, Math.PI / 6, 0.55, 2.0);
    flood.position.set(Math.cos(a) * r, 7.5, Math.sin(a) * r);
    flood.target.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    scene.add(flood, flood.target);
    floods.push(flood);
  }
}

// --------------------------------------------------------------- the fleet ---
// longest axis / yaw are corrected below at load time from the real bounding box.
// Every hull gets its own berth, so all of them are docked and visible at once.
// Declared before the berth geometry, which sizes itself from FLEET.length.
const FLEET = [
  { id: 'enterprise-e', label: 'Enterprise-E',    faction: 'Federation', file: 'star_trek_-_sovereign_class_opt.glb',      heavy: false },
  { id: 'voyager',      label: 'Voyager',         faction: 'Federation', file: 'voyager_ncc_74656_opt.glb',                heavy: false },
  { id: 'warbird',      label: 'Dderidex Warbird', faction: 'Romulan',   file: 'star_trek_-_dderidex_class_warbird_opt.glb', heavy: false },
  { id: 'bird-of-prey', label: 'Bird of Prey',    faction: 'Klingon',    file: 'star_trek_-_bird_of_prey_enterprise_opt.glb', heavy: false },
  { id: 'defiant',      label: 'Defiant',         faction: 'Federation', file: 'defiant_opt.glb',                          heavy: false },
  { id: 'enterprise-d', label: 'Enterprise-D',    faction: 'Federation', file: 'enterprised_opt.glb',                      heavy: false },
];

// ships whose nose ends up pointing backwards after the automatic axis fix get
// flipped here. Tuned by looking at the ?lineup=1 render.
const YAW_FIX = {
  'enterprise-e': 0,
  'voyager': Math.PI,
  'warbird': 0,
  'bird-of-prey': 0,
  'defiant': Math.PI,
  'enterprise-d': Math.PI,
};

// -------------------------------------------------------------- the station ---
// The ring is gone: a proper station model anchors the scene instead. The berth
// pad stays so the hull still has something to sit above.
const dockGroup = new THREE.Group();
scene.add(dockGroup);

const HULL_MAT = new THREE.MeshStandardMaterial({ color: 0x4b525c, metalness: 0.85, roughness: 0.45, envMapIntensity: 0.55 });
const DARK_MAT = new THREE.MeshStandardMaterial({ color: 0x1d2127, metalness: 0.75, roughness: 0.55, envMapIntensity: 0.45 });
// The deck is deliberately unlit: a lit PBR surface under floodlights + IBL kept
// washing out to white, so the deck uses a fixed dark tone and the inlay ring
// provides the "floodlit" cue instead.
const PAD_MAT = new THREE.MeshBasicMaterial({ color: 0x171c23 });
const PAD_RIM_MAT = new THREE.MeshBasicMaterial({ color: 0x2ad4ff, transparent: true, opacity: 0.6 });
const LAMP_MAT = new THREE.MeshStandardMaterial({
  color: 0x0a1018, emissive: 0x4fd1ff, emissiveIntensity: 1.5, metalness: 0.2, roughness: 0.4,
});

const PAD_R = SHIP_LENGTH * 0.24;   // landing pad radius
const SHIP_Y = 0;                   // berths sit on the station's equator
const PAD_DROP = 1.85;              // pad hangs this far below the hull
const STATION_SIZE = SHIP_LENGTH * 2.7;   // longest axis of the station in world units
const STATION_POS = new THREE.Vector3(0, 0, 0);   // the berths ring around it

// One berth per hull, arranged like compass points around the station. Each gets
// its own spoke extruding radially outward, with the pad at the far end.
const BERTH_COUNT = FLEET.length;
const BERTH_RADIUS = SHIP_LENGTH * 2.2;      // pad distance from station centre
const SPOKE_START = 2.8;                     // spokes emerge from inside the hull
// angle 0 is +X; start at +Z so the first spoke points at the camera
const berthAngle = (i) => Math.PI / 2 + (i * Math.PI * 2) / BERTH_COUNT;
const berthDir = (i) => new THREE.Vector3(Math.cos(berthAngle(i)), 0, Math.sin(berthAngle(i)));
const berthPos = (i) => berthDir(i).multiplyScalar(BERTH_RADIUS).setY(SHIP_Y);

const padGlows = [];
for (let i = 0; i < BERTH_COUNT; i++) {
  const a = berthAngle(i);
  const dir = berthDir(i);
  const pos = berthPos(i);

  // spoke: a beam whose long axis is X, rotated so +X follows the radial dir
  const spokeLen = BERTH_RADIUS - SPOKE_START;
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(spokeLen, 0.46, 0.66), HULL_MAT);
  spoke.position.copy(dir.clone().multiplyScalar(SPOKE_START + spokeLen / 2));
  spoke.rotation.y = -a;
  dockGroup.add(spoke);

  // tie ring where the spoke leaves the hull
  const collar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.1), DARK_MAT);
  collar.position.copy(dir.clone().multiplyScalar(SPOKE_START + 0.4));
  collar.rotation.y = -a;
  dockGroup.add(collar);

  // running lights along the spoke
  for (const f of [0.3, 0.6, 0.85]) {
    const r = SPOKE_START + spokeLen * f;
    for (const side of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), LAMP_MAT);
      // offset sideways, perpendicular to the spoke
      lamp.position.copy(dir.clone().multiplyScalar(r)).add(new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(side * 0.4));
      lamp.position.y += 0.3;
      dockGroup.add(lamp);
    }
  }

  // drop post from the spoke end down to the pad
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, PAD_DROP, 10), HULL_MAT);
  post.position.copy(pos).setY(SHIP_Y - PAD_DROP / 2);
  dockGroup.add(post);

  // pad
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(PAD_R, PAD_R * 1.08, 0.14, 48), PAD_MAT);
  deck.position.copy(pos).setY(SHIP_Y - PAD_DROP - 0.07);
  dockGroup.add(deck);

  const glow = new THREE.Mesh(new THREE.RingGeometry(PAD_R * 0.86, PAD_R * 0.99, 64), PAD_RIM_MAT.clone());
  glow.rotation.x = -Math.PI / 2;
  glow.position.copy(pos).setY(SHIP_Y - PAD_DROP + 0.005);
  dockGroup.add(glow);
  padGlows.push(glow);
}

// now that the berth count is known, give every berth its own floodlight
buildFloods(BERTH_COUNT);

// Load the station model. It arrives as a Tripo asset normalised to a 2-unit
// cube, so it is rescaled and re-centred on load.
new THREE.GLTFLoader().load(
  './models/3D.glb',
  (gltf) => {
    const raw = gltf.scene;
    const box = new THREE.Box3().setFromObject(raw);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    raw.position.sub(centre);                      // centre on the group origin

    const holder = new THREE.Group();
    holder.add(raw);
    const s = STATION_SIZE / Math.max(size.x, size.y, size.z);
    holder.scale.setScalar(s);
    holder.position.copy(STATION_POS);
    dockGroup.add(holder);

    raw.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m && m.isMeshStandardMaterial) { m.envMapIntensity = 1.0; m.needsUpdate = true; }
      }
    });

    console.log(`[navigator] station loaded, scaled ${s.toFixed(2)}× (${size.x.toFixed(1)}×${size.y.toFixed(1)}×${size.z.toFixed(1)} native)`);
  },
  undefined,
  (err) => {
    console.error('[navigator] station failed to load, building the old ring instead', err);
    buildFallbackRing();
  }
);

// If the station asset is missing or corrupt the scene still needs an anchor.
function buildFallbackRing() {
  const R = SHIP_LENGTH * 0.66;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.13, 14, 180), HULL_MAT);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -1.5;
  dockGroup.add(ring);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.085, 1.9, 8), HULL_MAT);
    strut.position.set(Math.cos(a) * R, -2.45, Math.sin(a) * R);
    dockGroup.add(strut);
  }
}

const shipRoot = new THREE.Group();
scene.add(shipRoot);

const loader = new THREE.GLTFLoader();
// the optimised heavy models use EXT_meshopt_compression
if (typeof MeshoptDecoder !== 'undefined') loader.setMeshoptDecoder(MeshoptDecoder);
else console.warn('[navigator] MeshoptDecoder missing — optimised models will fail');
const state = {};                   // id -> { slot, model, loaded, loading, index }
let activeId = null;

// One slot per hull, parked at its own berth with the nose pointing outward
// along the spoke. Flight moves the slot, so a launched ship leaves the others.
FLEET.forEach((ship, i) => {
  const slot = new THREE.Group();
  slot.name = `berth:${ship.id}`;
  slot.position.copy(berthPos(i));
  slot.rotation.y = Math.PI - berthAngle(i);   // nose (-X) -> radial outward
  shipRoot.add(slot);
  state[ship.id] = { slot, model: null, loaded: false, loading: false, index: i };
});

const panel = document.getElementById('ship-info');
const listEl = document.getElementById('ship-list');
const statusEl = document.getElementById('status');

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#ff6b6b' : 'rgba(255,255,255,0.66)';
}

// Normalise an arbitrary glTF into: centred, longest axis along +X, length = SHIP_LENGTH.
function normalise(rawRoot, id) {
  const group = new THREE.Group();

  const box = new THREE.Box3().setFromObject(rawRoot);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  rawRoot.position.sub(centre);

  // put the longest axis on X so every hull is compared like for like
  if (size.y >= size.x && size.y >= size.z) {
    group.rotation.z = -Math.PI / 2;          // Y forward -> X forward
  } else if (size.z >= size.x && size.z >= size.y) {
    group.rotation.y = Math.PI / 2;           // Z forward -> X forward
  }

  group.add(rawRoot);

  const longest = Math.max(size.x, size.y, size.z);
  const s = SHIP_LENGTH / longest;
  group.scale.setScalar(s);

  // nose direction is unknowable from a bounding box, so it is a per-ship constant
  group.rotation.y += (YAW_FIX[id] || 0);

  // keep materials honest: metallic hulls need the environment to read at all
  rawRoot.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.isMeshStandardMaterial) {
        if (m.metalness > 0.85 && !m.map) m.metalness = 0.7;
        m.envMapIntensity = 1.35;
        m.needsUpdate = true;
      }
    }
  });

  return group;
}

function buildButtons() {
  listEl.innerHTML = '';
  for (const ship of FLEET) {
    const btn = document.createElement('button');
    btn.dataset.id = ship.id;
    btn.innerHTML = `<span class="label">${ship.label}</span><span class="tag">${ship.faction}</span>`;
    btn.onclick = () => selectShip(ship.id);
    if (ship.heavy) btn.classList.add('heavy');
    listEl.appendChild(btn);
  }
}

function markButton(id, cls) {
  const btn = listEl.querySelector(`button[data-id="${id}"]`);
  if (!btn) return;
  btn.classList.remove('loaded', 'loading', 'failed');
  if (cls) btn.classList.add(cls);
}

// Highlight the active berth and fly the camera to it. Every hull stays docked;
// selection is emphasis, not visibility.
function showShip(id, focus) {
  activeId = id;
  const ship = FLEET.find((s) => s.id === id);
  for (const btn of listEl.querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.id === id);
  }
  // pad glow: active berth is bright, the rest idle
  FLEET.forEach((s) => {
    const glow = padGlows[state[s.id].index];
    if (!glow) return;
    const on = s.id === id;
    glow.material.opacity = on ? 0.95 : 0.28;
    glow.material.color.setHex(on ? 0x6ff0ff : 0x2ad4ff);
  });
  if (ship) document.getElementById('ship-name').textContent = ship.label;
  if (focus && ship) focusBerth(state[id].index);
}

// Wide shot of the whole station with its ring of berths.
function overviewCamera() {
  camTween = {
    t: 0, dur: 0.6,
    fromPos: camera.position.clone(),
    toPos: new THREE.Vector3(3, 27, 46),
    fromTarget: controls.target.clone(),
    // aim left of centre: the panel covers the left edge of the canvas
    toTarget: new THREE.Vector3(-6, 0, 0),
  };
}

// smooth camera move to a berth, eased in frame()
let camTween = null;
function focusBerth(index) {
  if (LINEUP) return;
  const p = berthPos(index);
  const out = berthDir(index).multiplyScalar(13);        // stand outside the ring
  camTween = {
    t: 0,
    dur: 0.85,
    fromPos: camera.position.clone(),
    toPos: p.clone().add(out).add(new THREE.Vector3(0, 7.5, 0)),
    fromTarget: controls.target.clone(),
    toTarget: p.clone().setY(SHIP_Y - 0.4),
  };
}

function loadShip(id, onDone) {
  const ship = FLEET.find((s) => s.id === id);
  const entry = state[id];
  if (!ship || !entry) return;
  if (entry.loaded) { if (onDone) onDone(); return; }
  if (entry.loading) return;

  entry.loading = true;
  markButton(id, 'loading');

  loader.load(
    `./models/${ship.file}`,
    (gltf) => {
      const model = normalise(gltf.scene, id);
      entry.slot.add(model);          // parked at the berth by the slot
      entry.model = model;
      entry.loaded = true;
      entry.loading = false;
      markButton(id, 'loaded');
      console.log(`[navigator] loaded ${ship.file} at berth ${entry.index}`);
      if (onDone) onDone(ship);
    },
    undefined,
    (err) => {
      entry.loading = false;
      markButton(id, 'failed');
      console.error(`[navigator] failed ${ship.file}`, err);
      setStatus(`Could not load ${ship.label}: ${err && err.message ? err.message : err}`, true);
      if (onDone) onDone(ship, err);
    }
  );
}

function selectShip(id) {
  const ship = FLEET.find((s) => s.id === id);
  if (!ship) return;
  const entry = state[id];

  if (entry.loaded) {
    showShip(id, true);
    setStatus(`${ship.label} — ${ship.faction}, berth ${entry.index + 1}`);
    return;
  }
  if (entry.loading) {
    showShip(id, true);
    setStatus(`Loading ${ship.label}…`);
    return;
  }
  setStatus(`Loading ${ship.label}…`);
  loadShip(id, () => {
    showShip(id, true);
    setStatus(`${ship.label} — ${ship.faction}, berth ${entry.index + 1}`);
  });
}

// ----------------------------------------------------------------- lineup -----
// ?lineup=1 lays every light ship out in a row so orientation can be checked in
// one screenshot instead of guessing.
const params = new URLSearchParams(location.search);
const LINEUP = params.get('lineup') === '1';
const ONLY = params.get('only');                 // e.g. ?lineup=1&only=defiant
const INCLUDE_HEAVY = params.get('heavy') === '1'; // include the 125 MB pair

if (LINEUP) {
  document.body.classList.add('lineup');
  dockGroup.visible = false;                 // clear view of the hulls themselves
  let order = FLEET.filter((s) => INCLUDE_HEAVY || !s.heavy);
  if (ONLY) order = order.filter((s) => s.id === ONLY);

  const n = order.length;
  const spacing = n === 1 ? 0 : 16;
  let placed = 0;

  order.forEach((ship, i) => {
    loader.load(`./models/${ship.file}`, (gltf) => {
      const g = normalise(gltf.scene, ship.id);
      g.position.set((i - (n - 1) / 2) * spacing, 0, 0);
      shipRoot.add(g);
      placed++;
      if (placed === n) {
        const dist = n === 1 ? 22 : n === 2 ? 34 : 62;
        camera.position.set(0, dist * 0.22, dist);
        controls.target.set(0, 0, 0);
        setStatus(`${n} ship${n > 1 ? 's' : ''}, left to right: ` + order.map((s) => s.label).join(' · '));
      } else {
        setStatus(`lineup: ${placed}/${n} loaded…`);
      }
    }, undefined, (err) => {
      setStatus(`lineup failed for ${ship.label}: ${err}`, true);
    });
  });
}

// ------------------------------------------------------------------ loop ------
buildButtons();
if (!LINEUP) {
  let done = 0;
  setStatus(`Loading the fleet into ${BERTH_COUNT} berths…`);
  for (const ship of FLEET) {
    loadShip(ship.id, () => {
      done++;
      const ok = FLEET.filter((s) => state[s.id].loaded).length;
      if (done === BERTH_COUNT) {
        setStatus(`${ok}/${BERTH_COUNT} hulls docked — click one to fly over to it.`);
        const first = FLEET.find((s) => state[s.id].loaded);
        if (first) showShip(first.id, false);   // highlight, but stay on the wide shot
        overviewCamera();
      } else {
        setStatus(`Loading the fleet… ${done}/${BERTH_COUNT}`);
      }
    });
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
let prevT = 0;
// handy for debugging from the console / screenshots
window.__nav = {
  scene, camera, controls, shipRoot, dockGroup, renderer, state,
  slots: Object.fromEntries(Object.entries(state).map(([k, v]) => [k, v.slot])),
  berthPos, berthDir, berthAngle, padGlows,
  getActive: () => activeId,
  overviewCamera,
  // test hook: the tween only advances on rendered frames, which a headless tab
  // may never produce, so it must be cancellable from outside
  clearTween: () => { camTween = null; },
};
// other modules (flight.js) hook the render loop through this
window.__navHooks = window.__navHooks || [];
// The frame body is separate from the rAF wrapper so it can be stepped by hand.
// Headless browsers suspend rAF in background tabs, which otherwise makes
// automated verification of anything time-based impossible.
function frame(dt, t) {
  // the station is a real structure now, so nothing spins: a rotating dock would
  // slide the berth out from under a parked hull
  LAMP_MAT.emissiveIntensity = 1.25 + Math.sin(t * 2.2) * 0.35;

  // eased fly-to when a berth is selected
  if (camTween && controls.enabled) {
    camTween.t += dt;
    const k = Math.min(camTween.t / camTween.dur, 1);
    const e = k < 0.5 ? 2 * k * k : -1 + (4 - 2 * k) * k;   // easeInOutQuad
    camera.position.lerpVectors(camTween.fromPos, camTween.toPos, e);
    controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, e);
    if (k >= 1) camTween = null;
  }

  for (const fn of window.__navHooks) fn(dt, t);
  // OrbitControls.update() re-derives the camera from its own state every call,
  // even when `enabled` is false, so it must not run while flight drives the camera
  if (controls.enabled) controls.update();
  renderer.render(scene, camera);
}

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  const dt = Math.min(t - prevT, 0.05);   // clamp so a stalled tab can't teleport the ship
  prevT = t;
  frame(dt, t);
}

window.__nav.frame = frame;
animate();
