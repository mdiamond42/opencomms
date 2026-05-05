package com.opencomms.app.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RelayFramesTest {

    @Test
    fun `decodes current relay registered frame`() {
        val raw = """{"type":"registered","user_id":"phone:operator","users_online":["hermes","phone:operator"]}"""
        val frame = RelayFrameCodec.decode(raw)
        assertTrue(frame is RelayFrame.Registered)
        val registered = frame as RelayFrame.Registered
        assertEquals("phone:operator", registered.userId)
        assertEquals(listOf("hermes", "phone:operator"), registered.usersOnline)
    }

    @Test
    fun `registered frame tolerates legacy extra fields without requiring them`() {
        val raw = """{"type":"registered","user_id":"phone:operator","users_online":[],"registered_as":"x","session_id":"y"}"""
        val frame = RelayFrameCodec.decode(raw)
        assertTrue(frame is RelayFrame.Registered)
        val registered = frame as RelayFrame.Registered
        assertEquals("phone:operator", registered.userId)
        assertEquals(emptyList<String>(), registered.usersOnline)
    }

    @Test
    fun `decodes current relay error frame`() {
        val raw = """{"type":"error","error":"unauthorized"}"""
        val frame = RelayFrameCodec.decode(raw)
        assertTrue(frame is RelayFrame.RelayError)
        val error = frame as RelayFrame.RelayError
        assertEquals("unauthorized", error.error)
        assertEquals("unauthorized", error.displayMessage)
    }

    @Test
    fun `error frame supports code and message fallback`() {
        val raw = """{"type":"error","code":"X","message":"y"}"""
        val frame = RelayFrameCodec.decode(raw)
        assertTrue(frame is RelayFrame.RelayError)
        val error = frame as RelayFrame.RelayError
        assertEquals("X", error.code)
        assertEquals("y", error.displayMessage)
    }

    @Test
    fun `unknown frames stay structured and visible`() {
        val raw = """{"type":"heartbeat","ts":"2026-05-03T12:00:00Z"}"""
        val frame = RelayFrameCodec.decode(raw)
        assertTrue(frame is RelayFrame.Unknown)
        val unknown = frame as RelayFrame.Unknown
        assertEquals("heartbeat", unknown.type)
        assertEquals(raw, unknown.raw)
    }
}
