use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::{broadcast, watch};
use tokio::task::JoinHandle;
use tokio::time::MissedTickBehavior;

use crate::library::Library;
use crate::store::DownloadId;
use crate::transfer::Phase;

pub const MIN_INTERVAL: Duration = Duration::from_millis(100);
const SMOOTHING: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Update {
    pub id: DownloadId,
    pub phase: Phase,
    pub received: u64,
    pub total: Option<u64>,
    pub speed: u64,
    pub left: Option<Duration>,
    pub connections: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Batch {
    pub seq: u64,
    pub updates: Vec<Update>,
    pub settled: Vec<DownloadId>,
    // Counts each settle and each change outside a tick since the stream began.
    // The watch keeps only the newest batch, so a reader compares this number
    // rather than trust that it saw every batch.
    pub revision: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamOptions {
    pub interval: Duration,
    pub persist_every: u32,
}

impl Default for StreamOptions {
    fn default() -> Self {
        Self {
            interval: MIN_INTERVAL,
            persist_every: 20,
        }
    }
}

// The watch keeps only the newest batch, so a reader that waits on something
// else can miss one; settled downloads also go out here, each to every reader.
const SETTLED_BACKLOG: usize = 256;

pub struct ProgressStream {
    rx: watch::Receiver<Arc<Batch>>,
    settled: broadcast::Sender<DownloadId>,
    task: JoinHandle<()>,
}

impl ProgressStream {
    pub fn spawn(library: Arc<Library>, options: StreamOptions) -> Self {
        let (tx, rx) = watch::channel(Arc::new(Batch::default()));
        let (settled, _) = broadcast::channel(SETTLED_BACKLOG);
        let task = tokio::spawn(run(library, options, tx, settled.clone()));
        Self { rx, settled, task }
    }

    pub fn subscribe(&self) -> watch::Receiver<Arc<Batch>> {
        self.rx.clone()
    }

    pub fn settled(&self) -> broadcast::Receiver<DownloadId> {
        self.settled.subscribe()
    }
}

impl Drop for ProgressStream {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn run(
    library: Arc<Library>,
    options: StreamOptions,
    tx: watch::Sender<Arc<Batch>>,
    settled: broadcast::Sender<DownloadId>,
) {
    let mut ticker = tokio::time::interval(options.interval.max(MIN_INTERVAL));
    ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let persist_every = u64::from(options.persist_every.max(1));
    let mut speeds: HashMap<DownloadId, Smoother> = HashMap::new();
    let mut seq: u64 = 0;
    let mut revision: u64 = 0;
    loop {
        ticker.tick().await;
        seq += 1;
        let now = Instant::now();
        let batch = match library.tick().await {
            Ok(tick) => {
                speeds.retain(|id, _| tick.live.iter().any(|(live, _)| live == id));
                let updates = tick
                    .live
                    .iter()
                    .map(|(id, p)| {
                        let speed = speeds
                            .entry(*id)
                            .or_insert_with(|| Smoother::new(p.received, now, p.speed))
                            .update(p.received, now);
                        Update {
                            id: *id,
                            phase: p.phase,
                            received: p.received,
                            total: p.total,
                            speed,
                            left: time_left(p.received, p.total, speed),
                            connections: p.connections,
                        }
                    })
                    .collect();
                let persisted = if seq.is_multiple_of(persist_every) {
                    library
                        .record_progress(&tick.live)
                        .err()
                        .map(|e| e.to_string())
                } else {
                    None
                };
                let error = tick.error.or(persisted);
                let news = tick.settled.len() + tick.changed.len();
                revision = revision.saturating_add(u64::try_from(news).unwrap_or(u64::MAX));
                Batch {
                    seq,
                    updates,
                    revision,
                    settled: tick.settled,
                    error,
                }
            }
            Err(e) => Batch {
                seq,
                revision,
                error: Some(e.to_string()),
                ..Batch::default()
            },
        };
        for &id in &batch.settled {
            let _readers = settled.send(id);
        }
        tx.send_replace(Arc::new(batch));
    }
}

#[derive(Debug, Clone)]
pub struct Smoother {
    last_received: u64,
    last_at: Instant,
    speed: f64,
}

impl Smoother {
    #[allow(clippy::cast_precision_loss)]
    pub const fn new(received: u64, at: Instant, seed: u64) -> Self {
        Self {
            last_received: received,
            last_at: at,
            speed: seed as f64,
        }
    }

    #[allow(clippy::cast_precision_loss)]
    pub fn update(&mut self, received: u64, at: Instant) -> u64 {
        let dt = at.saturating_duration_since(self.last_at).as_secs_f64();
        if dt > 0.0 {
            let instant = received.saturating_sub(self.last_received) as f64 / dt;
            let weight = 1.0 - (-dt / SMOOTHING.as_secs_f64()).exp();
            self.speed += weight * (instant - self.speed);
            self.last_received = received;
            self.last_at = at;
        }
        bytes_per_second(self.speed)
    }
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
const fn bytes_per_second(speed: f64) -> u64 {
    speed.round().max(0.0) as u64
}

pub fn time_left(received: u64, total: Option<u64>, speed: u64) -> Option<Duration> {
    let remaining = total?.saturating_sub(received);
    (speed > 0).then(|| Duration::from_secs(remaining.div_ceil(speed)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MB: u64 = 1 << 20;

    fn feed(s: &mut Smoother, start: Instant, from: u64, rate: u64, steps: u32) -> (u64, u64) {
        let mut received = from;
        let mut speed = 0;
        for step in 1..=steps {
            received += rate / 10;
            speed = s.update(received, start + Duration::from_millis(100) * step);
        }
        (received, speed)
    }

    #[test]
    fn a_steady_rate_converges_to_that_rate() {
        let start = Instant::now();
        let mut s = Smoother::new(0, start, 0);
        let (_, speed) = feed(&mut s, start, 0, 10 * MB, 100);
        assert!(speed.abs_diff(10 * MB) < 10 * MB / 100, "speed {speed}");
    }

    #[test]
    fn a_stall_decays_smoothly_instead_of_dropping_to_zero() {
        let start = Instant::now();
        let mut s = Smoother::new(0, start, 10 * MB);
        let (received, steady) = feed(&mut s, start, 0, 10 * MB, 50);
        let one_second = s.update(received, start + Duration::from_secs(6));
        let three_seconds = s.update(received, start + Duration::from_secs(8));
        assert!(
            one_second < steady && one_second > steady / 2,
            "{one_second} vs {steady}"
        );
        assert!(
            three_seconds < one_second && three_seconds > 0,
            "{three_seconds}"
        );
    }

    #[test]
    fn the_seed_carries_until_time_passes() {
        let start = Instant::now();
        let mut s = Smoother::new(5 * MB, start, 3 * MB);
        assert_eq!(s.update(5 * MB, start), 3 * MB);
    }

    #[test]
    fn time_left_rounds_up_and_needs_a_size_and_a_speed() {
        assert_eq!(
            time_left(0, Some(10 * MB), 2 * MB),
            Some(Duration::from_secs(5))
        );
        assert_eq!(
            time_left(0, Some(10 * MB + 1), 2 * MB),
            Some(Duration::from_secs(6))
        );
        assert_eq!(time_left(4 * MB, Some(4 * MB), MB), Some(Duration::ZERO));
        assert_eq!(time_left(0, None, MB), None);
        assert_eq!(time_left(0, Some(MB), 0), None);
    }
}
