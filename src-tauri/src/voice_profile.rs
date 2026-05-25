use anyhow::{Context, Result};
use serde::Serialize;
use std::path::PathBuf;

use crate::storage::AppConfig;
use crate::stt::whisper_compat::WhisperCompatProvider;

const DEFAULT_SAMPLE_RATE: u32 = 16_000;

#[derive(Debug, Clone)]
pub struct VoiceProfileCandidate {
    pub pcm: Vec<u8>,
    pub raw_text: String,
    pub final_text: String,
    pub duration_ms: Option<i64>,
    pub stt_provider: String,
    pub llm_provider: String,
    pub app_name: String,
    pub app_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct VoiceProfileQuality {
    pub duration_seconds: f32,
    pub sample_rate: u32,
    pub channels: u16,
    pub rms: f32,
    pub peak: f32,
    pub estimated_silence_ratio: f32,
    pub clipping_ratio: f32,
    pub quality_score: f32,
    pub accepted: bool,
    pub reject_reason: Option<String>,
}

#[derive(Debug, Serialize)]
struct VoiceProfileTask<'a> {
    id: String,
    created_at: String,
    source: &'static str,
    audio_path: String,
    transcript: &'a str,
    raw_text: &'a str,
    language: &'static str,
    scene: &'static str,
    duration_seconds: f32,
    quality: VoiceProfileQuality,
    stt_provider: &'a str,
    llm_provider: &'a str,
    app_name: &'a str,
    app_type: &'a str,
    speaker_embedding: PendingAnalysis,
    emotion: PendingAnalysis,
}

#[derive(Debug, Serialize)]
struct PendingAnalysis {
    status: &'static str,
    provider_slot: &'static str,
}

pub fn default_inbox_dir() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("com.voiceslate.app")
        .join("voice-profile-slot")
        .join("inbox")
}

pub fn resolve_inbox_dir(config: &AppConfig) -> PathBuf {
    let configured = config.voice_profile_inbox_dir.trim();
    if configured.is_empty() {
        default_inbox_dir()
    } else {
        PathBuf::from(configured)
    }
}

pub fn enqueue_candidate(config: &AppConfig, candidate: VoiceProfileCandidate) -> Result<()> {
    if !config.voice_profile_enabled {
        return Ok(());
    }

    let quality = analyze_pcm_quality(
        &candidate.pcm,
        DEFAULT_SAMPLE_RATE,
        config.voice_profile_min_duration_seconds,
        config.voice_profile_min_quality_score,
    );
    if !quality.accepted {
        tracing::info!(
            "Voice profile candidate rejected: reason={:?}, duration_s={:.2}, score={:.2}",
            quality.reject_reason,
            quality.duration_seconds,
            quality.quality_score
        );
        return Ok(());
    }

    let inbox_dir = resolve_inbox_dir(config);
    std::fs::create_dir_all(&inbox_dir).with_context(|| {
        format!(
            "Failed to create voice profile inbox {}",
            inbox_dir.display()
        )
    })?;

    let id = uuid::Uuid::new_v4().to_string();
    let wav_path = inbox_dir.join(format!("{id}.wav"));
    let task_path = inbox_dir.join(format!("{id}.json"));
    let wav = WhisperCompatProvider::build_wav(&candidate.pcm, DEFAULT_SAMPLE_RATE);
    std::fs::write(&wav_path, wav)
        .with_context(|| format!("Failed to write voice profile audio {}", wav_path.display()))?;

    let task = VoiceProfileTask {
        id,
        created_at: chrono::Local::now().to_rfc3339(),
        source: "voiceslate",
        audio_path: wav_path.to_string_lossy().to_string(),
        transcript: &candidate.final_text,
        raw_text: &candidate.raw_text,
        language: "zh",
        scene: "dictation",
        duration_seconds: quality.duration_seconds,
        quality,
        stt_provider: &candidate.stt_provider,
        llm_provider: &candidate.llm_provider,
        app_name: &candidate.app_name,
        app_type: &candidate.app_type,
        speaker_embedding: PendingAnalysis {
            status: "pending",
            provider_slot: "speaker_embedding",
        },
        emotion: PendingAnalysis {
            status: "pending",
            provider_slot: "emotion_recognition",
        },
    };
    let json = serde_json::to_vec_pretty(&task)?;
    std::fs::write(&task_path, json)
        .with_context(|| format!("Failed to write voice profile task {}", task_path.display()))?;

    tracing::info!("Voice profile candidate queued: {}", task_path.display());
    Ok(())
}

pub fn analyze_pcm_quality(
    pcm: &[u8],
    sample_rate: u32,
    min_duration_seconds: f32,
    min_quality_score: f32,
) -> VoiceProfileQuality {
    let sample_count = pcm.len() / 2;
    let duration_seconds = sample_count as f32 / sample_rate as f32;
    let mut peak = 0.0f32;
    let mut sum_squares = 0.0f64;
    let mut silent = 0usize;
    let mut clipped = 0usize;

    for chunk in pcm.chunks_exact(2) {
        let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
        let amp = (sample as f32 / i16::MAX as f32).abs();
        peak = peak.max(amp);
        sum_squares += (amp as f64) * (amp as f64);
        if amp < 0.01 {
            silent += 1;
        }
        if amp >= 0.98 {
            clipped += 1;
        }
    }

    let rms = if sample_count > 0 {
        (sum_squares / sample_count as f64).sqrt() as f32
    } else {
        0.0
    };
    let silence_ratio = if sample_count > 0 {
        silent as f32 / sample_count as f32
    } else {
        1.0
    };
    let clipping_ratio = if sample_count > 0 {
        clipped as f32 / sample_count as f32
    } else {
        1.0
    };

    let signal_score = (rms / 0.08).clamp(0.0, 1.0);
    let peak_score = (peak / 0.35).clamp(0.0, 1.0);
    let silence_score = (1.0 - silence_ratio).clamp(0.0, 1.0);
    let clipping_score = (1.0 - clipping_ratio * 20.0).clamp(0.0, 1.0);
    let quality_score = (signal_score * 0.35)
        + (peak_score * 0.25)
        + (silence_score * 0.25)
        + (clipping_score * 0.15);

    let reject_reason = if duration_seconds < min_duration_seconds {
        Some("too_short".to_string())
    } else if rms < 0.01 || peak < 0.03 {
        Some("too_quiet".to_string())
    } else if silence_ratio > 0.85 {
        Some("mostly_silence".to_string())
    } else if clipping_ratio > 0.02 {
        Some("clipping".to_string())
    } else if quality_score < min_quality_score {
        Some("low_quality_score".to_string())
    } else {
        None
    };

    VoiceProfileQuality {
        duration_seconds,
        sample_rate,
        channels: 1,
        rms,
        peak,
        estimated_silence_ratio: silence_ratio,
        clipping_ratio,
        quality_score,
        accepted: reject_reason.is_none(),
        reject_reason,
    }
}

#[cfg(test)]
mod tests {
    use super::analyze_pcm_quality;

    fn pcm_with_value(sample: i16, samples: usize) -> Vec<u8> {
        let mut out = Vec::with_capacity(samples * 2);
        for _ in 0..samples {
            out.extend_from_slice(&sample.to_le_bytes());
        }
        out
    }

    #[test]
    fn rejects_short_audio() {
        let pcm = pcm_with_value(6000, 16_000);
        let quality = analyze_pcm_quality(&pcm, 16_000, 3.0, 0.65);
        assert!(!quality.accepted);
        assert_eq!(quality.reject_reason.as_deref(), Some("too_short"));
    }

    #[test]
    fn accepts_clean_signal() {
        let pcm = pcm_with_value(6000, 16_000 * 4);
        let quality = analyze_pcm_quality(&pcm, 16_000, 3.0, 0.4);
        assert!(quality.accepted, "{quality:?}");
    }
}
