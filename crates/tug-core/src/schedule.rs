use std::fmt;
use std::str::FromStr;

pub const MINUTES_PER_DAY: u16 = 24 * 60;

// Days are bits, Monday first; times are minutes after midnight. A stop before
// the start runs past midnight into the next day.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Schedule {
    pub days: u8,
    pub start: u16,
    pub stop: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ScheduleError {
    #[error("a schedule needs at least one day")]
    NoDays,
    #[error("{0} minutes is past the end of a day")]
    Time(u16),
    #[error("a schedule must start and stop at different times")]
    NoHours,
    #[error("{0:?} isn't a schedule")]
    Unreadable(String),
}

impl Schedule {
    pub const EVERY_DAY: u8 = 0b111_1111;

    pub const fn validate(self) -> Result<(), ScheduleError> {
        if self.days & Self::EVERY_DAY == 0 || self.days & !Self::EVERY_DAY != 0 {
            return Err(ScheduleError::NoDays);
        }
        if self.start >= MINUTES_PER_DAY {
            return Err(ScheduleError::Time(self.start));
        }
        if self.stop >= MINUTES_PER_DAY {
            return Err(ScheduleError::Time(self.stop));
        }
        if self.start == self.stop {
            return Err(ScheduleError::NoHours);
        }
        Ok(())
    }

    pub const fn is_open(self, weekday: u8, minute: u16) -> bool {
        if self.start < self.stop {
            self.on(weekday) && self.start <= minute && minute < self.stop
        } else {
            (self.on(weekday) && minute >= self.start)
                || (self.on(weekday + 6) && minute < self.stop)
        }
    }

    const fn on(self, weekday: u8) -> bool {
        self.days & (1 << (weekday % 7)) != 0
    }

    pub fn is_open_now(self) -> bool {
        let now = jiff::Zoned::now();
        let weekday = u8::try_from(now.weekday().to_monday_zero_offset()).unwrap_or(0);
        let minute =
            u16::try_from(i32::from(now.hour()) * 60 + i32::from(now.minute())).unwrap_or(0);
        self.is_open(weekday, minute)
    }
}

impl fmt::Display for Schedule {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {} {}", self.days, self.start, self.stop)
    }
}

impl FromStr for Schedule {
    type Err = ScheduleError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let unreadable = || ScheduleError::Unreadable(s.to_owned());
        let mut parts = s.split(' ');
        let mut next = || parts.next().ok_or_else(unreadable);
        let schedule = Self {
            days: next()?.parse().map_err(|_| unreadable())?,
            start: next()?.parse().map_err(|_| unreadable())?,
            stop: next()?.parse().map_err(|_| unreadable())?,
        };
        if parts.next().is_some() {
            return Err(unreadable());
        }
        schedule.validate()?;
        Ok(schedule)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONDAY: u8 = 0;
    const TUESDAY: u8 = 1;
    const SUNDAY: u8 = 6;

    fn at(hour: u16, minute: u16) -> u16 {
        hour * 60 + minute
    }

    #[test]
    fn a_daytime_schedule_is_open_from_its_start_until_its_stop() {
        let work = Schedule {
            days: 1 << MONDAY,
            start: at(9, 0),
            stop: at(17, 30),
        };
        assert!(!work.is_open(MONDAY, at(8, 59)));
        assert!(work.is_open(MONDAY, at(9, 0)));
        assert!(work.is_open(MONDAY, at(17, 29)));
        assert!(!work.is_open(MONDAY, at(17, 30)));
        assert!(!work.is_open(TUESDAY, at(12, 0)), "only on its days");
    }

    #[test]
    fn a_night_schedule_runs_past_midnight_from_its_day() {
        let night = Schedule {
            days: 1 << SUNDAY,
            start: at(23, 0),
            stop: at(7, 0),
        };
        assert!(night.is_open(SUNDAY, at(23, 30)));
        assert!(
            night.is_open(MONDAY, at(6, 59)),
            "Sunday night goes on into Monday"
        );
        assert!(!night.is_open(MONDAY, at(7, 0)));
        assert!(
            !night.is_open(MONDAY, at(23, 30)),
            "Monday isn't one of its days"
        );
        assert!(
            !night.is_open(SUNDAY, at(6, 0)),
            "Sunday morning belongs to Saturday"
        );
    }

    #[test]
    fn a_schedule_needs_days_hours_and_times_inside_a_day() {
        let valid = Schedule {
            days: Schedule::EVERY_DAY,
            start: at(1, 0),
            stop: at(7, 0),
        };
        valid.validate().unwrap();
        for (bad, error) in [
            (Schedule { days: 0, ..valid }, ScheduleError::NoDays),
            (
                Schedule {
                    days: 0x80,
                    ..valid
                },
                ScheduleError::NoDays,
            ),
            (
                Schedule {
                    start: MINUTES_PER_DAY,
                    ..valid
                },
                ScheduleError::Time(MINUTES_PER_DAY),
            ),
            (
                Schedule {
                    stop: valid.start,
                    ..valid
                },
                ScheduleError::NoHours,
            ),
        ] {
            assert_eq!(bad.validate(), Err(error), "{bad:?}");
        }
    }

    #[test]
    fn a_schedule_reads_back_what_it_writes_and_refuses_the_rest() {
        let night = Schedule {
            days: 0b110_0000,
            start: at(23, 0),
            stop: at(7, 0),
        };
        assert_eq!(night.to_string().parse(), Ok(night));
        for text in ["", "96 1380", "96 1380 420 1", "96 night 420", "0 60 420"] {
            assert!(text.parse::<Schedule>().is_err(), "{text:?}");
        }
    }
}
