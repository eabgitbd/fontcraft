export type Ring = Array<[number, number]>;
/** One filled region: an outer ring and the holes inside it. Rings are not closed (no repeated first point). */
export type Shape = { outer: Ring; holes: Ring[] };

/** Shoelace area. Positive means counter-clockwise in a y-up coordinate system. */
export function signedArea(r: Ring): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i]!;
    const [x2, y2] = r[(i + 1) % r.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}
