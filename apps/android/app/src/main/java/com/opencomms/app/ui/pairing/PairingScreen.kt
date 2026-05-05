package com.opencomms.app.ui.pairing

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.opencomms.app.contacts.Contact
import com.opencomms.app.contacts.ContactRepository
import com.opencomms.app.identity.IdentityRepository
import com.opencomms.app.pairing.PairingError
import com.opencomms.app.pairing.PairingPayload
import com.opencomms.app.pairing.PairingValidator
import com.opencomms.app.protocol.ParticipantKind
import com.opencomms.app.relay.RelayAccountRepository
import com.opencomms.app.ui.common.ErrorMapper
import com.opencomms.app.ui.common.kindLabel
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.format.DateTimeParseException

internal fun shouldShowQrScanner(selectedTab: Int, hasValidatedPayload: Boolean): Boolean =
    selectedTab == 0 && !hasValidatedPayload

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PairingScreen(
    onBack: () -> Unit,
    onPaired: () -> Unit
) {
    val context = LocalContext.current
    val contactRepo = remember { ContactRepository(context) }
    val accountRepo = remember { RelayAccountRepository(context) }
    val identityRepo = remember { IdentityRepository(context) }

    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    var selectedTab by remember { mutableIntStateOf(0) }
    var pasteText by remember { mutableStateOf("") }
    var validatedPayload by remember { mutableStateOf<PairingPayload?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Add Contact") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            TabRow(selectedTabIndex = selectedTab) {
                Tab(selected = selectedTab == 0, onClick = { selectedTab = 0 }) {
                    Text("Scan QR", modifier = Modifier.padding(12.dp))
                }
                Tab(selected = selectedTab == 1, onClick = { selectedTab = 1 }) {
                    Text("Paste link", modifier = Modifier.padding(12.dp))
                }
            }

            when (selectedTab) {
                0 -> if (shouldShowQrScanner(selectedTab, validatedPayload != null)) {
                    QrScanTab(
                        errorMessage = errorMessage,
                        onRetry = {
                            errorMessage = null
                            validatedPayload = null
                        },
                        onScanned = { json ->
                            val result = PairingValidator.parseAndValidate(json)
                            if (result.isSuccess) {
                                validatedPayload = result.getOrThrow()
                                errorMessage = null
                                true
                            } else {
                                val err = result.exceptionOrNull()
                                errorMessage = if (err is PairingError) {
                                    ErrorMapper.pairingErrorMessage(context, err)
                                } else "Unknown error parsing pairing payload."
                                validatedPayload = null
                                false
                            }
                        }
                    )
                } else {
                    QrScanSuccessPanel(
                        onScanAnother = {
                            validatedPayload = null
                            errorMessage = null
                        }
                    )
                }
                1 -> PasteTab(
                    text = pasteText,
                    onTextChange = { pasteText = it; validatedPayload = null; errorMessage = null },
                    errorMessage = errorMessage,
                    onValidate = {
                        val result = PairingValidator.parseAndValidate(pasteText)
                        if (result.isSuccess) {
                            validatedPayload = result.getOrThrow()
                            errorMessage = null
                        } else {
                            val err = result.exceptionOrNull()
                            errorMessage = if (err is PairingError) {
                                ErrorMapper.pairingErrorMessage(context, err)
                            } else "Unknown error."
                            validatedPayload = null
                        }
                    }
                )
            }

            validatedPayload?.let { payload ->
                Spacer(modifier = Modifier.height(12.dp))
                PairingConfirmCard(
                    payload = payload,
                    onConfirm = {
                        val identity = identityRepo.getOrCreate()
                        val token = payload.token ?: payload.pairingToken ?: ""
                        val account = accountRepo.findOrCreate(
                            relayUrl = payload.relayUrl,
                            token = token,
                            registeredAs = identity.humanId
                        )
                        val contact = Contact(
                            id = payload.contact.id,
                            displayName = payload.contact.displayName,
                            kind = payload.contact.kind,
                            capabilities = payload.contact.capabilities,
                            relayAccountId = account.id,
                            addedAt = Instant.now().toString()
                        )
                        contactRepo.upsert(contact)
                        scope.launch {
                            snackbarHostState.showSnackbar("Added ${payload.contact.displayName}")
                        }
                        onPaired()
                    },
                    onCancel = { validatedPayload = null }
                )
            }
        }
    }
}

@Composable
private fun QrScanSuccessPanel(
    onScanAnother: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("QR confirmed", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(6.dp))
            Text("Review the contact data below, then tap Confirm add.")
            Spacer(modifier = Modifier.height(12.dp))
            OutlinedButton(onClick = onScanAnother, modifier = Modifier.fillMaxWidth()) {
                Text("Scan a different QR")
            }
        }
    }
}

@Composable
private fun PasteTab(
    text: String,
    onTextChange: (String) -> Unit,
    errorMessage: String?,
    onValidate: () -> Unit
) {
    Column(modifier = Modifier.padding(16.dp)) {
        OutlinedTextField(
            value = text,
            onValueChange = onTextChange,
            label = { Text("Pairing QR, link, or JSON") },
            placeholder = { Text("Paste OpenComms invite link or pairing JSON here…") },
            modifier = Modifier
                .fillMaxWidth()
                .height(160.dp),
            minLines = 5
        )
        if (errorMessage != null) {
            Spacer(modifier = Modifier.height(6.dp))
            Text(errorMessage, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(modifier = Modifier.height(12.dp))
        Button(onClick = onValidate, modifier = Modifier.fillMaxWidth()) {
            Text("Validate")
        }
    }
}

@Composable
private fun PairingConfirmCard(
    payload: PairingPayload,
    onConfirm: () -> Unit,
    onCancel: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Confirm Contact", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(8.dp))
            Text("Name: ${payload.contact.displayName}")
            Text("Kind: ${kindLabel(payload.contact.kind)}")
            payload.mode?.let { Text("Mode: $it") }
            Text("Relay: ${payload.relayUrl}")
            payload.projectName?.let { Text("Project: $it (${payload.projectId ?: "unscoped"})") }
            if (payload.agentIds.isNotEmpty()) {
                Text("Agents: ${payload.agentIds.joinToString(", ")}")
            }
            payload.safetyCode?.let { Text("Safety code: $it") }
            payload.expiresAt?.let {
                Text("Expires: $it")
            }
            Spacer(modifier = Modifier.height(12.dp))
            Button(onClick = onConfirm, modifier = Modifier.fillMaxWidth()) {
                Text("Confirm add")
            }
            Spacer(modifier = Modifier.height(4.dp))
            OutlinedButton(onClick = onCancel, modifier = Modifier.fillMaxWidth()) {
                Text("Cancel")
            }
        }
    }
}
