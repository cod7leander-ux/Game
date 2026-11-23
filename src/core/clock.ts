import { GAME, type GameSpeed } from './config';

/**
 * Fixed-step simulation clock. Days are the atomic simulation step; rendering
 * stays frame-based. Speeds scale how many day-steps a frame may consume.
 */
export class SimClock {
  day = 1;
  speed: GameSpeed = 1;
  private accumulatorMs = 0;

  constructor(
    readonly msPerDay: number = GAME.msPerDay,
    startDay = 1,
  ) {
    this.day = startDay;
  }

  get isPaused(): boolean {
    return this.speed === 0;
  }

  setSpeed(speed: GameSpeed): void {
    this.speed = speed;
  }

  togglePause(): void {
    this.speed = this.speed === 0 ? 1 : 0;
  }

  /** Fractional progress through the current day, 0..1 (drives UI progress bars). */
  get dayProgress(): number {
    return this.accumulatorMs / this.msPerDay;
  }

  /**
   * Advances real time. Returns the number of whole days the caller must simulate.
   */
  advance(deltaMs: number): number {
    if (this.speed === 0) return 0;
    this.accumulatorMs += deltaMs * this.speed;
    const budget = GAME.maxDaysPerFrame;
    const steps = Math.min(budget, Math.floor(this.accumulatorMs / this.msPerDay));
    if (steps > 0) this.accumulatorMs -= steps * this.msPerDay;
    // Avoid unbounded catch-up debt after a long stall (tab backgrounded, etc.).
    if (this.accumulatorMs > this.msPerDay * (budget + 1)) this.accumulatorMs = 0;
    this.day += steps;
    return steps;
  }

  serialize(): { day: number; speed: GameSpeed; progress: number } {
    return { day: this.day, speed: this.speed, progress: this.dayProgress };
  }

  restore(state: { day: number; speed: GameSpeed; progress?: number }): void {
    this.day = Math.max(1, Math.floor(state.day));
    this.speed = state.speed;
    this.accumulatorMs = (state.progress ?? 0) * this.msPerDay;
  }
}
