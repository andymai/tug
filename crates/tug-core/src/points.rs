// Named places in the library where a test holds a task, so that it can call into
// the gap that a race would hit. Each library keeps its own, so tests that run at
// once in one process don't share them. Built only with the `test-points` feature.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use tokio::sync::Semaphore;

#[derive(Default)]
pub struct Points {
    armed: Mutex<HashMap<&'static str, Arc<Gate>>>,
}

struct Gate {
    arrived: Semaphore,
    // Closed to let every task through, now and later.
    open: Semaphore,
}

impl Default for Gate {
    fn default() -> Self {
        Self {
            arrived: Semaphore::new(0),
            open: Semaphore::new(0),
        }
    }
}

pub struct Hold {
    gate: Arc<Gate>,
}

impl Points {
    pub fn arm(&self, name: &'static str) -> Hold {
        let gate = Arc::new(Gate::default());
        self.armed
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(name, Arc::clone(&gate));
        Hold { gate }
    }

    pub async fn reach(&self, name: &'static str) {
        let gate = self
            .armed
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(name)
            .cloned();
        if let Some(gate) = gate {
            gate.arrived.add_permits(1);
            let _open = gate.open.acquire().await;
        }
    }
}

impl Hold {
    // Waits until a task gets to the point, and counts it.
    pub async fn reached(&self) {
        if let Ok(arrival) = self.gate.arrived.acquire().await {
            arrival.forget();
        }
    }

    pub fn release(&self) {
        self.gate.open.close();
    }
}

impl Drop for Hold {
    fn drop(&mut self) {
        self.release();
    }
}
