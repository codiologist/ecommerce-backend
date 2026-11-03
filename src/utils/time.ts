export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Parses "15m" / "30s" / "2h" into seconds. */
export function durationToSeconds(value: string): number {
  const match = /^(\d+)([smh])$/.exec(value);
  if (!match?.[1] || !match[2]) throw new Error(`Invalid duration: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2];
  return unit === 'h' ? amount * 3600 : unit === 'm' ? amount * 60 : amount;
}
