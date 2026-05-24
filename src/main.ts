import { initGPU } from './gpu/renderer';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const errorOverlay = document.getElementById('error-overlay') as HTMLDivElement;

function showError(msg: string): void {
  errorOverlay.textContent = msg;
  errorOverlay.classList.add('visible');
  canvas.style.display = 'none';
}

async function bootstrap(): Promise<void> {
  // Feature detect WebGPU
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

  try {
    await initGPU({ device, context, canvas, format });
  } catch (err) {
    showError(`GPU initialization failed:\n${String(err)}`);
    return;
  }

  let halted = false;
  device.lost.then(() => { halted = true; });

  // Minimal render loop for Phase 1 — replaced by full game loop in Phase 4
  function frame(): void {
    if (halted) return;
    render(device, context!, canvas);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Phase 1 render: just clear to black each frame to confirm the loop runs
function render(device: GPUDevice, context: GPUCanvasContext, _canvas: HTMLCanvasElement): void {
  const commandEncoder = device.createCommandEncoder();
  const textureView = context.getCurrentTexture().createView();

  const pass = commandEncoder.beginRenderPass({
    colorAttachments: [
      {
        view: textureView,
        clearValue: { r: 0, g: 0.05, b: 0, a: 1 }, // dark green tint confirms GPU is running
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  pass.end();

  device.queue.submit([commandEncoder.finish()]);
}

bootstrap().catch((err) => {
  showError(`Unexpected error:\n${String(err)}`);
});
