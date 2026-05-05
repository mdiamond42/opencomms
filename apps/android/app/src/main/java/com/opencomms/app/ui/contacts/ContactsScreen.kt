package com.opencomms.app.ui.contacts

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.opencomms.app.contacts.Contact
import com.opencomms.app.contacts.ContactRepository
import com.opencomms.app.chat.TranscriptRepository
import com.opencomms.app.relay.RelayAccountRepository
import com.opencomms.app.ui.common.kindLabel

internal fun removeContactFromList(contacts: List<Contact>, contactId: String): List<Contact> =
    contacts.filter { it.id != contactId }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContactsScreen(
    onContactClick: (String) -> Unit,
    onAddContact: () -> Unit,
    onConnectAgents: () -> Unit,
    onSettings: () -> Unit
) {
    val context = LocalContext.current
    val contactRepo = remember { ContactRepository(context) }
    val transcriptRepo = remember { TranscriptRepository(context) }
    val accountRepo = remember { RelayAccountRepository(context) }
    var overflowExpanded by remember { mutableStateOf(false) }
    var contacts by remember { mutableStateOf(contactRepo.getAll()) }
    var pendingRemoval by remember { mutableStateOf<Contact?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("OpenComms") },
                actions = {
                    IconButton(onClick = onAddContact) {
                        Icon(Icons.Default.Add, contentDescription = "Add contact")
                    }
                    IconButton(onClick = { overflowExpanded = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = "More")
                    }
                    DropdownMenu(
                        expanded = overflowExpanded,
                        onDismissRequest = { overflowExpanded = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text("Connect agents") },
                            onClick = { overflowExpanded = false; onConnectAgents() }
                        )
                        DropdownMenuItem(
                            text = { Text("Settings") },
                            onClick = { overflowExpanded = false; onSettings() }
                        )
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onAddContact) {
                Icon(Icons.Default.Add, contentDescription = "Add contact")
            }
        }
    ) { padding ->
        pendingRemoval?.let { contact ->
            AlertDialog(
                onDismissRequest = { pendingRemoval = null },
                title = { Text("Remove ${kindLabel(contact.kind)}?") },
                text = { Text("Remove ${contact.displayName} from contacts and clear its local transcript?") },
                confirmButton = {
                    TextButton(
                        onClick = {
                            contactRepo.remove(contact.id)
                            transcriptRepo.clearContact(contact.id)
                            contacts = removeContactFromList(contacts, contact.id)
                            pendingRemoval = null
                        }
                    ) { Text("Remove") }
                },
                dismissButton = {
                    TextButton(onClick = { pendingRemoval = null }) { Text("Cancel") }
                }
            )
        }

        if (contacts.isEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Spacer(modifier = Modifier.weight(1f))
                Text("No contacts yet.", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Add one with a pairing QR.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.weight(1f))
            }
        } else {
            LazyColumn(modifier = Modifier.padding(padding)) {
                items(contacts, key = { it.id }) { contact ->
                    ContactRow(
                        contact = contact,
                        relayLabel = accountRepo.getById(contact.relayAccountId)?.label ?: contact.relayAccountId.take(8),
                        onClick = { onContactClick(contact.id) },
                        onRemove = { pendingRemoval = contact }
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
private fun ContactRow(contact: Contact, relayLabel: String, onClick: () -> Unit, onRemove: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = Icons.Default.Person,
            contentDescription = kindLabel(contact.kind),
            modifier = Modifier.size(40.dp),
            tint = MaterialTheme.colorScheme.primary
        )
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    contact.displayName,
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    kindLabel(contact.kind),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            contact.lastMessagePreview?.let { preview ->
                Text(
                    preview,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Text(
                "via $relayLabel",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.outline
            )
        }
        IconButton(onClick = onRemove) {
            Icon(
                imageVector = Icons.Default.Delete,
                contentDescription = "Remove ${contact.displayName}",
                tint = MaterialTheme.colorScheme.error
            )
        }
    }
}
