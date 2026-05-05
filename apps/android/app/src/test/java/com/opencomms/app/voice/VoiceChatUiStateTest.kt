package com.opencomms.app.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceChatUiStateTest {
    @Test
    fun controlsExposePushToTalkContinualMuteAndStopLabels() {
        val state = VoiceChatUiState.fromVoiceState(
            VoiceState(
                status = VoiceStatus.LISTENING,
                muted = false,
                continualArmed = true,
                continualConsented = true,
                partialTranscript = "hello"
            )
        )

        assertEquals("Listening…", state.statusLabel)
        assertEquals("Hold / tap to talk", state.pushToTalkLabel)
        assertEquals("Continual on", state.continualLabel)
        assertEquals("Mute mic", state.muteLabel)
        assertEquals("Stop voice", state.stopLabel)
        assertEquals("hello", state.partialTranscript)
        assertTrue(state.showPartialTranscript)
        assertTrue(state.continualEnabled)
        assertFalse(state.muted)
    }

    @Test
    fun mutedStateKeepsStopVisibleAndDoesNotClaimListening() {
        val state = VoiceChatUiState.fromVoiceState(
            VoiceState(status = VoiceStatus.MUTED, muted = true, continualArmed = true, continualConsented = true)
        )

        assertEquals("Muted", state.statusLabel)
        assertEquals("Unmute mic", state.muteLabel)
        assertEquals("Stop voice", state.stopLabel)
        assertTrue(state.continualEnabled)
        assertTrue(state.muted)
        assertFalse(state.showPartialTranscript)
    }
}
