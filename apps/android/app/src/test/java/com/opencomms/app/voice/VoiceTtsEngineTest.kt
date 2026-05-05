package com.opencomms.app.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceTtsEngineTest {
    @Test
    fun samsungEngineIsPreferredWhenInstalled() {
        val engines = listOf(
            VoiceTtsEngine(packageName = "com.google.android.tts", label = "Speech Services by Google"),
            VoiceTtsEngine(packageName = "com.samsung.SMT", label = "Samsung Text-to-speech"),
        )

        val preferred = VoiceTtsEnginePreference.preferredSamsungOrDefault(engines)

        assertEquals("com.samsung.SMT", preferred.packageName)
        assertEquals("Samsung Text-to-speech", preferred.label)
    }

    @Test
    fun selectedMissingNonSamsungEngineFallsBackToSystemDefault() {
        val engines = listOf(VoiceTtsEngine(packageName = "com.google.android.tts", label = "Google"))

        val selected = VoiceTtsEnginePreference.resolveSelectedEngine("com.acme.missing", engines)

        assertNull(selected)
    }

    @Test
    fun selectedSamsungEngineCanResolveToForcedOptionWhenNotListed() {
        val engines = listOf(VoiceTtsEngine(packageName = "com.google.android.tts", label = "Google"))

        val selected = VoiceTtsEnginePreference.resolveSelectedEngine("com.samsung.SMT", engines)

        assertEquals("com.samsung.SMT", selected?.packageName)
        assertEquals("Samsung Text-to-speech (force)", selected?.label)
    }

    @Test
    fun availableOptionsPutSystemDefaultFirstThenSamsungWhenInstalled() {
        val engines = listOf(
            VoiceTtsEngine("com.acme.tts", "Acme Voice"),
            VoiceTtsEngine("com.google.android.tts", "Speech Services by Google"),
            VoiceTtsEngine("com.samsung.SMT", "Samsung Text-to-speech"),
        )

        val options = VoiceTtsEnginePreference.options(engines)

        assertNull(options[0].packageName)
        assertEquals("System default", options[0].label)
        assertEquals("com.samsung.SMT", options[1].packageName)
        assertTrue(options.any { it.packageName == "com.google.android.tts" })
    }

    @Test
    fun samsungForcedOptionCanBeAddedWhenPackageDetectedOutsideEngineList() {
        val engines = listOf(VoiceTtsEngine("com.google.android.tts", "Speech Services by Google"))

        val options = VoiceTtsEnginePreference.options(engines, includeSamsungFallback = true)

        assertEquals("com.samsung.SMT", options[1].packageName)
        assertEquals("Samsung Text-to-speech (force)", options[1].label)
    }

    @Test
    fun samsungForcedOptionIsNotDuplicatedWhenEngineListAlreadyContainsSamsung() {
        val engines = listOf(VoiceTtsEngine("com.samsung.SMT", "Android TTS"))

        val options = VoiceTtsEnginePreference.options(engines, includeSamsungFallback = true)

        assertEquals(1, options.count { it.packageName == "com.samsung.SMT" })
        assertEquals("Android TTS", options.first { it.packageName == "com.samsung.SMT" }.label)
    }

    @Test
    fun samsungVoiceOptionsAreLimitedToSamsungEngineAndSortedForSettings() {
        val voices = listOf(
            VoiceTtsVoice(name = "ko-KR-language", label = "Korean", localeTag = "ko-KR", enginePackageName = "com.samsung.SMT"),
            VoiceTtsVoice(name = "en-US-language", label = "English (United States)", localeTag = "en-US", enginePackageName = "com.samsung.SMT"),
            VoiceTtsVoice(name = "en-us-x-google", label = "Google US", localeTag = "en-US", enginePackageName = "com.google.android.tts"),
        )

        val options = VoiceTtsVoicePreference.options("com.samsung.SMT", voices)

        assertEquals("Use Android TTS settings voice", options[0].label)
        assertEquals(listOf(null, "en-US-language", "ko-KR-language"), options.map { it.name })
    }

    @Test
    fun selectedMissingVoiceFallsBackToEngineDefault() {
        val voices = listOf(
            VoiceTtsVoice(name = "en-US-language", label = "English (United States)", localeTag = "en-US", enginePackageName = "com.samsung.SMT"),
        )

        val selected = VoiceTtsVoicePreference.resolveSelectedVoice("missing", "com.samsung.SMT", voices)

        assertNull(selected)
    }
}
