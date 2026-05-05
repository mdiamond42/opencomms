package com.opencomms.app.relay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ClientStateMachineTest {

    private fun machine() = ClientStateMachine()

    @Test
    fun `initial state is Idle`() {
        val m = machine()
        assertTrue(m.current is ClientState.Idle)
    }

    @Test
    fun `Idle to Connecting on connect`() {
        val m = machine()
        m.onConnect()
        assertTrue(m.current is ClientState.Connecting)
    }

    @Test
    fun `Connecting to SocketOpenAwaitingRegister on socket open`() {
        val m = machine()
        m.onConnect()
        m.onSocketOpen()
        assertTrue(m.current is ClientState.SocketOpenAwaitingRegister)
    }

    @Test
    fun `SocketOpenAwaitingRegister to Registered on registered frame`() {
        val m = machine()
        m.onConnect()
        m.onSocketOpen()
        m.onRegistered()
        assertTrue(m.current is ClientState.Registered)
        assertTrue(m.current.isReady)
    }

    @Test
    fun `Registered to Error on error`() {
        val m = machine()
        m.onConnect()
        m.onSocketOpen()
        m.onRegistered()
        m.onError("unknown_recipient", recoverable = true)
        val state = m.current
        assertTrue(state is ClientState.Error)
        assertEquals("unknown_recipient", (state as ClientState.Error).message)
        assertTrue(state.recoverable)
    }

    @Test
    fun `any state to Disconnected on disconnect`() {
        listOf<(ClientStateMachine) -> Unit>(
            { /* idle */ },
            { it.onConnect() },
            { it.onConnect(); it.onSocketOpen() },
            { it.onConnect(); it.onSocketOpen(); it.onRegistered() }
        ).forEach { setup ->
            val m = machine()
            setup(m)
            m.onDisconnect()
            assertTrue("Expected Disconnected but got ${m.current}", m.current is ClientState.Disconnected)
        }
    }

    @Test
    fun `isReady is only true when Registered`() {
        val m = machine()
        assertFalse(m.current.isReady)
        m.onConnect()
        assertFalse(m.current.isReady)
        m.onSocketOpen()
        assertFalse(m.current.isReady)
        m.onRegistered()
        assertTrue(m.current.isReady)
        m.onDisconnect()
        assertFalse(m.current.isReady)
    }

    @Test
    fun `reset returns to Idle`() {
        val m = machine()
        m.onConnect()
        m.onSocketOpen()
        m.onRegistered()
        m.reset()
        assertTrue(m.current is ClientState.Idle)
    }

    @Test
    fun `fatal error is non-recoverable`() {
        val m = machine()
        m.onConnect()
        m.onError("auth_failed", recoverable = false)
        val state = m.current as ClientState.Error
        assertFalse(state.recoverable)
    }

    @Test
    fun `state flow current value reflects transitions`() {
        val m = machine()
        assertTrue(m.state.value is ClientState.Idle)
        m.onConnect()
        assertTrue(m.state.value is ClientState.Connecting)
        m.onSocketOpen()
        assertTrue(m.state.value is ClientState.SocketOpenAwaitingRegister)
        m.onRegistered()
        assertTrue(m.state.value is ClientState.Registered)
        m.onDisconnect()
        assertTrue(m.state.value is ClientState.Disconnected)
    }
}
