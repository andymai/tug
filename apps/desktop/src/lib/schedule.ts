import type { Schedule } from "../backend/backend";

export function openAt(schedule: Schedule, at: Date): boolean {
  const weekday = (at.getDay() + 6) % 7;
  const minute = at.getHours() * 60 + at.getMinutes();
  const on = (day: number) => (schedule.days & (1 << (day % 7))) !== 0;
  return schedule.start < schedule.stop
    ? on(weekday) && schedule.start <= minute && minute < schedule.stop
    : (on(weekday) && minute >= schedule.start) || (on(weekday + 6) && minute < schedule.stop);
}
