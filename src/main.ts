/**
 * main.ts — Entry point, game loop, and simulation.
 *
 * Responsibilities:
 *   - WebGPU feature detection
 *   - GPU init, device-lost wiring
 *   - Fixed-timestep game loop (60Hz, MAX_FRAME=0.25)
 *   - Full game simulation (Phase 4): player, invader grid, bullets, barriers, lives
 *   - Instance buffer assembly for the renderer
 *   - window.__game debug hook (DEV + test builds only)
 */

import { initGPU, type Renderer, type SpriteInstance } from './gpu/renderer';
import {
  UV_PLAYER,
  UV_UFO,
  UV_INVADER_A_0, UV_INVADER_A_1,
  UV_INVADER_B_0, UV_INVADER_B_1,
  UV_INVADER_C_0, UV_INVADER_C_1,
  UV_BULLET_PLAYER,
  UV_BULLET_ENEMY_STRAIGHT,
  UV_INVADER_EXPLOSION,
  UV_PLAYER_EXPLOSION_0,
  UV_PLAYER_EXPLOSION_1,
  SPRITE_SIZES,
  uvForString,
  FONT_CELL_W,
  FONT_CELL_H,
} from './assets/atlas';
import {
  type Player,
  type Invader,
  type Bullet,
  type BarrierMask,
  type Ufo,
  makeBarrierMask,
  BARRIER_POSITIONS,
  BARRIER_Y,
  BARRIER_W,
  BARRIER_H,
  PLAYFIELD_W,
  PLAYFIELD_H,
  PLAYER_START_X,
  PLAYER_START_Y,
  PLAYER_SPEED,
  BULLET_PLAYER_SPEED,
  BULLET_ENEMY_SPEED,
  MAX_ENEMY_BULLETS,
  INVADER_FIRE_CHANCE,
  INVADER_CELL_W,
  INVADER_CELL_H,
  PLAYER_INVULN_DURATION,
  EXPLOSION_FRAME_DURATION,
  pointsForInvaderType,
  UFO_SCORE_VALUES,
  UFO_SPEED,
  UFO_Y,
  UFO_SPAWN_MIN_S,
  UFO_SPAWN_MAX_S,
} from './game/entities';
import {
  makeGameState,
  startGame,
  togglePause,
  autoPause,
  triggerGameOver,
  triggerWin,
  returnToIdle,
  addScore,
  advanceWave,
  resetLevel,
  type GameState,
} from './game/state';
import {
  makeInvaderGrid,
  aliveCount,
  invaderWorldX,
  invaderWorldY,
  bottomInvadersPerColumn,
  framesPerStep,
  levelSpeedCap,
  GRID_COLS,
  type InvaderGrid,
} from './game/spawner';
import {
  makeInputState,
  attachInputListeners,
  isDownEither,
  wasPressed,
  type InputState,
} from './game/input';
import { aabbOverlap, sweptBulletBarrierHit, applySplash, type Rect } from './game/physics';
import { makeAudioManager, type AudioManager } from './game/sound';

// ── Fixed timestep constants ──────────────────────────────────────────────────
const DT = 1 / 60;          // seconds per logic tick
const MAX_FRAME = 0.25;     // max seconds of catch-up per RAF (clamps background-tab return)

// ── DOM ───────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const errorOverlay = document.getElementById('error-overlay') as HTMLDivElement;

function showError(msg: string): void {
  errorOverlay.textContent = msg;
  errorOverlay.classList.add('visible');
  canvas.style.display = 'none';
}

// ── Simulation state ──────────────────────────────────────────────────────────

/** All mutable simulation state — replaced on wave start / game reset. */
interface SimState {
  player: Player;
  grid: InvaderGrid;
  bullets: Bullet[];
  barriers: BarrierMask[];
  ufo: Ufo;
  /** Ticks the grid has accumulated since the last step */
  gridStepAccum: number;
  /** Cycles 0→1→2→3→0 each grid step — selects which of the 4 step sounds plays */
  invaderStepNote: number;
  /** true = an invader explosion is showing; tracks which invader */
  invaderExplosion: { col: number; row: number; timer: number } | null;
  /** UFO explosion + score popup after being shot */
  ufoExplosion: { x: number; scoreValue: number; timer: number } | null;
}

function makePlayer(): Player {
  return {
    x: PLAYER_START_X,
    y: PLAYER_START_Y,
    lives: 3,
    explodeFrame: null,
    invulnTimer: 0,
    explodeTimer: 0,
  };
}

function makeBarriers(): BarrierMask[] {
  return BARRIER_POSITIONS.map((bx) => ({
    mask: makeBarrierMask(),
    x: bx,
    y: BARRIER_Y,
  }));
}

function makeSim(waveN: number): SimState {
  return {
    player: makePlayer(),
    grid: makeInvaderGrid(waveN),
    bullets: [],
    barriers: makeBarriers(),
    ufo: {
      x: -SPRITE_SIZES.ufo.w / 2,
      dir: 1,
      active: false,
      spawnTimer: UFO_SPAWN_MIN_S + Math.random() * (UFO_SPAWN_MAX_S - UFO_SPAWN_MIN_S),
    },
    gridStepAccum: 0,
    invaderStepNote: 0,
    invaderExplosion: null,
    ufoExplosion: null,
  };
}

// ── Invader world-space bounding rect ─────────────────────────────────────────
function invaderRect(grid: InvaderGrid, inv: Invader): Rect {
  const cx = invaderWorldX(grid, inv);
  const cy = invaderWorldY(grid, inv);
  const w = SPRITE_SIZES.invaderA.w; // all invaders are same display size (12×8)
  const h = SPRITE_SIZES.invaderA.h;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function playerRect(player: Player): Rect {
  return {
    x: player.x - SPRITE_SIZES.player.w / 2,
    y: player.y - SPRITE_SIZES.player.h / 2,
    w: SPRITE_SIZES.player.w,
    h: SPRITE_SIZES.player.h,
  };
}

function bulletRect(bullet: Bullet): Rect {
  return {
    x: bullet.x - SPRITE_SIZES.bulletPlayer.w / 2,
    y: bullet.y - SPRITE_SIZES.bulletPlayer.h / 2,
    w: SPRITE_SIZES.bulletPlayer.w,
    h: SPRITE_SIZES.bulletPlayer.h,
  };
}

// ── Simulation update ─────────────────────────────────────────────────────────

function updateSim(
  sim: SimState,
  gs: GameState,
  input: InputState,
  renderer: Renderer,
  audio: AudioManager,
): { sim: SimState; gs: GameState; waveComplete: boolean } {
  let { player, grid, bullets, barriers, ufo, gridStepAccum, invaderStepNote, invaderExplosion, ufoExplosion } = sim;
  let waveComplete = false;

  // ── Player explosion / respawn ──────────────────────────────────────────────
  if (player.explodeFrame !== null) {
    player = { ...player, explodeTimer: player.explodeTimer - DT };
    if (player.explodeTimer <= 0) {
      // Advance explosion frame or end explosion
      const nextFrame = (player.explodeFrame ?? 0) + 1;
      if (nextFrame >= 2) {
        // Explosion finished — respawn (if lives remain; game-over already handled)
        player = {
          ...player,
          x: PLAYER_START_X,
          y: PLAYER_START_Y,
          explodeFrame: null,
          explodeTimer: 0,
          invulnTimer: PLAYER_INVULN_DURATION,
        };
      } else {
        player = { ...player, explodeFrame: nextFrame, explodeTimer: EXPLOSION_FRAME_DURATION };
      }
    }
    // Freeze movement and firing while exploding
    return {
      sim: { player, grid, bullets, barriers, ufo, gridStepAccum, invaderStepNote, invaderExplosion, ufoExplosion },
      gs,
      waveComplete,
    };
  }

  // ── Invuln timer ────────────────────────────────────────────────────────────
  if (player.invulnTimer > 0) {
    player = { ...player, invulnTimer: Math.max(0, player.invulnTimer - DT) };
  }

  // ── Player movement ─────────────────────────────────────────────────────────
  const movingLeft  = isDownEither(input, 'ArrowLeft', 'KeyA');
  const movingRight = isDownEither(input, 'ArrowRight', 'KeyD');
  if (movingLeft || movingRight) {
    const halfW = SPRITE_SIZES.player.w / 2;
    const dx = (movingRight ? 1 : -1) * PLAYER_SPEED * DT;
    const nx = Math.max(halfW, Math.min(PLAYFIELD_W - halfW, player.x + dx));
    player = { ...player, x: nx };
  }

  // ── Player fire ─────────────────────────────────────────────────────────────
  if (wasPressed(input, 'Space')) {
    audio.shoot();
    bullets = [
      ...bullets,
      {
        x: player.x,
        y: player.y - SPRITE_SIZES.player.h / 2,
        vy: BULLET_PLAYER_SPEED,
        owner: 'player',
        prevY: player.y - SPRITE_SIZES.player.h / 2,
      },
    ];
  }

  // ── Move bullets ────────────────────────────────────────────────────────────
  bullets = bullets.map((b) => {
    const newY = b.y + b.vy * DT;
    return { ...b, prevY: b.y, y: newY };
  });

  // Remove out-of-bounds bullets
  bullets = bullets.filter((b) => b.y > -16 && b.y < PLAYFIELD_H + 16);

  // ── Invader grid step ───────────────────────────────────────────────────────
  const alive = aliveCount(grid);
  const fps = Math.min(framesPerStep(alive), levelSpeedCap(gs.level));

  gridStepAccum += 1;
  if (gridStepAccum >= fps) {
    gridStepAccum = 0;

    // Play the next note in the 4-note descending invader-step loop
    const nextStepNote = ((invaderStepNote + 1) % 4) as 0 | 1 | 2 | 3;
    audio.invaderStep(nextStepNote);
    invaderStepNote = nextStepNote;

    // Toggle animation frame
    const newAnimFrame: 0 | 1 = grid.animFrame === 0 ? 1 : 0;

    // Determine if any invader would go out of bounds after stepping
    const stepSize = 2; // pixels per grid step
    let nextX = grid.gridX + grid.dir * stepSize;
    let nextDir = grid.dir;
    let nextY = grid.gridY;

    // Find leftmost and rightmost alive invader columns
    let minCol = GRID_COLS;
    let maxCol = -1;
    for (const inv of grid.invaders) {
      if (!inv.alive) continue;
      if (inv.col < minCol) minCol = inv.col;
      if (inv.col > maxCol) maxCol = inv.col;
    }

    if (minCol <= GRID_COLS) {
      const leftEdge = nextX + minCol * INVADER_CELL_W;
      const rightEdge = nextX + maxCol * INVADER_CELL_W + INVADER_CELL_W;

      if (leftEdge < 0 || rightEdge > PLAYFIELD_W) {
        // Hit a wall: revert x move, flip direction, drop one row (8px)
        nextX = grid.gridX;
        nextDir = (grid.dir === 1 ? -1 : 1) as 1 | -1;
        nextY = grid.gridY + 8;
      }
    }

    // Update all invader animation frames
    const newInvaders = grid.invaders.map((inv) => ({ ...inv, frame: newAnimFrame as 0 | 1 }));

    grid = {
      ...grid,
      gridX: nextX,
      gridY: nextY,
      dir: nextDir,
      animFrame: newAnimFrame,
      invaders: newInvaders,
    };
  }

  // ── Invader fire policy ─────────────────────────────────────────────────────
  const enemyBulletCount = bullets.filter((b) => b.owner === 'enemy').length;
  if (enemyBulletCount < MAX_ENEMY_BULLETS) {
    const bottomMap = bottomInvadersPerColumn(grid);
    const eligibleCols = Array.from(bottomMap.entries());

    for (const [col, row] of eligibleCols) {
      if (bullets.filter((b) => b.owner === 'enemy').length >= MAX_ENEMY_BULLETS) break;
      const fireChance = Math.min(INVADER_FIRE_CHANCE * (1 + 0.3 * (gs.level - 1)), 1 / 30);
      if (Math.random() < fireChance) {
        const inv = grid.invaders.find((i) => i.alive && i.col === col && i.row === row);
        if (inv) {
          const bx = invaderWorldX(grid, inv);
          const by = invaderWorldY(grid, inv) + SPRITE_SIZES.invaderA.h / 2;
          bullets = [
            ...bullets,
            { x: bx, y: by, vy: BULLET_ENEMY_SPEED, owner: 'enemy', prevY: by },
          ];
        }
      }
    }
  }

  // ── Invader explosion timer ─────────────────────────────────────────────────
  if (invaderExplosion !== null) {
    invaderExplosion = { ...invaderExplosion, timer: invaderExplosion.timer - DT };
    if (invaderExplosion.timer <= 0) {
      invaderExplosion = null;
    }
  }

  // ── UFO explosion timer ──────────────────────────────────────────────────────
  if (ufoExplosion !== null) {
    ufoExplosion = { ...ufoExplosion, timer: ufoExplosion.timer - DT };
    if (ufoExplosion.timer <= 0) {
      ufoExplosion = null;
    }
  }

  // ── UFO spawn and movement ──────────────────────────────────────────────────
  if (!ufo.active) {
    const newTimer = ufo.spawnTimer - DT;
    if (newTimer <= 0) {
      // Spawn UFO from the left edge — enters horizontally across the top
      ufo = { x: -SPRITE_SIZES.ufo.w / 2, dir: 1, active: true, spawnTimer: 0 };
      audio.ufoStart();
    } else {
      ufo = { ...ufo, spawnTimer: newTimer };
    }
  } else {
    const newX = ufo.x + ufo.dir * UFO_SPEED * DT;
    if (newX > PLAYFIELD_W + SPRITE_SIZES.ufo.w / 2) {
      // UFO exited the right edge — deactivate and set new random spawn timer
      ufo = {
        ...ufo,
        active: false,
        spawnTimer: UFO_SPAWN_MIN_S + Math.random() * (UFO_SPAWN_MAX_S - UFO_SPAWN_MIN_S),
      };
      audio.ufoStop();
    } else {
      ufo = { ...ufo, x: newX };
    }
  }

  // ── Bullet ↔ invader collision ──────────────────────────────────────────────
  const deadBulletIndices = new Set<number>();
  const newInvaders = grid.invaders.map((inv) => ({ ...inv }));

  for (let bi = 0; bi < bullets.length; bi++) {
    const b = bullets[bi];
    if (b.owner !== 'player') continue;
    if (deadBulletIndices.has(bi)) continue;

    for (const inv of newInvaders) {
      if (!inv.alive) continue;
      const ir = invaderRect(grid, inv);
      const br = bulletRect(b);
      if (aabbOverlap(ir, br)) {
        inv.alive = false;
        deadBulletIndices.add(bi);
        gs = addScore(gs, pointsForInvaderType(inv.type));
        audio.invaderHit();
        // Show explosion at the invader's position briefly
        invaderExplosion = {
          col: inv.col,
          row: inv.row,
          timer: EXPLOSION_FRAME_DURATION,
        };
        break;
      }
    }
  }

  // ── Bullet ↔ UFO collision ───────────────────────────────────────────────────
  if (ufo.active) {
    const ufoRect: Rect = {
      x: ufo.x - SPRITE_SIZES.ufo.w / 2,
      y: UFO_Y - SPRITE_SIZES.ufo.h / 2,
      w: SPRITE_SIZES.ufo.w,
      h: SPRITE_SIZES.ufo.h,
    };
    for (let bi = 0; bi < bullets.length; bi++) {
      const b = bullets[bi];
      if (b.owner !== 'player') continue;
      if (deadBulletIndices.has(bi)) continue;
      if (aabbOverlap(ufoRect, bulletRect(b))) {
        const scoreIdx = Math.floor(Math.random() * UFO_SCORE_VALUES.length);
        const scoreValue = UFO_SCORE_VALUES[scoreIdx];
        gs = addScore(gs, scoreValue);
        ufo = {
          ...ufo,
          active: false,
          spawnTimer: UFO_SPAWN_MIN_S + Math.random() * (UFO_SPAWN_MAX_S - UFO_SPAWN_MIN_S),
        };
        ufoExplosion = { x: ufo.x, scoreValue, timer: 1.0 };
        deadBulletIndices.add(bi);
        audio.ufoHit();
        break;
      }
    }
  }

  // ── Bullet ↔ player collision ───────────────────────────────────────────────
  // Only enemy bullets hit the player; player is invulnerable during invulnTimer.
  if (player.invulnTimer <= 0 && player.explodeFrame === null) {
    for (let bi = 0; bi < bullets.length; bi++) {
      const b = bullets[bi];
      if (b.owner !== 'enemy') continue;
      if (deadBulletIndices.has(bi)) continue;

      const pr = playerRect(player);
      const br = bulletRect(b);
      if (aabbOverlap(pr, br)) {
        deadBulletIndices.add(bi);
        audio.playerHit();
        const newLives = player.lives - 1;
        if (newLives <= 0) {
          // Game over — trigger state transition
          player = { ...player, lives: 0, explodeFrame: 0, explodeTimer: EXPLOSION_FRAME_DURATION };
          gs = triggerGameOver(gs);
        } else {
          player = {
            ...player,
            lives: newLives,
            explodeFrame: 0,
            explodeTimer: EXPLOSION_FRAME_DURATION,
          };
          gs = resetLevel(gs);
        }
        break;
      }
    }
  }

  // ── Bullet ↔ barrier collision ──────────────────────────────────────────────
  const updatedBarriers = barriers.map((bar) => ({ ...bar, mask: new Uint8Array(bar.mask) }));

  for (let bi = 0; bi < bullets.length; bi++) {
    if (deadBulletIndices.has(bi)) continue;
    const b = bullets[bi];

    for (let bari = 0; bari < updatedBarriers.length; bari++) {
      const bar = updatedBarriers[bari];
      const hit = sweptBulletBarrierHit(b, bar);
      if (hit) {
        applySplash(bar, hit, b.owner);
        // Upload the mutated mask to the GPU mirror
        renderer.barriers.upload(bari, bar.mask);
        deadBulletIndices.add(bi);
        break;
      }
    }
  }

  // Remove dead bullets
  bullets = bullets.filter((_, i) => !deadBulletIndices.has(i));

  // Apply invader changes
  grid = { ...grid, invaders: newInvaders };

  // ── Win condition: all invaders cleared ─────────────────────────────────────
  if (alive > 0 && aliveCount(grid) === 0) {
    waveComplete = true;
  }

  // ── Lose condition: invaders reach player row ───────────────────────────────
  if (gs.phase === 'PLAYING') {
    for (const inv of grid.invaders) {
      if (!inv.alive) continue;
      const invBottom = invaderWorldY(grid, inv) + SPRITE_SIZES.invaderA.h / 2;
      if (invBottom >= player.y - SPRITE_SIZES.player.h / 2) {
        gs = triggerGameOver(gs);
        break;
      }
    }
  }

  return {
    sim: { player, grid, bullets, barriers: updatedBarriers, ufo, gridStepAccum, invaderStepNote, invaderExplosion, ufoExplosion },
    gs,
    waveComplete,
  };
}

// ── HUD + overlay text helpers ────────────────────────────────────────────────

/** Push one sprite quad per character into `instances`, laid out left-to-right. */
function pushText(
  instances: SpriteInstance[],
  text: string,
  x: number,
  y: number,
): void {
  const uvs = uvForString(text);
  for (let i = 0; i < uvs.length; i++) {
    const uv = uvs[i];
    instances.push({
      x: x + i * FONT_CELL_W,
      y,
      w: FONT_CELL_W,
      h: FONT_CELL_H,
      atlasU: uv[0],
      atlasV: uv[1],
      atlasW: uv[2],
      atlasH: uv[3],
    });
  }
}

/** Return the x coordinate that centers `text` horizontally in the playfield. */
function centeredX(text: string): number {
  return Math.floor((PLAYFIELD_W - text.length * FONT_CELL_W) / 2);
}

/**
 * Append HUD (always-visible score/hi-score/lives) and phase-specific overlay
 * text (IDLE title, PAUSED, GAME_OVER, WIN) to the instance list.
 */
function buildHudInstances(
  instances: SpriteInstance[],
  gs: GameState,
  player: Player,
): void {
  // ── Always-visible score strip ────────────────────────────────────────────
  pushText(instances, 'SCORE', 2, 2);
  pushText(instances, String(gs.score).padStart(5, '0'), 2, 10);

  const hiLabel = 'HI-SCORE';
  pushText(instances, hiLabel, centeredX(hiLabel), 2);
  const hiVal = String(gs.highScore).padStart(5, '0');
  pushText(instances, hiVal, centeredX(hiVal), 10);

  // Lives + level (top-right) — show actual values while in-game, placeholder on IDLE
  const livesStr = `LIVES ${gs.phase !== 'IDLE' ? String(player.lives) : '-'}`;
  pushText(instances, livesStr, PLAYFIELD_W - livesStr.length * FONT_CELL_W - 2, 2);
  const levelStr = `LV ${gs.phase !== 'IDLE' ? String(gs.level) : '-'}`;
  pushText(instances, levelStr, PLAYFIELD_W - levelStr.length * FONT_CELL_W - 2, 10);

  // ── Phase-specific overlays ───────────────────────────────────────────────
  if (gs.phase === 'IDLE') {
    const title = 'SPACE INVADERS';
    pushText(instances, title, centeredX(title), 80);
    const prompt = 'PRESS SPACE TO START';
    pushText(instances, prompt, centeredX(prompt), 120);
  } else if (gs.phase === 'PAUSED') {
    const msg = 'PAUSED';
    pushText(instances, msg, centeredX(msg), 112);
    const hint = 'PRESS P TO RESUME';
    pushText(instances, hint, centeredX(hint), 124);
  } else if (gs.phase === 'GAME_OVER') {
    const msg = 'GAME OVER';
    pushText(instances, msg, centeredX(msg), 100);
    const scoreStr = `SCORE ${String(gs.score).padStart(5, '0')}`;
    pushText(instances, scoreStr, centeredX(scoreStr), 112);
    const hint = 'PRESS SPACE TO RETRY';
    pushText(instances, hint, centeredX(hint), 128);
  } else if (gs.phase === 'WIN') {
    const msg = 'STAGE CLEAR';
    pushText(instances, msg, centeredX(msg), 100);
    const scoreStr = `SCORE ${String(gs.score).padStart(5, '0')}`;
    pushText(instances, scoreStr, centeredX(scoreStr), 112);
    const hint = 'PRESS SPACE TO CONTINUE';
    pushText(instances, hint, centeredX(hint), 128);
  }
}

// ── Instance buffer assembly ──────────────────────────────────────────────────

function buildInstances(
  sim: SimState,
  gs: GameState,
  renderer: Renderer,
): SpriteInstance[] {
  const { player, grid, bullets, ufo, invaderExplosion, ufoExplosion } = sim;
  const instances: SpriteInstance[] = [];

  // ── Player ──────────────────────────────────────────────────────────────────
  if (player.explodeFrame !== null) {
    // Show explosion frame
    const uvExplosion = player.explodeFrame === 0 ? UV_PLAYER_EXPLOSION_0 : UV_PLAYER_EXPLOSION_1;
    const sz = SPRITE_SIZES.playerExplosion;
    instances.push({
      x: player.x - sz.w / 2,
      y: player.y - sz.h / 2,
      w: sz.w,
      h: sz.h,
      atlasU: uvExplosion[0],
      atlasV: uvExplosion[1],
      atlasW: uvExplosion[2],
      atlasH: uvExplosion[3],
    });
  } else {
    // Flash during invulnerability: hide every other 10-tick interval
    const showPlayer = player.invulnTimer <= 0 ||
      Math.floor(player.invulnTimer / (DT * 10)) % 2 === 0;
    if (showPlayer) {
      const sz = SPRITE_SIZES.player;
      instances.push({
        x: player.x - sz.w / 2,
        y: player.y - sz.h / 2,
        w: sz.w,
        h: sz.h,
        atlasU: UV_PLAYER[0],
        atlasV: UV_PLAYER[1],
        atlasW: UV_PLAYER[2],
        atlasH: UV_PLAYER[3],
      });
    }
  }

  // ── Invaders ─────────────────────────────────────────────────────────────────
  for (const inv of grid.invaders) {
    if (!inv.alive) continue;

    // Pick UV by type + animation frame
    let uv: readonly [number, number, number, number];
    if (inv.type === 'A') {
      uv = grid.animFrame === 0 ? UV_INVADER_A_0 : UV_INVADER_A_1;
    } else if (inv.type === 'B') {
      uv = grid.animFrame === 0 ? UV_INVADER_B_0 : UV_INVADER_B_1;
    } else {
      uv = grid.animFrame === 0 ? UV_INVADER_C_0 : UV_INVADER_C_1;
    }

    const sz = SPRITE_SIZES.invaderA;
    const cx = invaderWorldX(grid, inv);
    const cy = invaderWorldY(grid, inv);
    instances.push({
      x: cx - sz.w / 2,
      y: cy - sz.h / 2,
      w: sz.w,
      h: sz.h,
      atlasU: uv[0],
      atlasV: uv[1],
      atlasW: uv[2],
      atlasH: uv[3],
    });
  }

  // ── Invader explosion ─────────────────────────────────────────────────────────
  if (invaderExplosion !== null) {
    // Find the invader's position from grid coords (it's already dead, use col/row)
    const ex = grid.gridX + invaderExplosion.col * INVADER_CELL_W + INVADER_CELL_W / 2;
    const ey = grid.gridY + invaderExplosion.row * INVADER_CELL_H + INVADER_CELL_H / 2;
    const sz = SPRITE_SIZES.invaderExplosion;
    instances.push({
      x: ex - sz.w / 2,
      y: ey - sz.h / 2,
      w: sz.w,
      h: sz.h,
      atlasU: UV_INVADER_EXPLOSION[0],
      atlasV: UV_INVADER_EXPLOSION[1],
      atlasW: UV_INVADER_EXPLOSION[2],
      atlasH: UV_INVADER_EXPLOSION[3],
    });
  }

  // ── Bullets ───────────────────────────────────────────────────────────────────
  for (const b of bullets) {
    const uv = b.owner === 'player' ? UV_BULLET_PLAYER : UV_BULLET_ENEMY_STRAIGHT;
    const sz = SPRITE_SIZES.bulletPlayer;
    instances.push({
      x: b.x - sz.w / 2,
      y: b.y - sz.h / 2,
      w: sz.w,
      h: sz.h,
      atlasU: uv[0],
      atlasV: uv[1],
      atlasW: uv[2],
      atlasH: uv[3],
    });
  }

  // ── Barriers ──────────────────────────────────────────────────────────────────
  const barrierInstances = renderer.barriers.instances(BARRIER_POSITIONS, BARRIER_Y);
  for (const bi of barrierInstances) {
    instances.push(bi);
  }

  // ── UFO ───────────────────────────────────────────────────────────────────────
  if (ufo.active) {
    const sz = SPRITE_SIZES.ufo;
    instances.push({
      x: ufo.x - sz.w / 2,
      y: UFO_Y - sz.h / 2,
      w: sz.w,
      h: sz.h,
      atlasU: UV_UFO[0],
      atlasV: UV_UFO[1],
      atlasW: UV_UFO[2],
      atlasH: UV_UFO[3],
    });
  }

  // ── UFO explosion + score popup ───────────────────────────────────────────────
  if (ufoExplosion !== null) {
    const sz = SPRITE_SIZES.invaderExplosion;
    instances.push({
      x: ufoExplosion.x - sz.w / 2,
      y: UFO_Y - sz.h / 2,
      w: sz.w,
      h: sz.h,
      atlasU: UV_INVADER_EXPLOSION[0],
      atlasV: UV_INVADER_EXPLOSION[1],
      atlasW: UV_INVADER_EXPLOSION[2],
      atlasH: UV_INVADER_EXPLOSION[3],
    });
    const scoreStr = String(ufoExplosion.scoreValue);
    const scoreX = Math.max(0, Math.min(PLAYFIELD_W - scoreStr.length * FONT_CELL_W, ufoExplosion.x - (scoreStr.length * FONT_CELL_W) / 2));
    pushText(instances, scoreStr, scoreX, UFO_Y + sz.h / 2 + 2);
  }

  // ── HUD + overlays ────────────────────────────────────────────────────────────
  buildHudInstances(instances, gs, player);

  return instances;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

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

  // Wire device-lost handler immediately — v1 shows overlay and halts, no re-acquire.
  // (Re-init would require rebuilding pipelines + re-uploading atlas; not worth it for v1.)
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

  // ── Audio ──────────────────────────────────────────────────────────────────
  // AudioManager is lazy — AudioContext is created on first resume() call.
  // resume() must be called from a user-gesture handler (IDLE → PLAYING).
  const audio = makeAudioManager();

  // ── Input ──────────────────────────────────────────────────────────────────
  const input = makeInputState();
  attachInputListeners(input);

  // ── Auto-pause on blur + visibilitychange ──────────────────────────────────
  window.addEventListener('blur', () => { gs = autoPause(gs); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) gs = autoPause(gs);
  });

  // ── Game state ─────────────────────────────────────────────────────────────
  let gs: GameState = makeGameState();
  let sim: SimState = makeSim(gs.wave);

  // Upload initial barrier masks to the renderer
  for (let i = 0; i < 4; i++) {
    renderer.barriers.upload(i, sim.barriers[i].mask);
  }

  // ── Debug hook (DEV + test builds only) ────────────────────────────────────
  if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
    (window as unknown as Record<string, unknown>)['__game'] = {
      get state() { return gs.phase; },
      get score() { return gs.score; },
      get lives() { return sim.player.lives; },
      get bullets() { return sim.bullets; },
      get invaders() { return sim.grid.invaders; },
      barrierMaskAt(bx: number, by: number): number {
        for (const bar of sim.barriers) {
          const col = bx - Math.round(bar.x);
          const row = by - Math.round(bar.y);
          if (col >= 0 && col < BARRIER_W && row >= 0 && row < BARRIER_H) {
            return bar.mask[row * BARRIER_W + col];
          }
        }
        return 0;
      },
      start() {
        if (gs.phase === 'IDLE') {
          gs = startGame(gs);
          sim = makeSim(gs.wave);
          for (let i = 0; i < 4; i++) renderer.barriers.upload(i, sim.barriers[i].mask);
        }
      },
      reset() {
        gs = makeGameState();
        sim = makeSim(gs.wave);
        for (let i = 0; i < 4; i++) renderer.barriers.upload(i, sim.barriers[i].mask);
      },
      advance(ticks: number) {
        for (let t = 0; t < ticks; t++) {
          if (gs.phase === 'PLAYING') {
            const result = updateSim(sim, gs, input, renderer, audio);
            sim = result.sim;
            gs = result.gs;
            if (result.waveComplete) {
              gs = triggerWin(gs);
            }
          }
        }
      },
    };
  }

  // ── Game loop ──────────────────────────────────────────────────────────────
  const startTime = performance.now();
  let lastTime = startTime;
  let acc = 0;

  function frame(now: number): void {
    if (halted) return;

    const rawDt = (now - lastTime) / 1000;
    lastTime = now;
    acc = Math.min(acc + rawDt, MAX_FRAME);

    // Handle state transitions via input.
    // IMPORTANT: wasPressed() is destructive — it consumes the event on first read.
    // Only consume keys here for state machine transitions; leave Space unconsumed
    // while PLAYING so updateSim can read it for firing.
    const pPressed = wasPressed(input, 'KeyP');

    if (gs.phase === 'IDLE') {
      // Consume Space to start the game (prevents a bullet firing on the first sim tick)
      const spacePressed = wasPressed(input, 'Space');
      if (spacePressed || pPressed) {
        audio.resume(); // Unlock AudioContext — MUST be called from a user gesture
        gs = startGame(gs);
        sim = makeSim(gs.wave);
        for (let i = 0; i < 4; i++) renderer.barriers.upload(i, sim.barriers[i].mask);
        acc = 0; // discard time accumulated while on IDLE screen
      }
    } else if (gs.phase === 'PLAYING') {
      // Space is NOT consumed here — updateSim reads it for firing
      if (pPressed) gs = togglePause(gs);
    } else if (gs.phase === 'PAUSED') {
      // Consume Space (no-op while paused, but prevent accumulation)
      wasPressed(input, 'Space');
      if (pPressed) gs = togglePause(gs);
    } else if (gs.phase === 'GAME_OVER' || gs.phase === 'WIN') {
      const spacePressed = wasPressed(input, 'Space');
      if (spacePressed || pPressed) {
        gs = returnToIdle(gs);
      }
    }

    // Run simulation ticks
    if (gs.phase === 'PLAYING') {
      while (acc >= DT) {
        const result = updateSim(sim, gs, input, renderer, audio);
        sim = result.sim;
        gs = result.gs;
        acc -= DT;

        if (result.waveComplete) {
          audio.ufoStop(); // Ensure UFO sound stops on wave clear
          gs = advanceWave(triggerWin(gs));
          // WIN state returns to IDLE via user input (Space/P)
          break;
        }
        if (gs.phase !== 'PLAYING') {
          audio.ufoStop(); // Ensure UFO sound stops on game over
          break;
        }
      }
    } else {
      acc = 0; // don't accumulate while paused/idle
    }

    // Render
    const time = (now - startTime) / 1000;
    const instances = buildInstances(sim, gs, renderer);
    renderer.draw(instances, time);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

bootstrap().catch((err) => {
  showError(`Unexpected error:\n${String(err)}`);
});
