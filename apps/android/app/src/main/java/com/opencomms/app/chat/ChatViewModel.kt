package com.opencomms.app.chat

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.opencomms.app.contacts.Contact
import com.opencomms.app.contacts.ContactRepository
import com.opencomms.app.identity.IdentityRepository
import com.opencomms.app.protocol.EnvelopeWrapper
import com.opencomms.app.protocol.Participant
import com.opencomms.app.protocol.ParticipantKind
import com.opencomms.app.protocol.RelayFrame
import com.opencomms.app.relay.ClientState
import com.opencomms.app.relay.RelayAccountRepository
import com.opencomms.app.relay.RelayConnectionManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID

class ChatViewModel(application: Application) : AndroidViewModel(application) {

    private val context = application.applicationContext
    private val transcriptRepo = TranscriptRepository(context)
    private val identityRepo = IdentityRepository(context)
    private val contactRepo = ContactRepository(context)
    private val accountRepo = RelayAccountRepository(context)
    private val connectionManager = RelayConnectionManager.getInstance(context)

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    private val _clientState = MutableStateFlow<ClientState>(ClientState.Idle)
    val clientState: StateFlow<ClientState> = _clientState.asStateFlow()

    private var currentContact: Contact? = null

    fun loadContact(contactId: String) {
        currentContact = contactRepo.getById(contactId) ?: return
        _messages.value = transcriptRepo.getMessages(contactId)

        val account = accountRepo.getById(currentContact!!.relayAccountId) ?: return
        val identity = identityRepo.getOrCreate()

        val client = connectionManager.getOrCreate(
            account = account,
            userId = identity.humanId
        )

        viewModelScope.launch {
            client.state.collect { state -> _clientState.value = state }
        }

        viewModelScope.launch {
            client.frames.collect { frame ->
                when (frame) {
                    is RelayFrame.IncomingEnvelope -> {
                        val env = frame.envelope
                        if (env.sender.id == currentContact?.id) {
                            val msg = ChatMessage(
                                id = UUID.randomUUID().toString(),
                                contactId = contactId,
                                direction = Direction.INBOUND,
                                text = env.payload.body,
                                createdAt = Instant.now().toString(),
                                deliveryState = DeliveryState.DELIVERED,
                                envelopeId = env.id
                            )
                            transcriptRepo.append(msg)
                            _messages.value = transcriptRepo.getMessages(contactId)
                        }
                    }
                    is RelayFrame.RelayError -> {
                        val msg = ChatMessage(
                            id = UUID.randomUUID().toString(),
                            contactId = contactId,
                            direction = Direction.INBOUND,
                            text = "[Relay error: ${frame.displayMessage}]",
                            createdAt = Instant.now().toString(),
                            deliveryState = DeliveryState.FAILED,
                            errorMessage = frame.displayMessage
                        )
                        transcriptRepo.append(msg)
                        _messages.value = transcriptRepo.getMessages(contactId)
                    }
                    else -> {}
                }
            }
        }

        if (client.state.value is ClientState.Idle || client.state.value is ClientState.Disconnected) {
            client.connect()
        }
    }

    fun sendMessage(text: String) {
        val contact = currentContact ?: return
        val identity = identityRepo.getOrCreate()
        val account = accountRepo.getById(contact.relayAccountId) ?: return
        val client = connectionManager.getClient(account.id) ?: return

        val messageId = UUID.randomUUID().toString()
        val envelopeId = UUID.randomUUID().toString()
        val now = Instant.now().toString()

        val pending = ChatMessage(
            id = messageId,
            contactId = contact.id,
            direction = Direction.OUTBOUND,
            text = text,
            createdAt = now,
            deliveryState = DeliveryState.PENDING,
            envelopeId = envelopeId
        )
        transcriptRepo.append(pending)
        _messages.value = transcriptRepo.getMessages(contact.id)

        val envelope = EnvelopeWrapper.buildTextEnvelope(
            id = envelopeId,
            createdAt = now,
            sender = Participant(
                type = ParticipantKind.HUMAN,
                id = identity.humanId,
                deviceId = identity.deviceId
            ),
            recipient = Participant(
                type = contact.kind,
                id = contact.id
            ),
            text = text
        )

        val sent = client.send(EnvelopeWrapper.wrap(envelope))
        val finalState = if (sent) DeliveryState.SENT else DeliveryState.FAILED
        transcriptRepo.updateDeliveryState(contact.id, messageId, finalState)
        _messages.value = transcriptRepo.getMessages(contact.id)

        contactRepo.updateLastMessage(contact.id, text, now)
    }

    fun retryMessage(messageId: String) {
        val contactId = currentContact?.id ?: return
        val msg = transcriptRepo.getMessages(contactId).find { it.id == messageId } ?: return
        if (msg.deliveryState == DeliveryState.FAILED && msg.direction == Direction.OUTBOUND) {
            sendMessage(msg.text)
        }
    }
}
