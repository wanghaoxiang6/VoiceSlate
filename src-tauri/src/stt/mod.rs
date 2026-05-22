pub mod assemblyai;
pub mod cloud;
pub mod deepgram;
pub mod volcengine;
pub mod whisper_compat;

use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

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
    let backend = |provider: &'static str, label: &'static str, model: &'static str| {
        make(WhisperCompatConfig {
            provider_name: label,
            endpoint: match provider {
                "local-whisper" => "http://127.0.0.1:8788/api/proxy/stt?provider=local-whisper",
                "cloud-opus" => "http://127.0.0.1:8788/api/proxy/stt?provider=cloud-opus",
                "volcengine-flash" => {
                    "http://127.0.0.1:8788/api/proxy/stt?provider=volcengine-flash"
                }
                "volcengine-standard" => {
                    "http://127.0.0.1:8788/api/proxy/stt?provider=volcengine-standard"
                }
                "glm-asr" => "http://127.0.0.1:8788/api/proxy/stt?provider=glm-asr",
                "openai-whisper" => "http://127.0.0.1:8788/api/proxy/stt?provider=openai-whisper",
                "groq-whisper" => "http://127.0.0.1:8788/api/proxy/stt?provider=groq-whisper",
                "siliconflow" => "http://127.0.0.1:8788/api/proxy/stt?provider=siliconflow",
                _ => "http://127.0.0.1:8788/api/proxy/stt?provider=cloud-opus",
            },
            model,
            extra_fields: &[],
        })
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
        "volcengine-flash" => backend("volcengine-flash", "Volcengine Flash", "base"),
        "volcengine-standard" => backend("volcengine-standard", "Volcengine Standard", "base"),
        "local-whisper" => {
            let local_client = reqwest::Client::builder()
                .no_proxy()
                .build()
                .unwrap_or_else(|err| {
                    tracing::warn!("Failed to build no-proxy Local Whisper client: {}", err);
                    reqwest::Client::new()
                });
            Box::new(WhisperCompatProvider::with_client(
                WhisperCompatConfig {
                    provider_name: "Local Whisper",
                    endpoint: "http://127.0.0.1:8788/api/proxy/stt",
                    model: "base",
                    extra_fields: &[],
                },
                local_client,
            ))
        }
        "cloud-opus" => backend("cloud-opus", "Cloud Opus", "default"),
        "glm-asr" => backend("glm-asr", "GLM-ASR", "glm-asr-2512"),
        "openai-whisper" => backend("openai-whisper", "OpenAI Whisper", "whisper-1"),
        "groq-whisper" => backend("groq-whisper", "Groq Whisper", "whisper-large-v3-turbo"),
        "siliconflow" => backend("siliconflow", "SiliconFlow", "FunAudioLLM/SenseVoiceSmall"),
        _ => backend("cloud-opus", "Cloud Opus", "default"),
    }
}
