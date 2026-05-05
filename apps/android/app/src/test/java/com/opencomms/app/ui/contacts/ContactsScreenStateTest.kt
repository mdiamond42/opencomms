package com.opencomms.app.ui.contacts

import com.opencomms.app.contacts.Contact
import com.opencomms.app.protocol.ParticipantKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ContactsScreenStateTest {

    @Test
    fun `remove contact state helper removes only selected agent`() {
        val agent = contact("agent:assistant:demo", "Assistant", ParticipantKind.AGENT)
        val human = contact("human:friend", "Friend", ParticipantKind.HUMAN)

        val updated = removeContactFromList(listOf(agent, human), agent.id)

        assertEquals(listOf(human), updated)
        assertFalse(updated.any { it.id == agent.id })
        assertTrue(updated.any { it.id == human.id })
    }

    private fun contact(id: String, name: String, kind: ParticipantKind): Contact = Contact(
        id = id,
        displayName = name,
        kind = kind,
        relayAccountId = "relay:local",
        addedAt = "2026-05-05T00:00:00.000Z"
    )
}
