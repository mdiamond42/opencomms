package com.opencomms.app.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceControllerTest {

    private fun controller(initialState: VoiceState = VoiceState()) = VoiceController(initialState)

    @Test
    fun idle_to_listening_on_ptt_press() {
        val result = controller().dispatch(VoiceEvent.PttPress)

        assertEquals(VoiceStatus.LISTENING, result.state.status)
        assertEquals(listOf(VoiceEffect.StartRecognition), result.effects)
    }

    @Test
    fun listening_to_thinking_on_recognizer_final_emits_send() {
        val voice = controller(VoiceState(status = VoiceStatus.LISTENING, partialTranscript = "hel"))

        val result = voice.dispatch(VoiceEvent.RecognizerFinal("hello"))

        assertEquals(VoiceStatus.THINKING, result.state.status)
        assertEquals("", result.state.partialTranscript)
        assertEquals(listOf(VoiceEffect.SendTranscript("hello")), result.effects)
    }

    @Test
    fun thinking_to_speaking_on_reply_received_emits_tts() {
        val voice = controller(VoiceState(status = VoiceStatus.THINKING))

        val result = voice.dispatch(VoiceEvent.ReplyReceived("agent reply"))

        assertEquals(VoiceStatus.SPEAKING, result.state.status)
        assertEquals(listOf(VoiceEffect.SpeakText("agent reply")), result.effects)
    }

    @Test
    fun speaking_to_listening_when_continual_armed_and_tts_finished() {
        val voice = controller(VoiceState(status = VoiceStatus.SPEAKING, continualArmed = true, continualConsented = true))

        val result = voice.dispatch(VoiceEvent.TtsFinished)

        assertEquals(VoiceStatus.LISTENING, result.state.status)
        assertTrue(result.state.continualArmed)
        assertEquals(listOf(VoiceEffect.StartRecognition), result.effects)
    }

    @Test
    fun speaking_to_idle_when_continual_disarmed_and_tts_finished() {
        val voice = controller(VoiceState(status = VoiceStatus.SPEAKING))

        val result = voice.dispatch(VoiceEvent.TtsFinished)

        assertEquals(VoiceStatus.IDLE, result.state.status)
        assertEquals(emptyList<VoiceEffect>(), result.effects)
    }

    @Test
    fun listening_to_muted_cancels_in_flight_recognition() {
        val voice = controller(VoiceState(status = VoiceStatus.LISTENING, partialTranscript = "draft"))

        val result = voice.dispatch(VoiceEvent.Mute)

        assertEquals(VoiceStatus.MUTED, result.state.status)
        assertEquals("", result.state.partialTranscript)
        assertEquals(listOf(VoiceEffect.CancelRecognition), result.effects)
    }

    @Test
    fun muted_does_not_open_mic_in_continual_loop() {
        val voice = controller(VoiceState(status = VoiceStatus.MUTED, continualArmed = true, continualConsented = true))

        val result = voice.dispatch(VoiceEvent.TtsFinished)

        assertEquals(VoiceStatus.MUTED, result.state.status)
        assertTrue(result.state.continualArmed)
        assertEquals(emptyList<VoiceEffect>(), result.effects)
    }

    @Test
    fun app_backgrounded_disarms_continual_mode() {
        val voice = controller(VoiceState(status = VoiceStatus.LISTENING, continualArmed = true, continualConsented = true))

        val result = voice.dispatch(VoiceEvent.AppBackgrounded)

        assertEquals(VoiceStatus.IDLE, result.state.status)
        assertEquals(false, result.state.continualArmed)
        assertEquals(false, result.state.continualConsented)
        assertEquals(listOf(VoiceEffect.CancelRecognition), result.effects)
    }

    @Test
    fun audio_focus_loss_pauses_continual_mode() {
        val voice = controller(VoiceState(status = VoiceStatus.SPEAKING, continualArmed = true, continualConsented = true))

        val result = voice.dispatch(VoiceEvent.AudioFocusLost)

        assertEquals(VoiceStatus.PAUSED, result.state.status)
        assertTrue(result.state.continualArmed)
        assertEquals(listOf(VoiceEffect.StopTts), result.effects)
    }

    @Test
    fun recognizer_no_match_returns_to_idle_without_error_for_push_to_talk() {
        val voice = controller(VoiceState(status = VoiceStatus.LISTENING, partialTranscript = "draft"))

        val result = voice.dispatch(VoiceEvent.RecognizerNoMatch)

        assertEquals(VoiceStatus.IDLE, result.state.status)
        assertEquals("", result.state.partialTranscript)
        assertEquals(null, result.state.errorReason)
        assertEquals(emptyList<VoiceEffect>(), result.effects)
    }

    @Test
    fun recognizer_no_match_restarts_listening_in_continual_mode() {
        val voice = controller(VoiceState(status = VoiceStatus.LISTENING, continualArmed = true, continualConsented = true))

        val result = voice.dispatch(VoiceEvent.RecognizerNoMatch)

        assertEquals(VoiceStatus.LISTENING, result.state.status)
        assertEquals(null, result.state.errorReason)
        assertEquals(listOf(VoiceEffect.StartRecognition), result.effects)
    }

    @Test
    fun android_recognizer_error_7_maps_to_no_match_event() {
        assertEquals(VoiceEvent.RecognizerNoMatch, VoiceEvent.fromRecognizerErrorCode(7))
    }

    @Test
    fun recognizer_error_transitions_to_error_state_with_reason() {
        val voice = controller(VoiceState(status = VoiceStatus.LISTENING))

        val result = voice.dispatch(VoiceEvent.RecognizerError("network unavailable"))

        assertEquals(VoiceStatus.ERROR, result.state.status)
        assertEquals("network unavailable", result.state.errorReason)
        assertEquals(emptyList<VoiceEffect>(), result.effects)
    }

    @Test
    fun tts_error_does_not_block_text_transcript_display() {
        val voice = controller(VoiceState(status = VoiceStatus.SPEAKING))

        val result = voice.dispatch(VoiceEvent.TtsError("missing voice data"))

        assertEquals(VoiceStatus.ERROR, result.state.status)
        assertEquals("missing voice data", result.state.errorReason)
        assertEquals(emptyList<VoiceEffect>(), result.effects)
    }

    @Test
    fun partial_results_never_trigger_send() {
        val voice = controller(VoiceState(status = VoiceStatus.LISTENING))

        val result = voice.dispatch(VoiceEvent.RecognizerPartial("draft only"))

        assertEquals(VoiceStatus.LISTENING, result.state.status)
        assertEquals("draft only", result.state.partialTranscript)
        assertTrue(result.effects.none { it is VoiceEffect.SendTranscript })
    }

    @Test
    fun mute_during_speaking_keeps_speaking_and_allows_tts_finish() {
        val voice = controller(VoiceState(status = VoiceStatus.SPEAKING))

        val muted = voice.dispatch(VoiceEvent.Mute)

        assertEquals(VoiceStatus.SPEAKING, muted.state.status)
        assertTrue(muted.state.muted)
        assertEquals(emptyList<VoiceEffect>(), muted.effects)

        val finished = voice.dispatch(VoiceEvent.TtsFinished)
        assertEquals(VoiceStatus.IDLE, finished.state.status)
        assertTrue(finished.state.muted)
    }

    @Test
    fun barge_in_tap_during_speaking_cancels_tts_and_opens_mic() {
        val voice = controller(VoiceState(status = VoiceStatus.SPEAKING))

        val result = voice.dispatch(VoiceEvent.PttPress)

        assertEquals(VoiceStatus.LISTENING, result.state.status)
        assertEquals(listOf(VoiceEffect.StopTts, VoiceEffect.StartRecognition), result.effects)
    }

    @Test
    fun consent_required_before_first_continual_enable_per_launch() {
        val voice = controller()

        val denied = voice.dispatch(VoiceEvent.EnableContinual(consented = false))
        assertEquals(VoiceStatus.IDLE, denied.state.status)
        assertEquals(false, denied.state.continualArmed)
        assertEquals(listOf(VoiceEffect.RequestContinualConsent), denied.effects)

        val enabled = voice.dispatch(VoiceEvent.EnableContinual(consented = true))
        assertEquals(VoiceStatus.LISTENING, enabled.state.status)
        assertTrue(enabled.state.continualArmed)
        assertTrue(enabled.state.continualConsented)
        assertEquals(listOf(VoiceEffect.StartRecognition), enabled.effects)
    }

    @Test
    fun thirty_seconds_silence_in_continual_mode_transitions_to_paused() {
        val voice = controller(VoiceState(status = VoiceStatus.LISTENING, continualArmed = true, continualConsented = true))

        val result = voice.dispatch(VoiceEvent.SilenceTimeout)

        assertEquals(VoiceStatus.PAUSED, result.state.status)
        assertTrue(result.state.continualArmed)
        assertEquals(listOf(VoiceEffect.CancelRecognition), result.effects)
    }

    @Test
    fun mute_then_unmute_in_continual_mode_reopens_mic() {
        val voice = controller(VoiceState(status = VoiceStatus.MUTED, continualArmed = true, continualConsented = true))

        val result = voice.dispatch(VoiceEvent.Unmute)

        assertEquals(VoiceStatus.LISTENING, result.state.status)
        assertEquals(listOf(VoiceEffect.StartRecognition), result.effects)
    }

    @Test
    fun stop_disarms_continual_and_cancels_active_io() {
        val voice = controller(VoiceState(status = VoiceStatus.SPEAKING, continualArmed = true, continualConsented = true, partialTranscript = "draft"))

        val result = voice.dispatch(VoiceEvent.Stop)

        assertEquals(VoiceStatus.IDLE, result.state.status)
        assertEquals(false, result.state.continualArmed)
        assertEquals(false, result.state.continualConsented)
        assertEquals("", result.state.partialTranscript)
        assertEquals(listOf(VoiceEffect.StopTts), result.effects)
    }
}
