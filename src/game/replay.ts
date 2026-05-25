export type InputKey = 0 | 1 | 2;

export interface InputEvent {
  tick: number;
  key: InputKey;
  down: boolean;
}

export interface ReplayInputState {
  left: boolean;
  right: boolean;
  fire: boolean;
}

export function applyReplayEvent(state: ReplayInputState, event: Pick<InputEvent, 'key' | 'down'>): void {
  if (event.key === 0) state.left = event.down;
  if (event.key === 1) state.right = event.down;
  if (event.key === 2) state.fire = event.down;
}

export function makeReplayInputState(): ReplayInputState {
  return { left: false, right: false, fire: false };
}
