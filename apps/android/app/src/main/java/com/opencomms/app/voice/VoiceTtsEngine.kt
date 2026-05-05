package com.opencomms.app.voice

const val SAMSUNG_TTS_ENGINE = "com.samsung.SMT"
const val VOICE_TTS_ENGINE_PREF_KEY = "voice_tts_engine_package"
const val VOICE_TTS_VOICE_PREF_KEY = "voice_tts_voice_name"

data class VoiceTtsEngine(
    val packageName: String?,
    val label: String,
)

data class VoiceTtsVoice(
    val name: String?,
    val label: String,
    val localeTag: String?,
    val enginePackageName: String?,
)

object VoiceTtsEnginePreference {
    fun options(
        installedEngines: List<VoiceTtsEngine>,
        includeSamsungFallback: Boolean = false,
    ): List<VoiceTtsEngine> {
        val samsung = installedEngines.firstOrNull { it.packageName == SAMSUNG_TTS_ENGINE }
            ?: if (includeSamsungFallback) VoiceTtsEngine(packageName = SAMSUNG_TTS_ENGINE, label = "Samsung Text-to-speech (force)") else null
        val others = installedEngines
            .filterNot { it.packageName == SAMSUNG_TTS_ENGINE }
            .sortedBy { it.label.lowercase() }
        return listOfNotNull(
            VoiceTtsEngine(packageName = null, label = "System default"),
            samsung,
        ) + others
    }

    fun resolveSelectedEngine(selectedPackage: String?, installedEngines: List<VoiceTtsEngine>): VoiceTtsEngine? {
        if (selectedPackage.isNullOrBlank()) return null
        return installedEngines.firstOrNull { it.packageName == selectedPackage }
            ?: if (selectedPackage == SAMSUNG_TTS_ENGINE) VoiceTtsEngine(packageName = SAMSUNG_TTS_ENGINE, label = "Samsung Text-to-speech (force)") else null
    }

    fun preferredSamsungOrDefault(installedEngines: List<VoiceTtsEngine>): VoiceTtsEngine =
        installedEngines.firstOrNull { it.packageName == SAMSUNG_TTS_ENGINE }
            ?: VoiceTtsEngine(packageName = null, label = "System default")
}

object VoiceTtsVoicePreference {
    fun options(selectedEnginePackage: String?, availableVoices: List<VoiceTtsVoice>): List<VoiceTtsVoice> {
        val engineVoices = availableVoices
            .filter { selectedEnginePackage == null || it.enginePackageName == selectedEnginePackage }
            .sortedWith(compareBy<VoiceTtsVoice> { it.localeTag ?: "" }.thenBy { it.label.lowercase() })
        return listOf(VoiceTtsVoice(name = null, label = "Use Android TTS settings voice", localeTag = null, enginePackageName = selectedEnginePackage)) + engineVoices
    }

    fun resolveSelectedVoice(
        selectedVoiceName: String?,
        selectedEnginePackage: String?,
        availableVoices: List<VoiceTtsVoice>
    ): VoiceTtsVoice? {
        if (selectedVoiceName.isNullOrBlank()) return null
        return options(selectedEnginePackage, availableVoices).firstOrNull { it.name == selectedVoiceName }
    }
}
