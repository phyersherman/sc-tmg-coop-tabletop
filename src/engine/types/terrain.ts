export interface TableSpec {
  width: number; // x extent, inches
  height: number; // y extent, inches
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Edge = 'N' | 'S' | 'E' | 'W';

export interface EdgeSegment {
  edge: Edge;
  /** Start/end along the edge in inches (x for N/S, y for E/W). */
  from: number;
  to: number;
}

export interface MarkerSpec {
  id: 1 | 2 | 3 | 4 | 5;
  x: number;
  y: number;
}

export interface DeploymentLayout {
  id: string;
  name: string;
  scale: 'skirmish' | 'standard' | 'grand';
  table: TableSpec;
  markers: MarkerSpec[];
  entry: { red: EdgeSegment[]; blue: EdgeSegment[] };
}

export type TerrainSize = 0 | 1 | 2 | 3 | 4;

export interface TerrainPiece {
  n: number;
  catalogId: string;
  size: TerrainSize;
  grass: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  accessPoints?: { x: number; y: number }[];
  /**
   * Turned clockwise by this many degrees about its centre. `x, y, w, h` stay the piece's own footprint as if it
   * were not turned, so every check can measure in the piece's frame (see `pieceLocal`).
   */
  rot?: number;
  /** A Lost Temple Ramp: which long side its ramp runs down (see `rampLane`), set so the ramp opens onto clear ground. */
  rampSide?: 1 | -1;
}

export interface TerrainLayout {
  seed: number;
  table: TableSpec;
  pieces: TerrainPiece[];
  fireLanes: Rect[];
  violations: string[];
  /** True when generated from the player's own terrain collection. */
  fromInventory?: boolean;
}
