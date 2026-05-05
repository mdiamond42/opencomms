package com.opencomms.app.voice

/**
 * Pure Kotlin state machine for the planned OpenComms voice v1 controller.
 *
 * This type intentionally has no Android SpeechRecognizer/TextToSpeech imports. Android integration should
 * translate platform callbacks into [VoiceEvent] values and execute returned [VoiceEffect] values in a later slice.
 */
class VoiceController(initialState: VoiceState = VoiceState()) {
    var state: VoiceState = initialState
        private set

    fun dispatch(event: VoiceEvent): VoiceTransition {
        val transition = reduce(state, event)
        state = transition.state
        return transition
    }

    companion object {
        fun reduce(state: VoiceState, event: VoiceEvent): VoiceTransition = when (event) {
            VoiceEvent.PttPress -> onPttPress(state)
            is VoiceEvent.RecognizerPartial -> onRecognizerPartial(state, event.text)
            is VoiceEvent.RecognizerFinal -> onRecognizerFinal(state, event.text)
            is VoiceEvent.RecognizerError -> error(state, event.reason)
            is VoiceEvent.ReplyReceived -> transition(
                state.copy(status = VoiceStatus.SPEAKING, errorReason = null),
                VoiceEffect.SpeakText(event.text),
            )
            VoiceEvent.TtsFinished -> onTtsFinished(state)
            is VoiceEvent.TtsError -> error(state, event.reason)
            VoiceEvent.Mute -> onMute(state)
            VoiceEvent.Unmute -> onUnmute(state)
            VoiceEvent.AppBackgrounded -> onAppBackgrounded(state)
            VoiceEvent.AudioFocusLost -> onAudioFocusLost(state)
            is VoiceEvent.EnableContinual -> onEnableContinual(state, event.consented)
            VoiceEvent.DisableContinual -> onDisableContinual(state)
            VoiceEvent.Stop -> onStop(state)
            VoiceEvent.BargeIn -> onPttPress(state)
            VoiceEvent.SilenceTimeout -> onSilenceTimeout(state)
        }

        private fun onPttPress(state: VoiceState): VoiceTransition = when (state.status) {
            VoiceStatus.SPEAKING -> transition(
                state.copy(status = VoiceStatus.LISTENING, partialTranscript = "", errorReason = null),
                VoiceEffect.StopTts,
                VoiceEffect.StartRecognition,
            )
            VoiceStatus.LISTENING -> transition(state)
            VoiceStatus.MUTED -> transition(state)
            else -> transition(
                state.copy(status = VoiceStatus.LISTENING, muted = false, partialTranscript = "", errorReason = null),
                VoiceEffect.StartRecognition,
            )
        }

        private fun onRecognizerPartial(state: VoiceState, text: String): VoiceTransition {
            if (state.status != VoiceStatus.LISTENING) return transition(state)
            return transition(state.copy(partialTranscript = text, errorReason = null))
        }

        private fun onRecognizerFinal(state: VoiceState, text: String): VoiceTransition {
            if (state.status != VoiceStatus.LISTENING) return transition(state)
            return transition(
                state.copy(status = VoiceStatus.THINKING, partialTranscript = "", errorReason = null),
                VoiceEffect.SendTranscript(text),
            )
        }

        private fun onTtsFinished(state: VoiceState): VoiceTransition = when {
            state.status != VoiceStatus.SPEAKING -> transition(state)
            state.continualArmed && state.continualConsented -> transition(
                state.copy(status = VoiceStatus.LISTENING, partialTranscript = "", errorReason = null),
                VoiceEffect.StartRecognition,
            )
            else -> transition(state.copy(status = VoiceStatus.IDLE, errorReason = null))
        }

        private fun onMute(state: VoiceState): VoiceTransition {
            return when (state.status) {
                VoiceStatus.LISTENING -> VoiceTransition(
                    state.copy(status = VoiceStatus.MUTED, muted = true, partialTranscript = "", errorReason = null),
                    listOf(VoiceEffect.CancelRecognition),
                )
                VoiceStatus.SPEAKING -> transition(state.copy(muted = true, partialTranscript = "", errorReason = null))
                else -> transition(state.copy(status = VoiceStatus.MUTED, muted = true, partialTranscript = "", errorReason = null))
            }
        }

        private fun onUnmute(state: VoiceState): VoiceTransition {
            if (!state.muted && state.status != VoiceStatus.MUTED) return transition(state)
            if (state.status == VoiceStatus.SPEAKING) return transition(state.copy(muted = false, errorReason = null))
            return if (state.continualArmed && state.continualConsented) {
                transition(
                    state.copy(status = VoiceStatus.LISTENING, muted = false, partialTranscript = "", errorReason = null),
                    VoiceEffect.StartRecognition,
                )
            } else {
                transition(state.copy(status = VoiceStatus.IDLE, muted = false, errorReason = null))
            }
        }

        private fun onAppBackgrounded(state: VoiceState): VoiceTransition {
            val effects = activeCancellationEffects(state)
            return VoiceTransition(
                state.copy(
                    status = VoiceStatus.IDLE,
                    continualArmed = false,
                    continualConsented = false,
                    partialTranscript = "",
                    errorReason = null,
                ),
                effects,
            )
        }

        private fun onAudioFocusLost(state: VoiceState): VoiceTransition {
            val effects = activeCancellationEffects(state)
            val nextStatus = if (state.continualArmed && state.continualConsented) VoiceStatus.PAUSED else VoiceStatus.IDLE
            return VoiceTransition(
                state.copy(status = nextStatus, partialTranscript = "", errorReason = null),
                effects,
            )
        }

        private fun onEnableContinual(state: VoiceState, consented: Boolean): VoiceTransition {
            if (!consented) return transition(state.copy(continualArmed = false), VoiceEffect.RequestContinualConsent)

            val armed = state.copy(continualArmed = true, continualConsented = true, errorReason = null)
            return if (armed.muted || armed.status == VoiceStatus.MUTED) {
                transition(armed)
            } else {
                transition(
                    armed.copy(status = VoiceStatus.LISTENING, partialTranscript = ""),
                    VoiceEffect.StartRecognition,
                )
            }
        }

        private fun onDisableContinual(state: VoiceState): VoiceTransition {
            val effects = activeCancellationEffects(state)
            return VoiceTransition(
                state.copy(
                    status = VoiceStatus.IDLE,
                    continualArmed = false,
                    continualConsented = false,
                    partialTranscript = "",
                    errorReason = null,
                ),
                effects,
            )
        }

        private fun onStop(state: VoiceState): VoiceTransition {
            val effects = activeCancellationEffects(state)
            return VoiceTransition(
                state.copy(
                    status = VoiceStatus.IDLE,
                    continualArmed = false,
                    continualConsented = false,
                    partialTranscript = "",
                    errorReason = null,
                ),
                effects,
            )
        }

        private fun onSilenceTimeout(state: VoiceState): VoiceTransition {
            if (!state.continualArmed || !state.continualConsented) return transition(state)
            return when (state.status) {
                VoiceStatus.LISTENING -> transition(
                    state.copy(status = VoiceStatus.PAUSED, partialTranscript = "", errorReason = null),
                    VoiceEffect.CancelRecognition,
                )
                VoiceStatus.SPEAKING -> transition(
                    state.copy(status = VoiceStatus.PAUSED, partialTranscript = "", errorReason = null),
                    VoiceEffect.StopTts,
                )
                else -> transition(state.copy(status = VoiceStatus.PAUSED, partialTranscript = "", errorReason = null))
            }
        }

        private fun error(state: VoiceState, reason: String): VoiceTransition = transition(
            state.copy(status = VoiceStatus.ERROR, partialTranscript = "", errorReason = reason),
        )

        private fun activeCancellationEffects(state: VoiceState): List<VoiceEffect> = when (state.status) {
            VoiceStatus.LISTENING -> listOf(VoiceEffect.CancelRecognition)
            VoiceStatus.SPEAKING -> listOf(VoiceEffect.StopTts)
            else -> emptyList()
        }

        private fun transition(state: VoiceState, vararg effects: VoiceEffect): VoiceTransition =
            VoiceTransition(state = state, effects = effects.toList())
    }
}

data class VoiceTransition(
    val state: VoiceState,
    val effects: List<VoiceEffect> = emptyList(),
)

data class VoiceState(
    val status: VoiceStatus = VoiceStatus.IDLE,
    val muted: Boolean = false,
    val continualArmed: Boolean = false,
    val continualConsented: Boolean = false,
    val partialTranscript: String = "",
    val errorReason: String? = null,
)

enum class VoiceStatus {
    IDLE,
    LISTENING,
    THINKING,
    SPEAKING,
    PAUSED,
    MUTED,
    ERROR,
}

sealed class VoiceEvent {
    object PttPress : VoiceEvent()
    data class RecognizerPartial(val text: String) : VoiceEvent()
    data class RecognizerFinal(val text: String) : VoiceEvent()
    data class RecognizerError(val reason: String) : VoiceEvent()
    data class ReplyReceived(val text: String) : VoiceEvent()
    object TtsFinished : VoiceEvent()
    data class TtsError(val reason: String) : VoiceEvent()
    object Mute : VoiceEvent()
    object Unmute : VoiceEvent()
    object AppBackgrounded : VoiceEvent()
    object AudioFocusLost : VoiceEvent()
    data class EnableContinual(val consented: Boolean) : VoiceEvent()
    object DisableContinual : VoiceEvent()
    object Stop : VoiceEvent()
    object BargeIn : VoiceEvent()
    object SilenceTimeout : VoiceEvent()
}

sealed class VoiceEffect {
    object StartRecognition : VoiceEffect()
    object CancelRecognition : VoiceEffect()
    data class SendTranscript(val text: String) : VoiceEffect()
    data class SpeakText(val text: String) : VoiceEffect()
    object StopTts : VoiceEffect()
    object RequestContinualConsent : VoiceEffect()
}
