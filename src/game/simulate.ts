import {
  type Player,
  type Invader,
  type Bullet,
  type BarrierMask,
  type Ufo,
  makeBarrierMask,
  BARRIER_POSITIONS,
  BARRIER_Y,
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
  PLAYER_INVULN_DURATION,
  EXPLOSION_FRAME_DURATION,
  pointsForInvaderType,
  UFO_SCORE_VALUES,
  UFO_SPEED,
  UFO_Y,
  UFO_SPAWN_MIN_S,
  UFO_SPAWN_MAX_S,
} from './entities.js';
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
} from './spawner.js';
import { aabbOverlap, sweptBulletBarrierHit, applySplash, type Rect } from './physics.js';
import { makeRng, type Rng } from './rng.js';
import { applyReplayEvent, makeReplayInputState, type InputEvent, type ReplayInputState } from './replay.js';

const DT = 1 / 60;
export const DEFAULT_MAX_TICKS = 60 * 60 * 60;

export type SimEnded = 'GAME_OVER' | 'WIN' | 'in-progress';

export interface SimulateResult {
  score: number;
  ended: SimEnded;
  ticks: number;
}

interface HeadlessGameState {
  phase: SimEnded | 'PLAYING';
  score: number;
  wave: number;
  level: number;
}

interface SimState {
  player: Player;
  grid: InvaderGrid;
  bullets: Bullet[];
  barriers: BarrierMask[];
  ufo: Ufo;
  gridStepAccum: number;
  invaderStepNote: number;
  invaderExplosion: { col: number; row: number; timer: number } | null;
  ufoExplosion: { x: number; scoreValue: number; timer: number } | null;
  playerFireCooldown: number;
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

function makeSim(waveN: number, rng: Rng): SimState {
  return {
    player: makePlayer(),
    grid: makeInvaderGrid(waveN),
    bullets: [],
    barriers: makeBarriers(),
    ufo: {
      x: -16,
      dir: 1,
      active: false,
      spawnTimer: UFO_SPAWN_MIN_S + rng.next() * (UFO_SPAWN_MAX_S - UFO_SPAWN_MIN_S),
    },
    gridStepAccum: 0,
    invaderStepNote: 0,
    invaderExplosion: null,
    ufoExplosion: null,
    playerFireCooldown: 0,
  };
}

function invaderRect(grid: InvaderGrid, inv: Invader): Rect {
  const cx = invaderWorldX(grid, inv);
  const cy = invaderWorldY(grid, inv);
  return { x: cx - 6, y: cy - 4, w: 12, h: 8 };
}

function playerRect(player: Player): Rect {
  return { x: player.x - 6.5, y: player.y - 4, w: 13, h: 8 };
}

function bulletRect(bullet: Bullet): Rect {
  return { x: bullet.x - 0.5, y: bullet.y - 2, w: 1, h: 4 };
}

function addScore(gs: HeadlessGameState, points: number): HeadlessGameState {
  if (gs.phase !== 'PLAYING') return gs;
  return { ...gs, score: gs.score + points };
}

function triggerGameOver(gs: HeadlessGameState): HeadlessGameState {
  return gs.phase === 'PLAYING' ? { ...gs, phase: 'GAME_OVER', level: 1 } : gs;
}

function updateHeadless(
  sim: SimState,
  gs: HeadlessGameState,
  input: ReplayInputState,
  rng: Rng,
): { sim: SimState; gs: HeadlessGameState; waveComplete: boolean } {
  let { player, grid, bullets, barriers, ufo, gridStepAccum, invaderStepNote, invaderExplosion, ufoExplosion, playerFireCooldown } = sim;
  let waveComplete = false;

  if (player.explodeFrame !== null) {
    player = { ...player, explodeTimer: player.explodeTimer - DT };
    if (player.explodeTimer <= 0) {
      const nextFrame = (player.explodeFrame ?? 0) + 1;
      if (nextFrame >= 2) {
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
    return { sim: { player, grid, bullets, barriers, ufo, gridStepAccum, invaderStepNote, invaderExplosion, ufoExplosion, playerFireCooldown }, gs, waveComplete };
  }

  if (player.invulnTimer > 0) {
    player = { ...player, invulnTimer: Math.max(0, player.invulnTimer - DT) };
  }

  if (input.left || input.right) {
    const halfW = 6.5;
    const dx = (input.right ? 1 : -1) * PLAYER_SPEED * DT;
    player = { ...player, x: Math.max(halfW, Math.min(PLAYFIELD_W - halfW, player.x + dx)) };
  }

  if (playerFireCooldown > 0) playerFireCooldown = Math.max(0, playerFireCooldown - DT);
  if (playerFireCooldown <= 0 && input.fire) {
    playerFireCooldown = 0.12;
    bullets = [
      ...bullets,
      { x: player.x, y: player.y - 4, vy: BULLET_PLAYER_SPEED, owner: 'player', prevY: player.y - 4 },
    ];
  }

  bullets = bullets
    .map((b) => ({ ...b, prevY: b.y, y: b.y + b.vy * DT }))
    .filter((b) => b.y > -16 && b.y < PLAYFIELD_H + 16);

  const alive = aliveCount(grid);
  const fps = Math.min(framesPerStep(alive), levelSpeedCap(gs.level));
  gridStepAccum += 1;
  if (gridStepAccum >= fps) {
    gridStepAccum = 0;
    invaderStepNote = (invaderStepNote + 1) % 4;
    const newAnimFrame: 0 | 1 = grid.animFrame === 0 ? 1 : 0;
    let nextX = grid.gridX + grid.dir * 2;
    let nextDir = grid.dir;
    let nextY = grid.gridY;
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
        nextX = grid.gridX;
        nextDir = (grid.dir === 1 ? -1 : 1) as 1 | -1;
        nextY = grid.gridY + 8;
      }
    }
    grid = {
      ...grid,
      gridX: nextX,
      gridY: nextY,
      dir: nextDir,
      animFrame: newAnimFrame,
      invaders: grid.invaders.map((inv) => ({ ...inv, frame: newAnimFrame })),
    };
  }

  if (bullets.filter((b) => b.owner === 'enemy').length < MAX_ENEMY_BULLETS) {
    for (const [col, row] of bottomInvadersPerColumn(grid).entries()) {
      if (bullets.filter((b) => b.owner === 'enemy').length >= MAX_ENEMY_BULLETS) break;
      const fireChance = Math.min(INVADER_FIRE_CHANCE * (1 + 0.6 * (gs.level - 1)), 1 / 12);
      if (rng.next() < fireChance) {
        const inv = grid.invaders.find((i) => i.alive && i.col === col && i.row === row);
        if (inv) {
          const bx = invaderWorldX(grid, inv);
          const by = invaderWorldY(grid, inv) + 4;
          bullets = [...bullets, { x: bx, y: by, vy: BULLET_ENEMY_SPEED, owner: 'enemy', prevY: by }];
        }
      }
    }
  }

  if (invaderExplosion !== null) {
    invaderExplosion = { ...invaderExplosion, timer: invaderExplosion.timer - DT };
    if (invaderExplosion.timer <= 0) invaderExplosion = null;
  }
  if (ufoExplosion !== null) {
    ufoExplosion = { ...ufoExplosion, timer: ufoExplosion.timer - DT };
    if (ufoExplosion.timer <= 0) ufoExplosion = null;
  }

  if (!ufo.active) {
    const newTimer = ufo.spawnTimer - DT;
    ufo = newTimer <= 0
      ? { x: -8, dir: 1, active: true, spawnTimer: 0 }
      : { ...ufo, spawnTimer: newTimer };
  } else {
    const newX = ufo.x + ufo.dir * UFO_SPEED * DT;
    ufo = newX > PLAYFIELD_W + 8
      ? { ...ufo, active: false, spawnTimer: UFO_SPAWN_MIN_S + rng.next() * (UFO_SPAWN_MAX_S - UFO_SPAWN_MIN_S) }
      : { ...ufo, x: newX };
  }

  const deadBulletIndices = new Set<number>();
  const newInvaders = grid.invaders.map((inv) => ({ ...inv }));
  for (let bi = 0; bi < bullets.length; bi++) {
    const b = bullets[bi];
    if (b.owner !== 'player' || deadBulletIndices.has(bi)) continue;
    for (const inv of newInvaders) {
      if (!inv.alive) continue;
      if (aabbOverlap(invaderRect(grid, inv), bulletRect(b))) {
        inv.alive = false;
        deadBulletIndices.add(bi);
        gs = addScore(gs, pointsForInvaderType(inv.type));
        invaderExplosion = { col: inv.col, row: inv.row, timer: EXPLOSION_FRAME_DURATION };
        break;
      }
    }
  }

  if (ufo.active) {
    const rect: Rect = { x: ufo.x - 8, y: UFO_Y - 4, w: 16, h: 8 };
    for (let bi = 0; bi < bullets.length; bi++) {
      const b = bullets[bi];
      if (b.owner !== 'player' || deadBulletIndices.has(bi)) continue;
      if (aabbOverlap(rect, bulletRect(b))) {
        const scoreValue = UFO_SCORE_VALUES[Math.floor(rng.next() * UFO_SCORE_VALUES.length)];
        gs = addScore(gs, scoreValue);
        ufo = { ...ufo, active: false, spawnTimer: UFO_SPAWN_MIN_S + rng.next() * (UFO_SPAWN_MAX_S - UFO_SPAWN_MIN_S) };
        ufoExplosion = { x: ufo.x, scoreValue, timer: 1 };
        deadBulletIndices.add(bi);
        break;
      }
    }
  }

  if (player.invulnTimer <= 0 && player.explodeFrame === null) {
    for (let bi = 0; bi < bullets.length; bi++) {
      const b = bullets[bi];
      if (b.owner !== 'enemy' || deadBulletIndices.has(bi)) continue;
      if (aabbOverlap(playerRect(player), bulletRect(b))) {
        deadBulletIndices.add(bi);
        const newLives = player.lives - 1;
        if (newLives <= 0) {
          player = { ...player, lives: 0, explodeFrame: 0, explodeTimer: EXPLOSION_FRAME_DURATION };
          gs = triggerGameOver(gs);
        } else {
          player = { ...player, lives: newLives, explodeFrame: 0, explodeTimer: EXPLOSION_FRAME_DURATION };
        }
        break;
      }
    }
  }

  const updatedBarriers = barriers.map((bar) => ({ ...bar, mask: new Uint8Array(bar.mask) }));
  for (let bi = 0; bi < bullets.length; bi++) {
    if (deadBulletIndices.has(bi)) continue;
    const b = bullets[bi];
    for (const bar of updatedBarriers) {
      const hit = sweptBulletBarrierHit(b, bar);
      if (hit) {
        applySplash(bar, hit, b.owner);
        deadBulletIndices.add(bi);
        break;
      }
    }
  }

  bullets = bullets.filter((_, i) => !deadBulletIndices.has(i));
  grid = { ...grid, invaders: newInvaders };

  if (alive > 0 && aliveCount(grid) === 0) waveComplete = true;

  if (gs.phase === 'PLAYING') {
    for (const inv of grid.invaders) {
      if (!inv.alive) continue;
      const invBottom = invaderWorldY(grid, inv) + 4;
      if (invBottom >= player.y - 4) {
        gs = triggerGameOver(gs);
        break;
      }
    }
  }

  return { sim: { player, grid, bullets, barriers: updatedBarriers, ufo, gridStepAccum, invaderStepNote, invaderExplosion, ufoExplosion, playerFireCooldown }, gs, waveComplete };
}

export function simulate(seed: number, inputLog: InputEvent[], maxTicks = DEFAULT_MAX_TICKS): SimulateResult {
  const rng = makeRng(seed);
  let gs: HeadlessGameState = { phase: 'PLAYING', score: 0, wave: 1, level: 1 };
  let sim = makeSim(gs.wave, rng);
  const input = makeReplayInputState();
  const events = [...inputLog].sort((a, b) => a.tick - b.tick);
  let eventIndex = 0;
  let ticks = 0;

  while (ticks < maxTicks && gs.phase === 'PLAYING') {
    while (eventIndex < events.length && events[eventIndex].tick === ticks) {
      const event = events[eventIndex];
      if (event.tick < 0 || event.key < 0 || event.key > 2 || typeof event.down !== 'boolean') {
        return { score: gs.score, ended: 'in-progress', ticks };
      }
      applyReplayEvent(input, event);
      eventIndex++;
    }
    const result = updateHeadless(sim, gs, input, rng);
    sim = result.sim;
    gs = result.gs;
    if (result.waveComplete) {
      const savedLives = sim.player.lives;
      gs = { ...gs, wave: gs.wave + 1, level: gs.level + 1 };
      sim = makeSim(gs.wave, rng);
      sim = { ...sim, player: { ...sim.player, lives: savedLives } };
    }
    ticks++;
  }

  return {
    score: Math.max(0, Math.min(999999, Math.floor(gs.score))),
    ended: gs.phase === 'GAME_OVER' || gs.phase === 'WIN' ? gs.phase : 'in-progress',
    ticks,
  };
}
