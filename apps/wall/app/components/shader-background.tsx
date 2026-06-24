import { useEffect, useRef } from "react";

// Liquid risograph background. A full-screen WebGL fragment shader that paints
// the *same* four-corner colour mesh as the CSS `body::before` (styles.css):
// green → teal → gold → clay, anchored to the corners. It flows like a slow
// liquid (fbm domain warp), drifts hue a touch over time, and bulges gently
// toward the cursor. The CSS mesh stays as the no-JS / no-WebGL fallback; once
// this mounts we hide it via [data-shader-bg="on"], keeping the film grain on top.

type Pool = { color: [number, number, number]; alpha: number };

function hex(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Matches the light/dark gradient stacks in styles.css (corner colours + alphas).
const LIGHT: Pool[] = [
  { color: hex("#66800b"), alpha: 0.26 }, // top-left  · green / signal
  { color: hex("#24837b"), alpha: 0.22 }, // top-right · teal
  { color: hex("#ad8301"), alpha: 0.22 }, // bot-right · gold
  { color: hex("#bc5215"), alpha: 0.15 }, // bot-left  · clay
];
const DARK: Pool[] = [
  { color: hex("#a0af54"), alpha: 0.20 },
  { color: hex("#5abdac"), alpha: 0.18 },
  { color: hex("#d0a215"), alpha: 0.18 },
  { color: hex("#da702c"), alpha: 0.14 },
];

// Corner anchors (uv, y-down) — same positions as the CSS radial gradients.
const CORNERS = new Float32Array([0.06, 0.04, 0.94, 0.06, 0.94, 0.96, 0.06, 0.96]);

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform vec2  uMouse;     // eased cursor, uv 0..1, y-down
uniform float uMouseAmt;  // 0..1 presence
uniform float uReduced;   // 1.0 => prefers-reduced-motion (freeze)
uniform vec3  uColors[4];
uniform float uAlphas[4];
uniform vec2  uCorners[4];

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, amp = 0.5;
  for (int i = 0; i < 5; i++) { v += amp * noise(p); p *= 2.0; amp *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  uv.y = 1.0 - uv.y;                 // y-down, to match the corner anchors
  float asp = uRes.x / uRes.y;
  vec2 ap = vec2(uv.x * asp, uv.y);  // aspect-corrected space
  float t = (uReduced > 0.5) ? 0.0 : uTime;

  // Liquid: fbm of fbm (domain warp) for slow, organic flow.
  vec2 fp = ap * 1.6;
  vec2 q = vec2(fbm(fp + vec2(0.0, 0.3) + 0.05 * t),
                fbm(fp + vec2(4.7, 2.1) - 0.04 * t));
  vec2 r = vec2(fbm(fp + 2.2 * q + vec2(1.7, 9.2) + 0.03 * t),
                fbm(fp + 2.2 * q + vec2(8.3, 2.8) - 0.035 * t));
  vec2 warp = r - 0.5;

  // Cursor: a gentle outward lens plus a soft ripple ring — subtle.
  vec2 mp = vec2(uMouse.x * asp, uMouse.y);
  float md = distance(ap, mp);
  float amt = exp(-md * md * 6.0) * uMouseAmt;
  warp += normalize(ap - mp + 1e-4) * amt * 0.06 * sin(md * 16.0 - t * 1.5);
  vec2 lens = (ap - mp) * amt * 0.10;
  vec2 suv = ap + warp * 0.16 - lens;

  // Accumulate the four pools (premultiplied: rgb already scaled by coverage).
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 c = uCorners[i];
    c += 0.03 * vec2(sin(t * 0.10 + float(i) * 1.7), cos(t * 0.12 + float(i) * 2.3));
    float d = distance(suv, vec2(c.x * asp, c.y));
    float w = pow(smoothstep(1.15, 0.0, d), 1.25);
    w *= uAlphas[i] * (1.0 + 0.12 * sin(t * 0.2 + float(i) * 1.9)); // breathe
    col += uColors[i] * w;
    a += w;
  }
  a = clamp(a, 0.0, 1.0);

  // "Cambia de color un poco": a tiny hue drift over time (~±6°).
  float ang = (uReduced > 0.5) ? 0.0 : 0.10 * sin(t * 0.06);
  mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYIQ * col;
  float cs = cos(ang), sn = sin(ang);
  yiq = vec3(yiq.x, yiq.y * cs - yiq.z * sn, yiq.y * sn + yiq.z * cs);
  col = toRGB * yiq;

  gl_FragColor = vec4(col, a);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { gl.deleteShader(sh); return null; }
  return sh;
}

export function ShaderBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return; // no WebGL → keep the CSS mesh fallback

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    // Full-screen triangle.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied over the page

    const u = {
      res: gl.getUniformLocation(prog, "uRes"),
      time: gl.getUniformLocation(prog, "uTime"),
      mouse: gl.getUniformLocation(prog, "uMouse"),
      mouseAmt: gl.getUniformLocation(prog, "uMouseAmt"),
      reduced: gl.getUniformLocation(prog, "uReduced"),
      colors: gl.getUniformLocation(prog, "uColors[0]"),
      alphas: gl.getUniformLocation(prog, "uAlphas[0]"),
      corners: gl.getUniformLocation(prog, "uCorners[0]"),
    };
    gl.uniform2fv(u.corners, CORNERS);

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    gl.uniform1f(u.reduced, reduced ? 1 : 0);

    // Palette follows the theme; re-applied when the `dark` class toggles.
    function applyPalette() {
      const pools = document.documentElement.classList.contains("dark") ? DARK : LIGHT;
      gl!.uniform3fv(u.colors, new Float32Array(pools.flatMap(p => p.color)));
      gl!.uniform1fv(u.alphas, new Float32Array(pools.map(p => p.alpha)));
    }
    applyPalette();

    let w = 0, h = 0;
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      w = Math.round(innerWidth * dpr);
      h = Math.round(innerHeight * dpr);
      canvas!.width = w; canvas!.height = h;
      gl!.viewport(0, 0, w, h);
      gl!.uniform2f(u.res, w, h);
    }
    resize();

    // Eased cursor + presence, so the liquid follows softly rather than snapping.
    let mx = 0.5, my = 0.5, tmx = 0.5, tmy = 0.5, amt = 0, lastMove = -1e9;
    function onMove(cx: number, cy: number) {
      tmx = cx / innerWidth; tmy = cy / innerHeight; lastMove = performance.now();
    }
    const mouse = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const touch = (e: TouchEvent) => { const t = e.touches[0]; if (t) onMove(t.clientX, t.clientY); };
    addEventListener("mousemove", mouse, { passive: true });
    addEventListener("touchmove", touch, { passive: true });
    addEventListener("resize", resize);

    const themeObs = new MutationObserver(applyPalette);
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    const start = performance.now();
    let raf = 0, running = true;

    function frame() {
      if (!running) return;
      const now = performance.now();
      if (!reduced) {
        mx += (tmx - mx) * 0.06; my += (tmy - my) * 0.06;
        const want = now - lastMove < 1200 ? 1 : 0;
        amt += (want - amt) * 0.05;
        gl!.uniform1f(u.time, (now - start) / 1000);
        gl!.uniform2f(u.mouse, mx, my);
        gl!.uniform1f(u.mouseAmt, amt);
      }
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      if (!reduced) raf = requestAnimationFrame(frame);
    }

    // Pause the loop when the tab is hidden (no point burning frames).
    function onVisibility() {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!reduced) { running = true; raf = requestAnimationFrame(frame); }
    }
    document.addEventListener("visibilitychange", onVisibility);

    // Hand over from the CSS mesh now that the shader is live.
    document.documentElement.dataset.shaderBg = "on";

    if (reduced) frame();                      // one static paint
    else raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      removeEventListener("mousemove", mouse);
      removeEventListener("touchmove", touch);
      removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      themeObs.disconnect();
      delete document.documentElement.dataset.shaderBg;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-[2] h-full w-full"
    />
  );
}
