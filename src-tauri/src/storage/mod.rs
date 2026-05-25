use anyhow::Result;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri_plugin_store::StoreExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub stt_provider: String,
    pub stt_api_key: String,
    pub stt_language: String,
    pub stt_correction_enabled: bool,
    pub stt_corrections: Vec<SttCorrection>,
    pub llm_provider: String,
    pub llm_api_key: String,
    pub llm_model: String,
    pub llm_base_url: String,
    pub polish_enabled: bool,
    pub translate_enabled: bool,
    pub target_lang: String,
    pub hotkey: String,
    pub hotkey_mode: String,
    pub output_mode: String,
    pub selected_text_enabled: bool,
    pub theme: String,
    pub auto_start: bool,
    pub close_to_tray: bool,
    pub start_minimized: bool,
    pub max_recording_seconds: u32,
    pub ui_language: String,
    pub capsule_auto_hide: bool,
    pub voice_profile_enabled: bool,
    pub voice_profile_inbox_dir: String,
    pub voice_profile_min_duration_seconds: f32,
    pub voice_profile_min_quality_score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct SttCorrection {
    pub from: String,
    pub to: String,
    pub enabled: bool,
}

impl Default for SttCorrection {
    fn default() -> Self {
        Self {
            from: String::new(),
            to: String::new(),
            enabled: true,
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            stt_provider: "cloud-opus".to_string(),
            stt_api_key: String::new(),
            stt_language: "multi".to_string(),
            stt_correction_enabled: false,
            stt_corrections: Vec::new(),
            llm_provider: "deepseek".to_string(),
            llm_api_key: String::new(),
            llm_model: "deepseek-v4-flash".to_string(),
            llm_base_url: "https://api.deepseek.com/v1".to_string(),
            polish_enabled: true,
            translate_enabled: false,
            target_lang: "en".to_string(),
            #[cfg(target_os = "macos")]
            hotkey: "Alt+/".to_string(),
            #[cfg(not(target_os = "macos"))]
            hotkey: "AltRight".to_string(),
            #[cfg(target_os = "macos")]
            hotkey_mode: "hold".to_string(),
            #[cfg(not(target_os = "macos"))]
            hotkey_mode: "toggle".to_string(),
            output_mode: "keyboard".to_string(),
            selected_text_enabled: false,
            theme: "system".to_string(),
            auto_start: false,
            close_to_tray: true,
            start_minimized: false,
            max_recording_seconds: 30,
            ui_language: "zh".to_string(),
            capsule_auto_hide: false,
            voice_profile_enabled: false,
            voice_profile_inbox_dir: String::new(),
            voice_profile_min_duration_seconds: 3.0,
            voice_profile_min_quality_score: 0.65,
        }
    }
}

// ─── ConfigManager (tauri-plugin-store backed) ───

pub struct ConfigManager {
    app_handle: tauri::AppHandle,
    cache: Mutex<Option<AppConfig>>,
}

impl ConfigManager {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self {
            app_handle,
            cache: Mutex::new(None),
        }
    }

    pub async fn load(&self) -> Result<AppConfig> {
        if let Some(config) = self.cache.lock().unwrap_or_else(|e| e.into_inner()).clone() {
            return Ok(config);
        }

        let config = match self.app_handle.store("settings.json") {
            Ok(store) => match store.get("app_config") {
                Some(val) => serde_json::from_value::<AppConfig>(val.clone()).unwrap_or_default(),
                None => AppConfig::default(),
            },
            Err(_) => AppConfig::default(),
        };

        *self.cache.lock().unwrap_or_else(|e| e.into_inner()) = Some(config.clone());
        Ok(config)
    }

    pub async fn save(&self, config: &AppConfig) -> Result<()> {
        *self.cache.lock().unwrap_or_else(|e| e.into_inner()) = Some(config.clone());

        let store = self
            .app_handle
            .store("settings.json")
            .map_err(|e| anyhow::anyhow!("Failed to open store: {}", e))?;
        let val = serde_json::to_value(config)?;
        store.set("app_config", val);
        store.save().map_err(|e| anyhow::anyhow!("{}", e))?;

        Ok(())
    }
}

// ─── HistoryStore (SQLite backed) ───

/// Maximum number of history entries to retain. Older entries are pruned on insert.
const MAX_HISTORY_ENTRIES: u32 = 5000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: i64,
    pub created_at: String,
    pub app_name: String,
    pub app_type: String,
    pub raw_text: String,
    pub polished_text: String,
    pub corrected_text: Option<String>,
    pub corrected_at: Option<String>,
    pub language: Option<String>,
    pub duration_ms: Option<i64>,
    pub stt_provider: Option<String>,
    pub llm_provider: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SttCorrectionSuggestion {
    pub id: i64,
    pub wrong_text: String,
    pub correct_text: String,
    pub source_count: i64,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_seen_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HistoryStats {
    pub total_entries: i64,
    pub total_duration_ms: i64,
    pub total_characters: i64,
    pub estimated_saved_ms: i64,
    pub average_chars_per_minute: f64,
    pub month_entries: i64,
    pub month_duration_ms: i64,
    pub month_characters: i64,
    pub month_llm_input_tokens: i64,
    pub month_llm_output_tokens: i64,
    pub month_stt_cost_cny: f64,
    pub month_llm_cost_usd: f64,
    pub total_llm_input_tokens: i64,
    pub total_llm_output_tokens: i64,
    pub total_stt_cost_cny: f64,
    pub total_llm_cost_usd: f64,
}

pub struct HistoryStore {
    conn: Mutex<Connection>,
}

impl HistoryStore {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        let conn = Connection::open(&db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                app_name TEXT NOT NULL DEFAULT '',
                app_type TEXT NOT NULL DEFAULT '',
                raw_text TEXT NOT NULL DEFAULT '',
                polished_text TEXT NOT NULL DEFAULT '',
                corrected_text TEXT,
                corrected_at TEXT,
                language TEXT,
                duration_ms INTEGER,
                stt_provider TEXT,
                llm_provider TEXT
            );",
        )?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS stt_correction_suggestions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wrong_text TEXT NOT NULL,
                correct_text TEXT NOT NULL,
                source_count INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                UNIQUE(wrong_text, correct_text)
            );",
        )?;
        ensure_history_column(&conn, "corrected_text", "TEXT")?;
        ensure_history_column(&conn, "corrected_at", "TEXT")?;
        ensure_history_column(&conn, "stt_provider", "TEXT")?;
        ensure_history_column(&conn, "llm_provider", "TEXT")?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub async fn add(&self, entry: HistoryEntry) -> Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "INSERT INTO history (
                created_at,
                app_name,
                app_type,
                raw_text,
                polished_text,
                corrected_text,
                corrected_at,
                language,
                duration_ms,
                stt_provider,
                llm_provider
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                entry.created_at,
                entry.app_name,
                entry.app_type,
                entry.raw_text,
                entry.polished_text,
                entry.corrected_text,
                entry.corrected_at,
                entry.language,
                entry.duration_ms,
                entry.stt_provider,
                entry.llm_provider,
            ],
        )?;

        // Prune old entries beyond the retention limit
        conn.execute(
            "DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ?1)",
            rusqlite::params![MAX_HISTORY_ENTRIES],
        )?;

        Ok(())
    }

    pub async fn list(&self, limit: u32, offset: u32) -> Result<Vec<HistoryEntry>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare(
            "SELECT
                id,
                created_at,
                app_name,
                app_type,
                raw_text,
                polished_text,
                corrected_text,
                corrected_at,
                language,
                duration_ms,
                stt_provider,
                llm_provider
             FROM history ORDER BY id DESC LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt.query_map(rusqlite::params![limit, offset], |row| {
            Ok(HistoryEntry {
                id: row.get(0)?,
                created_at: row.get(1)?,
                app_name: row.get(2)?,
                app_type: row.get(3)?,
                raw_text: row.get(4)?,
                polished_text: row.get(5)?,
                corrected_text: row.get(6)?,
                corrected_at: row.get(7)?,
                language: row.get(8)?,
                duration_ms: row.get(9)?,
                stt_provider: row.get(10)?,
                llm_provider: row.get(11)?,
            })
        })?;
        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }
        Ok(entries)
    }

    pub async fn update_correction(&self, id: i64, corrected_text: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let normalized = corrected_text
            .map(str::trim)
            .filter(|text| !text.is_empty());
        let existing = conn
            .query_row(
                "SELECT raw_text, polished_text FROM history WHERE id = ?1",
                rusqlite::params![id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;

        if let Some(text) = normalized {
            let corrected_at = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
            conn.execute(
                "UPDATE history SET corrected_text = ?1, corrected_at = ?2 WHERE id = ?3",
                rusqlite::params![text, corrected_at, id],
            )?;
            if let Some((raw_text, polished_text)) = existing {
                record_stt_correction_suggestion(&conn, &raw_text, &polished_text, text)?;
            }
        } else {
            conn.execute(
                "UPDATE history SET corrected_text = NULL, corrected_at = NULL WHERE id = ?1",
                rusqlite::params![id],
            )?;
        }

        Ok(())
    }

    pub async fn list_stt_correction_suggestions(
        &self,
        min_count: i64,
        limit: u32,
    ) -> Result<Vec<SttCorrectionSuggestion>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare(
            "SELECT id, wrong_text, correct_text, source_count, status, created_at, updated_at, last_seen_at
             FROM stt_correction_suggestions
             WHERE status = 'pending' AND source_count >= ?1
             ORDER BY source_count DESC, updated_at DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(rusqlite::params![min_count.max(1), limit], |row| {
            Ok(SttCorrectionSuggestion {
                id: row.get(0)?,
                wrong_text: row.get(1)?,
                correct_text: row.get(2)?,
                source_count: row.get(3)?,
                status: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                last_seen_at: row.get(7)?,
            })
        })?;
        let mut suggestions = Vec::new();
        for row in rows {
            suggestions.push(row?);
        }
        Ok(suggestions)
    }

    pub async fn mark_stt_correction_suggestion(&self, id: i64, status: &str) -> Result<()> {
        let normalized = match status {
            "accepted" | "ignored" | "pending" => status,
            _ => "ignored",
        };
        let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "UPDATE stt_correction_suggestions SET status = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![normalized, now, id],
        )?;
        Ok(())
    }

    pub async fn stats(&self) -> Result<HistoryStats> {
        const TYPING_CHARS_PER_MINUTE: f64 = 75.0;

        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare(
            "SELECT raw_text, polished_text, corrected_text, duration_ms, created_at, stt_provider, llm_provider FROM history",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        })?;

        let mut stats = HistoryStats::default();
        let current_month = chrono::Local::now().format("%Y-%m").to_string();
        for row in rows {
            let (
                raw_text,
                polished_text,
                corrected_text,
                duration_ms,
                created_at,
                stt_provider,
                llm_provider,
            ) = row?;
            let display_text = corrected_text
                .as_deref()
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| polished_text.clone());
            let input_tokens =
                estimate_llm_tokens(&raw_text) + prompt_overhead_tokens(&llm_provider);
            let fallback_text = if display_text.trim().is_empty() {
                raw_text
            } else {
                display_text
            };

            stats.total_entries += 1;
            stats.total_duration_ms += duration_ms.unwrap_or(0);
            let char_count = fallback_text
                .chars()
                .filter(|ch| !ch.is_whitespace())
                .count() as i64;
            stats.total_characters += char_count;

            let output_tokens = estimate_llm_tokens(&fallback_text);
            let stt_cost_cny = estimate_stt_cost_cny(duration_ms.unwrap_or(0), &stt_provider);
            let llm_cost_usd = estimate_llm_cost_usd(input_tokens, output_tokens, &llm_provider);

            stats.total_llm_input_tokens += input_tokens;
            stats.total_llm_output_tokens += output_tokens;
            stats.total_stt_cost_cny += stt_cost_cny;
            stats.total_llm_cost_usd += llm_cost_usd;

            if created_at.starts_with(&current_month) {
                stats.month_entries += 1;
                stats.month_duration_ms += duration_ms.unwrap_or(0);
                stats.month_characters += char_count;
                stats.month_llm_input_tokens += input_tokens;
                stats.month_llm_output_tokens += output_tokens;
                stats.month_stt_cost_cny += stt_cost_cny;
                stats.month_llm_cost_usd += llm_cost_usd;
            }
        }

        if stats.total_duration_ms > 0 {
            stats.average_chars_per_minute =
                stats.total_characters as f64 / (stats.total_duration_ms as f64 / 60_000.0);
        }

        let estimated_typing_ms =
            (stats.total_characters as f64 / TYPING_CHARS_PER_MINUTE * 60_000.0).round() as i64;
        stats.estimated_saved_ms = (estimated_typing_ms - stats.total_duration_ms).max(0);

        Ok(stats)
    }

    pub async fn clear(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute("DELETE FROM history", [])?;
        Ok(())
    }
}

fn ensure_history_column(conn: &Connection, column_name: &str, definition: &str) -> Result<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(history)")?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
    let exists = columns
        .filter_map(|c| c.ok())
        .any(|name| name == column_name);

    if !exists {
        conn.execute(
            &format!(
                "ALTER TABLE history ADD COLUMN {} {}",
                column_name, definition
            ),
            [],
        )?;
    }

    Ok(())
}

fn record_stt_correction_suggestion(
    conn: &Connection,
    raw_text: &str,
    polished_text: &str,
    corrected_text: &str,
) -> Result<()> {
    let corrected = corrected_text.trim();
    if corrected.is_empty() || corrected.len() > 800 {
        return Ok(());
    }

    let polished = polished_text.trim();
    let raw = raw_text.trim();
    let wrong = if !polished.is_empty() && polished != corrected {
        polished
    } else if !raw.is_empty() && raw != corrected {
        raw
    } else {
        return Ok(());
    };

    if wrong == corrected || wrong.len() > 800 {
        return Ok(());
    }

    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO stt_correction_suggestions (
            wrong_text, correct_text, source_count, status, created_at, updated_at, last_seen_at
         ) VALUES (?1, ?2, 1, 'pending', ?3, ?3, ?3)
         ON CONFLICT(wrong_text, correct_text) DO UPDATE SET
            source_count = source_count + 1,
            updated_at = excluded.updated_at,
            last_seen_at = excluded.last_seen_at",
        rusqlite::params![wrong, corrected, now],
    )?;
    Ok(())
}

fn estimate_llm_tokens(text: &str) -> i64 {
    let mut tokens = 0.0f64;
    let mut ascii_run = 0usize;

    for ch in text.chars() {
        if ch.is_whitespace() {
            if ascii_run > 0 {
                tokens += (ascii_run as f64 / 4.0).ceil();
                ascii_run = 0;
            }
            continue;
        }

        if ch.is_ascii_alphanumeric() {
            ascii_run += 1;
            continue;
        }

        if ascii_run > 0 {
            tokens += (ascii_run as f64 / 4.0).ceil();
            ascii_run = 0;
        }

        if ch.is_ascii_punctuation() {
            tokens += 0.5;
        } else {
            tokens += 1.0;
        }
    }

    if ascii_run > 0 {
        tokens += (ascii_run as f64 / 4.0).ceil();
    }

    tokens.round() as i64
}

fn prompt_overhead_tokens(provider: &Option<String>) -> i64 {
    match provider.as_deref() {
        Some("deepseek") | Some("openai") | Some("glm") | Some("qwen") | Some("claude") => 220,
        Some(_) => 180,
        None => 180,
    }
}

fn estimate_stt_cost_cny(duration_ms: i64, provider: &Option<String>) -> f64 {
    let hours = duration_ms.max(0) as f64 / 3_600_000.0;
    let rate = match provider.as_deref() {
        Some("volcengine-flash") => 4.5,
        Some("volcengine-standard") => 2.3,
        Some("local-whisper") | Some("cloud-opus") => 0.0,
        _ => 0.0,
    };
    hours * rate
}

fn estimate_llm_cost_usd(input_tokens: i64, output_tokens: i64, provider: &Option<String>) -> f64 {
    match provider.as_deref() {
        Some("deepseek") => {
            let input_cost = input_tokens.max(0) as f64 / 1_000_000.0 * 0.14;
            let output_cost = output_tokens.max(0) as f64 / 1_000_000.0 * 0.28;
            input_cost + output_cost
        }
        _ => 0.0,
    }
}

// ─── DictionaryStore (SQLite backed) ───

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db_path(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("voiceslate-{name}-{suffix}.sqlite"))
    }

    fn sample_entry(raw_text: &str, polished_text: &str) -> HistoryEntry {
        HistoryEntry {
            id: 0,
            created_at: "2026-05-16T12:00:00".to_string(),
            app_name: "test".to_string(),
            app_type: "test".to_string(),
            raw_text: raw_text.to_string(),
            polished_text: polished_text.to_string(),
            corrected_text: None,
            corrected_at: None,
            language: Some("zh".to_string()),
            duration_ms: Some(1200),
            stt_provider: Some("cloud-opus".to_string()),
            llm_provider: Some("managed".to_string()),
        }
    }

    #[tokio::test]
    async fn manual_history_correction_creates_pending_stt_suggestion() {
        let path = temp_db_path("correction-suggestion");
        let store = HistoryStore::new(path.clone()).unwrap();

        store
            .add(sample_entry("raw wrong text", "polished wrong text"))
            .await
            .unwrap();
        store
            .update_correction(1, Some("correct text"))
            .await
            .unwrap();

        let suggestions = store.list_stt_correction_suggestions(1, 10).await.unwrap();
        assert_eq!(suggestions.len(), 1);
        assert_eq!(suggestions[0].wrong_text, "polished wrong text");
        assert_eq!(suggestions[0].correct_text, "correct text");
        assert_eq!(suggestions[0].source_count, 1);
        assert_eq!(suggestions[0].status, "pending");

        store
            .mark_stt_correction_suggestion(suggestions[0].id, "ignored")
            .await
            .unwrap();
        let suggestions = store.list_stt_correction_suggestions(1, 10).await.unwrap();
        assert!(suggestions.is_empty());

        let _ = std::fs::remove_file(path);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DictionaryEntry {
    pub id: i64,
    pub word: String,
    pub pronunciation: Option<String>,
}

pub struct DictionaryStore {
    conn: Mutex<Connection>,
}

impl DictionaryStore {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        let conn = Connection::open(&db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS dictionary (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                word TEXT NOT NULL,
                pronunciation TEXT
            );",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub async fn add(&self, word: &str, pronunciation: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "INSERT INTO dictionary (word, pronunciation) VALUES (?1, ?2)",
            rusqlite::params![word, pronunciation],
        )?;
        Ok(())
    }

    pub async fn remove(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "DELETE FROM dictionary WHERE id = ?1",
            rusqlite::params![id],
        )?;
        Ok(())
    }

    pub async fn list(&self) -> Result<Vec<DictionaryEntry>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare("SELECT id, word, pronunciation FROM dictionary")?;
        let rows = stmt.query_map([], |row| {
            Ok(DictionaryEntry {
                id: row.get(0)?,
                word: row.get(1)?,
                pronunciation: row.get(2)?,
            })
        })?;
        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }
        Ok(entries)
    }

    pub async fn words(&self) -> Vec<String> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = match conn.prepare("SELECT word FROM dictionary") {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = match stmt.query_map([], |row| row.get::<_, String>(0)) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };
        rows.filter_map(|r| r.ok()).collect()
    }
}
