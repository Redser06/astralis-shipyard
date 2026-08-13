import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { 
  Rocket, 
  Shield, 
  Zap, 
  Crosshair, 
  Sparkles, 
  Download, 
  RotateCw, 
  Eye, 
  Flame, 
  Volume2, 
  VolumeX, 
  Atom, 
  Check, 
  RefreshCw, 
  PenTool, 
  Terminal, 
  Boxes, 
  Orbit 
} from 'lucide-react';

// --- Web Audio Synthesizer ---
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }
  init() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) this.ctx = new AudioContext();
    }
  }
  playClick() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, this.ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.05);
  }
  playWarp() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, this.ctx.currentTime + 0.4);
    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.4);
  }
  playBurn() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(65, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(90, this.ctx.currentTime + 0.6);
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.6);
  }
}
const sfx = new SoundEngine();

// --- Tech Catalog & Database ---
const COMPONENT_DATABASE = {
  sublight: [
    { id: 'ion_pulse', name: 'Ion Pulse Drive Mk-I', tier: 1, thrust: 140, efficiency: 95, mass: 18, desc: 'High specific impulse xenon drive with steady cyan ion trail.' },
    { id: 'mpd_thruster', name: 'Magnetoplasmadynamic Torch', tier: 2, thrust: 320, efficiency: 82, mass: 28, desc: 'Electromagnetic lorentz-force plasma accelerator.' },
    { id: 'fusion_torch', name: 'Thermonuclear Fusion Torch', tier: 3, thrust: 780, efficiency: 70, mass: 45, desc: 'Direct D-He3 fusion reaction exhaust with raw impulse.' }
  ],
  ftl: [
    { id: 'none', name: 'Sublight Only (No FTL)', tier: 1, jumpRange: 0, powerDraw: 0, mass: 0, desc: 'Standard system-bound configuration.' },
    { id: 'hyper_shunt', name: 'Hyperspace Shunt Core', tier: 2, jumpRange: 8.5, powerDraw: 45, mass: 35, desc: 'Jumps through subspace beacon corridors.' },
    { id: 'alcubierre_ring', name: 'Alcubierre Spacetime Warp Ring', tier: 3, jumpRange: 32.0, powerDraw: 85, mass: 65, desc: 'Smooth toroidal ring bending spacetime around hull without inertial dilation.' },
    { id: 'graviton_singularity', name: 'Graviton Fold Engine', tier: 4, jumpRange: 95.0, powerDraw: 140, mass: 90, desc: 'Instantaneous spatial translation via micro-singularity manifold.' }
  ],
  weapons: [
    { id: 'gauss_cannons', name: 'Twin Gauss Railguns', type: 'Kinetic', tier: 1, damage: 180, rate: 85, heat: 35, desc: 'Magnetic coil accelerates solid depleted-uranium slugs.' },
    { id: 'plasma_lance', name: 'Coherent Plasma Lance', type: 'Energy', tier: 2, damage: 340, rate: 50, heat: 65, desc: 'Superheated magnetic flux beam melting armored plating.' },
    { id: 'quantum_torpedoes', name: 'Quantum Singularity Torpedoes', type: 'Ordnance', tier: 3, damage: 620, rate: 25, heat: 40, desc: 'Micro-collapsar warheads delivering localized gravitational crushing.' },
    { id: 'tachyon_disruptor', name: 'Tachyon Beam Disruptor', type: 'Energy', tier: 4, damage: 890, rate: 70, heat: 90, desc: 'Sub-atomic superluminal particle stream bypassing kinetic shields.' }
  ],
  sensors: [
    { id: 'radar_dome', name: 'Pulse-Doppler Radar Dome', tier: 1, range: 450, resolution: 60, desc: 'Basic orbital RF transceiver dome.' },
    { id: 'ladar_array', name: 'Deep Space Coherent LADAR Spine', tier: 2, range: 1200, resolution: 92, desc: 'Multi-wavelength laser telemetry for stealth craft tracking.' },
    { id: 'tachyon_scanner', name: 'Tachyon Spacetime Scanner', tier: 3, range: 4800, resolution: 98, desc: 'Detects superluminal hyperspace wakes and warp distortions.' }
  ],
  fuel: [
    { id: 'cryo_h2', name: 'Cryogenic Liquid H2 Bulk Tanks', tier: 1, capacity: 4000, size: 'Bulky External', massFactor: 1.4, desc: 'Large starter pressurized tanks occupying significant volume.' },
    { id: 'd_he3_bottles', name: 'Deuterium-He3 Magnetic Bottles', tier: 2, capacity: 8500, size: 'Medium Internal', massFactor: 1.1, desc: 'Pressurized magnetic confinement with improved density.' },
    { id: 'antimatter_pods', name: 'Matter-Antimatter Pods', tier: 3, capacity: 22000, size: 'Compact Core', massFactor: 0.7, desc: 'Penning-trap containment providing extreme energy density.' },
    { id: 'zero_point_core', name: 'Zero-Point Micro-Singularity', tier: 4, capacity: 99999, size: 'Micro Core', massFactor: 0.25, desc: 'Taps quantum vacuum fluctuations for near-limitless endurance.' }
  ],
  materials: [
    { id: 'duranium', name: 'Reinforced Duranium-3 Plating', tier: 1, armor: 250, weight: 1.3, color: '#475569', roughness: 0.4, metalness: 0.8 },
    { id: 'carbon_nanotube', name: 'Carbon-Nanotube Weave', tier: 2, armor: 480, weight: 0.9, color: '#1E293B', roughness: 0.2, metalness: 0.9 },
    { id: 'titanium_aerogel', name: 'Titanium-Aerogel Matrix', tier: 3, armor: 720, weight: 0.7, color: '#94A3B8', roughness: 0.15, metalness: 0.95 },
    { id: 'chronium_cloak', name: 'Chronium Metamaterial Lattice', tier: 4, armor: 1150, weight: 0.55, color: '#0284C7', roughness: 0.05, metalness: 1.0 }
  ]
};

// Preset Ship Templates
const SHIP_PRESETS = [
  {
    id: 'sentinel_interceptor',
    name: 'VOD-3 Sentinel Interceptor',
    class: 'Stealth Interceptor',
    hullProfile: 'stealth_arrow',
    sublight: 'mpd_thruster',
    ftl: 'alcubierre_ring',
    weapons: 'plasma_lance',
    sensors: 'ladar_array',
    fuel: 'antimatter_pods',
    material: 'carbon_nanotube',
    accentColor: '#38BDF8',
    stats: { speed: 88, maneuver: 94, firepower: 72, shield: 65, jump: 32 }
  },
  {
    id: 'aegis_battlecruiser',
    name: 'BC-9 Aegis Heavy Battlecruiser',
    class: 'Heavy Battlecruiser',
    hullProfile: 'raptor_wedge',
    sublight: 'fusion_torch',
    ftl: 'graviton_singularity',
    weapons: 'quantum_torpedoes',
    sensors: 'tachyon_scanner',
    fuel: 'zero_point_core',
    material: 'titanium_aerogel',
    accentColor: '#F59E0B',
    stats: { speed: 64, maneuver: 55, firepower: 96, shield: 92, jump: 95 }
  },
  {
    id: 'helios_explorer',
    name: 'EX-7 Helios Deep Explorer',
    class: 'Scientific Explorer',
    hullProfile: 'organic_manta',
    sublight: 'ion_pulse',
    ftl: 'alcubierre_ring',
    weapons: 'tachyon_disruptor',
    sensors: 'tachyon_scanner',
    fuel: 'antimatter_pods',
    material: 'chronium_cloak',
    accentColor: '#10B981',
    stats: { speed: 75, maneuver: 80, firepower: 60, shield: 78, jump: 45 }
  }
];

export default function AstralisShipyard() {
  const [activeTab, setActiveTab] = useState('designer'); // designer | rnd | spline | ai
  const [currentShip, setCurrentShip] = useState(SHIP_PRESETS[0]);
  const [environment, setEnvironment] = useState('drydock'); // drydock | nebula | asteroid
  const [isTestBurning, setIsTestBurning] = useState(false);
  const [wireframeMode, setWireframeMode] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  
  // Spline Sculpting State (Bezier Points [x, y])
  const [splinePoints, setSplinePoints] = useState([
    { id: 0, x: 20, y: 150, label: 'Nose Tip' },
    { id: 1, x: 90, y: 110, label: 'Cockpit Contour' },
    { id: 2, x: 200, y: 80, label: 'Mid Waist' },
    { id: 3, x: 310, y: 50, label: 'Wing Root Sweep' },
    { id: 4, x: 420, y: 110, label: 'Engine Nacelle' },
    { id: 5, x: 460, y: 150, label: 'Aft Exhaust' }
  ]);
  const [selectedSplinePoint, setSelectedSplinePoint] = useState(null);

  // R&D Tech Unlocks
  const [unlockedTechs, setUnlockedTechs] = useState({
    ion_pulse: true,
    mpd_thruster: true,
    fusion_torch: true,
    hyper_shunt: true,
    alcubierre_ring: true,
    graviton_singularity: false,
    gauss_cannons: true,
    plasma_lance: true,
    quantum_torpedoes: true,
    tachyon_disruptor: false,
    radar_dome: true,
    ladar_array: true,
    tachyon_scanner: true,
    cryo_h2: true,
    d_he3_bottles: true,
    antimatter_pods: true,
    zero_point_core: false,
    duranium: true,
    carbon_nanotube: true,
    titanium_aerogel: true,
    chronium_cloak: false
  });
  const [researchPoints, setResearchPoints] = useState(14500);

  // AI Architect State
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiChatLog, setAiChatLog] = useState([
    { sender: 'ai', text: 'Greetings, Architect. Astralis Shipyard CAD Matrix online. Describe your starship concept, tactical role, or engine requirements to instantly forge custom 3D ship configurations.' }
  ]);

  // Three.js Canvas Reference
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const shipGroupRef = useRef(null);
  const cameraRef = useRef(null);
  const particlesRef = useRef(null);
  const gantryRef = useRef(null);
  const animationFrameId = useRef(null);
  const isDraggingRef = useRef(false);
  const prevMousePosRef = useRef({ x: 0, y: 0 });
  const cameraAngleRef = useRef({ theta: 0.6, phi: 1.1, radius: 24 });

  // --- Three.js Procedural Starship Builder ---
  useEffect(() => {
    if (!mountRef.current) return;
    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    // 1. Scene & Camera
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x060913);
    scene.fog = new THREE.FogExp2(0x060913, 0.015);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    cameraRef.current = camera;
    updateCameraPosition();

    // 2. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    rendererRef.current = renderer;
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);

    // 3. Lighting
    const ambientLight = new THREE.AmbientLight(0x38bdf8, 0.4);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(20, 30, 20);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x818cf8, 1.8);
    rimLight.position.set(-20, -10, -20);
    scene.add(rimLight);

    const fillLight = new THREE.PointLight(0x38bdf8, 3, 40);
    fillLight.position.set(0, -6, 0);
    scene.add(fillLight);

    // 4. Ship Container Group
    const shipGroup = new THREE.Group();
    shipGroupRef.current = shipGroup;
    scene.add(shipGroup);

    // 5. Build Environment & Stars
    buildEnvironment(scene, environment);

    // 6. Build Initial Starship Mesh
    rebuildShipMesh();

    // 7. Mouse Orbit Controls Event Listeners
    const dom = renderer.domElement;
    const onMouseDown = (e) => {
      isDraggingRef.current = true;
      prevMousePosRef.current = { x: e.clientX, y: e.clientY };
    };
    const onMouseMove = (e) => {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - prevMousePosRef.current.x;
      const dy = e.clientY - prevMousePosRef.current.y;
      prevMousePosRef.current = { x: e.clientX, y: e.clientY };

      cameraAngleRef.current.theta -= dx * 0.008;
      cameraAngleRef.current.phi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraAngleRef.current.phi - dy * 0.008));
      updateCameraPosition();
    };
    const onMouseUp = () => { isDraggingRef.current = false; };
    const onWheel = (e) => {
      e.preventDefault();
      cameraAngleRef.current.radius = Math.max(8, Math.min(60, cameraAngleRef.current.radius + e.deltaY * 0.02));
      updateCameraPosition();
    };

    dom.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    dom.addEventListener('wheel', onWheel, { passive: false });

    // 8. Render Loop
    let clock = new THREE.Clock();
    const animate = () => {
      animationFrameId.current = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();

      // Auto rotation
      if (autoRotate && !isDraggingRef.current) {
        cameraAngleRef.current.theta += 0.004;
        updateCameraPosition();
      }

      // Thruster Particle Animation
      if (particlesRef.current) {
        const positions = particlesRef.current.geometry.attributes.position.array;
        for (let i = 2; i < positions.length; i += 3) {
          positions[i] -= (isTestBurning ? 0.9 : 0.25);
          if (positions[i] < -18) {
            positions[i] = -4.5;
            positions[i - 2] = (Math.random() - 0.5) * 1.2;
            positions[i - 1] = (Math.random() - 0.5) * 0.8;
          }
        }
        particlesRef.current.geometry.attributes.position.needsUpdate = true;
      }

      // Gentle Ship Hover Bobbing
      if (shipGroupRef.current) {
        shipGroupRef.current.position.y = Math.sin(elapsed * 1.5) * 0.15;
      }

      // Gantry Laser Scanners Pulsing
      if (gantryRef.current) {
        gantryRef.current.rotation.y = Math.sin(elapsed * 0.4) * 0.1;
      }

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId.current);
      window.removeEventListener('resize', handleResize);
      dom.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      dom.removeEventListener('wheel', onWheel);
      if (rendererRef.current && rendererRef.current.domElement) {
        rendererRef.current.dispose();
      }
    };
  }, []);

  // Update Camera Position Helper
  const updateCameraPosition = () => {
    if (!cameraRef.current) return;
    const { theta, phi, radius } = cameraAngleRef.current;
    cameraRef.current.position.x = radius * Math.sin(phi) * Math.sin(theta);
    cameraRef.current.position.y = radius * Math.cos(phi);
    cameraRef.current.position.z = radius * Math.sin(phi) * Math.cos(theta);
    cameraRef.current.lookAt(0, 0, 0);
  };

  // Build Procedural Environment (Drydock vs Nebula vs Asteroids)
  const buildEnvironment = (scene, envType) => {
    // Remove old environment elements
    const oldEnv = scene.getObjectByName('environment_container');
    if (oldEnv) scene.remove(oldEnv);

    const envContainer = new THREE.Group();
    envContainer.name = 'environment_container';

    // 1. Starfield Particles
    const starCount = 1800;
    const starGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i += 3) {
      starPositions[i] = (Math.random() - 0.5) * 400;
      starPositions[i + 1] = (Math.random() - 0.5) * 400;
      starPositions[i + 2] = (Math.random() - 0.5) * 400;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.8, transparent: true, opacity: 0.85 });
    const starField = new THREE.Points(starGeo, starMat);
    envContainer.add(starField);

    if (envType === 'drydock') {
      // Orbital Drydock Gantry with Holographic Floor Grid
      const grid = new THREE.GridHelper(50, 40, 0x38bdf8, 0x1e293b);
      grid.position.y = -6;
      envContainer.add(grid);

      // Gantry Frame Columns
      const gantryGroup = new THREE.Group();
      gantryRef.current = gantryGroup;
      const beamMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9, roughness: 0.3 });
      const lightBeamMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

      for (let side of [-14, 14]) {
        const colGeo = new THREE.BoxGeometry(1.2, 16, 1.2);
        const col = new THREE.Mesh(colGeo, beamMat);
        col.position.set(side, 2, 0);
        gantryGroup.add(col);

        const armGeo = new THREE.BoxGeometry(8, 0.8, 0.8);
        const arm = new THREE.Mesh(armGeo, beamMat);
        arm.position.set(side > 0 ? side - 4 : side + 4, 8, 0);
        gantryGroup.add(arm);

        // Laser Projector Tip
        const laserTip = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 8), lightBeamMat);
        laserTip.rotation.z = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        laserTip.position.set(side > 0 ? side - 8 : side + 8, 8, 0);
        gantryGroup.add(laserTip);
      }
      envContainer.add(gantryGroup);

      // Distant Planet Sphere
      const planetGeo = new THREE.SphereGeometry(60, 32, 32);
      const planetMat = new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        roughness: 0.8,
        metalness: 0.1,
        emissive: 0x0369a1,
        emissiveIntensity: 0.15
      });
      const planet = new THREE.Mesh(planetGeo, planetMat);
      planet.position.set(120, -40, -180);
      envContainer.add(planet);
    } else if (envType === 'nebula') {
      // Colorful Nebula Cloud Spheres
      const colors = [0x818cf8, 0xa855f7, 0x38bdf8];
      for (let i = 0; i < 15; i++) {
        const cloudGeo = new THREE.SphereGeometry(15 + Math.random() * 10, 16, 16);
        const cloudMat = new THREE.MeshBasicMaterial({
          color: colors[i % colors.length],
          transparent: true,
          opacity: 0.08,
          wireframe: true
        });
        const cloud = new THREE.Mesh(cloudGeo, cloudMat);
        cloud.position.set((Math.random() - 0.5) * 120, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 120);
        envContainer.add(cloud);
      }
    } else if (envType === 'asteroid') {
      // Floating Asteroids
      const astMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.9 });
      for (let i = 0; i < 25; i++) {
        const astGeo = new THREE.DodecahedronGeometry(1.5 + Math.random() * 2.5, 1);
        const ast = new THREE.Mesh(astGeo, astMat);
        ast.position.set((Math.random() - 0.5) * 70, (Math.random() - 0.5) * 40 - 2, (Math.random() - 0.5) * 70);
        ast.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        envContainer.add(ast);
      }
    }

    scene.add(envContainer);
  };

  // Re-run environment build when environment state changes
  useEffect(() => {
    if (sceneRef.current) {
      buildEnvironment(sceneRef.current, environment);
    }
  }, [environment]);

  // Rebuild Full 3D Starship Mesh based on Ship State & Splines
  const rebuildShipMesh = () => {
    if (!shipGroupRef.current) return;
    const group = shipGroupRef.current;
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }

    const matConfig = COMPONENT_DATABASE.materials.find(m => m.id === currentShip.material) || COMPONENT_DATABASE.materials[0];
    const hullColor = new THREE.Color(matConfig.color);
    const accentColor = new THREE.Color(currentShip.accentColor);

    // 1. Hull Material
    const hullMat = new THREE.MeshStandardMaterial({
      color: hullColor,
      roughness: matConfig.roughness,
      metalness: matConfig.metalness,
      wireframe: wireframeMode
    });

    const canopyMat = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      metalness: 0.1,
      roughness: 0.05,
      transmission: 0.85,
      transparent: true,
      opacity: 0.9,
      reflectivity: 0.9,
      wireframe: wireframeMode
    });

    const glowMat = new THREE.MeshBasicMaterial({ color: accentColor });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.8 });

    // --- PROCEDURAL REFINED HULL WITH SMOOTH BEZIER PROFILE ---
    // Generate Lathed Hull using the 2D Spline Points
    const curvePoints = splinePoints.map(p => {
      // Map canvas coordinates to 3D lathe profile
      const x = (p.y - 150) * -0.025 + 0.1; // radius from center
      const y = (p.x - 240) * 0.022;        // length along z-axis
      return new THREE.Vector2(Math.max(0.15, Math.abs(x)), y);
    });

    // Sort along Z axis
    curvePoints.sort((a, b) => a.y - b.y);
    const hullGeo = new THREE.LatheGeometry(curvePoints, 32);
    hullGeo.rotateX(Math.PI / 2);
    hullGeo.scale(1.4, 0.75, 1.4); // Flatten horizontally for sleek aerodynamic stealth aesthetic
    const hullMesh = new THREE.Mesh(hullGeo, hullMat);
    group.add(hullMesh);

    // 2. Sleek Cockpit Canopy Bulge
    const canopyGeo = new THREE.SphereGeometry(1.2, 24, 16);
    canopyGeo.scale(0.8, 0.45, 2.0);
    const canopyMesh = new THREE.Mesh(canopyGeo, canopyMat);
    canopyMesh.position.set(0, 0.7, 1.2);
    group.add(canopyMesh);

    // 3. Swept Aerodynamic Delta Wings
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(6.5, -2.8);
    wingShape.lineTo(6.8, -4.2);
    wingShape.lineTo(2.0, -3.8);
    wingShape.lineTo(0, -3.2);
    wingShape.closePath();

    const extrudeSettings = { depth: 0.18, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.08, bevelThickness: 0.08 };
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, extrudeSettings);
    wingGeo.rotateX(Math.PI / 2);

    // Right Wing
    const rightWing = new THREE.Mesh(wingGeo, hullMat);
    rightWing.position.set(0.8, 0, 0.5);
    group.add(rightWing);

    // Left Wing (Mirrored)
    const leftWing = new THREE.Mesh(wingGeo, hullMat);
    leftWing.scale.set(-1, 1, 1);
    leftWing.position.set(-0.8, 0, 0.5);
    group.add(leftWing);

    // Wingtip Accent Glow Strips
    const wingTipGeo = new THREE.BoxGeometry(0.1, 0.1, 1.6);
    const rightWingGlow = new THREE.Mesh(wingTipGeo, glowMat);
    rightWingGlow.position.set(7.1, 0.1, -3.0);
    group.add(rightWingGlow);

    const leftWingGlow = new THREE.Mesh(wingTipGeo, glowMat);
    leftWingGlow.position.set(-7.1, 0.1, -3.0);
    group.add(leftWingGlow);

    // 4. Sublight Engine Nacelles & Thruster Cones
    for (let xOffset of [-1.8, 1.8]) {
      const nacelleGeo = new THREE.CylinderGeometry(0.75, 0.95, 3.8, 24);
      nacelleGeo.rotateX(Math.PI / 2);
      const nacelle = new THREE.Mesh(nacelleGeo, darkMat);
      nacelle.position.set(xOffset, -0.1, -3.8);
      group.add(nacelle);

      // Glowing Thruster Exhaust Core
      const thrusterGeo = new THREE.CylinderGeometry(0.65, 0.4, 0.4, 24);
      thrusterGeo.rotateX(Math.PI / 2);
      const thruster = new THREE.Mesh(thrusterGeo, glowMat);
      thruster.position.set(xOffset, -0.1, -5.6);
      group.add(thruster);
    }

    // 5. FTL Engine Component (Alcubierre Ring / Graviton Shunt)
    if (currentShip.ftl === 'alcubierre_ring') {
      const ringGeo = new THREE.TorusGeometry(3.6, 0.28, 16, 48);
      const ringMat = new THREE.MeshPhysicalMaterial({
        color: 0x818cf8,
        emissive: 0x818cf8,
        emissiveIntensity: 0.6,
        metalness: 0.9,
        roughness: 0.1,
        transparent: true,
        opacity: 0.88,
        wireframe: wireframeMode
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(0, 0.1, -1.2);
      group.add(ring);
    } else if (currentShip.ftl === 'graviton_singularity') {
      const coreGeo = new THREE.SphereGeometry(1.4, 24, 24);
      const coreMat = new THREE.MeshStandardMaterial({
        color: 0xa855f7,
        emissive: 0xa855f7,
        emissiveIntensity: 0.9,
        wireframe: true
      });
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.position.set(0, 0.6, -1.8);
      group.add(core);
    }

    // 6. Weapon Hardpoints (Gauss / Plasma / Torpedoes)
    for (let xOffset of [-3.2, 3.2]) {
      const weaponMountGeo = new THREE.BoxGeometry(0.5, 0.4, 1.8);
      const mount = new THREE.Mesh(weaponMountGeo, darkMat);
      mount.position.set(xOffset, -0.2, -1.0);
      group.add(mount);

      if (currentShip.weapons === 'gauss_cannons' || currentShip.weapons === 'plasma_lance') {
        const barrelGeo = new THREE.CylinderGeometry(0.09, 0.09, 2.2, 12);
        barrelGeo.rotateX(Math.PI / 2);
        const barrel = new THREE.Mesh(barrelGeo, new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.95 }));
        barrel.position.set(xOffset, -0.2, 0.8);
        group.add(barrel);
      } else {
        // Torpedo Tube Pod
        const podGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.6, 16);
        podGeo.rotateX(Math.PI / 2);
        const pod = new THREE.Mesh(podGeo, glowMat);
        pod.position.set(xOffset, -0.15, 0.5);
        group.add(pod);
      }
    }

    // 7. Sensor / LADAR Spine or Dome
    if (currentShip.sensors === 'ladar_array' || currentShip.sensors === 'tachyon_scanner') {
      const spineGeo = new THREE.CylinderGeometry(0.08, 0.15, 3.2, 12);
      spineGeo.rotateX(Math.PI / 2);
      const spine = new THREE.Mesh(spineGeo, glowMat);
      spine.position.set(0, 1.2, 0);
      group.add(spine);
    } else {
      const domeGeo = new THREE.SphereGeometry(0.6, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      const dome = new THREE.Mesh(domeGeo, darkMat);
      dome.position.set(0, 0.8, -0.5);
      group.add(dome);
    }

    // 8. Dynamic Engine Particle System
    const pCount = 120;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount * 3; i += 3) {
      pPos[i] = (Math.random() - 0.5) * 1.4;
      pPos[i + 1] = (Math.random() - 0.5) * 0.8;
      pPos[i + 2] = -4.5 - Math.random() * 12;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({
      color: accentColor,
      size: 0.45,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });
    const particles = new THREE.Points(pGeo, pMat);
    particlesRef.current = particles;
    group.add(particles);
  };

  // Trigger rebuild when ship design or wireframe updates
  useEffect(() => {
    rebuildShipMesh();
  }, [currentShip, wireframeMode, splinePoints]);

  // Handle Component Swap
  const handleSwapComponent = (category, item) => {
    if (soundEnabled) sfx.playClick();
    setCurrentShip(prev => ({
      ...prev,
      [category]: item.id
    }));
  };

  // Handle Preset Selection
  const handleSelectPreset = (preset) => {
    if (soundEnabled) sfx.playWarp();
    setCurrentShip(preset);
  };

  // Handle Engine Test Burn
  const handleTestBurn = () => {
    if (soundEnabled) sfx.playBurn();
    setIsTestBurning(true);
    setTimeout(() => setIsTestBurning(false), 2200);
  };

  // Handle Tech Research Unlock
  const handleUnlockTech = (techId, cost) => {
    if (researchPoints >= cost) {
      if (soundEnabled) sfx.playWarp();
      setResearchPoints(prev => prev - cost);
      setUnlockedTechs(prev => ({ ...prev, [techId]: true }));
    }
  };

  // Handle AI Ship Generation Prompt
  const handleSendAiPrompt = () => {
    if (!aiPrompt.trim() || isAiGenerating) return;
    if (soundEnabled) sfx.playClick();
    
    const userMessage = aiPrompt;
    setAiChatLog(prev => [...prev, { sender: 'user', text: userMessage }]);
    setAiPrompt('');
    setIsAiGenerating(true);

    setTimeout(() => {
      // Procedural AI heuristic parser
      const lower = userMessage.toLowerCase();
      let newPreset = { ...currentShip };
      let responseText = '';

      if (lower.includes('stealth') || lower.includes('recon') || lower.includes('black ops')) {
        newPreset = {
          ...currentShip,
          name: 'VOD-X Shadow Wraith',
          class: 'Stealth Interceptor',
          material: 'carbon_nanotube',
          accentColor: '#38BDF8',
          sublight: 'mpd_thruster',
          ftl: 'alcubierre_ring',
          sensors: 'ladar_array'
        };
        responseText = 'Configured Shadow Wraith stealth profile with low-observability carbon weave, ladar spine, and Alcubierre warp ring.';
      } else if (lower.includes('heavy') || lower.includes('battleship') || lower.includes('dreadnought') || lower.includes('war')) {
        newPreset = {
          ...currentShip,
          name: 'DREAD-9 Iron Sovereign',
          class: 'Heavy Dreadnought',
          material: 'titanium_aerogel',
          accentColor: '#F43F5E',
          sublight: 'fusion_torch',
          ftl: 'graviton_singularity',
          weapons: 'quantum_torpedoes'
        };
        responseText = 'Assembled Heavy Dreadnought matrix: Reinforced titanium aerogel armor, thermonuclear fusion torch, and micro-singularity ordnance.';
      } else if (lower.includes('explorer') || lower.includes('deep space') || lower.includes('science')) {
        newPreset = {
          ...currentShip,
          name: 'VOID-7 Chronos Voyager',
          class: 'Deep Space Explorer',
          material: 'chronium_cloak',
          accentColor: '#10B981',
          sublight: 'ion_pulse',
          ftl: 'graviton_singularity',
          sensors: 'tachyon_scanner',
          fuel: 'zero_point_core'
        };
        responseText = 'Synthesized long-range scientific exploration configuration with tachyon scanners, zero-point micro core, and high-efficiency ion drives.';
      } else {
        newPreset = {
          ...currentShip,
          name: 'CUSTOM-' + Math.floor(Math.random() * 900 + 100) + ' Starfarer',
          accentColor: ['#38BDF8', '#818CF8', '#10B981', '#F59E0B', '#F43F5E'][Math.floor(Math.random() * 5)]
        };
        responseText = `Analyzed "${userMessage}". Optimized hull aerodynamics, recalculated power distribution, and balanced combat telemetry.`;
      }

      setCurrentShip(newPreset);
      setAiChatLog(prev => [...prev, { sender: 'ai', text: responseText }]);
      setIsAiGenerating(false);
      if (soundEnabled) sfx.playWarp();
    }, 1200);
  };

  // Export Standalone Single-File HTML Starship Viewer
  const handleExportStandaloneHTML = () => {
    if (soundEnabled) sfx.playClick();
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${currentShip.name} — Astralis 3D Viewer</title>
  <style>
    body { margin: 0; background: #060913; color: #fff; font-family: sans-serif; overflow: hidden; }
    #hud { position: absolute; top: 20px; left: 20px; z-index: 10; background: rgba(15,23,42,0.85); padding: 18px 24px; border-radius: 12px; border: 1px solid rgba(56,189,248,0.3); backdrop-filter: blur(12px); }
    h1 { margin: 0 0 6px 0; font-size: 20px; color: #38bdf8; font-family: 'Orbitron', monospace; }
    p { margin: 4px 0; font-size: 13px; color: #94a3b8; }
    #instructions { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); font-size: 12px; color: #64748b; }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
</head>
<body>
  <div id="hud">
    <h1>${currentShip.name}</h1>
    <p><strong>Class:</strong> ${currentShip.class}</p>
    <p><strong>Drive:</strong> ${currentShip.sublight} | <strong>FTL:</strong> ${currentShip.ftl}</p>
    <p><strong>Ordnance:</strong> ${currentShip.weapons}</p>
  </div>
  <div id="instructions">Left Click + Drag: Orbit | Scroll: Zoom</div>
  <script>
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060913);
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(16, 12, 20);
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x38bdf8, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight.position.set(20, 30, 20);
    scene.add(dirLight);

    const ship = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({ color: '${currentShip.accentColor}', roughness: 0.3, metalness: 0.8 });
    const hullGeo = new THREE.ConeGeometry(2.5, 9, 32);
    hullGeo.rotateX(Math.PI / 2);
    hullGeo.scale(1.2, 0.6, 1.2);
    const mesh = new THREE.Mesh(hullGeo, hullMat);
    ship.add(mesh);

    const wingGeo = new THREE.BoxGeometry(11, 0.15, 3.5);
    const wings = new THREE.Mesh(wingGeo, hullMat);
    wings.position.set(0, 0, -1);
    ship.add(wings);
    scene.add(ship);

    let isDown = false, prevX = 0, prevY = 0;
    window.addEventListener('mousedown', e => { isDown = true; prevX = e.clientX; prevY = e.clientY; });
    window.addEventListener('mouseup', () => isDown = false);
    window.addEventListener('mousemove', e => {
      if (!isDown) return;
      ship.rotation.y += (e.clientX - prevX) * 0.01;
      ship.rotation.x += (e.clientY - prevY) * 0.01;
      prevX = e.clientX; prevY = e.clientY;
    });

    function animate() {
      requestAnimationFrame(animate);
      if (!isDown) ship.rotation.y += 0.005;
      renderer.render(scene, camera);
    }
    animate();
  </script>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentShip.name.toLowerCase().replace(/\s+/g, '-')}-viewer.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-screen h-screen overflow-hidden flex flex-col bg-[#060913] text-slate-100 font-sans select-none">
      
      {/* --- TOP BAR HUD --- */}
      <header className="h-16 border-b border-slate-800/80 glass-panel flex items-center justify-between px-6 z-20 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-400/30 flex items-center justify-center text-cyan-400 shadow-[0_0_15px_rgba(56,189,248,0.25)]">
            <Rocket className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-orbitron font-bold text-lg tracking-wider text-white">ASTRALIS</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono border border-cyan-500/30">SHIPYARD CAD</span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">NEXT-GEN STARSHIP FOUNDRY &bull; V3.4 PROT</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center space-x-1 bg-slate-900/90 p-1 rounded-xl border border-slate-800">
          <button 
            onClick={() => { if(soundEnabled) sfx.playClick(); setActiveTab('designer'); }}
            className={`px-4 py-2 rounded-lg text-xs font-medium font-mono flex items-center space-x-2 transition-all ${
              activeTab === 'designer' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Boxes className="w-4 h-4" />
            <span>3D FOUNDRY</span>
          </button>
          <button 
            onClick={() => { if(soundEnabled) sfx.playClick(); setActiveTab('spline'); }}
            className={`px-4 py-2 rounded-lg text-xs font-medium font-mono flex items-center space-x-2 transition-all ${
              activeTab === 'spline' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <PenTool className="w-4 h-4" />
            <span>SPLINE SCULPTOR</span>
          </button>
          <button 
            onClick={() => { if(soundEnabled) sfx.playClick(); setActiveTab('rnd'); }}
            className={`px-4 py-2 rounded-lg text-xs font-medium font-mono flex items-center space-x-2 transition-all ${
              activeTab === 'rnd' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Atom className="w-4 h-4" />
            <span>R&D MATRIX</span>
          </button>
          <button 
            onClick={() => { if(soundEnabled) sfx.playClick(); setActiveTab('ai'); }}
            className={`px-4 py-2 rounded-lg text-xs font-medium font-mono flex items-center space-x-2 transition-all ${
              activeTab === 'ai' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>AI ARCHITECT</span>
          </button>
        </div>

        {/* Global Controls & Export */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800">
            <span className="text-[11px] text-slate-400 font-mono">R&D CREDITS:</span>
            <span className="text-xs font-orbitron font-bold text-emerald-400">{researchPoints.toLocaleString()} XP</span>
          </div>

          <button 
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition-colors border border-slate-700"
            title={soundEnabled ? 'Mute Audio' : 'Unmute Audio'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-cyan-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
          </button>

          <button 
            onClick={handleExportStandaloneHTML}
            className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold font-mono flex items-center space-x-1.5 shadow-[0_0_15px_rgba(56,189,248,0.3)] transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            <span>EXPORT HTML</span>
          </button>
        </div>
      </header>

      {/* --- MAIN INTERACTIVE WORKSPACE --- */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* 3D VIEWPORT CANVAS */}
        <div className="flex-1 h-full relative overflow-hidden">
          <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

          {/* Viewport Overlay Controls (Top Left) */}
          <div className="absolute top-4 left-4 z-10 flex flex-col space-y-2">
            <div className="glass-panel px-4 py-3 rounded-xl max-w-xs">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider">Active Configuration</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono">{currentShip.class}</span>
              </div>
              <h2 className="text-base font-orbitron font-bold text-white mt-1">{currentShip.name}</h2>
              <div className="grid grid-cols-2 gap-2 mt-3 pt-2 border-t border-slate-800 text-[11px] font-mono">
                <div><span className="text-slate-400">Sublight:</span> <span className="text-slate-200">{COMPONENT_DATABASE.sublight.find(x => x.id === currentShip.sublight)?.name.split(' ')[0]}</span></div>
                <div><span className="text-slate-400">FTL Core:</span> <span className="text-indigo-300">{COMPONENT_DATABASE.ftl.find(x => x.id === currentShip.ftl)?.name.split(' ')[0]}</span></div>
                <div><span className="text-slate-400">Ordnance:</span> <span className="text-rose-300">{COMPONENT_DATABASE.weapons.find(x => x.id === currentShip.weapons)?.name.split(' ')[0]}</span></div>
                <div><span className="text-slate-400">Sensors:</span> <span className="text-emerald-300">{COMPONENT_DATABASE.sensors.find(x => x.id === currentShip.sensors)?.name.split(' ')[0]}</span></div>
              </div>
            </div>

            {/* Environment & View Modes */}
            <div className="glass-panel p-2 rounded-xl flex items-center space-x-1.5 text-xs font-mono">
              <span className="text-[10px] text-slate-400 px-2">DOCK:</span>
              <button 
                onClick={() => setEnvironment('drydock')}
                className={`px-2.5 py-1 rounded ${environment === 'drydock' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-white'}`}
              >
                Station
              </button>
              <button 
                onClick={() => setEnvironment('nebula')}
                className={`px-2.5 py-1 rounded ${environment === 'nebula' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'text-slate-400 hover:text-white'}`}
              >
                Nebula
              </button>
              <button 
                onClick={() => setEnvironment('asteroid')}
                className={`px-2.5 py-1 rounded ${environment === 'asteroid' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'text-slate-400 hover:text-white'}`}
              >
                Asteroids
              </button>
            </div>
          </div>

          {/* Viewport Action HUD (Bottom Left) */}
          <div className="absolute bottom-4 left-4 z-10 flex items-center space-x-2">
            <button
              onClick={handleTestBurn}
              className={`px-4 py-2 rounded-xl text-xs font-mono font-bold flex items-center space-x-2 transition-all ${
                isTestBurning 
                  ? 'bg-amber-500 text-slate-950 shadow-[0_0_20px_rgba(245,158,11,0.5)] scale-105' 
                  : 'glass-panel text-amber-400 hover:bg-amber-500/10 border-amber-500/30'
              }`}
            >
              <Flame className="w-4 h-4" />
              <span>{isTestBurning ? 'THRUSTER BURN ACTIVE' : 'TEST BURN'}</span>
            </button>

            <button
              onClick={() => setWireframeMode(!wireframeMode)}
              className={`p-2 rounded-xl text-xs font-mono transition-all ${
                wireframeMode ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-400' : 'glass-panel text-slate-400 hover:text-white'
              }`}
              title="Toggle Wireframe CAD Mode"
            >
              <Eye className="w-4 h-4" />
            </button>

            <button
              onClick={() => setAutoRotate(!autoRotate)}
              className={`p-2 rounded-xl text-xs font-mono transition-all ${
                autoRotate ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-400' : 'glass-panel text-slate-400 hover:text-white'
              }`}
              title="Toggle Auto 360 Rotation"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            <div className="glass-panel px-3 py-1.5 rounded-xl text-[10px] font-mono text-slate-400 flex items-center space-x-1.5">
              <Orbit className="w-3.5 h-3.5 text-cyan-400" />
              <span>360° ORBIT: Drag left/right &amp; up/down</span>
            </div>
          </div>

          {/* Ship Presets Carousel (Bottom Center) */}
          <div className="absolute bottom-4 right-96 z-10 flex items-center space-x-2">
            <div className="glass-panel p-1.5 rounded-xl flex space-x-1.5">
              {SHIP_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  onClick={() => handleSelectPreset(preset)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all flex items-center space-x-1.5 ${
                    currentShip.id === preset.id
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{preset.name.split(' ')[0]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* --- RIGHT SIDEBAR PANEL --- */}
        <div className="w-96 border-l border-slate-800/80 glass-panel flex flex-col h-full z-20 shrink-0 overflow-y-auto">
          
          {/* TAB 1: 3D COMPONENT HARDPOINT SLOTS */}
          {activeTab === 'designer' && (
            <div className="p-5 flex flex-col space-y-6">
              <div>
                <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider">Modular Assembly</span>
                <h3 className="text-lg font-orbitron font-bold text-white">Component Hardpoints</h3>
                <p className="text-xs text-slate-400 mt-1">Swap out drive technology, ordnance, sensors, and miniaturized fuel containment.</p>
              </div>

              {/* Sublight Propulsion */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-300 flex items-center space-x-1.5"><Rocket className="w-3.5 h-3.5 text-cyan-400" /> <span>Sublight Drive</span></span>
                  <span className="text-cyan-400">{COMPONENT_DATABASE.sublight.find(x => x.id === currentShip.sublight)?.name}</span>
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {COMPONENT_DATABASE.sublight.map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleSwapComponent('sublight', item)}
                      className={`p-2.5 rounded-xl text-left border text-xs font-mono transition-all flex items-center justify-between ${
                        currentShip.sublight === item.id 
                          ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200 shadow-sm' 
                          : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div>
                        <div className="font-semibold text-white">{item.name}</div>
                        <div className="text-[10px] text-slate-400">Thrust: {item.thrust} kN | Eff: {item.efficiency}%</div>
                      </div>
                      {currentShip.sublight === item.id && <Check className="w-4 h-4 text-cyan-400" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* FTL Engines */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-300 flex items-center space-x-1.5"><Sparkles className="w-3.5 h-3.5 text-indigo-400" /> <span>FTL Engine Core</span></span>
                  <span className="text-indigo-400">{COMPONENT_DATABASE.ftl.find(x => x.id === currentShip.ftl)?.name}</span>
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {COMPONENT_DATABASE.ftl.map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleSwapComponent('ftl', item)}
                      className={`p-2.5 rounded-xl text-left border text-xs font-mono transition-all flex items-center justify-between ${
                        currentShip.ftl === item.id 
                          ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-200 shadow-sm' 
                          : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div>
                        <div className="font-semibold text-white">{item.name}</div>
                        <div className="text-[10px] text-slate-400">Range: {item.jumpRange} LY | Draw: {item.powerDraw} GW</div>
                      </div>
                      {currentShip.ftl === item.id && <Check className="w-4 h-4 text-indigo-400" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Weapons Ordnance */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-300 flex items-center space-x-1.5"><Crosshair className="w-3.5 h-3.5 text-rose-400" /> <span>Weapons System</span></span>
                  <span className="text-rose-400">{COMPONENT_DATABASE.weapons.find(x => x.id === currentShip.weapons)?.name}</span>
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {COMPONENT_DATABASE.weapons.map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleSwapComponent('weapons', item)}
                      className={`p-2.5 rounded-xl text-left border text-xs font-mono transition-all flex items-center justify-between ${
                        currentShip.weapons === item.id 
                          ? 'bg-rose-500/20 border-rose-500/50 text-rose-200 shadow-sm' 
                          : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div>
                        <div className="font-semibold text-white">{item.name}</div>
                        <div className="text-[10px] text-slate-400">{item.type} | Dmg: {item.damage} MJ</div>
                      </div>
                      {currentShip.weapons === item.id && <Check className="w-4 h-4 text-rose-400" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fuel Storage & Miniaturization */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-300 flex items-center space-x-1.5"><Zap className="w-3.5 h-3.5 text-amber-400" /> <span>Fuel &amp; Containment</span></span>
                  <span className="text-amber-400">{COMPONENT_DATABASE.fuel.find(x => x.id === currentShip.fuel)?.size}</span>
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {COMPONENT_DATABASE.fuel.map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleSwapComponent('fuel', item)}
                      className={`p-2.5 rounded-xl text-left border text-xs font-mono transition-all flex items-center justify-between ${
                        currentShip.fuel === item.id 
                          ? 'bg-amber-500/20 border-amber-500/50 text-amber-200 shadow-sm' 
                          : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div>
                        <div className="font-semibold text-white">{item.name}</div>
                        <div className="text-[10px] text-slate-400">Footprint: {item.size}</div>
                      </div>
                      {currentShip.fuel === item.id && <Check className="w-4 h-4 text-amber-400" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Hull Alloy Material */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-300 flex items-center space-x-1.5"><Shield className="w-3.5 h-3.5 text-emerald-400" /> <span>Hull Composite</span></span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {COMPONENT_DATABASE.materials.map(mat => (
                    <button
                      key={mat.id}
                      onClick={() => handleSwapComponent('material', mat)}
                      className={`p-2 rounded-xl text-left border text-xs font-mono transition-all ${
                        currentShip.material === mat.id 
                          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200' 
                          : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-semibold text-white text-[11px] truncate">{mat.name.split(' ')[0]}</div>
                      <div className="text-[10px] text-slate-400">Armor: {mat.armor}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: BEZIER SPLINE HULL SCULPTOR */}
          {activeTab === 'spline' && (
            <div className="p-5 flex flex-col space-y-5">
              <div>
                <span className="text-[10px] font-mono text-indigo-400 uppercase tracking-wider">Hull Geometry CAD</span>
                <h3 className="text-lg font-orbitron font-bold text-white">Spline Sculptor</h3>
                <p className="text-xs text-slate-400 mt-1">Drag the Bezier control points to shape smooth, aerodynamic curves in real time.</p>
              </div>

              {/* 2D Interactive Bezier Canvas */}
              <div className="relative bg-slate-950 border border-slate-800 rounded-xl p-4 overflow-hidden">
                <div className="text-[10px] font-mono text-slate-500 mb-2 flex justify-between">
                  <span>LATHE PROFILE CANVAS</span>
                  <span>(Live 3D Lofting)</span>
                </div>
                <svg className="w-full h-52 bg-slate-900/70 rounded-lg border border-slate-800 cursor-crosshair">
                  {/* Grid Lines */}
                  <defs>
                    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#grid)" />

                  {/* Center Axis Line */}
                  <line x1="0" y1="150" x2="100%" y2="150" stroke="rgba(56,189,248,0.2)" strokeDasharray="4" />

                  {/* Bezier Smooth Spline Path */}
                  <path
                    d={`M ${splinePoints[0].x * 0.6} ${splinePoints[0].y * 0.6} ` +
                      splinePoints.slice(1).map(p => `L ${p.x * 0.6} ${p.y * 0.6}`).join(' ')}
                    fill="none"
                    stroke="#818cf8"
                    strokeWidth="3"
                  />

                  {/* Spline Control Points */}
                  {splinePoints.map(p => (
                    <circle
                      key={p.id}
                      cx={p.x * 0.6}
                      cy={p.y * 0.6}
                      r="6"
                      fill={selectedSplinePoint === p.id ? '#38bdf8' : '#818cf8'}
                      stroke="#ffffff"
                      strokeWidth="2"
                      className="cursor-pointer hover:scale-125 transition-transform"
                      onMouseDown={() => setSelectedSplinePoint(p.id)}
                    />
                  ))}
                </svg>

                {/* Point Sliders */}
                <div className="mt-4 space-y-3">
                  <div className="text-xs font-mono text-slate-300 font-semibold">Fine-Tune Cross Section Points</div>
                  {splinePoints.map(p => (
                    <div key={p.id} className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono text-slate-400">
                        <span>{p.label}</span>
                        <span>Radius: {Math.abs(p.y - 150)}px</span>
                      </div>
                      <input
                        type="range"
                        min="50"
                        max="250"
                        value={p.y}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          setSplinePoints(prev => prev.map(pt => pt.id === p.id ? { ...pt, y: val } : pt));
                        }}
                        className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-400"
                      />
                    </div>
                  ))}
                </div>

                {/* Reset Spline Preset */}
                <button
                  onClick={() => {
                    setSplinePoints([
                      { id: 0, x: 20, y: 150, label: 'Nose Tip' },
                      { id: 1, x: 90, y: 110, label: 'Cockpit Contour' },
                      { id: 2, x: 200, y: 80, label: 'Mid Waist' },
                      { id: 3, x: 310, y: 50, label: 'Wing Root Sweep' },
                      { id: 4, x: 420, y: 110, label: 'Engine Nacelle' },
                      { id: 5, x: 460, y: 150, label: 'Aft Exhaust' }
                    ]);
                  }}
                  className="w-full mt-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono flex items-center justify-center space-x-2"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>RESET TO AERODYNAMIC DEFAULT</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: R&D TECH TREE MATRIX */}
          {activeTab === 'rnd' && (
            <div className="p-5 flex flex-col space-y-5">
              <div>
                <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-wider">Research &amp; Engineering</span>
                <h3 className="text-lg font-orbitron font-bold text-white">R&D Technology Tree</h3>
                <p className="text-xs text-slate-400 mt-1">Unlock experimental FTL fold drives, tachyon weaponry, and zero-point power cores.</p>
              </div>

              {/* Tech Nodes List */}
              <div className="space-y-3">
                {/* Graviton Singularity FTL */}
                <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/70 flex flex-col space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-orbitron font-bold text-indigo-300">Graviton Fold Singularity (Tier 4)</span>
                    {unlockedTechs.graviton_singularity ? (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono">UNLOCKED</span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">5,000 XP</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400">Enables instant spacetime folding leaps without warp transit dilation.</p>
                  {!unlockedTechs.graviton_singularity && (
                    <button
                      onClick={() => handleUnlockTech('graviton_singularity', 5000)}
                      disabled={researchPoints < 5000}
                      className="w-full py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-slate-950 text-xs font-bold font-mono"
                    >
                      RESEARCH TECH
                    </button>
                  )}
                </div>

                {/* Tachyon Beam Disruptor */}
                <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/70 flex flex-col space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-orbitron font-bold text-rose-300">Tachyon Beam Disruptor (Tier 4)</span>
                    {unlockedTechs.tachyon_disruptor ? (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono">UNLOCKED</span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">4,200 XP</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400">Superluminal particles that phase through target shields with 890 MJ pulse output.</p>
                  {!unlockedTechs.tachyon_disruptor && (
                    <button
                      onClick={() => handleUnlockTech('tachyon_disruptor', 4200)}
                      disabled={researchPoints < 4200}
                      className="w-full py-1.5 rounded-lg bg-rose-500 hover:bg-rose-400 disabled:opacity-40 text-slate-950 text-xs font-bold font-mono"
                    >
                      RESEARCH TECH
                    </button>
                  )}
                </div>

                {/* Zero-Point Micro Core */}
                <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/70 flex flex-col space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-orbitron font-bold text-amber-300">Zero-Point Micro-Core (Tier 4)</span>
                    {unlockedTechs.zero_point_core ? (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono">UNLOCKED</span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">6,500 XP</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400">Miniaturizes ship fuel containment by 75% while providing near limitless range.</p>
                  {!unlockedTechs.zero_point_core && (
                    <button
                      onClick={() => handleUnlockTech('zero_point_core', 6500)}
                      disabled={researchPoints < 6500}
                      className="w-full py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 text-xs font-bold font-mono"
                    >
                      RESEARCH TECH
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: CONVERSATIONAL AI SHIP ARCHITECT */}
          {activeTab === 'ai' && (
            <div className="p-5 flex flex-col h-full space-y-4">
              <div>
                <span className="text-[10px] font-mono text-purple-400 uppercase tracking-wider">Natural Language CAD</span>
                <h3 className="text-lg font-orbitron font-bold text-white">AI Ship Architect</h3>
                <p className="text-xs text-slate-400 mt-1">Describe any aesthetic or mission parameter and the engine will forge it.</p>
              </div>

              {/* Chat Log Window */}
              <div className="flex-1 bg-slate-950/80 border border-slate-800 rounded-xl p-3 overflow-y-auto space-y-2.5 text-xs font-mono">
                {aiChatLog.map((msg, idx) => (
                  <div key={idx} className={`p-2.5 rounded-xl ${msg.sender === 'user' ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-200 ml-4' : 'bg-slate-900 border border-slate-800 text-slate-300 mr-4'}`}>
                    <div className="text-[10px] font-bold text-slate-400 mb-1">{msg.sender === 'user' ? 'ARCHITECT' : 'AI CAD MATRIX'}</div>
                    {msg.text}
                  </div>
                ))}
                {isAiGenerating && (
                  <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-300 flex items-center space-x-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Synthesizing hull geometry &amp; loadout...</span>
                  </div>
                )}
              </div>

              {/* Prompt Suggestions */}
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Stealth reconnaissance ship',
                  'Heavy battleship with torpedoes',
                  'Deep space science explorer'
                ].map((sugg, i) => (
                  <button
                    key={i}
                    onClick={() => { setAiPrompt(sugg); }}
                    className="text-[10px] px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800"
                  >
                    "{sugg}"
                  </button>
                ))}
              </div>

              {/* Prompt Input Box */}
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendAiPrompt()}
                  placeholder="Describe your starship idea..."
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
                />
                <button
                  onClick={handleSendAiPrompt}
                  className="px-3.5 py-2 rounded-xl bg-purple-500 hover:bg-purple-400 text-slate-950 font-bold text-xs flex items-center justify-center transition-all"
                >
                  <Sparkles className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
