package com.opencomms.app.ui.settings

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.TextToSpeech.EngineInfo
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.opencomms.app.chat.TranscriptRepository
import com.opencomms.app.contacts.ContactRepository
import com.opencomms.app.diagnostics.DiagnosticsExporter
import com.opencomms.app.identity.IdentityRepository
import com.opencomms.app.relay.RelayAccountRepository
import com.opencomms.app.storage.PrefsStore
import com.opencomms.app.voice.SAMSUNG_TTS_ENGINE
import com.opencomms.app.voice.VOICE_TTS_ENGINE_PREF_KEY
import com.opencomms.app.voice.VOICE_TTS_VOICE_PREF_KEY
import com.opencomms.app.voice.VoiceTtsEngine
import com.opencomms.app.voice.VoiceTtsEnginePreference
import com.opencomms.app.voice.VoiceTtsVoice
import com.opencomms.app.voice.VoiceTtsVoicePreference

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onIdentityRegenerated: () -> Unit
) {
    val context = LocalContext.current
    val identityRepo = remember { IdentityRepository(context) }
    val contactRepo = remember { ContactRepository(context) }
    val accountRepo = remember { RelayAccountRepository(context) }
    val transcriptRepo = remember { TranscriptRepository(context) }

    var identity by remember { mutableStateOf(identityRepo.getOrCreate()) }
    var displayName by remember { mutableStateOf(identity.displayName) }
    var accounts by remember { mutableStateOf(accountRepo.getAll()) }
    var showRegenerateDialog by remember { mutableStateOf(false) }
    var showClearDialog by remember { mutableStateOf(false) }
    var showTtsEngineDialog by remember { mutableStateOf(false) }
    var showTtsVoiceDialog by remember { mutableStateOf(false) }
    var selectedTtsEnginePackage by remember { mutableStateOf(PrefsStore.getString(context, VOICE_TTS_ENGINE_PREF_KEY)) }
    var selectedTtsVoiceName by remember { mutableStateOf(PrefsStore.getString(context, VOICE_TTS_VOICE_PREF_KEY)) }
    var ttsEngineRestartNonce by remember { mutableIntStateOf(0) }
    var ttsReady by remember { mutableStateOf(false) }
    val textToSpeech = remember(context, selectedTtsEnginePackage, ttsEngineRestartNonce) {
        TextToSpeech(context, { status -> ttsReady = status == TextToSpeech.SUCCESS }, selectedTtsEnginePackage)
    }
    val installedTtsEngines = remember(textToSpeech, ttsReady) {
        textToSpeech.engines.map { it.toVoiceTtsEngine() }
    }
    val androidDefaultTtsEnginePackage = remember(textToSpeech, ttsReady) { textToSpeech.defaultEngine }
    val activeTtsEnginePackage = selectedTtsEnginePackage ?: androidDefaultTtsEnginePackage
    val availableTtsVoices = remember(textToSpeech, ttsReady, activeTtsEnginePackage) {
        textToSpeech.voices.orEmpty().map { voice ->
            VoiceTtsVoice(
                name = voice.name,
                label = voice.name,
                localeTag = voice.locale?.toLanguageTag(),
                enginePackageName = activeTtsEnginePackage
            )
        }
    }
    val samsungTtsPackageVisible = remember(context, installedTtsEngines, androidDefaultTtsEnginePackage) {
        installedTtsEngines.any { it.packageName == SAMSUNG_TTS_ENGINE } ||
            androidDefaultTtsEnginePackage == SAMSUNG_TTS_ENGINE ||
            isPackageInstalled(context, SAMSUNG_TTS_ENGINE)
    }
    val selectedTtsEngine = VoiceTtsEnginePreference.resolveSelectedEngine(selectedTtsEnginePackage, installedTtsEngines)
    val currentTtsEngineLabel = selectedTtsEngine?.let { engine ->
        "${engine.label} (${engine.packageName})"
    } ?: "System default (${androidDefaultTtsEnginePackage ?: "unknown"})"
    val samsungTtsEngine = VoiceTtsEnginePreference.options(installedTtsEngines, includeSamsungFallback = samsungTtsPackageVisible)
        .firstOrNull { it.packageName == SAMSUNG_TTS_ENGINE }
    val selectedTtsVoice = VoiceTtsVoicePreference.resolveSelectedVoice(selectedTtsVoiceName, activeTtsEnginePackage, availableTtsVoices)
    val currentTtsVoiceLabel = selectedTtsVoice?.label ?: "Android TTS settings voice"

    fun selectTtsEngine(engine: VoiceTtsEngine) {
        if (engine.packageName == null) {
            PrefsStore.remove(context, VOICE_TTS_ENGINE_PREF_KEY)
        } else {
            PrefsStore.putString(context, VOICE_TTS_ENGINE_PREF_KEY, engine.packageName)
        }
        selectedTtsEnginePackage = engine.packageName
        selectedTtsVoiceName = null
        PrefsStore.remove(context, VOICE_TTS_VOICE_PREF_KEY)
        ttsReady = false
        ttsEngineRestartNonce++
        showTtsEngineDialog = false
    }

    fun selectTtsVoice(voice: VoiceTtsVoice) {
        if (voice.name == null) {
            PrefsStore.remove(context, VOICE_TTS_VOICE_PREF_KEY)
        } else {
            PrefsStore.putString(context, VOICE_TTS_VOICE_PREF_KEY, voice.name)
        }
        selectedTtsVoiceName = voice.name
        showTtsVoiceDialog = false
    }

    fun applySelectedTtsVoice() {
        textToSpeech.voices.orEmpty().firstOrNull { it.name == selectedTtsVoiceName }?.let { textToSpeech.voice = it }
    }

    fun testTtsVoice() {
        if (ttsReady) {
            applySelectedTtsVoice()
            textToSpeech.speak("OpenComms voice test. OpenComms voice test ready.", TextToSpeech.QUEUE_FLUSH, Bundle(), "opencomms-settings-voice-test")
        }
    }

    fun openAndroidTtsSettings() {
        try {
            context.startActivity(Intent("com.android.settings.TTS_SETTINGS"))
        } catch (_: ActivityNotFoundException) {
            context.startActivity(Intent(android.provider.Settings.ACTION_SETTINGS))
        }
    }

    DisposableEffect(textToSpeech) {
        onDispose { textToSpeech.shutdown() }
    }

    if (showRegenerateDialog) {
        AlertDialog(
            onDismissRequest = { showRegenerateDialog = false },
            title = { Text("Regenerate identity?") },
            text = { Text("This will delete all contacts and transcripts. This cannot be undone.") },
            confirmButton = {
                TextButton(onClick = {
                    val contacts = contactRepo.getAll()
                    transcriptRepo.clearAll(contacts.map { it.id })
                    contactRepo.clear()
                    accountRepo.clear()
                    identityRepo.regenerate()
                    showRegenerateDialog = false
                    onIdentityRegenerated()
                }) { Text("Regenerate") }
            },
            dismissButton = {
                TextButton(onClick = { showRegenerateDialog = false }) { Text("Cancel") }
            }
        )
    }

    if (showClearDialog) {
        AlertDialog(
            onDismissRequest = { showClearDialog = false },
            title = { Text("Clear all local data?") },
            text = { Text("All contacts, transcripts, and identity will be deleted.") },
            confirmButton = {
                TextButton(onClick = {
                    PrefsStore.clearAll(context)
                    showClearDialog = false
                    onIdentityRegenerated()
                }) { Text("Clear") }
            },
            dismissButton = {
                TextButton(onClick = { showClearDialog = false }) { Text("Cancel") }
            }
        )
    }

    if (showTtsEngineDialog) {
        val engineOptions = VoiceTtsEnginePreference.options(installedTtsEngines, includeSamsungFallback = samsungTtsPackageVisible)
        AlertDialog(
            onDismissRequest = { showTtsEngineDialog = false },
            title = { Text("Voice engine") },
            text = {
                Column(
                    modifier = Modifier
                        .heightIn(max = 420.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        "Select Samsung TTS here to force OpenComms to use Samsung instead of Google.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    engineOptions.forEach { engine ->
                        TextButton(
                            onClick = { selectTtsEngine(engine) },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            RadioButton(
                                selected = selectedTtsEnginePackage == engine.packageName,
                                onClick = { selectTtsEngine(engine) }
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(engine.label)
                                engine.packageName?.let {
                                    Text(
                                        it,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { testTtsVoice() }) { Text("Test") }
            },
            dismissButton = {
                TextButton(onClick = { showTtsEngineDialog = false }) { Text("Done") }
            }
        )
    }

    if (showTtsVoiceDialog) {
        val voiceOptions = VoiceTtsVoicePreference.options(activeTtsEnginePackage, availableTtsVoices)
        AlertDialog(
            onDismissRequest = { showTtsVoiceDialog = false },
            title = { Text("Voice variant") },
            text = {
                Column(
                    modifier = Modifier
                        .heightIn(max = 420.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        "Your Android TTS settings voice may not appear in this list. Use Android TTS settings voice leaves the engine in control, so Samsung's selected Voice 2 can be used.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    voiceOptions.forEach { voice ->
                        TextButton(
                            onClick = { selectTtsVoice(voice) },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            RadioButton(
                                selected = selectedTtsVoiceName == voice.name,
                                onClick = { selectTtsVoice(voice) }
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(voice.label)
                                voice.localeTag?.let {
                                    Text(
                                        it,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { testTtsVoice() }) { Text("Test") }
            },
            dismissButton = {
                TextButton(onClick = { showTtsVoiceDialog = false }) { Text("Done") }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
        ) {
            Text("Local Identity", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(8.dp))

            OutlinedTextField(
                value = displayName,
                onValueChange = { displayName = it },
                label = { Text("Display name") },
                modifier = Modifier.fillMaxWidth(),
                trailingIcon = {
                    TextButton(onClick = {
                        identityRepo.updateDisplayName(displayName.ifBlank { "My Phone" })
                        identity = identityRepo.getOrCreate()
                    }) { Text("Save") }
                }
            )

            Spacer(modifier = Modifier.height(8.dp))
            Text("Human ID: ${identity.humanId}", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Device ID: ${identity.deviceId}", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)

            Spacer(modifier = Modifier.height(12.dp))
            OutlinedButton(
                onClick = { showRegenerateDialog = true },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
            ) { Text("Regenerate identity") }

            Spacer(modifier = Modifier.height(24.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            Text("Voice", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                "Current TTS engine: $currentTtsEngineLabel",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                "Current voice: $currentTtsVoiceLabel",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                "Android default engine package: ${androidDefaultTtsEnginePackage ?: "unknown"}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                "Detected engine packages: ${installedTtsEngines.mapNotNull { it.packageName }.ifEmpty { listOf("none") }.joinToString()}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (selectedTtsEnginePackage == SAMSUNG_TTS_ENGINE) {
                Text(
                    "Samsung TTS is selected for OpenComms replies.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary
                )
            } else if (samsungTtsEngine != null) {
                Text(
                    "Samsung TTS was found by package/default-engine check. Tap Use Samsung TTS to force package com.samsung.SMT, even if Android labels it as Android TTS.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary
                )
            } else {
                Text(
                    "Samsung TTS is not currently reported by Android. Enable/install Samsung TTS in Android text-to-speech settings first.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Button(
                    onClick = { samsungTtsEngine?.let { selectTtsEngine(it) } },
                    enabled = samsungTtsEngine != null,
                    modifier = Modifier.weight(1f)
                ) { Text("Use Samsung TTS") }
                OutlinedButton(
                    onClick = { showTtsEngineDialog = true },
                    modifier = Modifier.weight(1f)
                ) { Text("Choose engine") }
            }
            Spacer(modifier = Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedButton(
                    onClick = { showTtsVoiceDialog = true },
                    enabled = ttsReady && availableTtsVoices.isNotEmpty(),
                    modifier = Modifier.weight(1f)
                ) { Text("Choose voice") }
                OutlinedButton(
                    onClick = { testTtsVoice() },
                    enabled = ttsReady,
                    modifier = Modifier.weight(1f)
                ) { Text("Test voice") }
            }
            Spacer(modifier = Modifier.height(8.dp))
            TextButton(
                onClick = { openAndroidTtsSettings() },
                modifier = Modifier.fillMaxWidth()
            ) { Text("Android TTS settings") }

            Spacer(modifier = Modifier.height(24.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            Text("Relay Accounts", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(8.dp))
            if (accounts.isEmpty()) {
                Text("No relay accounts.", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                accounts.forEach { account ->
                    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                        Text(account.label ?: account.relayUrl, style = MaterialTheme.typography.bodyMedium)
                        Text(account.relayUrl, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        TextButton(onClick = {
                            accountRepo.remove(account.id)
                            accounts = accountRepo.getAll()
                        }) { Text("Remove", color = MaterialTheme.colorScheme.error) }
                    }
                    HorizontalDivider()
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            Text("Data", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedButton(
                onClick = { showClearDialog = true },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
            ) { Text("Clear local data") }

            Spacer(modifier = Modifier.height(8.dp))
            Button(
                onClick = {
                    val exporter = DiagnosticsExporter(context)
                    val file = exporter.export()
                    val intent = exporter.shareIntent(file)
                    context.startActivity(android.content.Intent.createChooser(intent, "Export diagnostics"))
                },
                modifier = Modifier.fillMaxWidth()
            ) { Text("Export diagnostics") }

            Spacer(modifier = Modifier.height(24.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            Text("About", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(8.dp))
            Text("OpenComms v0.1 — generic client", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private fun EngineInfo.toVoiceTtsEngine(): VoiceTtsEngine =
    VoiceTtsEngine(
        packageName = name,
        label = label?.takeIf { it.isNotBlank() } ?: name
    )

@Suppress("DEPRECATION")
private fun isPackageInstalled(context: Context, packageName: String): Boolean =
    try {
        context.packageManager.getPackageInfo(packageName, 0)
        true
    } catch (_: Exception) {
        false
    }
