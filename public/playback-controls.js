export const SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 2];
export function presetRate(value) {
  if (!Number.isFinite(value)) return 1;
  return SPEED_PRESETS.reduce((best, rate) => Math.abs(rate - value) < Math.abs(best - value) ? rate : best);
}
export function preparedChunkCount(player) {
  if (player.mode === 'full' && !player.finalized) return 0;
  const starts = player.starts || [];
  const duration = player.duration || 0;
  let count = 0;
  while (count < player.chunks.length && Number.isFinite(starts[count]) && starts[count] < duration) count++;
  return count;
}
