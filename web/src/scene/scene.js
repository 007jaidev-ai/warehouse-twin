// Three.js scene for the picking floor. Plain boxes + instancing so it runs on any laptop.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const LEVELS = [0.12, 0.82, 1.52]; // shelf heights (m)
const CARTON_H = 0.55;

function textTexture(text, { size = 64, color = '#e8eef5', bg = null, w = 512, h = 128, weight = 700 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = color;
  g.font = `${weight} ${size}px Inter, Segoe UI, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createScene(el, wh) {
  const { cfg, slots } = wh;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b121b');
  scene.fog = new THREE.Fog('#0b121b', 70, 140);

  const cx = wh.width / 2, cz = (wh.frontZ + wh.backZ) / 2;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  camera.position.set(cx - 16, 30, wh.frontZ - 26);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(cx, 0, cz - 2);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 8;
  controls.maxDistance = 110;

  scene.add(new THREE.HemisphereLight('#d6e6ff', '#1a2028', 1.4));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(cx + 18, 40, cz - 24);
  sun.target.position.set(cx, 0, cz);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 120 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  // ---- floor, walkways, safety lines
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(wh.width + 40, wh.backZ - wh.frontZ + 50),
    new THREE.MeshStandardMaterial({ color: '#18212c', roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz - 4);
  floor.receiveShadow = true;
  scene.add(floor);

  const walkMat = new THREE.MeshStandardMaterial({ color: '#273444', roughness: 0.9 });
  const lineMat = new THREE.MeshBasicMaterial({ color: '#d9b42c' });
  const flat = (w, d, x, z, mat, y = 0.005) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true;
    scene.add(m); return m;
  };
  const cw = cfg.crossW;
  flat(wh.width, cw, cx, wh.frontZ, walkMat);
  flat(wh.width, cw, cx, wh.backZ, walkMat);
  for (let a = 0; a < cfg.aisles; a++) {
    const x = wh.aisleX(a);
    flat(cfg.aisleW, wh.depth, x, wh.depth / 2, walkMat);
    for (const dx of [-1, 1]) flat(0.08, wh.depth, x + dx * (cfg.aisleW / 2 - 0.12), wh.depth / 2, lineMat, 0.01);
    const lbl = flat(2.6, 0.65, x, wh.frontZ - 0.6, new THREE.MeshBasicMaterial({ map: textTexture(`AISLE ${cfg.aisles - a}`, { size: 70, color: '#9fb3c8' }), transparent: true }), 0.012);
    lbl.rotation.z = Math.PI;
  }
  for (const z of [wh.frontZ - cw / 2 + 0.1, wh.backZ + cw / 2 - 0.1]) flat(wh.width, 0.08, cx, z, lineMat, 0.01);

  // ---- packing dock
  const dock = wh.pos[wh.DOCK];
  const dockBase = new THREE.Mesh(new THREE.BoxGeometry(9, 0.25, 3.2), new THREE.MeshStandardMaterial({ color: '#30475e', roughness: 0.7 }));
  dockBase.position.set(dock[0], 0.125, dock[1] - 1.2);
  dockBase.receiveShadow = true;
  scene.add(dockBase);
  for (const dx of [-3, 0, 3]) {
    const table = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 1), new THREE.MeshStandardMaterial({ color: '#8a9bb0' }));
    table.position.set(dock[0] + dx, 0.7, dock[1] - 2.1);
    table.castShadow = true;
    scene.add(table);
  }
  const dockSign = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture('PACKING DOCK', { size: 62, color: '#ffffff', bg: '#1f6feb' }) }));
  dockSign.scale.set(5, 1.25, 1);
  dockSign.position.set(dock[0], 3.2, dock[1] - 2.2);
  scene.add(dockSign);

  // ---- racks: uprights, shelf beams, cartons (one carton per level per slot)
  const uprightGeo = new THREE.BoxGeometry(0.08, cfg.rackH, 0.08);
  const rows = [];
  for (let a = 0; a < cfg.aisles; a++) for (let s = 0; s < 2; s++) rows.push(slots.find((sl) => sl.aisle === a && sl.side === s).x);
  const uprights = new THREE.InstancedMesh(uprightGeo, new THREE.MeshStandardMaterial({ color: '#2d5fb4', metalness: 0.3, roughness: 0.5 }), rows.length * (cfg.bays + 1) * 2);
  // front/back orange beams under each shelf level (open top so carton colours show from above)
  const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.09, wh.depth), new THREE.MeshStandardMaterial({ color: '#e0782b', metalness: 0.2, roughness: 0.6 }), rows.length * LEVELS.length * 2);
  const m4 = new THREE.Matrix4();
  let ui = 0, bi = 0;
  for (const x of rows) {
    for (let b = 0; b <= cfg.bays; b++)
      for (const dx of [-cfg.rackD / 2 + 0.04, cfg.rackD / 2 - 0.04]) {
        m4.makeTranslation(x + dx, cfg.rackH / 2, b * cfg.bayW);
        uprights.setMatrixAt(ui++, m4);
      }
    for (const y of LEVELS)
      for (const dx of [-cfg.rackD / 2 + 0.04, cfg.rackD / 2 - 0.04]) {
        m4.makeTranslation(x + dx, y - 0.05, wh.depth / 2);
        beams.setMatrixAt(bi++, m4);
      }
  }
  uprights.castShadow = beams.castShadow = true;
  beams.receiveShadow = true;
  scene.add(uprights, beams);

  const cartons = new THREE.InstancedMesh(
    new THREE.BoxGeometry(cfg.rackD * 0.78, CARTON_H, cfg.bayW * 0.82),
    new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75 }),
    slots.length * LEVELS.length);
  for (const s of slots)
    LEVELS.forEach((y, l) => {
      m4.makeTranslation(s.x, y + CARTON_H / 2, s.z);
      cartons.setMatrixAt(s.id * LEVELS.length + l, m4);
      cartons.setColorAt(s.id * LEVELS.length + l, new THREE.Color('#888'));
    });
  cartons.castShadow = cartons.receiveShadow = true;
  scene.add(cartons);

  const baseColors = slots.map(() => new THREE.Color('#888'));
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
  const selFrame = mkFrame('#ffffff', 1);
  const swapFrame = mkFrame('#39d98a', 1);
  const hoverFrame = mkFrame('#9ecbff', 0.7);
  const placeFrame = (f, id) => {
    if (id < 0) { f.visible = false; return; }
    const s = slots[id];
    f.position.set(s.x, cfg.rackH / 2, s.z); f.visible = true;
  };

  const diamondGeo = new THREE.OctahedronGeometry(0.3);
  const partnerMarks = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(diamondGeo, new THREE.MeshBasicMaterial({ color: '#ff5fd2' }));
    m.visible = false; scene.add(m); return m;
  });
  const pendingMarks = Array.from({ length: 100 }, () => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 12), new THREE.MeshBasicMaterial({ color: '#33e1ff' }));
    m.rotation.x = Math.PI; m.visible = false; scene.add(m); return m;
  });
  let pendingSlots = [];

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

  // ---- picker (person + cart)
  const picker = new THREE.Group();
  const vest = new THREE.MeshStandardMaterial({ color: '#ff8a1f', roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.75, 4, 10), vest);
  body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshStandardMaterial({ color: '#e9b98f' }));
  head.position.y = 1.62;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#ffd400' }));
  helmet.position.y = 1.66;
  const cart = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.85), new THREE.MeshStandardMaterial({ color: '#9aa7b5', metalness: 0.4, roughness: 0.4 }));
  cart.position.set(0, 0.55, 0.75);
  const totes = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.75), new THREE.MeshStandardMaterial({ color: '#2f7de1' }));
  totes.position.set(0, 0.88, 0.75);
  for (const m of [body, head, helmet, cart, totes]) { m.castShadow = true; picker.add(m); }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 32), new THREE.MeshBasicMaterial({ color: '#ff8a1f', transparent: true, opacity: 0.8 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
  picker.add(ring);
  picker.position.set(dock[0], 0, dock[1]);
  scene.add(picker);

  // ---- route line
  const routeMat = new THREE.LineDashedMaterial({ color: '#33e1ff', dashSize: 0.6, gapSize: 0.35 });
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
  let down = null;
  renderer.domElement.addEventListener('pointermove', (e) => hoverCb(pick(e), e));
  renderer.domElement.addEventListener('pointerleave', (e) => hoverCb(-1, e));
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6) clickCb(pick(e), e);
    down = null;
  });

  function resize() {
    const w = el.clientWidth, h = el.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(el);
  resize();

  let frameCb = () => {};
  const clock = new THREE.Clock();
  let bob = 0, moving = false;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    frameCb(dt);
    for (const [id, f] of flashes) {
      const nf = f - dt;
      if (nf <= 0) flashes.delete(id); else flashes.set(id, nf);
      paintSlot(id);
    }
    if (moving) bob += dt * 10;
    body.position.y = 0.95 + Math.abs(Math.sin(bob)) * 0.05;
    pendingSlots.forEach((id, i) => { pendingMarks[i].position.y = cfg.rackH + 0.55 + Math.sin(t * 4 + i) * 0.12; });
    partnerMarks.forEach((m) => { m.rotation.y = t * 2; });
    routeMat.dashOffset = -t * 1.5;
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    onFrame: (cb) => { frameCb = cb; },
    onSlotHover: (cb) => { hoverCb = cb; },
    onSlotClick: (cb) => { clickCb = cb; },
    setSlotColors(colors) { colors.forEach((c, i) => { baseColors[i].copy(c); paintSlot(i); }); },
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
    },
    setTraffic(values, colorFn) { // values already normalised to 0..1
      trafficGroup.visible = !!values;
      if (!values) return;
      trafficStrips.forEach((m, i) => {
        const v = values[i];
        m.material.color.copy(colorFn(v));
        m.material.opacity = v === 0 ? 0 : 0.25 + 0.6 * v;
      });
    },
    setRoute(points) {
      routeLine.geometry.dispose();
      routeLine.geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, 0.08, z)));
      routeLine.computeLineDistances();
    },
    setPending(ids) {
      pendingSlots = ids;
      pendingMarks.forEach((m, i) => {
        m.visible = i < ids.length;
        if (m.visible) m.position.set(slots[ids[i]].x, cfg.rackH + 0.55, slots[ids[i]].z);
      });
    },
    setPicker(x, z, heading, isMoving) {
      picker.position.set(x, 0, z);
      if (heading !== null) picker.rotation.y = heading;
      moving = isMoving;
    },
    resetView() {
      camera.position.set(cx - 16, 30, wh.frontZ - 26);
      controls.target.set(cx, 0, cz - 2);
    },
  };
}
