package com.opencomms.app.protocol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class RegisterFrameTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `register frame matches current relay schema`() {
        val frame = RegisterFrameBuilder.build(
            userId = "human:local:demo",
            token = "DEV-PAIRING-TOKEN-PLACEHOLDER"
        )
        val obj = json.parseToJsonElement(frame).jsonObject

        // Required fields per relay tests: { type, user_id, token }
        assertEquals("register", obj["type"]?.jsonPrimitive?.content)
        assertEquals("human:local:demo", obj["user_id"]?.jsonPrimitive?.content)
        assertNotNull(obj["token"])
    }

    @Test
    fun `register frame does not include old schema fields`() {
        val frame = RegisterFrameBuilder.build(
            userId = "human:local:demo",
            token = "DEV-PAIRING-TOKEN-PLACEHOLDER"
        )
        val obj = json.parseToJsonElement(frame).jsonObject

        // These fields existed in the old, incorrect schema
        assertNull("'identity' object must not appear", obj["identity"])
        assertNull("'client' object must not appear", obj["client"])
        assertNull("'device_id' must not appear at top level", obj["device_id"])
    }

    @Test
    fun `token field is present and non-empty`() {
        val frame = RegisterFrameBuilder.build(
            userId = "human:local:test",
            token = "DEV-PAIRING-TOKEN-PLACEHOLDER"
        )
        val obj = json.parseToJsonElement(frame).jsonObject
        val token = obj["token"]?.jsonPrimitive?.content
        assertNotNull(token)
        assert(!token.isNullOrBlank())
    }

    @Test
    fun `user_id matches the identity humanId`() {
        val userId = "human:local:abc-123"
        val frame = RegisterFrameBuilder.build(userId = userId, token = "tok")
        val obj = json.parseToJsonElement(frame).jsonObject
        assertEquals(userId, obj["user_id"]?.jsonPrimitive?.content)
    }
}
