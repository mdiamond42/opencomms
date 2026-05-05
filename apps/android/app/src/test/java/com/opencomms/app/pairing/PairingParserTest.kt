package com.opencomms.app.pairing

import com.opencomms.app.protocol.ParticipantKind
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.Signature
import java.util.Base64

class PairingParserTest {

    private fun loadFixture(name: String): String =
        javaClass.classLoader!!.getResourceAsStream("pairing/$name")!!
            .bufferedReader().readText()

    private fun inviteJson(overrides: String = ""): String = signedInviteJson(topExtra = overrides)

    private fun signedInviteJson(body: String): String {
        val generator = KeyPairGenerator.getInstance("Ed25519")
        val keyPair = generator.generateKeyPair()
        val rawPublicKey = keyPair.public.encoded.copyOfRange(keyPair.public.encoded.size - 32, keyPair.public.encoded.size)
        val publicKeyValue = Base64.getUrlEncoder().withoutPadding().encodeToString(rawPublicKey)
        val unsigned = body.replace("PUBLIC_KEY_VALUE", publicKeyValue)
        val obj = Json.parseToJsonElement(unsigned).jsonObject
        val payload = JsonObject(obj.filterKeys { it != "signature" })
        val signer = Signature.getInstance("Ed25519")
        signer.initSign(keyPair.private)
        signer.update(canonicalize(payload).toByteArray(Charsets.UTF_8))
        val signature = Base64.getUrlEncoder().withoutPadding().encodeToString(signer.sign())
        return unsigned.replace("SIGNATURE_VALUE", signature)
    }

    private fun signedInviteJson(
        mode: String = "human_to_human",
        subjectKind: String = "human",
        capabilities: String = "[\"chat\", \"status\"]",
        agentIds: String? = null,
        projectFields: String = "",
        issuerExtra: String = "",
        subjectExtra: String = "",
        publicKeyExtra: String = "",
        topExtra: String = ""
    ): String = signedInviteJson("""
        {
          "type": "opencomms_pairing_invite_v1",
          "invite_id": "123e4567-e89b-12d3-a456-426614174000",
          "mode": "$mode",
          "issuer": { "id": "human:operator", "kind": "human", "display_name": "Operator"$issuerExtra },
          "subject": { "kind": "$subjectKind", "id": "$subjectKind:friend", "display_name": "Friend"$subjectExtra },
          "relay_url": "https://relay.example.test",
          "public_key": { "alg": "ed25519", "kid": "key-1", "value": "PUBLIC_KEY_VALUE"$publicKeyExtra },
          "capabilities": $capabilities,
          "issued_at": "2026-05-04T00:00:00.000Z",
          "expires_at": "2999-05-04T00:15:00.000Z",
          "nonce": "nonce-abc",
          "safety_code": "ABCD-1234"${if (agentIds == null) "" else ",\n          \"agent_ids\": $agentIds"}$projectFields$topExtra,
          "signature": "SIGNATURE_VALUE"
        }
    """.trimIndent())

    private fun canonicalize(element: JsonElement): String = when (element) {
        is JsonObject -> element.keys.sorted().joinToString(prefix = "{", postfix = "}", separator = ",") { key ->
            jsonString(key) + ":" + canonicalize(element.getValue(key))
        }
        is kotlinx.serialization.json.JsonArray -> element.joinToString(prefix = "[", postfix = "]", separator = ",") { canonicalize(it) }
        is JsonPrimitive -> when {
            element.isString -> jsonString(element.content)
            element.booleanOrNull != null -> element.content
            else -> element.content
        }
        else -> error("Unsupported JSON element")
    }

    private fun jsonString(value: String): String = buildString {
        append('\"')
        for (ch in value) {
            when (ch) {
                '\"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\u000C' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (ch < ' ') append("\\u%04x".format(ch.code)) else append(ch)
            }
        }
        append('\"')
    }

    private fun linkFor(json: String, webFallback: Boolean = false): String {
        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray())
        return if (webFallback) "https://opencomms.local/pair#invite=$encoded" else "opencomms://pair?invite=$encoded"
    }

    private fun trustCardLinkFor(json: String): String {
        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray())
        return "opencomms://pair?v=1&card=$encoded"
    }

    private fun signedAgentCardJson(): String = signedInviteJson("""
        {
          "type": "opencomms_agent_card_v1",
          "agent_id": "agent:monolith",
          "display_name": "Peer Agent",
          "kind": "agent",
          "relay_url": "https://relay.example.test",
          "pairing_endpoint": "https://relay.example.test/pair/agent:monolith",
          "public_key": { "alg": "ed25519", "kid": "key-1", "value": "PUBLIC_KEY_VALUE" },
          "capabilities": ["chat", "status"],
          "issued_at": "2026-05-04T00:00:00.000Z",
          "expires_at": "2999-05-04T00:15:00.000Z",
          "signature": "SIGNATURE_VALUE"
        }
    """.trimIndent())

    @Test
    fun `invite json parses extended metadata`() {
        val result = PairingParser.parse(inviteJson())
        assertTrue(result.isSuccess)
        val payload = result.getOrThrow()
        assertEquals("opencomms_pairing_invite_v1", payload.type)
        assertEquals("123e4567-e89b-12d3-a456-426614174000", payload.inviteId)
        assertEquals("human_to_human", payload.mode)
        assertEquals("human:operator", payload.issuer?.id)
        assertEquals("human:friend", payload.contact.id)
        assertEquals("ABCD-1234", payload.safetyCode)
    }

    @Test
    fun `invite deep link and web fallback parse`() {
        val json = inviteJson()
        val appResult = PairingParser.parse(linkFor(json))
        val webResult = PairingParser.parse(linkFor(json, webFallback = true))
        assertTrue(appResult.isSuccess)
        assertTrue(webResult.isSuccess)
        assertEquals("human_to_human", appResult.getOrThrow().mode)
        assertEquals("human:friend", webResult.getOrThrow().contact.id)
    }

    @Test
    fun `Peer Agent trust card output text extracts signed card payload`() {
        val cardJson = signedAgentCardJson()
        val link = trustCardLinkFor(cardJson)
        val monolithOutput = """
            OpenComms trust card
            Display name: Peer Agent
            Kind: agent
            Agent ID: agent:monolith
            QR payload: $link
            $link
        """.trimIndent()

        val result = PairingValidator.parseAndValidate(monolithOutput)

        assertTrue(result.isSuccess)
        val payload = result.getOrThrow()
        assertEquals("opencomms_agent_card_v1", payload.type)
        assertEquals("agent:monolith", payload.contact.id)
        assertEquals("Peer Agent", payload.contact.displayName)
        assertEquals(ParticipantKind.AGENT, payload.contact.kind)
        assertEquals("https://relay.example.test/pair/agent:monolith", payload.pairingEndpoint)
    }

    @Test
    fun `trust card wrapper rejects tampered signed card`() {
        val tampered = signedAgentCardJson().replace("Peer Agent", "Darth Mallory")
        val result = PairingParser.parse(trustCardLinkFor(tampered))
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is PairingError.MissingContact)
    }

    @Test
    fun `pairing invites fail closed when signature metadata is missing`() {
        for (json in listOf(
            signedInviteJson().replace(Regex(",\\n\\s+\\\"signature\\\": \\\"[^\\\"]+\\\""), ""),
            signedInviteJson().replace(Regex("\\n\\s+\\\"public_key\\\": \\{ \\\"alg\\\": \\\"ed25519\\\", \\\"kid\\\": \\\"key-1\\\", \\\"value\\\": \\\"[^\\\"]+\\\" },"), ""),
            signedInviteJson().replace(Regex("\\n\\s+\\\"nonce\\\": \\\"nonce-abc\\\","), ""),
            signedInviteJson().replace(Regex("\\n\\s+\\\"invite_id\\\": \\\"123e4567-e89b-12d3-a456-426614174000\\\","), "")
        )) {
            assertTrue(PairingParser.parse(json).isFailure)
        }
    }

    @Test
    fun `pairing invites verify canonical Ed25519 signatures and reject tampering`() {
        val valid = inviteJson()
        assertTrue(PairingParser.parse(valid).isSuccess)
        assertTrue(PairingParser.parse(valid.replace(Regex("\\\"signature\\\": \\\"[^\\\"]+\\\""), "\"signature\": \"tampered\"")).isFailure)
        assertTrue(PairingParser.parse(valid.replace("\"display_name\": \"Friend\"", "\"display_name\": \"Mallory\"")).isFailure)
        assertTrue(PairingParser.parse(valid.replace("\"capabilities\": [\"chat\", \"status\"]", "\"capabilities\": [\"chat\"]")).isFailure)
        assertTrue(PairingParser.parse(inviteJson(",\n  \"project_id\": \"project:reef\"")).isFailure)
    }

    @Test
    fun `pairing invites reject exactly signed unknown fields`() {
        assertTrue(PairingParser.parse(signedInviteJson()).isSuccess)
        assertTrue(PairingParser.parse(signedInviteJson(topExtra = ",\n          \"unknown\": \"signed\"")).isFailure)
        assertTrue(PairingParser.parse(signedInviteJson(issuerExtra = ", \"unknown\": \"signed\"")).isFailure)
        assertTrue(PairingParser.parse(signedInviteJson(subjectExtra = ", \"unknown\": \"signed\"")).isFailure)
        assertTrue(PairingParser.parse(signedInviteJson(publicKeyExtra = ", \"unknown\": \"signed\"")).isFailure)
    }

    @Test
    fun `pairing invites reject exactly signed noncanonical arrays and human project fields`() {
        assertTrue(PairingParser.parse(signedInviteJson(capabilities = "[\"status\", \"chat\"]")).isFailure)
        assertTrue(PairingParser.parse(signedInviteJson(mode = "friend_project_agents", subjectKind = "agent", projectFields = ",\n          \"project_id\": \"project:reef\",\n          \"project_name\": \"Reef Ops\"", agentIds = "[\"agent:z\", \"agent:a\"]")).isFailure)
        assertTrue(PairingParser.parse(signedInviteJson(mode = "friend_project_agents", subjectKind = "agent", projectFields = ",\n          \"project_id\": \"project:reef\",\n          \"project_name\": \"Reef Ops\"", agentIds = "[\"agent:a\"]")).isSuccess)
        assertTrue(PairingParser.parse(signedInviteJson(mode = "friend_project_agents", subjectKind = "agent", projectFields = ",\n          \"project_name\": \"Reef Ops\"", agentIds = "[\"agent:a\"]")).isFailure)
        assertTrue(PairingParser.parse(signedInviteJson(mode = "friend_project_agents", subjectKind = "agent", projectFields = ",\n          \"project_id\": null,\n          \"project_name\": \"Reef Ops\"", agentIds = "[\"agent:a\"]")).isFailure)
        assertTrue(PairingParser.parse(signedInviteJson(mode = "friend_project_agents", subjectKind = "agent", projectFields = ",\n          \"project_id\": \"project:reef\",\n          \"project_name\": \"Reef Ops\"", agentIds = "[]")).isFailure)
        assertTrue(PairingParser.parse(signedInviteJson(mode = "human_to_human", projectFields = ",\n          \"project_id\": \"project:reef\",\n          \"project_name\": \"Reef Ops\"", agentIds = "[\"agent:a\"]")).isFailure)
        assertTrue(PairingParser.parse(signedInviteJson(mode = "human_to_human", projectFields = ",\n          \"project_id\": null,\n          \"project_name\": null", agentIds = "null")).isSuccess)
        assertTrue(PairingParser.parse(signedInviteJson(mode = "own_agent", subjectKind = "agent", projectFields = ",\n          \"project_id\": \"project:reef\",\n          \"project_name\": \"Reef Ops\"", agentIds = "[\"agent:a\"]")).isFailure)
    }

    @Test
    fun `invite deep link wrapper rejects legacy pairing payload type`() {
        val legacy = """
            {
              "type": "opencomms_pairing_v1",
              "relay_url": "https://relay.example.com",
              "token": "DEV-PAIRING-TOKEN-PLACEHOLDER",
              "contact_id": "agent:assistant:demo",
              "contact_display_name": "Assistant",
              "contact_kind": "agent"
            }
        """.trimIndent()
        val result = PairingParser.parse(linkFor(legacy))
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is PairingError.UnsupportedType)
    }

    @Test
    fun `pairing invite strict scalar fields reject numeric and non-string json values`() {
        val valid = inviteJson()
        assertTrue(PairingParser.parse(valid.replace("\"issued_at\": \"2026-05-04T00:00:00.000Z\"", "\"issued_at\": 1777852800")).isFailure)
        assertTrue(PairingParser.parse(valid.replace("\"expires_at\": \"2999-05-04T00:15:00.000Z\"", "\"expires_at\": 32472144900")).isFailure)
        assertTrue(PairingParser.parse(valid.replace("\"invite_id\": \"123e4567-e89b-12d3-a456-426614174000\"", "\"invite_id\": 123")).isFailure)
        assertTrue(PairingParser.parse(valid.replace("\"nonce\": \"nonce-abc\"", "\"nonce\": 123")).isFailure)
        assertTrue(PairingParser.parse(valid.replace(Regex("\\\"signature\\\": \\\"[^\\\"]+\\\""), "\"signature\": 123")).isFailure)
        assertTrue(PairingParser.parse(valid.replace("\"kind\": \"human\", \"display_name\": \"Operator\"", "\"kind\": \"agent\", \"display_name\": \"Operator\"")).isFailure)
        assertTrue(PairingParser.parse(valid.replace(Regex("\\\"value\\\": \\\"[^\\\"]+\\\""), "\"value\": 123")).isFailure)
    }

    @Test
    fun `pairing invites fail closed for malformed capabilities and agent ids`() {
        assertTrue(PairingParser.parse(inviteJson().replace("\"capabilities\": [\"chat\", \"status\"]", "\"capabilities\": \"chat\"")).isFailure)
        assertTrue(PairingParser.parse(inviteJson().replace("\"capabilities\": [\"chat\", \"status\"]", "\"capabilities\": [\"chat\", 1]")).isFailure)
        assertTrue(PairingParser.parse(inviteJson(",\n  \"agent_ids\": [\"agent:a\", 1]")).isFailure)
    }

    @Test
    fun `valid simple fixture parses correctly`() {
        val raw = loadFixture("valid_simple.json")
        val result = PairingParser.parse(raw)
        assertTrue(result.isSuccess)
        val payload = result.getOrThrow()
        assertEquals("opencomms_pairing_v1", payload.type)
        assertEquals("https://relay.example.com", payload.relayUrl)
        assertEquals("DEV-PAIRING-TOKEN-PLACEHOLDER", payload.token)
        assertEquals("agent:assistant:demo", payload.contact.id)
        assertEquals("Assistant", payload.contact.displayName)
        assertEquals(ParticipantKind.AGENT, payload.contact.kind)
    }

    @Test
    fun `valid full agent fixture parses structured contact block`() {
        val raw = loadFixture("valid_full_agent.json")
        val result = PairingParser.parse(raw)
        assertTrue(result.isSuccess)
        val payload = result.getOrThrow()
        assertEquals("https://relay.example.com", payload.relayUrl)
        assertNotNull(payload.pairingEndpoint)
        assertEquals("DEV-PAIRING-TOKEN-PLACEHOLDER", payload.pairingToken)
        assertEquals("agent:assistant:demo", payload.contact.id)
        assertEquals(ParticipantKind.AGENT, payload.contact.kind)
        assertTrue(payload.contact.capabilities.contains("text"))
    }

    @Test
    fun `valid full human fixture parses human kind`() {
        val raw = loadFixture("valid_full_human.json")
        val result = PairingParser.parse(raw)
        assertTrue(result.isSuccess)
        assertEquals(ParticipantKind.HUMAN, result.getOrThrow().contact.kind)
    }

    @Test
    fun `valid full device fixture parses device kind`() {
        val raw = loadFixture("valid_full_device.json")
        val result = PairingParser.parse(raw)
        assertTrue(result.isSuccess)
        assertEquals(ParticipantKind.DEVICE, result.getOrThrow().contact.kind)
    }

    @Test
    fun `valid full service fixture parses service kind`() {
        val raw = loadFixture("valid_full_service.json")
        val result = PairingParser.parse(raw)
        assertTrue(result.isSuccess)
        assertEquals(ParticipantKind.SERVICE, result.getOrThrow().contact.kind)
    }

    @Test
    fun `invalid malformed json returns MalformedJson error`() {
        val raw = loadFixture("invalid_malformed.json")
        val result = PairingParser.parse(raw)
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is PairingError.MalformedJson)
    }

    @Test
    fun `invalid missing relay returns MissingRelay error`() {
        val raw = loadFixture("invalid_missing_relay.json")
        val result = PairingParser.parse(raw)
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is PairingError.MissingRelay)
    }

    @Test
    fun `invalid missing contact returns MissingContact error`() {
        val raw = loadFixture("invalid_missing_contact.json")
        val result = PairingParser.parse(raw)
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is PairingError.MissingContact)
    }

    @Test
    fun `invalid bad kind returns BadKind error`() {
        val raw = loadFixture("invalid_bad_kind.json")
        val result = PairingParser.parse(raw)
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is PairingError.BadKind)
    }

    @Test
    fun `structured contact block takes precedence over flat fields`() {
        val json = """
            {
              "type": "opencomms_pairing_v1",
              "relay_url": "https://relay.example.com",
              "token": "DEV-PAIRING-TOKEN-PLACEHOLDER",
              "contact_id": "human:flat:demo",
              "contact_display_name": "Flat",
              "contact_kind": "human",
              "contact": {
                "id": "agent:structured:demo",
                "display_name": "Structured",
                "kind": "agent"
              }
            }
        """.trimIndent()
        val result = PairingParser.parse(json)
        assertTrue(result.isSuccess)
        assertEquals("agent:structured:demo", result.getOrThrow().contact.id)
        assertEquals(ParticipantKind.AGENT, result.getOrThrow().contact.kind)
    }
}
