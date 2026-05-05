package com.opencomms.app.ui.collaboration

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.opencomms.app.collaboration.AgentCollaboration
import com.opencomms.app.collaboration.AgentCollaborationRepository
import com.opencomms.app.collaboration.CollaborationAction
import com.opencomms.app.collaboration.CollaborationLifecycle
import com.opencomms.app.collaboration.CollaborationMessenger
import com.opencomms.app.collaboration.CollaborationPolicy
import com.opencomms.app.collaboration.CollaborationStatus
import com.opencomms.app.collaboration.FriendCollaborationRestriction
import com.opencomms.app.collaboration.RoomMessage
import com.opencomms.app.collaboration.RoomTranscriptRepository
import com.opencomms.app.contacts.AgentOwnership
import com.opencomms.app.contacts.Contact
import com.opencomms.app.contacts.ContactRepository
import com.opencomms.app.identity.IdentityRepository
import com.opencomms.app.protocol.EnvelopeWrapper
import com.opencomms.app.protocol.Participant
import com.opencomms.app.protocol.ParticipantKind
import com.opencomms.app.relay.RelayAccountRepository
import com.opencomms.app.relay.RelayConnectionManager
import java.time.Instant
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectAgentsScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val contactRepo = remember { ContactRepository(context) }
    val collaborationRepo = remember { AgentCollaborationRepository(context) }
    val roomRepo = remember { RoomTranscriptRepository(context) }
    val identityRepo = remember { IdentityRepository(context) }
    val accountRepo = remember { RelayAccountRepository(context) }
    val connectionManager = remember { RelayConnectionManager.getInstance(context) }

    var tabIndex by remember { mutableIntStateOf(0) }
    var contacts by remember { mutableStateOf(contactRepo.getAll()) }
    var selectedOwnAgentIds by remember { mutableStateOf<List<String>>(emptyList()) }
    var selectedFriendAgentId by remember { mutableStateOf<String?>(null) }
    var selectedRestriction by remember { mutableStateOf<FriendCollaborationRestriction?>(null) }
    var projectId by remember { mutableStateOf("") }
    var projectName by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    var collaborations by remember { mutableStateOf(collaborationRepo.getAll()) }
    var openRoomCollaborationId by remember { mutableStateOf<String?>(null) }
    var roomMessages by remember { mutableStateOf(emptyList<RoomMessage>()) }
    var roomDraft by remember { mutableStateOf("") }

    val state = ConnectAgentsState(
        contacts = contacts,
        selectedOwnAgentIds = selectedOwnAgentIds,
        selectedFriendAgentId = selectedFriendAgentId,
        selectedRestriction = selectedRestriction,
        projectId = projectId,
        projectName = projectName
    )

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Connect agents") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
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
        ) {
            OwnershipSection(
                agents = contacts.filter { it.kind == ParticipantKind.AGENT },
                onOwnershipChange = { id, ownership ->
                    contactRepo.updateAgentOwnership(id, ownership)
                    contacts = contactRepo.getAll()
                    selectedOwnAgentIds = selectedOwnAgentIds.filter { selectedId ->
                        contactRepo.getById(selectedId)?.agentOwnership == AgentOwnership.OWN
                    }
                    if (selectedFriendAgentId == id && ownership == AgentOwnership.OWN) selectedFriendAgentId = null
                }
            )
            TabRow(selectedTabIndex = tabIndex) {
                Tab(selected = tabIndex == 0, onClick = { tabIndex = 0 }, text = { Text("My agents") })
                Tab(selected = tabIndex == 1, onClick = { tabIndex = 1 }, text = { Text("Friend agent") })
            }
            message?.let {
                Text(
                    it,
                    modifier = Modifier.padding(16.dp),
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.bodyMedium
                )
            }
            CollaborationRecordsSection(
                collaborations = collaborations,
                contacts = contacts,
                onAction = { collaboration, action ->
                    val current = collaborationRepo.getAll().firstOrNull { it.id == collaboration.id } ?: collaboration
                    val pair = contacts.agentPairFor(current)
                    when (action) {
                        CollaborationAction.OPEN_ROOM -> {
                            if (pair == null) {
                                message = "Cannot open room: both collaboration agents must be contacts on this device."
                            } else {
                                openRoomCollaborationId = current.id
                                roomMessages = roomRepo.getMessages(current.roomId())
                                message = "Room opened for ${pair.first.displayName} ↔ ${pair.second.displayName}."
                            }
                        }
                        CollaborationAction.DISCONNECT -> {
                            if (pair == null) {
                                message = "Disconnect not sent: both collaboration agents must be contacts on this device."
                            } else {
                                val identity = identityRepo.getOrCreate()
                                val now = Instant.now().toString()
                                val sent = CollaborationMessenger.buildDisconnectMessages(
                                    current,
                                    pair.first,
                                    pair.second,
                                    identity.displayName,
                                    identity.humanId,
                                    now
                                ).map { sendCollaborationMessage(it, identityRepo, accountRepo, connectionManager) }
                                if (sent.size == 2 && sent.all { it }) {
                                    collaborationRepo.upsert(CollaborationLifecycle.disconnect(current, now))
                                    collaborations = collaborationRepo.getAll()
                                    if (openRoomCollaborationId == current.id) openRoomCollaborationId = null
                                    message = "Disconnect notices sent to both agents; collaboration is disconnected."
                                } else {
                                    message = "Disconnect was not finalized: both agent notices must send successfully."
                                }
                            }
                        }
                        CollaborationAction.REVOKE -> {
                            val identity = identityRepo.getOrCreate()
                            val now = Instant.now().toString()
                            val sent = pair?.let { (agentA, agentB) ->
                                CollaborationMessenger.buildRevokeMessages(
                                    current,
                                    agentA,
                                    agentB,
                                    identity.displayName,
                                    identity.humanId,
                                    now
                                ).map { sendCollaborationMessage(it, identityRepo, accountRepo, connectionManager) }
                            } ?: emptyList()
                            collaborationRepo.upsert(CollaborationLifecycle.revoke(current, now))
                            collaborations = collaborationRepo.getAll()
                            if (openRoomCollaborationId == current.id) openRoomCollaborationId = null
                            message = if (sent.size == 2 && sent.all { it }) {
                                "Revoke notices sent; collaboration is revoked locally."
                            } else {
                                // TODO: persist pending revocation notices so failed delivery can be retried after local final revoke.
                                "Collaboration revoked locally. Notice delivery may need retry if both agent sends did not complete."
                            }
                        }
                        CollaborationAction.RECONNECT, CollaborationAction.RETRY -> {
                            if (pair == null) {
                                message = "Retry/reconnect not sent: both collaboration agents must be contacts on this device."
                            } else {
                                val sent = sendIntroMessages(pair.first, pair.second, current.toPolicy(), identityRepo, accountRepo, connectionManager)
                                val now = Instant.now().toString()
                                val base = when (current.status) {
                                    CollaborationStatus.DISCONNECTED -> CollaborationLifecycle.reconnect(current, now)
                                    else -> current
                                }
                                val next = if (sent) {
                                    when (base.status) {
                                        CollaborationStatus.CONNECTED -> base
                                        CollaborationStatus.FAILED -> CollaborationLifecycle.confirmConnected(
                                            CollaborationLifecycle.reconnect(base, now),
                                            now
                                        )
                                        else -> CollaborationLifecycle.confirmConnected(base, now)
                                    }
                                } else {
                                    when (base.status) {
                                        CollaborationStatus.FAILED -> base
                                        CollaborationStatus.CONNECTED -> base
                                        else -> CollaborationLifecycle.confirmFailed(base, now)
                                    }
                                }
                                collaborationRepo.upsert(next)
                                collaborations = collaborationRepo.getAll()
                                message = if (sent) "Authorization resent; collaboration is connected." else "Authorization send failed; collaboration remains failed."
                            }
                        }
                    }
                }
            )
            openRoomCollaborationId?.let { roomCollaborationId ->
                val roomCollaboration = collaborations.firstOrNull { it.id == roomCollaborationId }
                val pair = roomCollaboration?.let { contacts.agentPairFor(it) }
                if (roomCollaboration != null && pair != null) {
                    RoomPanel(
                        collaboration = roomCollaboration,
                        messages = roomMessages,
                        draft = roomDraft,
                        onDraftChange = { roomDraft = it },
                        onSend = {
                            val text = roomDraft.trim()
                            if (text.isNotBlank()) {
                                val identity = identityRepo.getOrCreate()
                                val roomId = roomCollaboration.roomId()
                                val nextSeq = (roomRepo.getMessages(roomId).maxOfOrNull { it.seq } ?: 0) + 1
                                val broadcast = CollaborationMessenger.buildRoomBroadcastMessages(
                                    collaboration = roomCollaboration,
                                    agentA = pair.first,
                                    agentB = pair.second,
                                    roomId = roomId,
                                    seq = nextSeq,
                                    fromDisplay = identity.displayName,
                                    text = text
                                )
                                val sent = broadcast.map { sendCollaborationMessage(it, identityRepo, accountRepo, connectionManager) }
                                roomRepo.append(
                                    RoomMessage(
                                        id = UUID.randomUUID().toString(),
                                        roomId = roomId,
                                        collaborationId = roomCollaboration.id,
                                        seq = nextSeq,
                                        senderId = identity.humanId,
                                        senderDisplay = identity.displayName,
                                        text = text,
                                        createdAt = Instant.now().toString()
                                    )
                                )
                                roomMessages = roomRepo.getMessages(roomId)
                                roomDraft = ""
                                message = if (sent.size == 2 && sent.all { it }) "Room message sent to both agents." else "Room message saved locally; one or more agent sends failed."
                            }
                        },
                        onClose = { openRoomCollaborationId = null }
                    )
                }
            }
            if (tabIndex == 0) {
                MyAgentsSection(
                    agents = state.ownAgentCandidates,
                    selectedIds = selectedOwnAgentIds,
                    onToggle = { id ->
                        selectedOwnAgentIds = if (selectedOwnAgentIds.contains(id)) {
                            selectedOwnAgentIds - id
                        } else {
                            (selectedOwnAgentIds + id).takeLast(2)
                        }
                    }
                )
                Button(
                    modifier = Modifier.padding(16.dp).fillMaxWidth(),
                    enabled = state.canConnectOwnAgents,
                    onClick = {
                        val (agentA, agentB) = state.selectedOwnAgents() ?: return@Button
                        val policy = CollaborationPolicy.ownAgentsUnrestricted()
                        val now = Instant.now().toString()
                        val record = AgentCollaboration(
                            id = UUID.randomUUID().toString(),
                            agentAId = agentA.id,
                            agentBId = agentB.id,
                            scope = policy.scope,
                            status = CollaborationStatus.PENDING,
                            capabilities = policy.capabilities,
                            createdAt = now,
                            updatedAt = now
                        )
                        val sent = sendIntroMessages(agentA, agentB, policy, identityRepo, accountRepo, connectionManager)
                        val status = if (sent) CollaborationStatus.CONNECTED else CollaborationStatus.FAILED
                        collaborationRepo.upsertByAgentPair(record.copy(status = status, updatedAt = Instant.now().toString()))
                        collaborations = collaborationRepo.getAll()
                        message = if (sent) "Agents connected and authorization sent." else "Saved failed collaboration: relay send did not complete. Retry when connected."
                        contacts = contactRepo.getAll()
                    }
                ) { Text("Connect selected agents") }
            } else {
                FriendAgentSection(
                    agents = state.friendAgentCandidates,
                    selectedAgentId = selectedFriendAgentId,
                    onSelectAgent = { selectedFriendAgentId = it },
                    selectedRestriction = selectedRestriction,
                    onSelectRestriction = { selectedRestriction = it },
                    projectId = projectId,
                    onProjectIdChange = { projectId = it },
                    projectName = projectName,
                    onProjectNameChange = { projectName = it }
                )
                Button(
                    modifier = Modifier.padding(16.dp).fillMaxWidth(),
                    enabled = state.canConnectFriendAgent,
                    onClick = {
                        val friend = state.selectedFriendAgent() ?: return@Button
                        val restriction = selectedRestriction ?: return@Button
                        val policy = CollaborationPolicy.friendPreset(restriction, projectId, projectName)
                        val identity = identityRepo.getOrCreate()
                        val now = Instant.now().toString()
                        val authMessage = CollaborationMessenger.buildFriendAuthorizationMessage(
                            authorizationSource = identity.displayName,
                            authorizerId = identity.humanId,
                            friendAgent = friend,
                            policy = policy
                        )
                        val sent = sendCollaborationMessage(authMessage, identityRepo, accountRepo, connectionManager)
                        collaborationRepo.upsertByAgentPair(
                            AgentCollaboration(
                                id = UUID.randomUUID().toString(),
                                agentAId = identity.humanId,
                                agentBId = friend.id,
                                scope = policy.scope,
                                status = if (sent) CollaborationStatus.CONNECTED else CollaborationStatus.FAILED,
                                capabilities = policy.capabilities,
                                projectId = policy.projectId,
                                projectName = policy.projectName,
                                createdAt = now,
                                updatedAt = Instant.now().toString()
                            )
                        )
                        collaborations = collaborationRepo.getAll()
                        message = if (sent) {
                            "Friend agent authorization sent with ${policy.scope.wireName} restriction."
                        } else {
                            "Failed to send friend-agent authorization; saved FAILED collaboration for retry when relay is connected."
                        }
                    }
                ) { Text("Authorize friend agent") }
            }
        }
    }
}

@Composable
private fun CollaborationRecordsSection(
    collaborations: List<AgentCollaboration>,
    contacts: List<Contact>,
    onAction: (AgentCollaboration, CollaborationAction) -> Unit
) {
    Column(modifier = Modifier.padding(16.dp)) {
        Text("Collaboration records", style = MaterialTheme.typography.titleMedium)
        if (collaborations.isEmpty()) {
            Text("No collaborations yet.", style = MaterialTheme.typography.bodySmall)
        } else {
            collaborations.forEach { collaboration ->
                val agentA = contacts.firstOrNull { it.id == collaboration.agentAId }?.displayName ?: collaboration.agentAId
                val agentB = contacts.firstOrNull { it.id == collaboration.agentBId }?.displayName ?: collaboration.agentBId
                val actions = CollaborationLifecycle.availableActions(collaboration)
                Text("$agentA ↔ $agentB", style = MaterialTheme.typography.bodyMedium)
                Text("${collaboration.scope.wireName} • ${collaboration.status.displayLabel} • updated ${collaboration.updatedAt}", style = MaterialTheme.typography.bodySmall)
                if (actions.isEmpty()) {
                    Text("Actions: read only", style = MaterialTheme.typography.bodySmall)
                } else {
                    Row(modifier = Modifier.fillMaxWidth()) {
                        actions.forEach { action ->
                            Button(
                                modifier = Modifier.padding(end = 8.dp),
                                onClick = { onAction(collaboration, action) }
                            ) { Text(action.buttonLabel()) }
                        }
                    }
                }
                if (collaboration.status == CollaborationStatus.REVOKED) {
                    Text("Revoked at ${collaboration.updatedAt}", style = MaterialTheme.typography.bodySmall)
                }
                HorizontalDivider()
            }
        }
    }
}

@Composable
private fun RoomPanel(
    collaboration: AgentCollaboration,
    messages: List<RoomMessage>,
    draft: String,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    onClose: () -> Unit
) {
    Column(modifier = Modifier.padding(16.dp).fillMaxWidth()) {
        Text("Room: ${collaboration.id}", style = MaterialTheme.typography.titleMedium)
        Text("Transcript is stored separately from 1:1 chats.", style = MaterialTheme.typography.bodySmall)
        if (messages.isEmpty()) {
            Text("No room messages yet.", style = MaterialTheme.typography.bodySmall)
        } else {
            messages.forEach { roomMessage ->
                Text("#${roomMessage.seq} ${roomMessage.senderDisplay}: ${roomMessage.text}", style = MaterialTheme.typography.bodySmall)
            }
        }
        OutlinedTextField(
            value = draft,
            onValueChange = onDraftChange,
            label = { Text("Room message") },
            modifier = Modifier.fillMaxWidth()
        )
        Row(modifier = Modifier.fillMaxWidth()) {
            Button(modifier = Modifier.padding(end = 8.dp), onClick = onSend, enabled = draft.isNotBlank()) { Text("Send to room") }
            Button(onClick = onClose) { Text("Close room") }
        }
        HorizontalDivider()
    }
}

@Composable
private fun OwnershipSection(
    agents: List<Contact>,
    onOwnershipChange: (String, AgentOwnership) -> Unit
) {
    Column(modifier = Modifier.padding(16.dp)) {
        Text("Classify each agent before authorizing collaboration. New/unclassified agents default to Friend.", style = MaterialTheme.typography.bodyMedium)
        agents.forEach { agent ->
            Text(agent.displayName, style = MaterialTheme.typography.bodySmall)
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                RadioButton(
                    selected = agent.agentOwnership == AgentOwnership.OWN,
                    onClick = { onOwnershipChange(agent.id, AgentOwnership.OWN) }
                )
                Text("Own")
                RadioButton(
                    selected = agent.agentOwnership == AgentOwnership.FRIEND,
                    onClick = { onOwnershipChange(agent.id, AgentOwnership.FRIEND) }
                )
                Text("Friend")
            }
            HorizontalDivider()
        }
    }
}

@Composable
private fun MyAgentsSection(agents: List<Contact>, selectedIds: List<String>, onToggle: (String) -> Unit) {
    Column(modifier = Modifier.padding(16.dp)) {
        Text("Choose exactly two of your agent contacts.", style = MaterialTheme.typography.bodyMedium)
        agents.forEach { agent ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Checkbox(checked = selectedIds.contains(agent.id), onCheckedChange = { onToggle(agent.id) })
                Text(agent.displayName)
            }
            HorizontalDivider()
        }
    }
}

@Composable
private fun FriendAgentSection(
    agents: List<Contact>,
    selectedAgentId: String?,
    onSelectAgent: (String) -> Unit,
    selectedRestriction: FriendCollaborationRestriction?,
    onSelectRestriction: (FriendCollaborationRestriction) -> Unit,
    projectId: String,
    onProjectIdChange: (String) -> Unit,
    projectName: String,
    onProjectNameChange: (String) -> Unit
) {
    Column(modifier = Modifier.padding(16.dp)) {
        Text("Choose a friend-owned agent and collaboration restriction.", style = MaterialTheme.typography.bodyMedium)
        agents.forEach { agent ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().selectable(selected = selectedAgentId == agent.id, role = Role.RadioButton, onClick = { onSelectAgent(agent.id) })
            ) {
                RadioButton(selected = selectedAgentId == agent.id, onClick = { onSelectAgent(agent.id) })
                Text(agent.displayName)
            }
        }
        Spacer(modifier = Modifier.padding(8.dp))
        FriendCollaborationRestriction.entries.forEach { restriction ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().selectable(selected = selectedRestriction == restriction, role = Role.RadioButton, onClick = { onSelectRestriction(restriction) })
            ) {
                RadioButton(selected = selectedRestriction == restriction, onClick = { onSelectRestriction(restriction) })
                Text(restriction.label())
            }
        }
        if (selectedRestriction == FriendCollaborationRestriction.PROJECT_ONLY) {
            OutlinedTextField(value = projectId, onValueChange = onProjectIdChange, label = { Text("Project ID") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = projectName, onValueChange = onProjectNameChange, label = { Text("Project name") }, modifier = Modifier.fillMaxWidth())
        }
    }
}

private fun FriendCollaborationRestriction.label(): String = when (this) {
    FriendCollaborationRestriction.CHAT_ONLY -> "Chat only"
    FriendCollaborationRestriction.PROJECT_ONLY -> "Project only"
    FriendCollaborationRestriction.TOTAL_COLLABORATION -> "Total collaboration"
}

private fun CollaborationAction.buttonLabel(): String = when (this) {
    CollaborationAction.RETRY -> "Retry"
    CollaborationAction.OPEN_ROOM -> "Open room"
    CollaborationAction.DISCONNECT -> "Disconnect"
    CollaborationAction.RECONNECT -> "Reconnect"
    CollaborationAction.REVOKE -> "Revoke"
}

private fun AgentCollaboration.roomId(): String = "room-${id}"

private fun List<Contact>.agentPairFor(collaboration: AgentCollaboration): Pair<Contact, Contact>? {
    val agentA = firstOrNull { it.id == collaboration.agentAId }
    val agentB = firstOrNull { it.id == collaboration.agentBId }
    return if (agentA != null && agentB != null) agentA to agentB else null
}

private fun AgentCollaboration.toPolicy(): CollaborationPolicy = CollaborationPolicy(
    scope = scope,
    capabilities = capabilities,
    projectId = projectId,
    projectName = projectName
)

private fun sendIntroMessages(
    agentA: Contact,
    agentB: Contact,
    policy: CollaborationPolicy,
    identityRepo: IdentityRepository,
    accountRepo: RelayAccountRepository,
    connectionManager: RelayConnectionManager
): Boolean {
    val identity = identityRepo.getOrCreate()
    val introMessages = CollaborationMessenger.buildIntroMessages(
        authorizationSource = identity.displayName,
        agentA = agentA,
        agentB = agentB,
        policy = policy
    )
    return introMessages.all { intro ->
        sendCollaborationMessage(intro, identityRepo, accountRepo, connectionManager)
    }
}

private fun sendCollaborationMessage(
    intro: com.opencomms.app.collaboration.CollaborationIntroMessage,
    identityRepo: IdentityRepository,
    accountRepo: RelayAccountRepository,
    connectionManager: RelayConnectionManager
): Boolean = runCatching {
    val identity = identityRepo.getOrCreate()
    val account = accountRepo.getById(intro.recipient.relayAccountId) ?: return@runCatching false
    val client = connectionManager.getOrCreate(account, identity.humanId)
    val now = Instant.now().toString()
    val envelope = EnvelopeWrapper.buildTextEnvelope(
        id = UUID.randomUUID().toString(),
        createdAt = now,
        sender = Participant(type = ParticipantKind.HUMAN, id = identity.humanId, deviceId = identity.deviceId),
        recipient = Participant(type = intro.recipient.kind, id = intro.recipient.id),
        text = intro.body
    )
    client.send(EnvelopeWrapper.wrap(envelope))
}.getOrDefault(false)
