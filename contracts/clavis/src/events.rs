//! NEP-297 events: `EVENT_JSON:{"standard":"clavis","version":"1.0.0","event":...,"data":[...]}`.
use near_sdk::env;
use near_sdk::serde_json::{Value, json};

pub const EVENT_STANDARD: &str = "clavis";
pub const EVENT_VERSION: &str = "1.0.0";

pub fn emit(event: &str, data: Value) {
    let payload = json!({
        "standard": EVENT_STANDARD,
        "version": EVENT_VERSION,
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}
