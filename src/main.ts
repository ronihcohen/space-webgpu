import { initGPU, type Renderer, type SpriteInstance } from './gpu/renderer';
import { UV_INVADER_A_0, UV_INVADER_B_0, UV_INVADER_C_0, SPRITE_SIZES } from './assets/atlas';
import {
  INVADER_CELL_W,
  INVADER_CELL_H,
  INVADER_GRID_START_X,
  INVADER_GRID_START_Y,
} from './game/entities';

const ROWS = 5;
const COLS = 11;

// Phase 2 test: build a static 5×11 invader grid — replaced by live game state in Phase 4
function buildTestGrid(): SpriteInstance[] {
  const instances: SpriteInstance[] = [];

  for (let row = 0; row < ROWS; row++) {
    // Row 0 → type C (top row, 30 pts); rows 1–2 → type B; rows 3–4 → type A
    const uv = row === 0 ? UV_INVADER_C_0 : row <= 2 ? UV_INVADER_B_0 : UV_INVADER_A_0;
    const size = row === 0 ? SPRITE_SIZES.invaderC : row <= 2 ? SPRITE_SIZES.invaderB : SPRITE_SIZES.invaderA;

    for (let col = 0; col < COLS; col++) {
      // Center sprite within its 16×16 grid cell
      const cellX = INVADER_GRID_START_X + col * INVADER_CELL_W;
      const cellY = INVADER_GRID_START_Y + row * INVADER_CELL_H;

      instances.push({
        x: cellX + (INVADER_CELL_W - size.w) / 2,
        y: cellY + (INVADER_CELL_H - size.h) / 2,
        w: size.w,
        h: size.h,
        atlasU: uv[0],
        atlasV: uv[1],
        atlasW: uv[2],
        atlasH: uv[3],
      });
    }
  }

  return instances;
}

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const errorOverlay = document.getElementById('error-overlay') as HTMLDivElement;

function showError(msg: string): void {
  errorOverlay.textContent = msg;
  errorOverlay.classList.add('visible');
  canvas.style.display = 'none';
}

async function bootstrap(): Promise<void> {
  if (!navigator.gpu) {
    showError('WebGPU is not supported in this browser.\n\nTry Chrome 113+ or Edge 113+.');
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    showError('No WebGPU adapter found.\n\nYour hardware or driver may not support WebGPU.');
    return;
  }

  const device = await adapter.requestDevice();

  // Wire device-lost handler immediately — v1 shows overlay and halts, no re-acquire
  // (Re-init would require rebuilding pipelines + re-uploading atlas; not worth it for a single-player clone)
  device.lost.then((info) => {
    showError(`GPU device lost: ${info.message}\n\nPlease reload the page.`);
  });

  const context = canvas.getContext('webgpu');
  if (!context) {
    showError('Failed to get WebGPU canvas context.');
    return;
  }

  const format = navigator.gpu.getPreferredCanvasFormat();

  let renderer: Renderer;
  try {
    renderer = await initGPU({ device, context, canvas, format });
  } catch (err) {
    showError(`GPU initialization failed:\n${String(err)}`);
    return;
  }

  let halted = false;
  device.lost.then(() => { halted = true; });

  const testInstances = buildTestGrid();
  const startTime = performance.now();

  function frame(): void {
    if (halted) return;
    const time = (performance.now() - startTime) / 1000;
    renderer.draw(testInstances, time);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

bootstrap().catch((err) => {
  showError(`Unexpected error:\n${String(err)}`);
});
