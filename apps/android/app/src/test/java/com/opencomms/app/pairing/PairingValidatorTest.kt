package com.opencomms.app.pairing

import com.opencomms.app.protocol.ParticipantKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingValidatorTest {

    private fun loadFixture(name: String): String =
        javaClass.classLoader!!.getResourceAsStream("pairing/$name")!!
            .bufferedReader().readText()

    private fun invitePayload(
        mode: String = "human_to_human",
        subjectKind: ParticipantKind = ParticipantKind.HUMAN,
        projectId: String? = null,
        projectName: String? = null,
        agentIds: List<String> = emptyList(),
        relayUrl: String = "https://relay.example.test",
        capabilities: List<String> = listOf("chat", "status"),
        expiresAt: String = "2999-05-04T00:15:00.000Z"
    ): PairingPayload = PairingPayload(
        type = "opencomms_pairing_invite_v1",
        relayUrl = relayUrl,
        pairingEndpoint = null,
        pairingToken = null,
        token = null,
        expiresAt = expiresAt,
        contact = PairingContact("${subjectKind.name.lowercase()}:friend", "Friend", subjectKind, capabilities),
        serverPublicKey = null,
        inviteId = "123e4567-e89b-12d3-a456-426614174000",
        mode = mode,
        issuer = PairingIssuer("human:operator", ParticipantKind.HUMAN, "Operator"),
        projectId = projectId,
        projectName = projectName,
        agentIds = agentIds,
        safetyCode = "ABCD-1234"
    )

    @Test
    fun `valid pairing invite modes pass validation`() {
        assertTrue(PairingValidator.validate(invitePayload()).isSuccess)
        assertTrue(PairingValidator.validate(invitePayload(mode = "own_agent", subjectKind = ParticipantKind.AGENT)).isSuccess)
        assertTrue(PairingValidator.validate(invitePayload(mode = "friend_project_agents", subjectKind = ParticipantKind.AGENT, projectId = "project:reef", projectName = "Reef Ops", agentIds = listOf("agent:friend"))).isSuccess)
    }

    @Test
    fun `invalid pairing invites fail closed`() {
        val expired = PairingValidator.validate(invitePayload(expiresAt = "2000-05-04T00:15:00.000Z"))
        assertTrue(expired.isFailure)
        assertTrue(expired.exceptionOrNull() is PairingError.Expired)

        val badMode = PairingValidator.validate(invitePayload(mode = "global_trust"))
        assertTrue(badMode.isFailure)
        assertTrue(badMode.exceptionOrNull() is PairingError.UnsupportedType)

        val missingProject = PairingValidator.validate(invitePayload(mode = "friend_project_agents", subjectKind = ParticipantKind.AGENT))
        assertTrue(missingProject.isFailure)
        assertTrue(missingProject.exceptionOrNull() is PairingError.MissingContact)

        val badRelay = PairingValidator.validate(invitePayload(relayUrl = "http://remote.example.test"))
        assertTrue(badRelay.isFailure)
        assertTrue(badRelay.exceptionOrNull() is PairingError.MissingRelay)

        val spoofedLocalhostRelay = PairingValidator.validate(invitePayload(relayUrl = "http://localhost.evil.com"))
        assertTrue(spoofedLocalhostRelay.isFailure)
        assertTrue(spoofedLocalhostRelay.exceptionOrNull() is PairingError.MissingRelay)

        val spoofedLoopbackRelay = PairingValidator.validate(invitePayload(relayUrl = "http://127.0.0.1.evil.com"))
        assertTrue(spoofedLoopbackRelay.isFailure)
        assertTrue(spoofedLoopbackRelay.exceptionOrNull() is PairingError.MissingRelay)

        val humanBlankProject = PairingValidator.validate(invitePayload(projectId = ""))
        assertTrue(humanBlankProject.isFailure)
        assertTrue(humanBlankProject.exceptionOrNull() is PairingError.MissingContact)

        val ownAgentProject = PairingValidator.validate(invitePayload(mode = "own_agent", subjectKind = ParticipantKind.AGENT, projectId = "project:reef"))
        assertTrue(ownAgentProject.isFailure)
        assertTrue(ownAgentProject.exceptionOrNull() is PairingError.MissingContact)

        val blankProjectAgent = PairingValidator.validate(invitePayload(mode = "friend_project_agents", subjectKind = ParticipantKind.AGENT, projectId = "project:reef", projectName = "Reef Ops", agentIds = listOf("")))
        assertTrue(blankProjectAgent.isFailure)
        assertTrue(blankProjectAgent.exceptionOrNull() is PairingError.MissingContact)

        val duplicateProjectAgents = PairingValidator.validate(invitePayload(mode = "friend_project_agents", subjectKind = ParticipantKind.AGENT, projectId = "project:reef", projectName = "Reef Ops", agentIds = listOf("agent:a", "agent:a")))
        assertTrue(duplicateProjectAgents.isFailure)
        assertTrue(duplicateProjectAgents.exceptionOrNull() is PairingError.MissingContact)

        val unsortedProjectAgents = PairingValidator.validate(invitePayload(mode = "friend_project_agents", subjectKind = ParticipantKind.AGENT, projectId = "project:reef", projectName = "Reef Ops", agentIds = listOf("agent:z", "agent:a")))
        assertTrue(unsortedProjectAgents.isFailure)
        assertTrue(unsortedProjectAgents.exceptionOrNull() is PairingError.MissingContact)

        val unsafeCaps = PairingValidator.validate(invitePayload(capabilities = listOf("chat", "tool_execute")))
        assertTrue(unsafeCaps.isFailure)
        assertTrue(unsafeCaps.exceptionOrNull() is PairingError.BadKind)
    }

    @Test
    fun `valid simple fixture passes validation`() {
        val result = PairingValidator.parseAndValidate(loadFixture("valid_simple.json"))
        assertTrue(result.isSuccess)
    }

    @Test
    fun `valid full agent fixture passes validation`() {
        val result = PairingValidator.parseAndValidate(loadFixture("valid_full_agent.json"))
        assertTrue(result.isSuccess)
    }

    @Test
    fun `valid full human fixture passes validation`() {
        assertTrue(PairingValidator.parseAndValidate(loadFixture("valid_full_human.json")).isSuccess)
    }

    @Test
    fun `valid full device fixture passes validation`() {
        assertTrue(PairingValidator.parseAndValidate(loadFixture("valid_full_device.json")).isSuccess)
    }

    @Test
    fun `valid full service fixture passes validation`() {
        assertTrue(PairingValidator.parseAndValidate(loadFixture("valid_full_service.json")).isSuccess)
    }

    @Test
    fun `invalid unknown type returns UnsupportedType`() {
        val result = PairingValidator.parseAndValidate(loadFixture("invalid_unknown_type.json"))
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is PairingError.UnsupportedType)
    }

    @Test
    fun `invalid malformed json returns MalformedJson`() {
        val result = PairingValidator.parseAndValidate(loadFixture("invalid_malformed.json"))
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is PairingError.MalformedJson)
    }

    @Test
    fun `invalid missing relay returns MissingRelay`() {
        val result = PairingValidator.parseAndValidate(loadFixture("invalid_missing_relay.json"))
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is PairingError.MissingRelay)
    }

    @Test
    fun `invalid missing contact returns MissingContact`() {
        val result = PairingValidator.parseAndValidate(loadFixture("invalid_missing_contact.json"))
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is PairingError.MissingContact)
    }

    @Test
    fun `invalid bad kind returns BadKind`() {
        val result = PairingValidator.parseAndValidate(loadFixture("invalid_bad_kind.json"))
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is PairingError.BadKind)
    }

    @Test
    fun `invalid expired returns Expired`() {
        val result = PairingValidator.parseAndValidate(loadFixture("invalid_expired.json"))
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is PairingError.Expired)
    }

    @Test
    fun `http non-localhost relay url is rejected`() {
        val json = """
            {
              "type": "opencomms_pairing_v1",
              "relay_url": "http://some-remote-relay.com",
              "token": "DEV-PAIRING-TOKEN-PLACEHOLDER",
              "contact_id": "agent:demo:1",
              "contact_display_name": "Demo",
              "contact_kind": "agent"
            }
        """.trimIndent()
        val result = PairingValidator.parseAndValidate(json)
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is PairingError.MissingRelay)
    }

    @Test
    fun `http localhost relay url is accepted`() {
        val json = """
            {
              "type": "opencomms_pairing_v1",
              "relay_url": "http://localhost:8780",
              "token": "DEV-PAIRING-TOKEN-PLACEHOLDER",
              "contact_id": "agent:demo:1",
              "contact_display_name": "Demo",
              "contact_kind": "agent"
            }
        """.trimIndent()
        assertTrue(PairingValidator.parseAndValidate(json).isSuccess)
    }

    @Test
    fun `missing token returns MissingToken`() {
        val json = """
            {
              "type": "opencomms_pairing_v1",
              "relay_url": "https://relay.example.com",
              "contact_id": "agent:demo:1",
              "contact_display_name": "Demo",
              "contact_kind": "agent"
            }
        """.trimIndent()
        val result = PairingValidator.parseAndValidate(json)
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is PairingError.MissingToken)
    }

    @Test
    fun `pairing_endpoint only returns EndpointNotImplemented`() {
        val json = """
            {
              "type": "opencomms_pairing_v1",
              "relay_url": "https://relay.example.com",
              "pairing_endpoint": "https://relay.example.com/v0/pair",
              "contact": {
                "id": "agent:demo:1",
                "display_name": "Demo",
                "kind": "agent"
              }
            }
        """.trimIndent()
        val result = PairingValidator.parseAndValidate(json)
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is PairingError.EndpointNotImplemented)
    }
}
