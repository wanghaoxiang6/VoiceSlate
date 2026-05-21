use anyhow::Result;
use async_trait::async_trait;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};

use super::{OutputMode, TextOutput};

/// Above this size, simulated typing becomes noticeably less reliable on
/// Windows input targets. Paste the full text atomically instead.
const PASTE_THRESHOLD_CHARS: usize = 80;
/// Maximum characters per enigo.text() call to avoid input buffer overflow.
const TYPE_CHUNK_SIZE: usize = 200;
/// Delay between typing chunks.
const TYPE_CHUNK_DELAY_MS: u64 = 5;
/// Delay after setting the clipboard before sending Ctrl+V.
const CLIPBOARD_SETTLE_MS: u64 = 80;
/// Delay before restoring the user's previous clipboard content.
const CLIPBOARD_RESTORE_DELAY_MS: u64 = 700;

pub struct KeyboardOutput;

impl Default for KeyboardOutput {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyboardOutput {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl TextOutput for KeyboardOutput {
    async fn type_text(&self, text: &str) -> Result<()> {
        let text = text.to_string();
        tokio::task::spawn_blocking(move || {
            let char_count = text.chars().count();
            if char_count > PASTE_THRESHOLD_CHARS || text.contains('\n') {
                tracing::info!(
                    "Keyboard output using clipboard paste fallback: chars={}, multiline={}",
                    char_count,
                    text.contains('\n')
                );
                paste_text_with_clipboard_restore(&text)?;
                return Ok(());
            }

            tracing::info!("Keyboard output using simulated typing: chars={}", char_count);
            let mut enigo = Enigo::new(&Settings::default())
                .map_err(|e| anyhow::anyhow!("Failed to create Enigo: {:?}", e))?;

            let lines: Vec<&str> = text.split('\n').collect();
            for (i, line) in lines.iter().enumerate() {
                if !line.is_empty() {
                    for chunk in line.chars().collect::<Vec<_>>().chunks(TYPE_CHUNK_SIZE) {
                        let s: String = chunk.iter().collect();
                        enigo
                            .text(&s)
                            .map_err(|e| anyhow::anyhow!("Failed to type text: {:?}", e))?;
                        std::thread::sleep(std::time::Duration::from_millis(TYPE_CHUNK_DELAY_MS));
                    }
                }
                if i < lines.len() - 1 {
                    enigo
                        .key(Key::Shift, Direction::Press)
                        .map_err(|e| anyhow::anyhow!("Key error: {:?}", e))?;
                    enigo
                        .key(Key::Return, Direction::Click)
                        .map_err(|e| anyhow::anyhow!("Key error: {:?}", e))?;
                    enigo
                        .key(Key::Shift, Direction::Release)
                        .map_err(|e| anyhow::anyhow!("Key error: {:?}", e))?;
                }
            }

            Ok(())
        })
        .await?
    }

    fn mode(&self) -> OutputMode {
        OutputMode::Keyboard
    }
}

fn paste_text_with_clipboard_restore(text: &str) -> Result<()> {
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|e| anyhow::anyhow!("Failed to access clipboard: {}", e))?;
    let backup = clipboard.get_text().ok();

    clipboard
        .set_text(text)
        .map_err(|e| anyhow::anyhow!("Failed to set clipboard: {}", e))?;
    std::thread::sleep(std::time::Duration::from_millis(CLIPBOARD_SETTLE_MS));

    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| anyhow::anyhow!("Failed to create Enigo: {:?}", e))?;
    enigo
        .key(Key::Control, Direction::Press)
        .map_err(|e| anyhow::anyhow!("Key press error: {:?}", e))?;
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| anyhow::anyhow!("Key click error: {:?}", e))?;
    enigo
        .key(Key::Control, Direction::Release)
        .map_err(|e| anyhow::anyhow!("Key release error: {:?}", e))?;

    std::thread::sleep(std::time::Duration::from_millis(CLIPBOARD_RESTORE_DELAY_MS));
    if let Some(previous) = backup {
        let _ = clipboard.set_text(previous);
    }

    Ok(())
}
