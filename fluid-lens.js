// <fluid-lens video="..." still="..." radius="150"> — WebGL liquid-glass lens.
// Real refraction (no blur): the lens bends, chromatically splits and inverts the
// live video sampled underneath a static first-frame plate.
(function () {
  const VERT = `
    void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
  `;

  const FRAG = `
    precision highp float;
    uniform sampler2D uStill;
    uniform sampler2D uVideo;
    uniform vec2  uRes;
    uniform vec2  uMouse;
    uniform float uRadius;
    uniform float uTime;
    uniform vec2  uScale;
    uniform vec2  uOffset;

    vec2 coverUV(vec2 n) { return n * uScale + uOffset; }

    void main() {
      vec2 p = gl_FragCoord.xy;
      vec2 n = p / uRes;
      vec3 still = texture2D(uStill, coverUV(n)).rgb;

      if (uRadius < 1.0) { gl_FragColor = vec4(still, 1.0); return; }

      vec2 d = p - uMouse;
      float dist = length(d);
      float e = dist / max(uRadius, 0.001);
      if (e > 1.0) { gl_FragColor = vec4(still, 1.0); return; }

      vec3 col = vec3(1.0) - texture2D(uVideo, coverUV(n)).rgb;
      float edge = 1.0 - smoothstep(0.992, 1.0, e);
      gl_FragColor = vec4(mix(still, col, edge), 1.0);
    }
  `;

  class FluidLens extends HTMLElement {
    connectedCallback() {
      if (this._booted) return;
      this._booted = true;
      this.style.display = "block";
      this.style.position = "absolute";
      this.style.inset = "0";
      this.style.pointerEvents = "none";
      this.init();
    }

    async init() {
      const THREE = await import("https://esm.sh/three@0.180.0");
      const canvas = document.createElement("canvas");
      canvas.style.cssText = "display:block; width:100%; height:100%;";
      this.appendChild(canvas);

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

      const video = document.createElement("video");
      video.src = this.getAttribute("video");
      video.loop = true;
      video.muted = true;
      video.defaultMuted = true;
      video.volume = 0;
      video.playsInline = true;
      video.crossOrigin = "anonymous";
      video.addEventListener("volumechange", () => { video.muted = true; video.volume = 0; });
      const vTex = new THREE.VideoTexture(video);
      vTex.minFilter = THREE.LinearFilter;
      vTex.generateMipmaps = false;
      video.play().catch(() => {});

      const still = new THREE.TextureLoader().load(this.getAttribute("still"));
      still.minFilter = THREE.LinearFilter;
      still.generateMipmaps = false;

      const target = parseFloat(this.getAttribute("radius") || "150");
      const uniforms = {
        uStill: { value: still },
        uVideo: { value: vTex },
        uRes: { value: new THREE.Vector2(1, 1) },
        uMouse: { value: new THREE.Vector2(-9999, -9999) },
        uRadius: { value: 0 },
        uTime: { value: 0 },
        uScale: { value: new THREE.Vector2(1, 1) },
        uOffset: { value: new THREE.Vector2(0, 0) }
      };

      const scene = new THREE.Scene();
      const camera = new THREE.Camera();
      scene.add(new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, depthTest: false })
      ));

      const MEDIA_ASPECT = 16 / 9;
      const resize = () => {
        const w = this.clientWidth || window.innerWidth;
        const h = this.clientHeight || window.innerHeight;
        renderer.setSize(w, h, false);
        const dpr = renderer.getPixelRatio();
        uniforms.uRes.value.set(w * dpr, h * dpr);
        const a = w / h;
        if (a > MEDIA_ASPECT) {
          const s = MEDIA_ASPECT / a;
          uniforms.uScale.value.set(1, s);
          uniforms.uOffset.value.set(0, (1 - s) / 2);
        } else {
          const s = a / MEDIA_ASPECT;
          uniforms.uScale.value.set(s, 1);
          uniforms.uOffset.value.set((1 - s) / 2, 0);
        }
      };
      resize();
      window.addEventListener("resize", resize);

      const pointer = { x: -9999, y: -9999 };
      const damped = { x: -9999, y: -9999 };
      const vel = { x: 0, y: 0 };
      let wantOpen = false;

      window.addEventListener("pointermove", (e) => {
        const r = this.getBoundingClientRect();
        const dpr = renderer.getPixelRatio();
        pointer.x = (e.clientX - r.left) * dpr;
        pointer.y = (r.height - (e.clientY - r.top)) * dpr;
        if (damped.x < -9000) { damped.x = pointer.x; damped.y = pointer.y; }
        wantOpen = true;
      }, { passive: true });

      const close = () => { wantOpen = false; };
      window.addEventListener("pointerleave", close);
      document.addEventListener("mouseleave", close);

      const clock = { t0: performance.now() };
      const loop = () => {
        // critically damped spring — smoother acceleration/settle than a plain lerp
        const k = 0.022, d = 0.24;
        vel.x += (pointer.x - damped.x) * k;
        vel.y += (pointer.y - damped.y) * k;
        vel.x *= 1 - d;
        vel.y *= 1 - d;
        damped.x += vel.x;
        damped.y += vel.y;
        uniforms.uMouse.value.set(damped.x, damped.y);
        const dpr = renderer.getPixelRatio();
        const goal = wantOpen ? target * dpr : 0;
        uniforms.uRadius.value += (goal - uniforms.uRadius.value) * 0.12;
        uniforms.uTime.value = (performance.now() - clock.t0) / 1000;
        renderer.render(scene, camera);
        this._raf = requestAnimationFrame(loop);
      };
      loop();
      this._cleanup = () => {
        cancelAnimationFrame(this._raf);
        window.removeEventListener("resize", resize);
        renderer.dispose();
      };
    }

    disconnectedCallback() { if (this._cleanup) this._cleanup(); }
  }

  if (!customElements.get("fluid-lens")) customElements.define("fluid-lens", FluidLens);
})();
