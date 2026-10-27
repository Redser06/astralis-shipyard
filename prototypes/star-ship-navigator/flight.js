/* Flight model for the Star Ship Navigator.
 *
 * Space has no air, so there is no drag, no lift, no stall and no weather. That
 * makes the physics unusually simple:
 *
 *   thrust  -> changes velocity           (F = ma, no top speed in reality)
 *   velocity-> persists when thrust stops (Newton's first law)
 *   rotation-> angular momentum, integrated as a quaternion, so no gimbal lock
 *
 * Two concessions to playability, both toggleable with Z:
 *   - a speed cap, because a hard limit is kinder than an unbounded drift
 *   - flight assist, which bleeds off velocity and rotation when you let go
 * With assist off you are flying a true Newtonian ship: point retrograde and
 * burn to stop.
 *
 * Ship local axes after normalise(): nose is -X, up is +Y, so roll is about X,
 * yaw about Y and pitch about Z.
 */

(function () {
  const nav = window.__nav;
  if (!nav) { console.error('[flight] __nav missing — app.js must load first'); return; }

  const { scene, camera, controls, shipRoot, dockGroup, renderer } = nav;

  // The hull being flown. Other ships stay docked on their pads.
  let vesselObj = null;
  const berthHome = new THREE.Vector3();

  // ------------------------------------------------------------ constants ---
  const THRUST_ACCEL = 14;      // units/s² at full throttle
  const BOOST_MULT = 2.6;
  const REVERSE_MULT = 0.6;
  const MAX_SPEED = 70;         // soft cap, applied as drag only above this
  const ANGULAR_ACCEL = 2.0;    // rad/s²
  const MAX_ANGULAR = 1.3;      // rad/s
  const ASSIST_LIN_TAU = 1.1;   // s, velocity time constant with assist on
  const ASSIST_ANG_TAU = 0.22;  // s, rotation time constant with assist on

  // ---------------------------------------------------------------- state ---
  const vessel = {
    pos: new THREE.Vector3(0, -1.5, 0),
    quat: new THREE.Quaternion(),
    vel: new THREE.Vector3(),
    angVel: new THREE.Vector3(),   // local: x=roll, y=yaw, z=pitch
  };

  const input = {
    thrust: 0,      // -1..1
    boost: false,
    roll: 0, yaw: 0, pitch: 0,
    brake: false,
  };

  const S = {
    active: false,
    assist: true,
    chase: true,
    speed: 0,
    throttle: 0,
  };

  const keys = new Set();
  const KEYMAP = {
    KeyW: 'fwd', KeyS: 'back',
    KeyA: 'yawL', KeyD: 'yawR',
    KeyQ: 'rollL', KeyE: 'rollR',
    ArrowUp: 'pitchUp', ArrowDown: 'pitchDown',
    ShiftLeft: 'boost', ShiftRight: 'boost',
    Space: 'brake',
  };

  // ------------------------------------------------- reference landmarks ---
  // In empty space you cannot see that you are moving. These give parallax.
  const landmarks = new THREE.Group();
  landmarks.visible = false;
  scene.add(landmarks);

  (function buildLandmarks() {
    // buoy field
    const buoyGeo = new THREE.OctahedronGeometry(0.55, 0);
    const buoyMats = [
      new THREE.MeshStandardMaterial({ color: 0x0a1018, emissive: 0x2ad4ff, emissiveIntensity: 1.6, metalness: 0.3, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: 0x101008, emissive: 0xffa64f, emissiveIntensity: 1.4, metalness: 0.3, roughness: 0.4 }),
    ];
    for (let i = 0; i < 70; i++) {
      const b = new THREE.Mesh(buoyGeo, buoyMats[i % 2]);
      const r = 90 + Math.random() * 340;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      b.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi) * 0.5,
        r * Math.sin(phi) * Math.sin(theta)
      );
      b.userData.spin = 0.3 + Math.random() * 0.9;
      landmarks.add(b);
    }

    // rocks
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.2, roughness: 0.95 });
    for (let i = 0; i < 14; i++) {
      const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), rockMat);
      const r = 140 + Math.random() * 320;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      rk.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi) * 0.6,
        r * Math.sin(phi) * Math.sin(theta)
      );
      rk.scale.setScalar(3 + Math.random() * 8);
      rk.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      landmarks.add(rk);
    }

    // dust: the thing that actually sells speed
    const N = 2200;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 900;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 900;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 900;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const dustMat = new THREE.PointsMaterial({
      color: 0x9fd4ff, size: 0.32, sizeAttenuation: true,
      transparent: true, opacity: 0.55, depthWrite: false,
    });
    landmarks.add(new THREE.Points(dustGeo, dustMat));
  })();

  // ------------------------------------------------------------------ HUD ---
  const hud = document.getElementById('flight-hud');
  const elSpeed = document.getElementById('f-speed');
  const elDist = document.getElementById('f-dist');
  const elThrottle = document.getElementById('f-throttle');
  const elAssist = document.getElementById('f-assist');
  const elCam = document.getElementById('f-cam');
  const btn = document.getElementById('btn-fly');

  function updateHUD() {
    if (!S.active) return;
    elSpeed.textContent = S.speed.toFixed(1);
    elDist.textContent = vessel.pos.length().toFixed(0);
    elThrottle.style.transform = `scaleX(${Math.abs(S.throttle)})`;
    elThrottle.style.background = S.throttle < -0.02 ? '#ffa64f' : '#2ad4ff';
    elAssist.textContent = S.assist ? 'ASSIST ON' : 'ASSIST OFF';
    elAssist.className = S.assist ? 'on' : 'off';
    elCam.textContent = S.chase ? 'CHASE' : 'ORBIT';
  }

  // ---------------------------------------------------------------- input ---
  function onKeyDown(e) {
    if (KEYMAP[e.code]) {
      keys.add(KEYMAP[e.code]);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    }
    if (!S.active) return;
    if (e.code === 'KeyZ') { S.assist = !S.assist; updateHUD(); }
    if (e.code === 'KeyC') { S.chase = !S.chase; updateHUD(); }
    if (e.code === 'KeyR') resetToDock();
    if (e.code === 'Escape') disable();
  }
  function onKeyUp(e) {
    if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]);
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => keys.clear());

  function readInput() {
    input.thrust = (keys.has('fwd') ? 1 : 0) - (keys.has('back') ? 1 : 0);
    input.yaw = (keys.has('yawL') ? 1 : 0) - (keys.has('yawR') ? 1 : 0);
    input.pitch = (keys.has('pitchUp') ? 1 : 0) - (keys.has('pitchDown') ? 1 : 0);
    input.roll = (keys.has('rollL') ? 1 : 0) - (keys.has('rollR') ? 1 : 0);
    input.boost = keys.has('boost');
    input.brake = keys.has('brake');
  }

  // -------------------------------------------------------------- physics ---
  const FORWARD = new THREE.Vector3(-1, 0, 0);   // nose is -X after normalise
  const _fwdWorld = new THREE.Vector3();
  const _dq = new THREE.Quaternion();
  const _euler = new THREE.Euler();

  function step(dt) {
    readInput();

    // --- attitude: angular acceleration then integrate as a quaternion ---
    const aAccel = ANGULAR_ACCEL * dt;
    vessel.angVel.x += input.roll * aAccel;      // roll about local X
    vessel.angVel.y += input.yaw * aAccel;       // yaw about local Y
    vessel.angVel.z += input.pitch * aAccel;     // pitch about local Z
    vessel.angVel.clampLength(0, MAX_ANGULAR);

    if (S.assist) {
      vessel.angVel.multiplyScalar(Math.exp(-dt / ASSIST_ANG_TAU));
    }

    if (vessel.angVel.lengthSq() > 1e-9) {
      _euler.set(vessel.angVel.x * dt, vessel.angVel.y * dt, vessel.angVel.z * dt, 'XYZ');
      _dq.setFromEuler(_euler);
      vessel.quat.multiply(_dq).normalize();     // local-space rotation
    }

    // --- translation ---
    _fwdWorld.copy(FORWARD).applyQuaternion(vessel.quat);

    if (input.thrust > 0) {
      const mult = input.boost ? BOOST_MULT : 1;
      vessel.vel.addScaledVector(_fwdWorld, THRUST_ACCEL * mult * dt);
    } else if (input.thrust < 0) {
      vessel.vel.addScaledVector(_fwdWorld, -THRUST_ACCEL * REVERSE_MULT * dt);
    }

    // brake burns retrograde, which is what actually stops you out here
    if (input.brake) {
      const s = vessel.vel.length();
      if (s > 0.01) {
        const dv = Math.min(s, THRUST_ACCEL * 1.6 * dt);
        vessel.vel.addScaledVector(vessel.vel.clone().normalize(), -dv);
      }
    }

    if (S.assist) {
      vessel.vel.multiplyScalar(Math.exp(-dt / ASSIST_LIN_TAU));
    }

    // soft cap: only bites above MAX_SPEED, so normal flight stays Newtonian
    const speed = vessel.vel.length();
    if (speed > MAX_SPEED) {
      vessel.vel.multiplyScalar(MAX_SPEED / speed);
    }

    vessel.pos.addScaledVector(vessel.vel, dt);

    // --- push the transform onto the scene graph ---
    if (vesselObj) {
      vesselObj.position.copy(vessel.pos);
      vesselObj.quaternion.copy(vessel.quat);
    }

    S.speed = vessel.vel.length();
    S.throttle = input.thrust * (input.boost ? 1 : 0.55);
  }

  // --------------------------------------------------------------- camera ---
  const _camTarget = new THREE.Vector3();
  const _camLocal = new THREE.Vector3(16, 4.4, 0);   // behind (+X) and above

  function updateCamera(dt) {
    if (!S.chase) {
      controls.target.copy(vessel.pos);
      return;
    }
    _camTarget.copy(_camLocal).applyQuaternion(vessel.quat).add(vessel.pos);
    // exponential smoothing, framerate independent
    const k = 1 - Math.exp(-dt * 5.5);
    camera.position.lerp(_camTarget, k);
    camera.up.set(0, 1, 0);
    camera.lookAt(vessel.pos);
  }

  // ------------------------------------------------------------ lifecycle ---
  function resetToDock() {
    vessel.pos.copy(berthHome);
    vessel.quat.identity();
    vessel.vel.set(0, 0, 0);
    vessel.angVel.set(0, 0, 0);
    if (vesselObj) {
      vesselObj.position.copy(vessel.pos);
      vesselObj.quaternion.copy(vessel.quat);
    }
  }

  function enable() {
    if (S.active) return;
    const loaded = Object.keys(nav.state).filter((k) => nav.state[k].loaded);
    if (!loaded.length) {
      const st = document.getElementById('status');
      st.textContent = 'Load a ship first, then launch.';
      st.style.color = '#ffd479';
      return;
    }

    // launch whichever hull is selected in the panel
    const current = nav.getActive();
    const key = current && nav.state[current] && nav.state[current].loaded ? current : loaded[0];
    vesselObj = nav.slots[key];
    berthHome.copy(vesselObj.position);
    S.vesselId = key;

    resetToDock();
    S.active = true;
    landmarks.visible = true;

    controls.enabled = false;
    if (hud) hud.hidden = false;
    if (btn) { btn.textContent = 'Return to dock'; btn.classList.add('flying'); }

    // start the camera behind the ship instead of wherever orbit left it
    camera.position.copy(_camLocal).applyQuaternion(vessel.quat).add(vessel.pos);
    camera.lookAt(vessel.pos);

    updateHUD();
  }

  function disable() {
    if (!S.active) return;
    S.active = false;
    keys.clear();
    landmarks.visible = false;
    resetToDock();

    controls.enabled = true;
    // ease back to the wide station shot
    if (nav.overviewCamera) nav.overviewCamera();
    else { controls.target.set(0, 0, 0); camera.position.set(3, 27, 46); }
    camera.up.set(0, 1, 0);

    if (hud) hud.hidden = true;
    if (btn) { btn.textContent = 'Launch (F)'; btn.classList.remove('flying'); }
  }

  function toggle() { S.active ? disable() : enable(); }

  if (btn) btn.addEventListener('click', toggle);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyF' && !e.metaKey && !e.ctrlKey) toggle();
  });

  // ------------------------------------------------------------- the hook ---
  window.__navHooks.push(function (dt, t) {
    if (S.active) {
      step(dt);
      updateCamera(dt);
      updateHUD();
    }
    // buoys keep tumbling either way
    if (landmarks.visible) {
      for (const c of landmarks.children) {
        if (c.userData.spin) c.rotation.y += dt * c.userData.spin;
      }
    }
  });

  // exposed for testing and for the console
  window.Flight = {
    enable, disable, toggle,
    vessel, state: S,
    _keys: keys,
    _input: input,
    _readInput: readInput,
    setInput(patch) { Object.assign(input, patch); },
    step,
    teleport(x, y, z) { vessel.pos.set(x, y, z); },
  };
})();
