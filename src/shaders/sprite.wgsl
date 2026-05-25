/**
 * sprite.wgsl — Instanced textured-quad shader.
 *
 * Each instance represents one sprite quad.  The vertex shader expands a
 * unit square (two triangles, 6 vertices) into world space using the per-
 * instance position/size, then maps atlas UVs onto the quad.  The fragment
 * shader samples the atlas with a nearest-neighbour sampler.
 *
 * Instance buffer layout (8 × f32 per instance, tightly packed):
 *   [0] x        — left edge in virtual playfield pixels
 *   [1] y        — top  edge in virtual playfield pixels
 *   [2] w        — width  in playfield pixels
 *   [3] h        — height in playfield pixels
 *   [4] atlasU   — left UV in atlas (0..1)
 *   [5] atlasV   — top  UV in atlas (0..1)
 *   [6] atlasW   — UV width  in atlas
 *   [7] atlasH   — UV height in atlas
 *
 * Bind group 0 — per-frame uniforms (projection matrix + time)
 * Bind group 1 — static atlas texture + sampler
 */

// ── Bind group 0 — per-frame uniforms ────────────────────────────────────────

struct Uniforms {
  // Orthographic projection: maps virtual 224×256 playfield to clip space.
  // Column-major storage (WGSL mat4x4<f32> is column-major).
  proj: mat4x4<f32>,
  time: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// ── Bind group 1 — atlas texture + sampler ────────────────────────────────────

@group(1) @binding(0) var atlasTex: texture_2d<f32>;
@group(1) @binding(1) var atlasSampler: sampler;

// ── Per-instance data (step-mode = "instance") ────────────────────────────────

struct InstanceData {
  @location(0) pos:    vec2<f32>,    // (x, y) top-left in playfield pixels
  @location(1) size:   vec2<f32>,    // (w, h) in playfield pixels
  @location(2) uvOrig: vec2<f32>,    // (atlasU, atlasV)
  @location(3) uvSize: vec2<f32>,    // (atlasW, atlasH)
}

// ── Vertex output ─────────────────────────────────────────────────────────────

struct VertexOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0)       uv:      vec2<f32>,
}

// ── Unit-square vertex positions (clip-space-agnostic; proj matrix handles it)

// Two-triangle quad: vertices 0..5, CCW winding.
// Each invocation selects one corner via vertex_index.
//
//  0──1    0,2,1 = triangle A (top-left, top-right, bottom-left)?
//  │  │    Actually we emit them in this order:
//  3──2    0,1,2, 0,2,3 — see the array below.
//
// xy ∈ [0, 1] in object space — origin at top-left of the quad.
const QUAD_POS = array<vec2<f32>, 6>(
  vec2(0.0, 0.0),  // 0 top-left
  vec2(1.0, 0.0),  // 1 top-right
  vec2(0.0, 1.0),  // 2 bottom-left
  vec2(1.0, 0.0),  // 3 top-right  (shared)
  vec2(1.0, 1.0),  // 4 bottom-right
  vec2(0.0, 1.0),  // 5 bottom-left (shared)
);

// ── Vertex shader ─────────────────────────────────────────────────────────────

@vertex
fn vs_main(
  @builtin(vertex_index) vid:  u32,
  inst: InstanceData,
) -> VertexOut {
  var out: VertexOut;

  let corner = QUAD_POS[vid];

  // World position: scale unit square to sprite size, then offset to position
  let worldPos = inst.pos + corner * inst.size;

  // Apply orthographic projection
  out.clipPos = uniforms.proj * vec4<f32>(worldPos, 0.0, 1.0);

  // UV: lerp across the atlas region occupied by this sprite
  out.uv = inst.uvOrig + corner * inst.uvSize;

  return out;
}

// ── Fragment shader ───────────────────────────────────────────────────────────

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  // Sentinel: atlasU < 0 means "solid black quad" (used for text backgrounds).
  if in.uv.x < 0.0 {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }
  let color = textureSample(atlasTex, atlasSampler, in.uv);
  // Discard fully-transparent pixels so sprites don't overwrite each other's
  // transparent regions (important for non-rectangular sprite silhouettes).
  if color.a < 0.01 {
    discard;
  }
  return color;
}
