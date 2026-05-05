package com.opencomms.app.voice

/**
 * Stable, testable labels/flags for the visible chat voice controls.
 */
data class VoiceChatUiState(
    val statusLabel: String,
    val pushToTalkLabel: String,
    val continualLabel: String,
    val muteLabel: String,
    val stopLabel: String,
    val partialTranscript: String,
    val showPartialTranscript: Boolean,
    val continualEnabled: Boolean,
    val muted: Boolean,
) {
    companion object {
        fun fromVoiceState(state: VoiceState): VoiceChatUiState = VoiceChatUiState(
            statusLabel = when (state.status) {
                VoiceStatus.IDLE -> "Voice ready"
                VoiceStatus.LISTENING -> "Listening…"
                VoiceStatus.THINKING -> "Waiting for reply…"
                VoiceStatus.SPEAKING -> if (state.muted) "Speaking · mic muted" else "Speaking…"
                VoiceStatus.PAUSED -> "Paused"
                VoiceStatus.MUTED -> "Muted"
                VoiceStatus.ERROR -> state.errorReason?.let { "Voice error: $it" } ?: "Voice error"
            },
            pushToTalkLabel = when (state.status) {
                VoiceStatus.SPEAKING -> "Barge in"
                else -> "Hold / tap to talk"
            },
            continualLabel = if (state.continualArmed && state.continualConsented) "Continual on" else "Continual off",
            muteLabel = if (state.muted || state.status == VoiceStatus.MUTED) "Unmute mic" else "Mute mic",
            stopLabel = "Stop voice",
            partialTranscript = state.partialTranscript,
            showPartialTranscript = state.partialTranscript.isNotBlank(),
            continualEnabled = state.continualArmed && state.continualConsented,
            muted = state.muted || state.status == VoiceStatus.MUTED,
        )
    }
}
