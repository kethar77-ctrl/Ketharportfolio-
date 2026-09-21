/* ------------------------------------------------------------------ *
 * scene3d.js — the WebGL layer of the portfolio
 *
 * One fixed, transparent canvas sits between the hero headline and the
 * rest of the page (see the z-index notes in styles.css). It draws:
 *
 *   1. Your memoji as a solid, extruded "acrylic standee" that turns to
 *      face the cursor. It is anchored to #memoji-wrap, so the layout in
 *      index.html still decides where it lives.
 *   2. A few chrome / gold / red objects around it (play button, film
 *      reel, lens ring, gloss ball).
 *   3. One object per section header further down the page. The camera
 *      travels down the page as you scroll, so objects at different depths
 *      move at different speeds: real parallax, not a CSS trick.
 *   4. A handful of drifting dust particles for depth.
 *
 * World units are CSS pixels at z = 0, which is why DOM elements and 3D
 * objects line up. If WebGL, the CDN or the texture is unavailable, this
 * file quietly gives up and the flat <img id="memoji"> stays visible.
 * ------------------------------------------------------------------ */
(() => {
  'use strict';

  const root = document.documentElement;
  const canvas = document.getElementById('scene3d');
  const wrap = document.getElementById('memoji-wrap');
  const heroImg = document.getElementById('memoji');
  if (!canvas || !wrap || !heroImg) return;

  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const lowPower = (navigator.hardwareConcurrency || 8) <= 2 || (navigator.deviceMemory || 8) <= 2;

  // Respect data-saver mode and browsers with no WebGL at all.
  if (navigator.connection && navigator.connection.saveData) return;
  if (!hasWebGL()) return;

  let renderer = null;
  let raf = 0;

  init().catch((err) => {
    console.warn('[scene3d] Falling back to the flat portrait:', err);
    fallBack();
  });

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  function hasWebGL() {
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2') || probe.getContext('webgl');
      if (!gl) return false;
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext(); // hand the context back; the real renderer creates its own
      return true;
    } catch {
      return false;
    }
  }

  function fallBack() {
    cancelAnimationFrame(raf);
    raf = 0;
    root.classList.remove('webgl-ready');
    canvas.classList.remove('is-ready');
    canvas.style.display = 'none';
    if (renderer) {
      try { renderer.dispose(); } catch { /* nothing more to do */ }
    }
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // Frame-rate independent easing toward a target.
  const damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt));

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // WebGL refuses images it isn't allowed to read
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not load ' + src.slice(0, 40)));
      img.src = src;
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  // Normal case: use memoji.webp directly. If the browser blocks it (opening the
  // file straight from disk does this), fall back to the embedded copy.
  async function loadPortraitImage() {
    const src = heroImg.currentSrc || heroImg.src || 'memoji.webp';
    try {
      return await loadImage(src);
    } catch {
      await loadScript('memoji-data.js');
      if (!window.MEMOJI_DATA_URI) throw new Error('memoji-data.js did not define MEMOJI_DATA_URI');
      return loadImage(window.MEMOJI_DATA_URI);
    }
  }

  /* ------------------------------------------------------------------ *
   * Scene
   * ------------------------------------------------------------------ */
  async function init() {
    const [THREE, envMod, utilsMod] = await Promise.all([
      import('three'),
      import('three/addons/environments/RoomEnvironment.js').catch(() => null),
      import('three/addons/utils/BufferGeometryUtils.js').catch(() => null),
    ]);
    const image = await loadPortraitImage();
    const aspect = image.naturalWidth / image.naturalHeight;

    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping ?? THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;

    const scene = new THREE.Scene();
    const FOV = 30;
    const camera = new THREE.PerspectiveCamera(FOV, 1, 50, 6000);

    /* ---- image-based lighting: gives chrome and gold something to reflect ---- */
    let envMap = null;
    if (envMod && envMod.RoomEnvironment) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      envMap = pmrem.fromScene(new envMod.RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-400, 500, 700);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff3b30, 3.2); // brand-red backlight
    rim.position.set(500, 150, -500);
    scene.add(rim);

    const metal = envMap ? 1 : 0.55; // without reflections, pure metal would render black
    const materials = {
      chrome: new THREE.MeshPhysicalMaterial({ color: 0xdfe0e6, metalness: metal, roughness: 0.16, envMap, envMapIntensity: 0.9 }),
      gold: new THREE.MeshPhysicalMaterial({ color: 0xc9a96e, metalness: metal, roughness: 0.28, envMap, envMapIntensity: 1 }),
      red: new THREE.MeshPhysicalMaterial({ color: 0xff3b30, metalness: 0.1, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, envMap, envMapIntensity: 0.8 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x14141a, metalness: 0.85, roughness: 0.38, flatShading: true, envMap, envMapIntensity: 0.9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    };

    /* ------------------------------------------------------------------ *
     * Geometry (each one is roughly a unit sphere, scaled per use)
     * ------------------------------------------------------------------ */
    // Bevelled extrusions come out faceted; crease-aware normals smooth the bevel but keep hard edges.
    const smooth = (geo) => (utilsMod && utilsMod.toCreasedNormals ? utilsMod.toCreasedNormals(geo, Math.PI / 5) : geo);

    function playGeometry() {
      const pts = [[1, 0], [-0.5, 0.866], [-0.5, -0.866]];
      const t = 0.24; // corner rounding
      const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      const shape = new THREE.Shape();
      pts.forEach((cur, i) => {
        const prev = pts[(i + 2) % 3];
        const next = pts[(i + 1) % 3];
        const s = lerp(cur, prev, t);
        const e = lerp(cur, next, t);
        if (i === 0) shape.moveTo(s[0], s[1]);
        else shape.lineTo(s[0], s[1]);
        shape.quadraticCurveTo(cur[0], cur[1], e[0], e[1]);
      });
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: 0.42, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.09, bevelSegments: 6, curveSegments: 18,
      });
      geo.center();
      return smooth(geo);
    }

    function reelGeometry() {
      const shape = new THREE.Shape();
      shape.absarc(0, 0, 1, 0, Math.PI * 2, false);
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        const hole = new THREE.Path();
        hole.absarc(Math.cos(a) * 0.56, Math.sin(a) * 0.56, 0.19, 0, Math.PI * 2, true);
        shape.holes.push(hole);
      }
      const hub = new THREE.Path();
      hub.absarc(0, 0, 0.1, 0, Math.PI * 2, true);
      shape.holes.push(hub);
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: 0.16, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.035, bevelSegments: 4, curveSegments: 48,
      });
      geo.center();
      return smooth(geo);
    }

    const geo = {
      play: playGeometry(),
      reel: reelGeometry(),
      knot: new THREE.TorusKnotGeometry(0.5, 0.17, 220, 28, 2, 3),
      ring: new THREE.TorusGeometry(1, 0.26, 32, 110),
      ball: new THREE.SphereGeometry(1, 64, 48),
      crystal: new THREE.IcosahedronGeometry(1, 0),
    };

    function makeMesh(kind, materialKey) {
      if (kind === 'crystal') {
        const solid = new THREE.Mesh(geo.crystal, materials.dark);
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo.crystal, 1),
          new THREE.LineBasicMaterial({ color: 0xc9a96e, transparent: true, opacity: 0.95 }),
        );
        solid.add(edges);
        return solid;
      }
      return new THREE.Mesh(geo[kind], materials[materialKey]);
    }

    /* ------------------------------------------------------------------ *
     * The portrait: a stack of dark, tinted copies behind the front image
     * gives the cut-out real thickness when it turns.
     * ------------------------------------------------------------------ */
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;

    const plane = new THREE.PlaneGeometry(1, 1);
    const LAYERS = 14;
    const portrait = new THREE.Group();
    const layers = [];
    const edgeNear = new THREE.Color(0x7a1a12);
    const edgeFar = new THREE.Color(0x120404);
    for (let i = 0; i < LAYERS; i += 1) {
      let material;
      if (i === 0) {
        material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.01, toneMapped: false });
      } else {
        material = new THREE.MeshBasicMaterial({
          map: texture,
          color: edgeNear.clone().lerp(edgeFar, i / (LAYERS - 1)),
          alphaTest: 0.5,
          alphaToCoverage: true,
          toneMapped: false,
        });
      }
      const mesh = new THREE.Mesh(plane, material);
      portrait.add(mesh);
      layers.push(mesh);
    }
    scene.add(portrait);

    /* ------------------------------------------------------------------ *
     * Objects: hero ring around the portrait + one per section header
     * ------------------------------------------------------------------ */
    // dx / dy are in portrait heights from its centre; size is a fraction of the portrait height.
    const HERO_SPECS = [
      { kind: 'play', mat: 'red', dx: -0.86, dy: 0.3, z: 90, size: 0.17, spin: [0.1, 0.42, 0.05], scrollSpin: 1.2, parallax: 26, rot: [0.2, 0.5, -0.25] },
      { kind: 'reel', mat: 'gold', dx: 0.88, dy: -0.04, z: -70, size: 0.25, spin: [0.14, 0.22, 0.32], scrollSpin: 0.8, parallax: 14, rot: [0.5, -0.5, 0.2] },
      { kind: 'ring', mat: 'chrome', dx: -0.68, dy: -0.46, z: -20, size: 0.11, spin: [0.5, 0.3, 0.1], scrollSpin: 1.4, parallax: 18, rot: [1.0, 0.3, 0] },
      { kind: 'ball', mat: 'red', dx: 0.56, dy: 0.6, z: 130, size: 0.065, spin: [0, 0, 0], scrollSpin: 0, parallax: 34, rot: [0, 0, 0] },
    ];

    // Each page object hangs in the empty right-hand side of a section header.
    const PAGE_SPECS = [
      { section: '#services', head: ':scope > .reveal', maxW: 1152, kind: 'knot', mat: 'chrome', size: 92, z: -30, spin: [0.08, 0.2, 0.04], scrollSpin: 1, parallax: 16, rot: [0.6, 0.2, 0.3] },
      { section: '#toolkit', head: ':scope > .reveal', maxW: 1152, kind: 'crystal', mat: 'dark', size: 78, z: 50, spin: [0.12, 0.26, 0.06], scrollSpin: 1.2, parallax: 22, rot: [0.4, 0.3, 0.1] },
      { section: 'section[aria-labelledby="process-heading"]', head: ':scope > .reveal', maxW: 1152, kind: 'reel', mat: 'gold', size: 84, z: -60, spin: [0.1, 0.18, 0.28], scrollSpin: 0.9, parallax: 12, rot: [0.6, -0.4, 0.1] },
      { section: '#faq', head: ':scope > .reveal', maxW: 896, kind: 'ball', mat: 'red', size: 60, z: 80, spin: [0, 0, 0], scrollSpin: 0, parallax: 24, rot: [0, 0, 0] },
    ];

    const items = [];
    function addItem(spec, group) {
      const mesh = makeMesh(spec.kind, spec.mat);
      mesh.rotation.set(spec.rot[0], spec.rot[1], spec.rot[2]);
      scene.add(mesh);
      const item = {
        spec,
        group,
        mesh,
        base: { x: 0, y: 0, z: 0 },
        spin: spec.spin,
        scrollSpin: spec.scrollSpin,
        parallax: spec.parallax,
        floatAmp: group === 'hero' ? 6 : 8,
        floatSpeed: 0.6 + Math.random() * 0.5,
        phase: Math.random() * Math.PI * 2,
        size: spec.size,
      };
      items.push(item);
      return item;
    }
    const heroItems = HERO_SPECS.map((spec) => addItem(spec, 'hero'));
    const pageItems = PAGE_SPECS.map((spec) => {
      const item = addItem(spec, 'page');
      item.sectionEl = document.querySelector(spec.section);
      item.headEl = item.sectionEl ? item.sectionEl.querySelector(spec.head) : null;
      if (!item.sectionEl || !item.headEl) item.mesh.visible = false;
      return item;
    });

    /* ---- dust ---- */
    function softDot() {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    const DUST_MAX = 220;
    const dustSeed = Array.from({ length: DUST_MAX }, () => [Math.random(), Math.random(), Math.random()]);
    const dustPositions = new Float32Array(DUST_MAX * 3);
    const dustColors = new Float32Array(DUST_MAX * 3);
    const palette = [new THREE.Color(0xffffff), new THREE.Color(0xc9a96e), new THREE.Color(0xff3b30)];
    for (let i = 0; i < DUST_MAX; i += 1) {
      const pick = Math.random();
      const c = palette[pick < 0.6 ? 0 : pick < 0.85 ? 1 : 2];
      const b = 0.35 + Math.random() * 0.65;
      dustColors[i * 3] = c.r * b;
      dustColors[i * 3 + 1] = c.g * b;
      dustColors[i * 3 + 2] = c.b * b;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    dustGeo.setAttribute('color', new THREE.BufferAttribute(dustColors, 3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      size: 20, map: softDot(), transparent: true, opacity: 0.75, depthWrite: false, vertexColors: true, sizeAttenuation: true, toneMapped: false,
    }));
    dust.frustumCulled = false;
    dust.renderOrder = 10; // after the portrait, so its depth already hides dust behind it
    scene.add(dust);

    /* ------------------------------------------------------------------ *
     * State, sizing and layout
     * ------------------------------------------------------------------ */
    const toggle = document.getElementById('motion-toggle');
    const state = {
      reduced: reducedQuery.matches,
      paused: reducedQuery.matches || (toggle && toggle.dataset.paused === 'true'),
    };
    const hero = { H: 320, S: 1, screenX: 0, pageY: 0, base: { x: 0, y: 0 } };
    const mouse = { x: 0, y: 0, active: false };
    const pointer = { x: 0, y: 0 }; // smoothed, -1..1 from the viewport centre
    const tilt = { x: 0, y: 0 };    // smoothed, portrait-relative
    let vw = 1;
    let vh = 1;
    let camZ = 1000;
    let dirty = true;
    let layoutQueued = false;

    function layout() {
      layoutQueued = false;
      const sy = window.scrollY;

      // Portrait
      const r = wrap.getBoundingClientRect();
      const H = Math.max(r.height, 1);
      const W = H * aspect;
      hero.H = H;
      hero.S = H / 320;
      hero.screenX = r.left + r.width / 2;
      hero.pageY = r.top + sy + r.height / 2;
      hero.base.x = hero.screenX - vw / 2;
      hero.base.y = -hero.pageY;
      const thickness = H * 0.05;
      const step = thickness / (LAYERS - 1);
      layers.forEach((mesh, i) => {
        mesh.scale.set(W, H, 1);
        mesh.position.z = -i * step;
      });

      // Hero objects: pull them in on narrow screens so nothing is clipped
      const spread = Math.min(1, (vw / 2 - 8) / (1.15 * H));
      heroItems.forEach((it) => {
        const s = it.spec;
        it.base.x = hero.base.x + s.dx * H * spread;
        it.base.y = hero.base.y + s.dy * H;
        it.base.z = s.z * hero.S;
        it.mesh.scale.setScalar(s.size * H);
      });

      // Section objects: only where there is room beside the header text
      const showPage = vw >= 1024 && !state.reduced && !lowPower;
      pageItems.forEach((it) => {
        if (!it.sectionEl || !it.headEl) return;
        it.mesh.visible = showPage;
        if (!showPage) return;
        const secTop = it.sectionEl.getBoundingClientRect().top + sy;
        const pageY = secTop + it.headEl.offsetTop + it.headEl.offsetHeight * 0.5;
        const containerW = Math.min(vw, it.spec.maxW);
        const right = (vw + containerW) / 2 - 24;
        const screenX = right - it.size * 1.05;
        it.base.x = screenX - vw / 2;
        it.base.y = -pageY;
        it.base.z = it.spec.z;
        it.mesh.scale.setScalar(it.size);
      });

      // Dust fills the whole page height
      const docH = Math.max(document.documentElement.scrollHeight, vh);
      const count = vw < 768 || lowPower ? 90 : DUST_MAX;
      for (let i = 0; i < DUST_MAX; i += 1) {
        const [a, b, c] = dustSeed[i];
        dustPositions[i * 3] = (a - 0.5) * vw * 1.3;
        dustPositions[i * 3 + 1] = -b * docH;
        dustPositions[i * 3 + 2] = -520 + c * 820;
      }
      dustGeo.setDrawRange(0, count);
      dustGeo.attributes.position.needsUpdate = true;

      dirty = true;
    }

    function queueLayout() {
      if (layoutQueued) return;
      layoutQueued = true;
      requestAnimationFrame(layout);
    }

    let sizedW = 0;
    let sizedH = 0;
    let sizedDpr = 0;

    function resize() {
      vw = canvas.clientWidth || window.innerWidth;
      vh = canvas.clientHeight || window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1 : finePointer ? 2 : 1.5);
      if (vw !== sizedW || vh !== sizedH || dpr !== sizedDpr) {
        sizedW = vw;
        sizedH = vh;
        sizedDpr = dpr;
        renderer.setPixelRatio(dpr);
        renderer.setSize(vw, vh, false);
      }
      camera.aspect = vw / vh;
      // Distance at which 1 world unit == 1 CSS pixel on the z = 0 plane
      camZ = (vh / 2) / Math.tan((FOV * Math.PI) / 360);
      camera.position.z = camZ;
      camera.updateProjectionMatrix();
      layout();
    }

    /* ------------------------------------------------------------------ *
     * Frame loop
     * ------------------------------------------------------------------ */
    let last = performance.now();
    let time = 0;
    let lastSy = window.scrollY;
    let lastInput = 0;   // last scroll or mouse movement
    let lastDraw = 0;
    let shown = false;

    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = clamp((now - last) / 1000, 0, 0.1);

      const sy = window.scrollY;
      const animating = !state.paused;
      if (!animating && !dirty && sy === lastSy) return;

      // While nothing is being scrolled or pointed, only the slow idle motion is running:
      // 30 fps looks identical and halves the GPU load.
      if (sy !== lastSy) lastInput = now;
      if (!dirty && now - lastInput > 600 && now - lastDraw < 32) return;
      lastDraw = now;
      last = now;

      if (animating) time += dt;
      const dScroll = animating ? clamp(sy - lastSy, -80, 80) : 0;

      // Pointer (mouse only; touch has no hover)
      const useMouse = animating && !state.reduced && mouse.active;
      pointer.x = damp(pointer.x, useMouse ? (mouse.x / vw) * 2 - 1 : 0, 4, dt);
      pointer.y = damp(pointer.y, useMouse ? (mouse.y / vh) * 2 - 1 : 0, 4, dt);

      camera.position.y = -(sy + vh / 2);

      // Portrait: turns toward the cursor, with a slow idle sway
      let tx = 0;
      let ty = 0;
      if (useMouse) {
        tx = clamp((mouse.x - hero.screenX) / (vw * 0.5), -1, 1);
        ty = clamp((mouse.y - (hero.pageY - sy)) / (vh * 0.5), -1, 1);
      }
      if (animating) {
        tilt.x = damp(tilt.x, tx, 5, dt);
        tilt.y = damp(tilt.y, ty, 5, dt);
      } else {
        tilt.x = 0;
        tilt.y = 0;
      }
      const sway = animating ? 1 : 0;
      portrait.rotation.y = tilt.x * 0.36 + sway * Math.sin(time * 0.55) * 0.07;
      portrait.rotation.x = tilt.y * 0.2 + sway * Math.sin(time * 0.42 + 1.2) * 0.035;
      portrait.position.set(hero.base.x, hero.base.y + sway * Math.sin(time * 0.8) * 5 * hero.S, 0);

      // Objects
      for (let i = 0; i < items.length; i += 1) {
        const it = items[i];
        const m = it.mesh;
        if (!m.visible) continue;
        if (animating) {
          m.rotation.x += it.spin[0] * dt;
          m.rotation.y += it.spin[1] * dt + dScroll * it.scrollSpin * 0.0016;
          m.rotation.z += it.spin[2] * dt;
        }
        const bob = animating ? Math.sin(time * it.floatSpeed + it.phase) * it.floatAmp : 0;
        m.position.set(
          it.base.x + pointer.x * it.parallax,
          it.base.y + bob - pointer.y * it.parallax * 0.6,
          it.base.z,
        );
      }

      renderer.render(scene, camera);
      lastSy = sy;
      dirty = false;

      if (!shown) {
        shown = true;
        canvas.classList.add('is-ready');
        root.classList.add('webgl-ready');
      }
    }

    /* ------------------------------------------------------------------ *
     * Wiring
     * ------------------------------------------------------------------ */
    window.addEventListener('resize', resize);
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(queueLayout);
      ro.observe(document.body);
      ro.observe(wrap);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueLayout);
    window.addEventListener('load', queueLayout);

    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
      lastInput = performance.now();
      dirty = true;
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => { mouse.active = false; dirty = true; });

    document.addEventListener('portfolio:motion', (e) => {
      state.paused = !!(e.detail && e.detail.paused);
      dirty = true;
    });
    const onReducedChange = (e) => {
      state.reduced = e.matches;
      if (e.matches) state.paused = true;
      queueLayout();
    };
    if (reducedQuery.addEventListener) reducedQuery.addEventListener('change', onReducedChange);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    });

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      root.classList.remove('webgl-ready');
      canvas.classList.remove('is-ready');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      texture.needsUpdate = true;
      shown = false;
      dirty = true;
    });

    resize();
    raf = requestAnimationFrame(frame);
  }
})();
