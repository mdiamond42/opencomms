package com.opencomms.app.relay

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class ClientStateMachine {

    private val _state = MutableStateFlow<ClientState>(ClientState.Idle)
    val state: StateFlow<ClientState> = _state.asStateFlow()

    val current: ClientState get() = _state.value

    fun onConnect() {
        _state.value = ClientState.Connecting
    }

    fun onSocketOpen() {
        _state.value = ClientState.SocketOpenAwaitingRegister
    }

    fun onRegistered() {
        _state.value = ClientState.Registered
    }

    fun onError(message: String, recoverable: Boolean = true) {
        _state.value = ClientState.Error(message, recoverable)
    }

    fun onDisconnect() {
        _state.value = ClientState.Disconnected
    }

    fun reset() {
        _state.value = ClientState.Idle
    }
}
