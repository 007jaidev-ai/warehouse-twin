// Three.js scene for the picking floor. Instanced boxes, a baked floor and render-on-demand,
// so it stays smooth (and quiet) on an average laptop.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const LEVELS = [0.12, 0.82, 1.52]; // shelf heights (m)
const CARTON_H = 0.55;

function textTexture(text, { size = 64, color = '#1f2226', bg = null, w = 512, h = 128, weight = 700 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = color;
  g.font = `${weight} ${size}px Bahnschrift, 'DIN Alternate', 'Segoe UI', sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Palette shared with style.css and build/blender/scene.py
export const PAL = {
  paper: '#f6efe0', ink: '#1f2226', graphite: '#3b3f45', steel: '#b9bcbe', signal: '#e0442a',
  cobalt: '#2340b8', moss: '#2e7d4f', plum: '#a8307e', kraft: '#c9a97a', table: '#f4f1ea',
};
// The floor is a top-down Cycles render of the same layout (build/blender/scene.py -> web/public/tex/floor.jpg):
// markings, contact shadows and AO are baked in, so the app needs no realtime shadow maps.
const BAKE = { x0: -6, x1: 31, z0: -10, z1: 27 };

export function createScene(el, wh) {
  const { cfg, slots } = wh;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.paper);
  scene.fog = new THREE.Fog(PAL.paper, 60, 125);

  const cx = wh.width / 2, cz = (wh.frontZ + wh.backZ) / 2;
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  const HOME = { pos: [cx - 17, 31, wh.frontZ - 27], target: [cx, 0, cz - 2] };
  camera.position.set(...HOME.pos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...HOME.target);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.minDistance = 8;
  controls.maxDistance = 95;

  // Render on demand: anything that changes the picture calls invalidate(); idle frames cost nothing.
  let dirty = true;
  const invalidate = () => { dirty = true; };
  controls.addEventListener('change', invalidate);

  scene.add(new THREE.HemisphereLight('#ffffff', '#cfc6b4', 1.9));
  const sun = new THREE.DirectionalLight('#fffaf2', 1.6);
  sun.position.set(cx + 18, 40, cz - 24); // same direction as the baked sun
  sun.target.position.set(cx, 0, cz);
  scene.add(sun, sun.target);

  // ---- floor: baked texture inside the warehouse, plain paper outside
  const bakeTex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}tex/floor.jpg`, invalidate);
  bakeTex.colorSpace = THREE.SRGBColorSpace;
  bakeTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: PAL.paper }));
  outer.rotation.x = -Math.PI / 2; outer.position.set(cx, -0.01, cz);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(BAKE.x1 - BAKE.x0, BAKE.z1 - BAKE.z0), new THREE.MeshBasicMaterial({ map: bakeTex }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((BAKE.x0 + BAKE.x1) / 2, 0, (BAKE.z0 + BAKE.z1) / 2);
  scene.add(outer, floor);

  // ---- packing dock (furniture only; apron, hatching and lettering are in the bake)
  const dock = wh.pos[wh.DOCK];
  const lambert = (color) => new THREE.MeshLambertMaterial({ color });
  const graphite = lambert(PAL.graphite);
  const dockGroup = new THREE.Group();
  const addBox = (w, h, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); dockGroup.add(m); return m; };
  addBox(9, 0.12, 2.6, dock[0], 0.06, dock[1] - 1.4, lambert('#c8c2b4'));
  for (const dx of [-3, 0, 3]) {
    addBox(2.2, 0.05, 0.95, dock[0] + dx, 0.86, dock[1] - 2.0, lambert(PAL.table));
    for (const lx of [-1, 1]) addBox(0.05, 0.84, 0.85, dock[0] + dx + lx, 0.43, dock[1] - 2.0, graphite);
    addBox(0.45, 0.3, 0.4, dock[0] + dx - 0.4, 1.03, dock[1] - 2.0, lambert(PAL.kraft));
  }
  scene.add(dockGroup);
  const dockSign = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture('PACK & DISPATCH', { size: 54, color: '#ffffff', bg: PAL.ink, weight: 600 }) }));
  dockSign.scale.set(3.6, 0.9, 1);
  dockSign.position.set(dock[0], 2.3, dock[1] - 3.3);
  scene.add(dockSign);

  // ---- racks: graphite uprights, signal-red step beams, galvanised decks, cartons (one per level per slot)
  const rows = [];
  for (let a = 0; a < cfg.aisles; a++) for (let s = 0; s < 2; s++) rows.push(slots.find((sl) => sl.aisle === a && sl.side === s).x);
  const uprights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, cfg.rackH, 0.07), graphite, rows.length * (cfg.bays + 1) * 2);
  const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.1, wh.depth), lambert(PAL.signal), rows.length * LEVELS.length * 2);
  const decks = new THREE.InstancedMesh(new THREE.BoxGeometry(cfg.rackD - 0.1, 0.02, wh.depth), lambert(PAL.steel), rows.length * LEVELS.length);
  const m4 = new THREE.Matrix4();
  let ui = 0, bi = 0, di = 0;
  for (const x of rows) {
    for (let b = 0; b <= cfg.bays; b++)
      for (const dx of [-cfg.rackD / 2 + 0.04, cfg.rackD / 2 - 0.04]) {
        m4.makeTranslation(x + dx, cfg.rackH / 2, b * cfg.bayW);
        uprights.setMatrixAt(ui++, m4);
      }
    for (const y of LEVELS) {
      for (const dx of [-cfg.rackD / 2 + 0.035, cfg.rackD / 2 - 0.035]) {
        m4.makeTranslation(x + dx, y - 0.05, wh.depth / 2);
        beams.setMatrixAt(bi++, m4);
      }
      m4.makeTranslation(x, y - 0.01, wh.depth / 2);
      decks.setMatrixAt(di++, m4);
    }
  }
  scene.add(uprights, beams, decks);

  const cartons = new THREE.InstancedMesh(
    new THREE.BoxGeometry(cfg.rackD * 0.78, CARTON_H, cfg.bayW * 0.82),
    new THREE.MeshLambertMaterial({ color: '#ffffff' }),
    slots.length * LEVELS.length);
  const GREY = new THREE.Color('#d7d3c8');
  for (const s of slots)
    LEVELS.forEach((y, l) => {
      m4.makeTranslation(s.x, y + CARTON_H / 2, s.z);
      cartons.setMatrixAt(s.id * LEVELS.length + l, m4);
      cartons.setColorAt(s.id * LEVELS.length + l, GREY);
    });
  scene.add(cartons);

  const baseColors = slots.map(() => GREY.clone());
  const flashes = new Map(); // slot -> remaining seconds
  const tmpColor = new THREE.Color();
  const WHITE = new THREE.Color('#ffffff');
  function paintSlot(id) {
    const f = flashes.get(id) || 0;
    tmpColor.copy(baseColors[id]).lerp(WHITE, Math.min(1, f * 1.6));
    for (let l = 0; l < LEVELS.length; l++) cartons.setColorAt(id * LEVELS.length + l, tmpColor);
    cartons.instanceColor.needsUpdate = true;
  }

  // ---- selection / hover / partner markers
  const boxGeo = new THREE.BoxGeometry(cfg.rackD + 0.15, cfg.rackH + 0.2, cfg.bayW + 0.1);
  const mkFrame = (color, opacity) => {
    const m = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
    m.visible = false; scene.add(m); return m;
  };
  const selFrame = mkFrame(PAL.ink, 1);
  const swapFrame = mkFrame(PAL.moss, 1);
  const hoverFrame = mkFrame(PAL.cobalt, 0.75);
  const placeFrame = (f, id) => {
    const ok = Number.isInteger(id) && id >= 0 && id < slots.length;
    const changed = f.visible !== ok || (ok && (f.position.x !== slots[id].x || f.position.z !== slots[id].z));
    f.visible = ok;
    if (ok) f.position.set(slots[id].x, cfg.rackH / 2, slots[id].z);
    if (changed) invalidate();
  };

  const diamondGeo = new THREE.OctahedronGeometry(0.3);
  const partnerMarks = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(diamondGeo, new THREE.MeshBasicMaterial({ color: PAL.plum }));
    m.visible = false; scene.add(m); return m;
  });
  const pendingGeo = new THREE.ConeGeometry(0.22, 0.45, 12);
  const pendingMat = new THREE.MeshBasicMaterial({ color: PAL.cobalt });
  const pendingMarks = Array.from({ length: slots.length }, () => {
    const m = new THREE.Mesh(pendingGeo, pendingMat);
    m.rotation.x = Math.PI; m.visible = false; scene.add(m); return m;
  });
  let pendingSlots = [];

  // ---- IoT: pick-to-light lamps on the aisle-facing rack edge, one per slot
  const lampGeo = new THREE.BoxGeometry(0.1, 0.3, 1.2);
  const lampMat = new THREE.MeshBasicMaterial({ color: '#1fbf6a' });
  const glowGeo = new THREE.PlaneGeometry(2.0, 1.9);
  const glowMat = new THREE.MeshBasicMaterial({ color: '#1fbf6a', transparent: true, opacity: 0.4, depthWrite: false });
  const lamps = slots.map((s) => {
    const m = new THREE.Mesh(lampGeo, lampMat);
    m.position.set(s.x + (s.side === 0 ? 1 : -1) * (cfg.rackD / 2 + 0.05), 1.15, s.z);
    m.visible = false; scene.add(m); return m;
  });
  const lampGlow = slots.map((s, i) => {
    const g = new THREE.Mesh(glowGeo, glowMat);
    g.rotation.x = -Math.PI / 2;
    g.position.set(lamps[i].position.x + (s.side === 0 ? 0.6 : -0.6), 0.04, s.z);
    g.visible = false; scene.add(g); return g;
  });
  let litSlots = [];

  // ---- floor traffic heatmap (one strip per walking-graph edge)
  const trafficGroup = new THREE.Group();
  trafficGroup.visible = false;
  scene.add(trafficGroup);
  const trafficStrips = wh.edges.map(([u, v]) => {
    const [x1, z1] = wh.pos[u], [x2, z2] = wh.pos[v];
    const len = Math.hypot(x2 - x1, z2 - z1);
    const along = Math.abs(z2 - z1) > Math.abs(x2 - x1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(along ? 1.6 : len + 1.6, along ? len : 1.6),
      new THREE.MeshBasicMaterial({ color: '#f00', transparent: true, opacity: 0.6, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set((x1 + x2) / 2, 0.03, (z1 + z2) / 2);
    trafficGroup.add(m);
    return m;
  });

  // ---- picker (person + cart) with a soft blob shadow instead of a shadow map
  const picker = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.75, 4, 10), lambert(PAL.signal));
  body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), lambert('#c79a74'));
  head.position.y = 1.62;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), lambert('#f2c230'));
  helmet.position.y = 1.66;
  const cart = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.85), new THREE.MeshStandardMaterial({ color: PAL.steel, metalness: 0.5, roughness: 0.4 }));
  cart.position.set(0, 0.55, 0.75);
  const totes = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.75), lambert(PAL.cobalt));
  totes.position.set(0, 0.88, 0.75);
  const blobC = document.createElement('canvas');
  blobC.width = blobC.height = 64;
  const bctx = blobC.getContext('2d'), grd = bctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(40,34,24,0.42)'); grd.addColorStop(1, 'rgba(40,34,24,0)');
  bctx.fillStyle = grd; bctx.fillRect(0, 0, 64, 64);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(blobC), transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.set(0, 0.015, 0.35);
  picker.add(blob, body, head, helmet, cart, totes);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.72, 40), new THREE.MeshBasicMaterial({ color: PAL.signal, transparent: true, opacity: 0.9 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
  picker.add(ring);
  const uwb = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 40), new THREE.MeshBasicMaterial({ color: PAL.cobalt, transparent: true, opacity: 0, depthWrite: false }));
  uwb.rotation.x = -Math.PI / 2; uwb.position.y = 0.03; uwb.visible = false;
  picker.add(uwb);
  picker.position.set(dock[0], 0, dock[1]);
  scene.add(picker);

  // ---- route line
  const routeMat = new THREE.LineDashedMaterial({ color: PAL.cobalt, dashSize: 0.6, gapSize: 0.35 });
  const routeLine = new THREE.Line(new THREE.BufferGeometry(), routeMat);
  scene.add(routeLine);

  // ---- interaction
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hoverCb = () => {}, clickCb = () => {};
  const pick = (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(cartons)[0];
    return hit ? Math.floor(hit.instanceId / LEVELS.length) : -1;
  };
  let down = null, lastMove = null;
  // hover raycasts at most once per frame, not once per pointer event
  renderer.domElement.addEventListener('pointermove', (e) => { lastMove = e; });
  renderer.domElement.addEventListener('pointerleave', (e) => { lastMove = null; hoverCb(-1, e); });
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6) clickCb(pick(e), e);
    down = null;
  });
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); });
  renderer.domElement.addEventListener('webglcontextrestored', invalidate);

  function resize() {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    invalidate();
  }
  new ResizeObserver(resize).observe(el);
  resize();

  let frameCb = () => false;
  const clock = new THREE.Clock();
  let bob = 0, moving = false, anim = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (lastMove && !down) { hoverCb(pick(lastMove), lastMove); lastMove = null; }
    const playing = frameCb(dt) === true;
    for (const [id, f] of flashes) {
      const nf = f - dt;
      if (nf <= 0) flashes.delete(id); else flashes.set(id, nf);
      paintSlot(id);
    }
    // continuous animation only while something is actually moving on screen
    const animating = playing || flashes.size > 0 || partnerMarks[0].visible || uwb.visible || litSlots.length > 0;
    if (animating) {
      anim += dt;
      if (moving && playing) bob += dt * 10;
      body.position.y = 0.95 + Math.abs(Math.sin(bob)) * 0.05;
      pendingSlots.forEach((id, i) => { pendingMarks[i].position.y = cfg.rackH + 0.55 + Math.sin(anim * 4 + i) * 0.12; });
      partnerMarks.forEach((m) => { m.rotation.y = anim * 2; });
      if (uwb.visible) { const k = (anim * 1.5) % 1; uwb.scale.setScalar(0.6 + k * 2.4); uwb.material.opacity = 0.7 * (1 - k); }
      if (litSlots.length) glowMat.opacity = 0.35 + 0.2 * Math.sin(anim * 6);
      routeMat.dashOffset = -anim * 1.5;
    }
    const moved = controls.update();
    if (animating || moved || dirty) { renderer.render(scene, camera); dirty = false; }
  });

  return {
    invalidate,
    onFrame: (cb) => { frameCb = cb; },
    onSlotHover: (cb) => { hoverCb = cb; },
    onSlotClick: (cb) => { clickCb = cb; },
    setSlotColors(colors) { colors.forEach((c, i) => { baseColors[i].copy(c); paintSlot(i); }); invalidate(); },
    flashSlot(id) { flashes.set(id, 0.6); },
    setSelection: (id) => placeFrame(selFrame, id),
    setSwapTarget: (id) => placeFrame(swapFrame, id),
    setHover: (id) => placeFrame(hoverFrame, id),
    setPartners(ids) {
      partnerMarks.forEach((m, i) => {
        const id = ids[i];
        m.visible = id !== undefined;
        if (m.visible) m.position.set(slots[id].x, cfg.rackH + 0.5, slots[id].z);
      });
      invalidate();
    },
    setTraffic(values, colorFn) { // values already normalised to 0..1
      trafficGroup.visible = !!values;
      invalidate();
      if (!values) return;
      trafficStrips.forEach((m, i) => {
        const v = values[i];
        m.material.color.copy(colorFn(v));
        m.material.opacity = v === 0 ? 0 : 0.3 + 0.6 * v;
      });
    },
    setRoute(points) {
      routeLine.geometry.dispose();
      routeLine.geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, 0.08, z)));
      routeLine.computeLineDistances();
      invalidate();
    },
    setPending(ids) {
      pendingSlots = ids;
      pendingMarks.forEach((m, i) => {
        m.visible = i < ids.length;
        if (m.visible) m.position.set(slots[ids[i]].x, cfg.rackH + 0.55, slots[ids[i]].z);
      });
      invalidate();
    },
    setLights(ids) { // pick-to-light: lamps on for these slots, off for the rest
      litSlots.forEach((id) => { lamps[id].visible = lampGlow[id].visible = false; });
      litSlots = ids.slice();
      litSlots.forEach((id) => { lamps[id].visible = lampGlow[id].visible = true; });
      invalidate();
    },
    setUwb(on) { uwb.visible = on; invalidate(); },
    setPicker(x, z, heading, isMoving) {
      picker.position.set(x, 0, z);
      if (heading !== null) picker.rotation.y = heading;
      moving = isMoving;
      invalidate();
    },
    resetView() {
      camera.position.set(...HOME.pos);
      controls.target.set(...HOME.target);
      invalidate();
    },
  };
}
