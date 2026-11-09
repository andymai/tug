use std::io::{self, Write};
use std::process::ExitCode;
use std::time::Duration;

use tug_host::{Host, SystemLauncher};
use tug_ipc::Endpoint;

fn main() -> ExitCode {
    let mut err = io::stderr().lock();
    let endpoint = match Endpoint::from_env() {
        Ok(endpoint) => endpoint,
        Err(e) => {
            let _written = writeln!(err, "tug-host: {e}");
            return ExitCode::FAILURE;
        }
    };
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(e) => {
            let _written = writeln!(err, "tug-host: {e}");
            return ExitCode::FAILURE;
        }
    };
    let host = Host::new(endpoint, SystemLauncher::default(), Duration::from_secs(20));
    let result = host.run(&runtime, &mut io::stdin().lock(), &mut io::stdout().lock());
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            let _written = writeln!(err, "tug-host: {e}");
            ExitCode::FAILURE
        }
    }
}
