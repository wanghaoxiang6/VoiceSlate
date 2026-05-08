pub mod assemblyai;
pub mod cloud;
pub mod deepgram;
pub mod volcengine;
pub mod whisper_compat;

use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use volcengine::{VolcengineFlashProvider, VolcengineStandardProvider};
use whisper_compat::{WhisperCompatConfig, WhisperCompatProvider};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SttConfig {
    pub api_key: String,
    pub language: Option<String>,
    pub smart_format: bool,
    pub sample_rate: u32,
}

impl Default for SttConfig {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            language: None,
            smart_format: true,
            sample_rate: 16000,
        }
    }
}

#[derive(Debug, Clone)]
pub enum TranscriptEvent {
    Partial { text: String },
    Final { text: String, confidence: f32 },
    SpeechStarted,
    SpeechEnded,
    Error { message: String },
}

#[async_trait]
pub trait SttProvider: Send + Sync {
    async fn connect(&mut self, config: &SttConfig) -> Result<()>;
    async fn send_audio(&mut self, chunk: &[u8]) -> Result<()>;
    async fn recv_transcript(&mut self) -> Result<Option<TranscriptEvent>>;
    /// Disconnect and optionally return a final transcript (for file-based providers).
    async fn disconnect(&mut self) -> Result<Option<String>>;
    fn name(&self) -> &str;
}

pub fn create_provider(
    provider_name: &str,
    client: Option<reqwest::Client>,
) -> Box<dyn SttProvider> {
    let make = |cfg: WhisperCompatConfig| -> Box<dyn SttProvider> {
        match client {
            Some(ref c) => Box::new(WhisperCompatProvider::with_client(cfg, c.clone())),
            None => Box::new(WhisperCompatProvider::new(cfg)),
        }
    };
    match provider_name {
        "cloud" => {
            let api_base_url = crate::api_base_url();
            match client {
                Some(ref c) => Box::new(cloud::CloudSttProvider::with_client(
                    api_base_url,
                    c.clone(),
                )),
                None => Box::new(cloud::CloudSttProvider::new(api_base_url)),
            }
        }
        "assemblyai" => Box::new(assemblyai::AssemblyAiProvider::new()),
        "volcengine-flash" => Box::new(VolcengineFlashProvider::new()),
        "volcengine-standard" => Box::new(VolcengineStandardProvider::new()),
        "local-whisper" => make(WhisperCompatConfig {
            provider_name: "Local Whisper",
            endpoint: "http://127.0.0.1:8178/v1/audio/transcriptions",
            model: "base",
            extra_fields: &[],
        }),
        "glm-asr" => make(WhisperCompatConfig {
            provider_name: "GLM-ASR",
            endpoint: "https://open.bigmodel.cn/api/paas/v4/audio/transcriptions",
            model: "glm-asr-2512",
            extra_fields: &[("stream", "false")],
        }),
        "openai-whisper" => make(WhisperCompatConfig {
            provider_name: "OpenAI Whisper",
            endpoint: "https://api.openai.com/v1/audio/transcriptions",
            model: "whisper-1",
            extra_fields: &[],
        }),
        "groq-whisper" => make(WhisperCompatConfig {
            provider_name: "Groq Whisper",
            endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
            model: "whisper-large-v3-turbo",
            extra_fields: &[],
        }),
        "siliconflow" => make(WhisperCompatConfig {
            provider_name: "SiliconFlow",
            endpoint: "https://api.siliconflow.cn/v1/audio/transcriptions",
            model: "FunAudioLLM/SenseVoiceSmall",
            extra_fields: &[],
        }),
        _ => make(WhisperCompatConfig {
            provider_name: "GLM-ASR",
            endpoint: "https://open.bigmodel.cn/api/paas/v4/audio/transcriptions",
            model: "glm-asr-2512",
            extra_fields: &[("stream", "false")],
        }),
    }
}
