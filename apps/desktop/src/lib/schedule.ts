import type { Schedule, Settings } from "../backend/backend";

export function openAt(schedule: Schedule, at: Date): boolean {
  const weekday = (at.getDay() + 6) % 7;
  const minute = at.getHours() * 60 + at.getMinutes();
  const on = (day: number) => (schedule.days & (1 << (day % 7))) !== 0;
  return schedule.start < schedule.stop
    ? on(weekday) && schedule.start <= minute && minute < schedule.stop
    : (on(weekday) && minute >= schedule.start) || (on(weekday + 6) && minute < schedule.stop);
}

// The limit that holds now: the slower hours' one while they last and it is lower.
export function limitInForce(settings: Pick<Settings, "speedLimit" | "slowHours">, at: Date): { limit: number | null; slower: boolean } {
  const slow = settings.slowHours !== null && openAt(settings.slowHours.hours, at) ? settings.slowHours : null;
  const slower = slow !== null && (settings.speedLimit === null || slow.limit < settings.speedLimit);
  return slower ? { limit: slow.limit, slower } : { limit: settings.speedLimit, slower };
}
