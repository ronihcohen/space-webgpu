import spriteWgsl from '../shaders/sprite.wgsl?raw';
import atlasUrl from '../assets/sprites.png';
import { ATLAS_W, ATLAS_H } from '../assets/atlas';

export const PLAYFIELD_W = 224;
export const PLAYFIELD_H = 256;

const MAX_INSTANCES = 300;
const FLOATS_PER_INSTANCE = 8;
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4; // 32 bytes

export interface SpriteInstance {
  x: number;      // top-left x in playfield pixels
  y: number;      // top-left y in playfield pixels
  w: number;      // width in playfield pixels
  h: number;      // height in playfield pixels
  atlasU: number; // left UV (0..1)
  atlasV: number; // top UV (0..1)
  atlasW: number; // UV width
  atlasH: number; // UV height
}

export interface GPUContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  canvas: HTMLCanvasElement;
  format: GPUTextureFormat;
}

export interface Renderer {
  draw(instances: SpriteInstance[], time: number): void;
}

function computeScale(viewportW: number, viewportH: number): number {
  return Math.max(1, Math.min(
    Math.floor(viewportW / PLAYFIELD_W),
    Math.floor(viewportH / PLAYFIELD_H),
  ));
}

function configureCanvas(ctx: GPUContext): void {
  const dpr = window.devicePixelRatio || 1;
  const n = computeScale(window.innerWidth * dpr, window.innerHeight * dpr);
  ctx.canvas.width = PLAYFIELD_W * n;
  ctx.canvas.height = PLAYFIELD_H * n;
  ctx.canvas.style.width = `${PLAYFIELD_W * n / dpr}px`;
  ctx.canvas.style.height = `${PLAYFIELD_H * n / dpr}px`;
  ctx.context.configure({ device: ctx.device, format: ctx.format, alphaMode: 'opaque' });
}

// Column-major orthographic projection: maps [0..W]×[0..H] to clip space [-1..1].
// Y is flipped: screen y=0 → clip y=+1 (top), screen y=H → clip y=-1 (bottom).
function orthoMatrix(w: number, h: number): Float32Array {
  return new Float32Array([
     2 / w,      0, 0, 0,  // col 0
         0, -2 / h, 0, 0,  // col 1
         0,      0, 1, 0,  // col 2
        -1,      1, 0, 1,  // col 3
  ]);
}

export async function initGPU(ctx: GPUContext): Promise<Renderer> {
  ctx.device.pushErrorScope('validation');

  configureCanvas(ctx);

  // ── Atlas texture ──────────────────────────────────────────────────────────
  const resp = await fetch(atlasUrl);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);

  const atlasTex = ctx.device.createTexture({
    label: 'atlas',
    size: [ATLAS_W, ATLAS_H],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  ctx.device.queue.copyExternalImageToTexture(
    { source: bitmap },
    { texture: atlasTex },
    [ATLAS_W, ATLAS_H],
  );
  bitmap.close();

  const sampler = ctx.device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });

  // ── Buffers ────────────────────────────────────────────────────────────────
  // Uniform buffer: mat4x4 (64B) + time f32 (4B) + padding (12B) = 80B
  const uniformBuf = ctx.device.createBuffer({
    label: 'uniforms',
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  ctx.device.queue.writeBuffer(uniformBuf, 0, orthoMatrix(PLAYFIELD_W, PLAYFIELD_H));

  const instanceBuf = ctx.device.createBuffer({
    label: 'instances',
    size: MAX_INSTANCES * BYTES_PER_INSTANCE,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  // ── Bind group layouts ─────────────────────────────────────────────────────
  const uniformBGL = ctx.device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: 'uniform' },
    }],
  });

  const atlasBGL = ctx.device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    ],
  });

  // ── Sprite render pipeline ─────────────────────────────────────────────────
  const spriteModule = ctx.device.createShaderModule({ label: 'sprite', code: spriteWgsl });

  const spritePipeline = ctx.device.createRenderPipeline({
    label: 'sprite',
    layout: ctx.device.createPipelineLayout({ bindGroupLayouts: [uniformBGL, atlasBGL] }),
    vertex: {
      module: spriteModule,
      entryPoint: 'vs_main',
      buffers: [{
        arrayStride: BYTES_PER_INSTANCE,
        stepMode: 'instance',
        attributes: [
          { shaderLocation: 0, offset:  0, format: 'float32x2' },  // pos
          { shaderLocation: 1, offset:  8, format: 'float32x2' },  // size
          { shaderLocation: 2, offset: 16, format: 'float32x2' },  // uvOrig
          { shaderLocation: 3, offset: 24, format: 'float32x2' },  // uvSize
        ],
      }],
    },
    fragment: {
      module: spriteModule,
      entryPoint: 'fs_main',
      targets: [{
        format: ctx.format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one',       dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
  });

  // ── Bind groups ────────────────────────────────────────────────────────────
  const uniformBG = ctx.device.createBindGroup({
    layout: uniformBGL,
    entries: [{ binding: 0, resource: { buffer: uniformBuf } }],
  });

  const atlasBG = ctx.device.createBindGroup({
    layout: atlasBGL,
    entries: [
      { binding: 0, resource: atlasTex.createView() },
      { binding: 1, resource: sampler },
    ],
  });

  const validationError = await ctx.device.popErrorScope();
  if (validationError) {
    throw new Error(`WebGPU validation error: ${validationError.message}`);
  }

  // ── Resize handler (~10 Hz throttle) ──────────────────────────────────────
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener('resize', () => {
    if (resizeTimer !== null) return;
    resizeTimer = setTimeout(() => { resizeTimer = null; configureCanvas(ctx); }, 100);
  });

  // Scratch CPU buffer — reused every frame to avoid GC pressure
  const instanceData = new Float32Array(MAX_INSTANCES * FLOATS_PER_INSTANCE);

  return {
    draw(instances: SpriteInstance[], time: number): void {
      const count = Math.min(instances.length, MAX_INSTANCES);

      // Update time uniform at byte offset 64 (after the 64-byte projection matrix)
      ctx.device.queue.writeBuffer(uniformBuf, 64, new Float32Array([time]));

      // Pack instance data into scratch buffer
      for (let i = 0; i < count; i++) {
        const base = i * FLOATS_PER_INSTANCE;
        const inst = instances[i];
        instanceData[base]     = inst.x;
        instanceData[base + 1] = inst.y;
        instanceData[base + 2] = inst.w;
        instanceData[base + 3] = inst.h;
        instanceData[base + 4] = inst.atlasU;
        instanceData[base + 5] = inst.atlasV;
        instanceData[base + 6] = inst.atlasW;
        instanceData[base + 7] = inst.atlasH;
      }
      if (count > 0) {
        ctx.device.queue.writeBuffer(instanceBuf, 0, instanceData, 0, count * FLOATS_PER_INSTANCE);
      }

      const enc = ctx.device.createCommandEncoder();
      const view = ctx.context.getCurrentTexture().createView();

      // Single pass: clear to black, then draw sprites on top
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });

      if (count > 0) {
        pass.setPipeline(spritePipeline);
        pass.setBindGroup(0, uniformBG);
        pass.setBindGroup(1, atlasBG);
        pass.setVertexBuffer(0, instanceBuf);
        pass.draw(6, count); // 6 vertices (2 triangles) × count instances
      }

      pass.end();
      ctx.device.queue.submit([enc.finish()]);
    },
  };
}
