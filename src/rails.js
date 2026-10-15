export const RAIL_LENGTH = 3;

export function railKey(side, s) {
  return `${side}:${Math.max(0, Math.floor((s + 1e-7) / RAIL_LENGTH))}`;
}

export function railIntact(track, road, side) {
  return road.tunnel || (road.rails[side] && !track.brokenRails.has(railKey(side, road.s)));
}

export function breakRail(track, side, s) {
  const centre = Math.floor(s / RAIL_LENGTH);
  const removed = [];
  for (let i = Math.max(0, centre - 1); i <= centre + 1; i++) {
    if (i * RAIL_LENGTH >= track.length) continue;
    const key = railKey(side, i * RAIL_LENGTH);
    if (!track.brokenRails.has(key)) { track.brokenRails.add(key); removed.push(key); }
  }
  return removed;
}
