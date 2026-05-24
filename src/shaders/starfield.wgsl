/**
 * starfield.wgsl — Fullscreen-quad background shader.
 *
 * Renders a parallax starfield using procedural noise.
 * Drawn as a single fullscreen quad (6 vertices, no vertex buffer —
 * positions are computed from vertex_index in the vertex shader).
 *
 * Two layers of stars at different speeds give a subtle depth effect.
 * Stars twinkle via a time-modulated brightness.
 *
 * Bind group 0 — per-frame uniforms (projection matrix + time)
 * (Same bind group layout as the sprite pass — shared bind group object.)
 */

struct Uniforms {
  proj: mat4x4<f32>,
  time: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// ── Vertex shader — fullscreen quad via vertex_index trick ────────────────────
//
// WebGPU clip space: x ∈ [-1,1], y ∈ [-1,1], z ∈ [0,1].
// Six vertices (two triangles) covering the entire clip-space rectangle.
// UV (0,0) = top-left, (1,1) = bottom-right.

const QUAD_CLIP = array<vec2<f32>, 6>(
  vec2(-1.0,  1.0),  // top-left
  vec2( 1.0,  1.0),  // top-right
  vec2(-1.0, -1.0),  // bottom-left
  vec2( 1.0,  1.0),  // top-right  (shared)
  vec2( 1.0, -1.0),  // bottom-right
  vec2(-1.0, -1.0),  // bottom-left (shared)
);

const QUAD_UV = array<vec2<f32>, 6>(
  vec2(0.0, 0.0),
  vec2(1.0, 0.0),
  vec2(0.0, 1.0),
  vec2(1.0, 0.0),
  vec2(1.0, 1.0),
  vec2(0.0, 1.0),
);

struct StarVOut {
  @builtin(position) pos: vec4<f32>,
  @location(0)       uv:  vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> StarVOut {
  var out: StarVOut;
  out.pos = vec4<f32>(QUAD_CLIP[vid], 0.0, 1.0);
  out.uv  = QUAD_UV[vid];
  return out;
}

// ── Procedural star helpers ───────────────────────────────────────────────────

// A fast deterministic hash that maps a 2D grid cell to a pseudo-random value.
fn hash21(p: vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(127.1, 311.7));
  q += dot(q, q + 19.19);
  return fract(q.x * q.y);
}

/**
 * Sample a star layer at UV `uv`.
 *
 * The UV space is divided into a grid of `gridSize × gridSize` cells.
 * Each cell gets one star at a random sub-cell position.
 * `speed` controls how fast the layer drifts downward (parallax).
 * Returns brightness [0,1] — 0 for empty space, >0 for a star pixel.
 */
fn starLayer(uv: vec2<f32>, gridSize: f32, speed: f32, seed: f32) -> f32 {
  // Scroll the UV downward over time (stars drift down = camera moving up)
  let scrolled = uv + vec2<f32>(0.0, uniforms.time * speed);
  let cell = floor(scrolled * gridSize);
  let local = fract(scrolled * gridSize);

  // Random position within the cell
  let r = hash21(cell + seed);
  let r2 = hash21(cell + seed + 7.3);
  let starPos = vec2<f32>(r, r2);

  // Distance to the star center
  let dist = length(local - starPos);

  // Star radius: ~1.5 pixels in cell space → gridSize-dependent
  let radius = 0.06;
  if dist > radius { return 0.0; }

  // Twinkle: modulate brightness with a sine wave keyed on the star's hash
  let phase = hash21(cell + seed + 13.7) * 6.2831;
  let twinkle = 0.6 + 0.4 * sin(uniforms.time * 2.0 + phase);

  // Smooth falloff within the star disk
  let brightness = (1.0 - dist / radius) * twinkle;
  return brightness;
}

// ── Fragment shader ───────────────────────────────────────────────────────────

@fragment
fn fs_main(in: StarVOut) -> @location(0) vec4<f32> {
  let uv = in.uv;

  // Layer 1: distant stars — small, many, slow drift
  let s1 = starLayer(uv, 32.0, 0.005, 0.0);

  // Layer 2: closer stars — fewer, faster drift, slightly brighter
  let s2 = starLayer(uv, 18.0, 0.012, 42.0);

  // Combine layers: layer 2 slightly brighter (foreground)
  let brightness = s1 * 0.65 + s2 * 0.90;

  // Subtle blue-white tint for distant stars, warmer white for close
  let starColor = mix(
    vec3<f32>(0.7, 0.7, 1.0),   // distant: cool blue-white
    vec3<f32>(1.0, 1.0, 0.9),   // close: warm white
    s2 / max(s2, 0.001),        // blend factor: 1 where layer2 dominates
  );

  return vec4<f32>(starColor * brightness, 1.0);
}
