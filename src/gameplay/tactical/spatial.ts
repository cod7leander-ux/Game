import type { TacticalUnit } from './types';

/**
 * Uniform spatial hash for target queries.
 *
 * Battles rebuild the grid once per tick (O(n)) and then answer range queries
 * from the few overlapping cells instead of scanning every unit. That keeps
 * targeting linear-ish as unit counts grow into the thousands, without
 * committing to a heavier tree structure this early.
 */
export class SpatialGrid {
  private readonly cells = new Map<number, TacticalUnit[]>();
  private readonly cellSize: number;

  constructor(cellSize = 250) {
    this.cellSize = Math.max(25, cellSize);
  }

  clear(): void {
    this.cells.clear();
  }

  private key(cx: number, cz: number): number {
    // Cantor-ish pairing into a single integer keeps the map allocation-free.
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  insert(unit: TacticalUnit): void {
    const cx = Math.floor(unit.position.x / this.cellSize);
    const cz = Math.floor(unit.position.z / this.cellSize);
    const key = this.key(cx, cz);
    const bucket = this.cells.get(key);
    if (bucket) bucket.push(unit);
    else this.cells.set(key, [unit]);
  }

  rebuild(units: TacticalUnit[]): void {
    this.clear();
    for (const unit of units) {
      if (unit.state === 'destroyed') continue;
      this.insert(unit);
    }
  }

  /** Appends living units whose horizontal distance is within `radius`. */
  query(center: { x: number; z: number }, radius: number, out: TacticalUnit[]): TacticalUnit[] {
    out.length = 0;
    const minX = Math.floor((center.x - radius) / this.cellSize);
    const maxX = Math.floor((center.x + radius) / this.cellSize);
    const minZ = Math.floor((center.z - radius) / this.cellSize);
    const maxZ = Math.floor((center.z + radius) / this.cellSize);
    const radiusSq = radius * radius;

    for (let cx = minX; cx <= maxX; cx += 1) {
      for (let cz = minZ; cz <= maxZ; cz += 1) {
        const bucket = this.cells.get(this.key(cx, cz));
        if (!bucket) continue;
        for (const unit of bucket) {
          if (unit.state === 'destroyed') continue;
          const dx = unit.position.x - center.x;
          const dz = unit.position.z - center.z;
          if (dx * dx + dz * dz <= radiusSq) out.push(unit);
        }
      }
    }
    return out;
  }
}
