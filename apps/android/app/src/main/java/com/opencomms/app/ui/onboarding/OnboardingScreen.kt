package com.opencomms.app.ui.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.opencomms.app.identity.IdentityRepository

@Composable
fun OnboardingScreen(
    onComplete: () -> Unit,
    onScanQr: () -> Unit,
    onPastePayload: () -> Unit
) {
    val context = LocalContext.current
    val identityRepo = remember { IdentityRepository(context) }
    val identity = remember { identityRepo.getOrCreate() }
    var displayName by remember { mutableStateOf(identity.displayName) }
    val focusManager = LocalFocusManager.current

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "OpenComms",
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "A generic messaging client for humans, agents, devices, and services.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Add a contact by scanning a pairing QR or pasting a pairing code.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(32.dp))

            OutlinedTextField(
                value = displayName,
                onValueChange = { displayName = it },
                label = { Text("Display name") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus() })
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "Human ID: ${identity.humanId}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth()
            )
            Text(
                text = "Device ID: ${identity.deviceId}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(32.dp))

            Button(
                onClick = {
                    identityRepo.updateDisplayName(displayName.ifBlank { "My Phone" })
                    onScanQr()
                },
                modifier = Modifier.fillMaxWidth()
            ) { Text("Scan pairing QR") }

            Spacer(modifier = Modifier.height(8.dp))

            OutlinedButton(
                onClick = {
                    identityRepo.updateDisplayName(displayName.ifBlank { "My Phone" })
                    onPastePayload()
                },
                modifier = Modifier.fillMaxWidth()
            ) { Text("Enter pairing payload manually") }

            Spacer(modifier = Modifier.height(8.dp))

            TextButton(
                onClick = {
                    identityRepo.updateDisplayName(displayName.ifBlank { "My Phone" })
                    onComplete()
                },
                modifier = Modifier.fillMaxWidth()
            ) { Text("Skip — set up later") }
        }
    }
}
