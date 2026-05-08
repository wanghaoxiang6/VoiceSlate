use anyhow::Result;
use async_trait::async_trait;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;

use super::{whisper_compat::WhisperCompatProvider, SttConfig, SttProvider, TranscriptEvent};

const VOLCENGINE_FLASH_ENDPOINT: &str =
    "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
const VOLCENGINE_RESOURCE_ID: &str = "volc.bigasr.auc_turbo";
const VOLCENGINE_STANDARD_SUBMIT_ENDPOINT: &str =
    "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit";
const VOLCENGINE_STANDARD_QUERY_ENDPOINT: &str =
    "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query";
const VOLCENGINE_STANDARD_RESOURCE_ID: &str = "volc.seedasr.auc";
const MAX_AUDIO_BYTES: usize = 24 * 1024 * 1024;

pub struct VolcengineFlashProvider {
    stt_config: Option<SttConfig>,
    audio_buffer: Vec<u8>,
    client: reqwest::Client,
}

impl VolcengineFlashProvider {
    pub fn new() -> Self {
        Self {
            stt_config: None,
            audio_buffer: Vec::new(),
            client: reqwest::Client::new(),
        }
    }
}

pub struct VolcengineStandardProvider {
    stt_config: Option<SttConfig>,
    audio_buffer: Vec<u8>,
    client: reqwest::Client,
}

impl VolcengineStandardProvider {
    pub fn new() -> Self {
        Self {
            stt_config: None,
            audio_buffer: Vec::new(),
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl SttProvider for VolcengineFlashProvider {
    async fn connect(&mut self, config: &SttConfig) -> Result<()> {
        if config.api_key.is_empty() {
            anyhow::bail!("Volcengine Flash ASR API key is empty");
        }
        self.stt_config = Some(config.clone());
        self.audio_buffer.clear();
        tracing::info!("Volcengine Flash ASR provider ready (buffering mode)");
        Ok(())
    }

    async fn send_audio(&mut self, chunk: &[u8]) -> Result<()> {
        if self.audio_buffer.len() + chunk.len() > MAX_AUDIO_BYTES {
            anyhow::bail!("Volcengine Flash ASR: audio exceeds maximum length");
        }
        self.audio_buffer.extend_from_slice(chunk);
        Ok(())
    }

    async fn recv_transcript(&mut self) -> Result<Option<TranscriptEvent>> {
        Ok(None)
    }

    async fn disconnect(&mut self) -> Result<Option<String>> {
        let config = match &self.stt_config {
            Some(c) => c.clone(),
            None => return Ok(None),
        };

        if self.audio_buffer.is_empty() {
            tracing::info!("Volcengine Flash ASR: no audio buffered, skipping");
            return Ok(None);
        }

        let audio_len_secs = self.audio_buffer.len() as f64 / (config.sample_rate as f64 * 2.0);
        let wav_data = WhisperCompatProvider::build_wav(&self.audio_buffer, config.sample_rate);
        self.audio_buffer.clear();

        let body = serde_json::json!({
            "user": { "uid": "voiceslate-local" },
            "audio": { "data": STANDARD.encode(wav_data) },
            "request": {
                "model_name": "bigmodel",
                "enable_itn": true,
                "enable_punc": true,
                "enable_ddc": true
            }
        });

        tracing::info!(
            "Volcengine Flash ASR: sending {:.1}s of audio for transcription",
            audio_len_secs
        );

        let resp = self
            .client
            .post(VOLCENGINE_FLASH_ENDPOINT)
            .header("Content-Type", "application/json")
            .header("X-Api-Key", &config.api_key)
            .header("X-Api-Resource-Id", VOLCENGINE_RESOURCE_ID)
            .header("X-Api-Request-Id", uuid::Uuid::new_v4().to_string())
            .header("X-Api-Sequence", "-1")
            .json(&body)
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await?;

        let status = resp.status();
        let api_status = resp
            .headers()
            .get("X-Api-Status-Code")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let api_message = resp
            .headers()
            .get("X-Api-Message")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let body_text = resp.text().await?;

        if !status.is_success() {
            anyhow::bail!(
                "Volcengine Flash ASR error ({} / {}): {}",
                status,
                api_status,
                api_message
            );
        }

        let value: serde_json::Value = serde_json::from_str(&body_text)?;
        let text = value["result"]["text"]
            .as_str()
            .unwrap_or("")
            .trim()
            .to_string();

        tracing::info!(
            "Volcengine Flash ASR transcription: {} chars, api_status={}, message={}",
            text.len(),
            api_status,
            api_message
        );

        if text.is_empty() {
            Ok(None)
        } else {
            Ok(Some(text))
        }
    }

    fn name(&self) -> &str {
        "Volcengine Flash ASR"
    }
}

#[async_trait]
impl SttProvider for VolcengineStandardProvider {
    async fn connect(&mut self, config: &SttConfig) -> Result<()> {
        if config.api_key.is_empty() {
            anyhow::bail!("Volcengine Standard ASR API key is empty");
        }
        self.stt_config = Some(config.clone());
        self.audio_buffer.clear();
        tracing::info!("Volcengine Standard ASR provider ready (buffering mode)");
        Ok(())
    }

    async fn send_audio(&mut self, chunk: &[u8]) -> Result<()> {
        if self.audio_buffer.len() + chunk.len() > MAX_AUDIO_BYTES {
            anyhow::bail!("Volcengine Standard ASR: audio exceeds maximum length");
        }
        self.audio_buffer.extend_from_slice(chunk);
        Ok(())
    }

    async fn recv_transcript(&mut self) -> Result<Option<TranscriptEvent>> {
        Ok(None)
    }

    async fn disconnect(&mut self) -> Result<Option<String>> {
        let config = match &self.stt_config {
            Some(c) => c.clone(),
            None => return Ok(None),
        };

        if self.audio_buffer.is_empty() {
            tracing::info!("Volcengine Standard ASR: no audio buffered, skipping");
            return Ok(None);
        }

        let wav_data = WhisperCompatProvider::build_wav(&self.audio_buffer, config.sample_rate);
        self.audio_buffer.clear();
        let request_id = uuid::Uuid::new_v4().to_string();
        let submit_body = serde_json::json!({
            "user": { "uid": "voiceslate-local" },
            "audio": {
                "data": STANDARD.encode(wav_data),
                "format": "wav"
            },
            "request": {
                "model_name": "bigmodel",
                "enable_itn": true,
                "enable_punc": true,
                "enable_ddc": true,
                "enable_speaker_info": false,
                "enable_channel_split": false,
                "show_utterances": false,
                "vad_segment": false,
                "sensitive_words_filter": ""
            }
        });

        let submit_resp = self
            .client
            .post(VOLCENGINE_STANDARD_SUBMIT_ENDPOINT)
            .header("Content-Type", "application/json")
            .header("X-Api-Key", &config.api_key)
            .header("X-Api-Resource-Id", VOLCENGINE_STANDARD_RESOURCE_ID)
            .header("X-Api-Request-Id", &request_id)
            .header("X-Api-Sequence", "-1")
            .json(&submit_body)
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await?;

        let submit_status = submit_resp.status();
        let submit_text = submit_resp.text().await?;
        if !submit_status.is_success() {
            anyhow::bail!(
                "Volcengine Standard ASR submit error ({}): {}",
                submit_status,
                submit_text
            );
        }

        let submit_value: serde_json::Value = serde_json::from_str(&submit_text)?;
        let task_id = submit_value["id"]
            .as_str()
            .or_else(|| submit_value["task_id"].as_str())
            .unwrap_or(&request_id)
            .to_string();

        for _ in 0..40 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;

            let query_body = serde_json::json!({ "id": task_id });
            let query_resp = self
                .client
                .post(VOLCENGINE_STANDARD_QUERY_ENDPOINT)
                .header("Content-Type", "application/json")
                .header("X-Api-Key", &config.api_key)
                .header("X-Api-Resource-Id", VOLCENGINE_STANDARD_RESOURCE_ID)
                .header("X-Api-Request-Id", uuid::Uuid::new_v4().to_string())
                .header("X-Api-Sequence", "-1")
                .json(&query_body)
                .timeout(std::time::Duration::from_secs(30))
                .send()
                .await?;

            let query_status = query_resp.status();
            let query_text = query_resp.text().await?;
            if !query_status.is_success() {
                continue;
            }

            let query_value: serde_json::Value = match serde_json::from_str(&query_text) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let text = query_value["result"]["text"]
                .as_str()
                .unwrap_or("")
                .trim()
                .to_string();

            if !text.is_empty() {
                tracing::info!(
                    "Volcengine Standard ASR transcription: {} chars",
                    text.len()
                );
                return Ok(Some(text));
            }
        }

        Ok(None)
    }

    fn name(&self) -> &str {
        "Volcengine Standard ASR"
    }
}
