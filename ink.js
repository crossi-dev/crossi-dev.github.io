/* ============================================================
   ink.js — WebGL hero treatment for Carlos Rossi's portfolio
   ------------------------------------------------------------
   ORIGINAL piece (deliberately NOT a stock effect): the name is
   rasterized to an offscreen canvas, mapped onto a Three.js plane,
   and pushed through a domain-warped flow-noise displacement — an
   "ink settling on paper" treatment in Velora's navy-on-cream ink.
   It blooms in on load, then breathes + reacts to the pointer.

   Brand-coherent: navy ink (#1B3A6B) on warm cream (#FAF6EE), the
   editorial "ink" metaphor, no particles / orbs / gradient text.

   Progressive enhancement: if Three.js is unavailable, WebGL is
   unsupported, the viewport is tiny, or the user prefers reduced
   motion, this module does nothing and the static Fraunces <h1>
   stays visible underneath. No layout dependency on the canvas.
   ============================================================ */
(function () {
  "use strict";

  var mount = document.getElementById("ink");
  if (!mount) return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var THREE = window.THREE;

  // Bail conditions -> leave the static wordmark visible.
  if (reduce || !THREE || !supportsWebGL()) return;

  function supportsWebGL() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext &&
        (c.getContext("webgl") || c.getContext("experimental-webgl")));
    } catch (e) { return false; }
  }

  var INK = "#1B3A6B";
  var CREAM = "#FAF6EE";

  // ---- Rasterize the wordmark to a texture --------------------
  // Two lines, Fraunces, tight tracking — matches the static H1.
  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  function buildTextTexture(w, h) {
    var c = document.createElement("canvas");
    c.width = Math.floor(w * DPR);
    c.height = Math.floor(h * DPR);
    var ctx = c.getContext("2d");
    ctx.scale(DPR, DPR);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = INK;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    // Size the type to the box. Fraunces is loaded via <link>; we
    // gate creation on document.fonts.ready so metrics are correct.
    var size = Math.min(w * 0.205, h * 0.46);
    var family = '600 ' + size + 'px "Fraunces", Georgia, serif';
    ctx.font = family;

    var line1 = "Carlos";
    var line2 = "Rossi";
    var lineGap = size * 1.0;
    var x = w * 0.012;
    var y1 = h * 0.5 - lineGap * 0.5 + size * 0.34;
    var y2 = y1 + lineGap;

    // micro letter-spacing to echo the CSS -0.025em
    drawTracked(ctx, line1, x, y1, -size * 0.022);
    drawTracked(ctx, line2, x, y2, -size * 0.022);

    var tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  function drawTracked(ctx, str, x, y, track) {
    var cx = x;
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + track;
    }
  }

  // ---- Three.js plumbing --------------------------------------
  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(DPR);
  renderer.setClearColor(0x000000, 0);
  mount.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("aria-hidden", "true");

  var scene = new THREE.Scene();
  var camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  var uniforms = {
    uTex: { value: null },
    uTime: { value: 0 },
    uReveal: { value: 0 },        // 0 -> 1 ink-bloom on load
    uPointer: { value: new THREE.Vector2(0.5, 0.5) },
    uHover: { value: 0 },         // eased pointer influence
    uAspect: { value: 1 },
    uCream: { value: new THREE.Color(CREAM) }
  };

  var geo = new THREE.PlaneGeometry(2, 2, 1, 1);
  var mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: uniforms,
    vertexShader: [
      "varying vec2 vUv;",
      "void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }"
    ].join("\n"),
    fragmentShader: [
      "precision highp float;",
      "varying vec2 vUv;",
      "uniform sampler2D uTex;",
      "uniform float uTime;",
      "uniform float uReveal;",
      "uniform float uHover;",
      "uniform vec2 uPointer;",
      "uniform float uAspect;",
      "uniform vec3 uCream;",

      // hash + value noise (Inigo Quilez style) — cheap, smooth
      "float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }",
      "float noise(vec2 p){",
      "  vec2 i = floor(p); vec2 f = fract(p);",
      "  vec2 u = f*f*(3.0-2.0*f);",
      "  float a = hash(i);",
      "  float b = hash(i+vec2(1.0,0.0));",
      "  float c = hash(i+vec2(0.0,1.0));",
      "  float d = hash(i+vec2(1.0,1.0));",
      "  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);",
      "}",
      "float fbm(vec2 p){",
      "  float v = 0.0; float a = 0.5;",
      "  for(int i=0;i<5;i++){ v += a*noise(p); p *= 2.0; a *= 0.5; }",
      "  return v;",
      "}",

      "void main(){",
      "  vec2 uv = vUv;",
      "  vec2 auv = vec2(uv.x*uAspect, uv.y);",

      // domain-warped flow field — the 'ink' movement
      "  float t = uTime*0.06;",
      "  vec2 q = vec2(fbm(auv*2.3 + t), fbm(auv*2.3 + vec2(5.2,1.3) - t));",
      "  float flow = fbm(auv*2.6 + 1.6*q + t*0.5);",

      // pointer pull — ink leans toward the cursor, gently
      "  vec2 pd = (uv - uPointer);",
      "  float pdist = length(vec2(pd.x*uAspect, pd.y));",
      "  float pull = smoothstep(0.55, 0.0, pdist) * uHover;",

      // reveal: ink blooms from baseline; displacement relaxes as it settles
      "  float settle = 1.0 - uReveal;",
      "  float amp = (0.022 + 0.05*settle) + pull*0.02;",
      "  vec2 disp = vec2((flow-0.5), (q.y-0.5)) * amp;",
      "  disp += normalize(pd + 1e-5) * pull * 0.012;",

      "  vec2 suv = uv + disp;",
      "  float ink = texture2D(uTex, suv).a;",

      // soft edge + subtle tonal variation inside the ink (paper bleed)
      "  float edge = smoothstep(0.04, 0.6, ink);",
      "  float grain = 0.92 + 0.08*fbm(auv*9.0 - t);",

      // vertical reveal mask: ink soaks upward into the letters
      "  float mask = smoothstep(uReveal*1.15 - 0.18, uReveal*1.15 + 0.06, 1.0 - uv.y + flow*0.06);",
      "  float a = edge * grain * clamp(uReveal*1.25, 0.0, 1.0) * (0.35 + 0.65*mask);",

      // ink color: navy, slightly deepened where flow concentrates
      "  vec3 col = mix(vec3(0.106,0.227,0.419), vec3(0.06,0.122,0.275), flow*0.7 + pull*0.3);",
      "  gl_FragColor = vec4(col, a);",
      "}"
    ].join("\n")
  });

  var mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);

  // ---- Sizing -------------------------------------------------
  function resize() {
    var r = mount.getBoundingClientRect();
    var w = Math.max(1, r.width);
    var h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    uniforms.uAspect.value = w / h;
    if (uniforms.uTex.value) uniforms.uTex.value.dispose();
    uniforms.uTex.value = buildTextTexture(w, h);
  }

  // ---- Pointer ------------------------------------------------
  var targetPointer = new THREE.Vector2(0.5, 0.5);
  var targetHover = 0;
  function onMove(e) {
    var r = mount.getBoundingClientRect();
    targetPointer.set(
      (e.clientX - r.left) / r.width,
      1.0 - (e.clientY - r.top) / r.height
    );
    targetHover = 1;
  }
  function onLeave() { targetHover = 0; }
  window.addEventListener("pointermove", onMove, { passive: true });
  mount.addEventListener("pointerleave", onLeave);

  // Pause rendering when the hero scrolls out of view (battery/CPU).
  var visible = true;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (ents) {
      visible = ents[0].isIntersecting;
    }, { threshold: 0.01 }).observe(mount);
  }

  // ---- Reveal + loop ------------------------------------------
  var start = null;
  function loop(ts) {
    if (start === null) start = ts;
    var el = (ts - start) / 1000;

    // ink-bloom reveal over ~1.6s, eased
    var rv = Math.min(el / 1.6, 1);
    uniforms.uReveal.value = rv < 1 ? (1 - Math.pow(1 - rv, 3)) : 1;

    uniforms.uTime.value = el;
    uniforms.uPointer.value.lerp(targetPointer, 0.06);
    uniforms.uHover.value += (targetHover - uniforms.uHover.value) * 0.05;

    if (visible) renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  // Wait for Fraunces so the rasterized metrics match the page.
  function boot() {
    resize();
    mount.classList.add("ink-on");
    // Fade the rasterized static H1 out explicitly. We set inline opacity
    // here (rather than relying on a stylesheet rule) because the hero
    // GSAP timeline writes an inline opacity:1 on the H1 that would win
    // over any stylesheet selector. Inline-vs-inline, last writer wins.
    var h1 = document.querySelector(".hero-name");
    if (h1) {
      h1.style.transition = "opacity 0.5s " +
        "cubic-bezier(0.16,1,0.3,1)";
      // let the GSAP intro play, then dissolve the duplicate.
      setTimeout(function () { h1.style.opacity = "0"; }, 900);
    }
    requestAnimationFrame(loop);
  }

  var ro;
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(boot);
  } else {
    window.addEventListener("load", boot);
  }

  // Debounced resize.
  var rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(resize, 160);
  });
})();
