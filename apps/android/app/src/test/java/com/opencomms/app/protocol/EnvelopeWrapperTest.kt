package com.opencomms.app.protocol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class EnvelopeWrapperTest {

    private val json = Json { ignoreUnknownKeys = true }

    private fun loadFixture(name: String): String =
        javaClass.classLoader!!.getResourceAsStream("envelopes/$name")!!
            .bufferedReader().readText()

    @Test
    fun `buildTextEnvelope emits strict v01 wrapper and required raw keys`() {
        val wrapped = EnvelopeWrapper.buildTextEnvelope("phone:operator", "hermes", "hello")
        val obj = json.parseToJsonElement(wrapped).jsonObject
        assertEquals(setOf("type", "envelope"), obj.keys)
        assertEquals("envelope", obj["type"]?.jsonPrimitive?.content)

        val inner = obj["envelope"]!!.jsonObject
        assertEquals(
            setOf(
                "version",
                "id",
                "idempotency_key",
                "created_at",
                "expires_at",
                "sender",
                "recipient",
                "channel",
                "intent",
                "requires_ack",
                "correlation_id",
                "payload",
                "permissions"
            ),
            inner.keys
        )
        assertEquals("0.1", inner["version"]?.jsonPrimitive?.content)
        assertTrue(inner["id"]!!.jsonPrimitive.content.matches(UUID_RE))
        assertTrue(inner["idempotency_key"]!!.jsonPrimitive.content.isNotBlank())
        assertTrue(inner["idempotency_key"]!!.jsonPrimitive.content.matches(UUID_RE))
        assertTrue(Instant.parse(inner["expires_at"]!!.jsonPrimitive.content) > Instant.parse(inner["created_at"]!!.jsonPrimitive.content))
        assertEquals("text", inner["channel"]?.jsonPrimitive?.content)
        assertEquals("message", inner["intent"]?.jsonPrimitive?.content)
        assertTrue(inner["requires_ack"]!!.jsonPrimitive.boolean)
        assertTrue(inner["correlation_id"] is JsonNull)

        val sender = inner["sender"]!!.jsonObject
        assertEquals(setOf("type", "id", "device_id"), sender.keys)
        assertEquals("human", sender["type"]?.jsonPrimitive?.content)
        assertEquals("phone:operator", sender["id"]?.jsonPrimitive?.content)
        assertEquals("android", sender["device_id"]?.jsonPrimitive?.content)

        val recipient = inner["recipient"]!!.jsonObject
        assertEquals(setOf("type", "id"), recipient.keys)
        assertEquals("agent", recipient["type"]?.jsonPrimitive?.content)
        assertEquals("hermes", recipient["id"]?.jsonPrimitive?.content)

        val payload = inner["payload"]!!.jsonObject
        assertEquals(setOf("content_type", "body"), payload.keys)
        assertEquals("text/plain", payload["content_type"]?.jsonPrimitive?.content)
        assertEquals("hello", payload["body"]?.jsonPrimitive?.content)
        assertNull(payload["summary"])

        val permissions = inner["permissions"]!!.jsonObject
        assertEquals(setOf("may_execute_tools", "may_notify_human", "risk_level"), permissions.keys)
        assertFalse(permissions["may_execute_tools"]!!.jsonPrimitive.boolean)
        assertTrue(permissions["may_notify_human"]!!.jsonPrimitive.boolean)
        assertEquals("low", permissions["risk_level"]?.jsonPrimitive?.content)
    }

    @Test
    fun `wrap produces correct outer type field`() {
        val envelope = EnvelopeWrapper.buildTextEnvelope(
            id = "00000000-0000-4000-8000-000000000001",
            idempotencyKey = "00000000-0000-4000-8000-000000000101",
            createdAt = "2026-05-03T12:00:00Z",
            expiresAt = "2026-05-03T12:05:00Z",
            sender = Participant(ParticipantKind.HUMAN, "human:local:demo", "device:android:demo"),
            recipient = Participant(ParticipantKind.AGENT, "agent:assistant:demo"),
            text = "hello"
        )
        val obj = json.parseToJsonElement(EnvelopeWrapper.wrap(envelope)).jsonObject
        assertEquals("envelope", obj["type"]?.jsonPrimitive?.content)
        assertNotNull(obj["envelope"])
    }

    @Test
    fun `raw EnvelopeV01 is never emitted at top level`() {
        val wrapped = EnvelopeWrapper.buildTextEnvelope("human:local:demo", "agent:assistant:demo", "test")
        val obj = json.parseToJsonElement(wrapped).jsonObject
        assertNull("version must not appear at top level", obj["version"])
        assertNull("sender must not appear at top level", obj["sender"])
        assertNull("payload must not appear at top level", obj["payload"])
    }

    @Test
    fun `old simplified field names and old permissions list are absent`() {
        val inner = json.parseToJsonElement(
            EnvelopeWrapper.buildTextEnvelope("human:local:demo", "agent:assistant:demo", "test")
        ).jsonObject["envelope"]!!.jsonObject
        assertNull("old 'v' field must not appear", inner["v"])
        assertNull("old 'kind' field must not appear", inner["kind"])
        assertNull("old 'body' object must not appear at envelope level", inner["body"])
        assertTrue("permissions must be an object", inner["permissions"]!!.jsonObject.containsKey("risk_level"))
    }

    @Test
    fun `outbound text fixture has current strict relay protocol shape`() {
        val fixtureObj = json.parseToJsonElement(loadFixture("outbound_text.json")).jsonObject
        assertEquals("envelope", fixtureObj["type"]?.jsonPrimitive?.content)
        val inner = fixtureObj["envelope"]!!.jsonObject
        assertEquals("0.1", inner["version"]?.jsonPrimitive?.content)
        assertEquals("00000000-0000-4000-8000-000000000101", inner["idempotency_key"]?.jsonPrimitive?.content)
        assertEquals("2026-05-03T12:05:00Z", inner["expires_at"]?.jsonPrimitive?.content)
        assertEquals("message", inner["intent"]?.jsonPrimitive?.content)
        assertEquals("low", inner["permissions"]!!.jsonObject["risk_level"]?.jsonPrimitive?.content)
    }

    @Test
    fun `RelayFrameCodec decodes inbound envelope with current protocol shape`() {
        val frame = RelayFrameCodec.decode(loadFixture("inbound_text.json"))
        assertTrue(frame is RelayFrame.IncomingEnvelope)
        val incoming = frame as RelayFrame.IncomingEnvelope
        assertEquals("hi back", incoming.envelope.payload.body)
        assertEquals(ParticipantKind.AGENT, incoming.envelope.sender.type)
        assertEquals("message", incoming.envelope.intent)
        assertEquals("low", incoming.envelope.permissions.riskLevel)
    }

    @Test
    fun `device contact kind is serialized as protocol-supported service participant`() {
        val wrapped = EnvelopeWrapper.wrap(
            EnvelopeWrapper.buildTextEnvelope(
                sender = Participant(ParticipantKind.HUMAN, "human:local:demo", "device:android:demo"),
                recipient = Participant(ParticipantKind.DEVICE, "device:local:demo"),
                text = "ping device"
            )
        )
        val recipient = json.parseToJsonElement(wrapped)
            .jsonObject["envelope"]!!
            .jsonObject["recipient"]!!
            .jsonObject
        assertEquals("service", recipient["type"]?.jsonPrimitive?.content)
        assertEquals("device:local:demo", recipient["id"]?.jsonPrimitive?.content)
    }

    companion object {
        private val UUID_RE = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
    }
}
