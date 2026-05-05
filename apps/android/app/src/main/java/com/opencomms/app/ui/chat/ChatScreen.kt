package com.opencomms.app.ui.chat

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.opencomms.app.chat.ChatMessage
import com.opencomms.app.chat.ChatViewModel
import com.opencomms.app.chat.DeliveryState
import com.opencomms.app.chat.Direction
import com.opencomms.app.contacts.ContactRepository
import com.opencomms.app.relay.ClientState
import com.opencomms.app.ui.common.kindLabel
import com.opencomms.app.storage.PrefsStore
import com.opencomms.app.voice.VOICE_TTS_ENGINE_PREF_KEY
import com.opencomms.app.voice.VOICE_TTS_VOICE_PREF_KEY
import com.opencomms.app.voice.VoiceChatUiState
import com.opencomms.app.voice.VoiceController
import com.opencomms.app.voice.VoiceEffect
import com.opencomms.app.voice.VoiceEvent
import com.opencomms.app.voice.VoiceState
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    contactId: String,
    onBack: () -> Unit,
    viewModel: ChatViewModel = viewModel()
) {
    val context = LocalContext.current
    val contactRepo = remember { ContactRepository(context) }
    val contact = remember { contactRepo.getById(contactId) }

    LaunchedEffect(contactId) { viewModel.loadContact(contactId) }

    val messages by viewModel.messages.collectAsState()
    val clientState by viewModel.clientState.collectAsState()
    val listState = rememberLazyListState()
    var composerText by remember { mutableStateOf("") }
    var voiceState by remember { mutableStateOf(VoiceState()) }
    val voiceUi = VoiceChatUiState.fromVoiceState(voiceState)
    var voiceRepliesEnabled by remember { mutableStateOf(false) }
    var showContinualConsent by remember { mutableStateOf(false) }
    val selectedTtsEnginePackage = remember { PrefsStore.getString(context, VOICE_TTS_ENGINE_PREF_KEY) }
    val selectedTtsVoiceName = remember { PrefsStore.getString(context, VOICE_TTS_VOICE_PREF_KEY) }
    var permissionStartNonce by remember { mutableIntStateOf(0) }
    var pendingVoiceEventAfterPermission by remember { mutableStateOf<VoiceEvent?>(null) }
    var lastSpokenInboundId by remember(contactId) { mutableStateOf<String?>(null) }
    var inboundBaselineInitialized by remember(contactId) { mutableStateOf(false) }
    var ttsReady by remember { mutableStateOf(false) }
    val speechRecognizerAvailable = remember { SpeechRecognizer.isRecognitionAvailable(context) }
    val speechRecognizer = remember(context) {
        if (speechRecognizerAvailable) SpeechRecognizer.createSpeechRecognizer(context) else null
    }
    val mainHandler = remember { Handler(Looper.getMainLooper()) }
    val textToSpeech = remember(context, selectedTtsEnginePackage) {
        TextToSpeech(context, { status -> ttsReady = status == TextToSpeech.SUCCESS }, selectedTtsEnginePackage)
    }

    fun startRecognition() {
        if (!speechRecognizerAvailable || speechRecognizer == null) {
            voiceState = VoiceController.reduce(voiceState, VoiceEvent.RecognizerError("Speech recognition unavailable on this device")).state
            return
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak to OpenComms")
        }
        speechRecognizer.startListening(intent)
    }

    fun applyVoiceTransition(effects: List<VoiceEffect>, nextState: VoiceState) {
        voiceState = nextState
        effects.forEach { effect ->
            when (effect) {
                VoiceEffect.StartRecognition -> startRecognition()
                VoiceEffect.CancelRecognition -> speechRecognizer?.cancel()
                is VoiceEffect.SendTranscript -> {
                    voiceRepliesEnabled = true
                    viewModel.sendMessage(effect.text)
                }
                is VoiceEffect.SpeakText -> {
                    if (ttsReady) {
                        val selectedVoice = textToSpeech.voices.orEmpty().firstOrNull { it.name == selectedTtsVoiceName }
                        if (selectedVoice != null) {
                            textToSpeech.voice = selectedVoice
                        }
                        textToSpeech.speak(effect.text, TextToSpeech.QUEUE_FLUSH, Bundle(), "opencomms-reply-${effect.text.hashCode()}")
                    } else {
                        voiceState = VoiceController.reduce(nextState, VoiceEvent.TtsError("Text to speech not ready")).state
                    }
                }
                VoiceEffect.StopTts -> textToSpeech.stop()
                VoiceEffect.RequestContinualConsent -> showContinualConsent = true
            }
        }
    }

    fun dispatchVoice(event: VoiceEvent) {
        val transition = VoiceController.reduce(voiceState, event)
        applyVoiceTransition(transition.effects, transition.state)
    }

    val recordAudioLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) permissionStartNonce++ else dispatchVoice(VoiceEvent.RecognizerError("Microphone permission denied"))
    }

    fun hasRecordAudioPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    fun dispatchOrRequestAudioPermission(event: VoiceEvent) {
        voiceRepliesEnabled = true
        if (hasRecordAudioPermission()) {
            dispatchVoice(event)
        } else {
            pendingVoiceEventAfterPermission = event
            recordAudioLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    fun startVoiceOrRequestPermission() {
        dispatchOrRequestAudioPermission(VoiceEvent.PttPress)
    }

    DisposableEffect(speechRecognizer, textToSpeech) {
        speechRecognizer?.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = Unit
            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit
            override fun onEvent(eventType: Int, params: Bundle?) = Unit
            override fun onPartialResults(partialResults: Bundle?) {
                val partial = partialResults
                    ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull()
                    .orEmpty()
                if (partial.isNotBlank()) dispatchVoice(VoiceEvent.RecognizerPartial(partial))
            }
            override fun onResults(results: Bundle?) {
                val finalText = results
                    ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull()
                    .orEmpty()
                if (finalText.isNotBlank()) dispatchVoice(VoiceEvent.RecognizerFinal(finalText))
            }
            override fun onError(error: Int) {
                dispatchVoice(VoiceEvent.fromRecognizerErrorCode(error))
            }
        })
        textToSpeech.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit
            override fun onDone(utteranceId: String?) { mainHandler.post { dispatchVoice(VoiceEvent.TtsFinished) } }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) { mainHandler.post { dispatchVoice(VoiceEvent.TtsError("Text to speech failed")) } }
        })
        onDispose {
            speechRecognizer?.destroy()
            textToSpeech.stop()
            textToSpeech.shutdown()
        }
    }

    LaunchedEffect(permissionStartNonce) {
        if (permissionStartNonce > 0) {
            val pending = pendingVoiceEventAfterPermission ?: VoiceEvent.PttPress
            pendingVoiceEventAfterPermission = null
            dispatchVoice(pending)
        }
    }

    LaunchedEffect(messages.size, voiceRepliesEnabled) {
        val latestInbound = messages.lastOrNull { it.direction == Direction.INBOUND && it.deliveryState == DeliveryState.DELIVERED }
        if (!inboundBaselineInitialized && !voiceRepliesEnabled) {
            lastSpokenInboundId = latestInbound?.id
            inboundBaselineInitialized = true
            return@LaunchedEffect
        }
        inboundBaselineInitialized = true
        if (voiceRepliesEnabled && latestInbound != null && latestInbound.id != lastSpokenInboundId) {
            lastSpokenInboundId = latestInbound.id
            dispatchVoice(VoiceEvent.ReplyReceived(latestInbound.text))
        } else if (!voiceRepliesEnabled) {
            lastSpokenInboundId = latestInbound?.id
        }
    }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
    }

    if (showContinualConsent) {
        AlertDialog(
            onDismissRequest = { showContinualConsent = false },
            title = { Text("Enable continual voice?") },
            text = { Text("OpenComms will visibly listen again after each spoken reply until you tap Stop or mute. Android speech recognition may use your device provider; OpenComms does not store cloud transcripts.") },
            confirmButton = {
                TextButton(onClick = {
                    showContinualConsent = false
                    voiceRepliesEnabled = true
                    dispatchOrRequestAudioPermission(VoiceEvent.EnableContinual(consented = true))
                }) { Text("Enable") }
            },
            dismissButton = {
                TextButton(onClick = {
                    showContinualConsent = false
                }) { Text("Cancel") }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(contact?.displayName ?: contactId)
                        contact?.kind?.let { kind ->
                            Text(
                                kindLabel(kind),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    ConnectionChip(clientState)
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(8.dp)
            ) {
                items(messages, key = { it.id }) { message ->
                    MessageBubble(
                        message = message,
                        onRetry = { viewModel.retryMessage(message.id) }
                    )
                }
            }

            VoiceControlsRow(
                state = voiceUi,
                onPushToTalk = { startVoiceOrRequestPermission() },
                onToggleContinual = {
                    if (voiceUi.continualEnabled) {
                        dispatchVoice(VoiceEvent.DisableContinual)
                    } else {
                        showContinualConsent = true
                    }
                },
                onToggleMute = {
                    if (voiceUi.muted) dispatchVoice(VoiceEvent.Unmute) else dispatchVoice(VoiceEvent.Mute)
                },
                onStop = {
                    voiceRepliesEnabled = false
                    dispatchVoice(VoiceEvent.Stop)
                }
            )

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = composerText,
                    onValueChange = { composerText = it },
                    placeholder = { Text("Message…") },
                    modifier = Modifier.weight(1f),
                    enabled = true,
                    singleLine = false,
                    maxLines = 4
                )
                Spacer(modifier = Modifier.width(8.dp))
                IconButton(
                    onClick = {
                        if (composerText.isNotBlank()) {
                            viewModel.sendMessage(composerText.trim())
                            composerText = ""
                        }
                    },
                    enabled = composerText.isNotBlank()
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send")
                }
            }
        }
    }
}

@Composable
private fun VoiceControlsRow(
    state: VoiceChatUiState,
    onPushToTalk: () -> Unit,
    onToggleContinual: () -> Unit,
    onToggleMute: () -> Unit,
    onStop: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            TextButton(onClick = onPushToTalk) {
                Icon(Icons.Default.Mic, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(4.dp))
                Text(state.pushToTalkLabel)
            }
            TextButton(onClick = onToggleContinual) { Text(state.continualLabel) }
            IconButton(onClick = onToggleMute) {
                Icon(
                    if (state.muted) Icons.Default.MicOff else Icons.Default.Mic,
                    contentDescription = state.muteLabel
                )
            }
            IconButton(onClick = onStop) {
                Icon(Icons.Default.Stop, contentDescription = state.stopLabel)
            }
        }
        Text(
            text = state.statusLabel,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        if (state.showPartialTranscript) {
            Text(
                text = "Heard: ${state.partialTranscript}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}

@Composable
private fun ConnectionChip(state: ClientState) {
    val (label, color) = when (state) {
        is ClientState.Idle -> "Idle" to Color.Gray
        is ClientState.Connecting -> "Connecting…" to Color(0xFFFFA000)
        is ClientState.SocketOpenAwaitingRegister -> "Registering…" to Color(0xFFFFA000)
        is ClientState.Registered -> "Connected" to Color(0xFF388E3C)
        is ClientState.Disconnected -> "Disconnected" to Color.Gray
        is ClientState.Error -> "Error" to MaterialTheme.colorScheme.error
    }
    FilterChip(
        selected = state is ClientState.Registered,
        onClick = {},
        label = { Text(label, style = MaterialTheme.typography.labelSmall) },
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = color.copy(alpha = 0.15f),
            selectedLabelColor = color
        ),
        modifier = Modifier.padding(end = 8.dp)
    )
}

@Composable
private fun MessageBubble(message: ChatMessage, onRetry: () -> Unit) {
    val isOutbound = message.direction == Direction.OUTBOUND
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isOutbound) Arrangement.End else Arrangement.Start
    ) {
        Box(
            modifier = Modifier
                .widthIn(max = 280.dp)
                .background(
                    color = if (isOutbound) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                    shape = RoundedCornerShape(12.dp)
                )
                .padding(horizontal = 12.dp, vertical = 8.dp)
        ) {
            Column {
                Text(
                    text = message.text,
                    color = if (isOutbound) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                    style = MaterialTheme.typography.bodyMedium
                )
                if (isOutbound) {
                    Row(
                        modifier = Modifier.align(Alignment.End),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        when (message.deliveryState) {
                            DeliveryState.PENDING -> Icon(
                                Icons.Default.Refresh, null, modifier = Modifier.size(12.dp),
                                tint = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.7f)
                            )
                            DeliveryState.SENT -> Icon(
                                Icons.Default.Check, null, modifier = Modifier.size(12.dp),
                                tint = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.7f)
                            )
                            DeliveryState.DELIVERED -> Icon(
                                Icons.Default.Check, null, modifier = Modifier.size(12.dp),
                                tint = MaterialTheme.colorScheme.onPrimary
                            )
                            DeliveryState.FAILED -> {
                                Icon(
                                    Icons.Default.Close, null, modifier = Modifier.size(12.dp),
                                    tint = MaterialTheme.colorScheme.error
                                )
                                IconButton(onClick = onRetry, modifier = Modifier.size(16.dp)) {
                                    Icon(Icons.Default.Refresh, "Retry", modifier = Modifier.size(12.dp))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
