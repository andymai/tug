// The mock in src/backend must refuse and clean up as Tug does. These cases come
// from Tug's own checks, and src/backend/contract.test.ts runs the mock on each;
// CI fails when a case here changes and the committed files don't.

use serde_json::{Value, json};

use super::*;

fn outcome(result: Result<Value, String>) -> Value {
    match result {
        Ok(value) => json!({ "ok": value }),
        Err(error) => json!({ "error": error }),
    }
}

fn headers() -> Vec<Value> {
    let cases: [(Option<&str>, Option<&str>, Option<&str>); 13] = [
        (None, None, None),
        (
            Some(" https://u:p@example.org/page?x=1#top "),
            Some(" a=1 "),
            Some(" Mozilla/5.0 "),
        ),
        (Some("https://example.org"), None, None),
        (Some("http://example.org/a"), Some(""), Some("  ")),
        (Some("ftp://example.org/"), None, None),
        (Some("not a page"), None, None),
        (None, Some("a=1\u{1}"), None),
        (None, None, Some("agent\nnext")),
        (None, None, Some("agent\u{7f}")),
        (None, Some("caf\u{e9}=1"), None),
        (None, Some("a=1;\tb=2"), None),
        (None, Some("a=1; b=2"), Some("Tug/1 (X11)")),
        // Rust and JavaScript trim different spaces.
        (None, None, Some("\u{feff}Tug/1\u{85}")),
    ];
    cases
        .iter()
        .map(|&(referrer, cookies, user_agent)| {
            let checked = Origin::new(referrer, cookies, user_agent)
                .map(|origin| serde_json::to_value(HeadersDto::from(&origin)).unwrap())
                .map_err(|e| e.to_string());
            json!({ "referrer": referrer, "cookies": cookies, "userAgent": user_agent, "outcome": outcome(checked) })
        })
        .collect()
}

fn names() -> Vec<Value> {
    let fits = "\u{e9}".repeat(127);
    let long = "\u{e9}".repeat(128);
    let cases = [
        "x.iso",
        " spaced.iso ",
        "",
        "   ",
        ".",
        "..",
        "a/b.iso",
        "a\0b",
        "a\u{1}b",
        "a\u{7f}b",
        "say \"hi\".txt",
        "a\\b.iso",
        "tab\there.iso",
        "\u{feff}x.iso\u{85}",
        // Rust quotes these differently from JSON.
        "a\t/\u{1}\u{a0}\u{301}\u{200b}\"\\b",
        &fits,
        &long,
    ];
    cases
        .iter()
        .map(|&name| {
            let checked = tug_core::check_name(name)
                .map(|plain| json!(plain))
                .map_err(|e| e.to_string());
            json!({ "name": name, "outcome": outcome(checked) })
        })
        .collect()
}

fn own() -> Vec<Value> {
    let cases: [(Option<u32>, Option<u64>); 7] = [
        (None, None),
        (Some(1), None),
        (Some(32), None),
        (Some(0), None),
        (Some(33), None),
        (None, Some(1)),
        (None, Some(0)),
    ];
    cases
        .iter()
        .map(|&(connections, speed_limit)| {
            let checked = tug_core::check_own(connections, speed_limit)
                .map(|()| Value::Null)
                .map_err(|e| e.to_string());
            json!({ "connections": connections, "speedLimit": speed_limit, "outcome": outcome(checked) })
        })
        .collect()
}

fn patches() -> Vec<Value> {
    let hours = json!({ "days": 127, "start": 60, "stop": 120 });
    let view =
        |name: &str, view: &str, query: &str| json!({ "name": name, "view": view, "query": query });
    let views: Vec<Value> = (0..51)
        .map(|n| view(&format!("v{n}"), "all", &format!("q{n}")))
        .collect();
    let columns: Vec<String> = (0..25).map(|n| "c".repeat(n % 20 + 1)).collect();
    let widths: BTreeMap<String, u32> = (0..25)
        .map(|n| (format!("w{}", "x".repeat(n)), 100))
        .collect();
    vec![
        json!({}),
        json!({ "connections": 32 }),
        json!({ "connections": 0 }),
        json!({ "connections": 33 }),
        json!({ "maxActive": 0 }),
        json!({ "maxActive": 17 }),
        json!({ "speedLimit": 0 }),
        json!({ "speedLimit": 0, "maxActive": 0 }),
        json!({ "schedule": hours }),
        json!({ "schedule": { "days": 0, "start": 60, "stop": 120 } }),
        json!({ "schedule": { "days": 128, "start": 60, "stop": 120 } }),
        json!({ "schedule": { "days": 127, "start": 1440, "stop": 1500 } }),
        json!({ "schedule": { "days": 127, "start": 60, "stop": 1440 } }),
        json!({ "schedule": { "days": 127, "start": 60, "stop": 60 } }),
        json!({ "slowHours": { "limit": 0, "hours": hours } }),
        json!({ "slowHours": { "limit": 1, "hours": { "days": 127, "start": 9, "stop": 9 } } }),
        json!({ "downloadDir": "Downloads" }),
        json!({ "downloadDir": "Downloads", "excludedSites": ["exa mple"] }),
        json!({ "excludedSites": ["example.org", "*.bank.example", "https://Mail.Example.net/inbox", "a.example\u{85}"] }),
        json!({ "excludedSites": ["Example.org", "example.org"] }),
        json!({ "excludedSites": ["exa mple"] }),
        json!({ "columns": ["size", "speed"], "sort": "-size" }),
        json!({ "columns": ["Size"] }),
        json!({ "columns": ["size", "size"] }),
        json!({ "columns": columns }),
        json!({ "sort": "--size" }),
        json!({ "sort": "" }),
        json!({ "widths": { "size": 120 } }),
        json!({ "widths": { "size": 12 } }),
        json!({ "widths": { "Size": 120 } }),
        // Rust walks the keys in UTF-8 order, JavaScript sorts them in UTF-16 order.
        json!({ "widths": { "\u{1f600}": 100, "\u{ff21}": 100 } }),
        json!({ "widths": widths }),
        json!({ "savedViews": [view("Linux", "all", "fedora iso")] }),
        json!({ "savedViews": [view(" ", "all", "x")] }),
        json!({ "savedViews": [view("tab\t\u{1}\"q\"", "all", "x")] }),
        json!({ "savedViews": [view("A", "All", "x")] }),
        json!({ "savedViews": [view(&"n".repeat(61), "all", "x")] }),
        json!({ "savedViews": [view("A", "all", "x"), view("B", "all", "x")] }),
        json!({ "savedViews": views }),
    ]
}

async fn settings() -> Vec<Value> {
    let base = Settings {
        download_dir: PathBuf::from("/home/you/Downloads"),
        ..Settings::default()
    };
    let mut cases = Vec::new();
    for patch in patches() {
        let library = Library::open(Store::open_in_memory().unwrap())
            .await
            .unwrap();
        library.update_settings(base.clone()).unwrap();
        let mut merged = serde_json::to_value(SettingsDto::from(&base)).unwrap();
        if let (Some(into), Some(from)) = (merged.as_object_mut(), patch.as_object()) {
            into.extend(from.clone());
        }
        let checked = save_settings(&library, serde_json::from_value(merged).unwrap())
            .map(|()| {
                serde_json::to_value(SettingsDto::from(&library.settings().unwrap())).unwrap()
            })
            .map_err(|e| e.message);
        cases.push(json!({ "patch": patch, "outcome": outcome(checked) }));
    }
    cases
}

#[tokio::test]
async fn cases_are_current() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/backend/contract");
    std::fs::create_dir_all(&dir).unwrap();
    for (name, cases) in [
        ("headers.json", headers()),
        ("names.json", names()),
        ("own.json", own()),
        ("settings.json", settings().await),
    ] {
        let text = serde_json::to_string_pretty(&cases).unwrap() + "\n";
        let path = dir.join(name);
        if std::fs::read_to_string(&path).ok().as_deref() != Some(text.as_str()) {
            std::fs::write(&path, text).unwrap();
        }
    }
}
