// Virtual playfield dimensions (original arcade resolution)
export const PLAYFIELD_W = 224;
export const PLAYFIELD_H = 256;

export interface GPUContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  canvas: HTMLCanvasElement;
  format: GPUTextureFormat;
}

// Compute the largest integer scale N such that 224*N <= viewportW and 256*N <= viewportH
function computeScale(viewportW: number, viewportH: number): number {
  const scaleX = Math.floor(viewportW / PLAYFIELD_W);
  const scaleY = Math.floor(viewportH / PLAYFIELD_H);
  return Math.max(1, Math.min(scaleX, scaleY));
}

function configureCanvas(ctx: GPUContext): void {
  const dpr = window.devicePixelRatio || 1;
  const viewportW = window.innerWidth * dpr;
  const viewportH = window.innerHeight * dpr;
  const n = computeScale(viewportW, viewportH);

  const physW = PLAYFIELD_W * n;
  const physH = PLAYFIELD_H * n;

  ctx.canvas.width = physW;
  ctx.canvas.height = physH;

  // CSS size: let browser handle any sub-integer stretch
  const cssW = PLAYFIELD_W * n / dpr;
  const cssH = PLAYFIELD_H * n / dpr;
  ctx.canvas.style.width = `${cssW}px`;
  ctx.canvas.style.height = `${cssH}px`;

  ctx.context.configure({
    device: ctx.device,
    format: ctx.format,
    alphaMode: 'opaque',
  });
}

export async function initGPU(ctx: GPUContext): Promise<void> {
  // Wrap pipeline/shader creation in a validation error scope so errors are readable
  ctx.device.pushErrorScope('validation');

  // Phase 1: nothing to compile yet — just configure the canvas
  configureCanvas(ctx);

  const validationError = await ctx.device.popErrorScope();
  if (validationError) {
    throw new Error(`WebGPU validation error: ${validationError.message}`);
  }

  // Throttled resize handler (~10Hz) so dragging the window doesn't reconfigure every frame
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener('resize', () => {
    if (resizeTimer !== null) return;
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      configureCanvas(ctx);
    }, 100);
  });
}
