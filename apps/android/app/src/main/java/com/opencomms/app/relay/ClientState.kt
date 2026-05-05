package com.opencomms.app.relay

sealed class ClientState {
    object Idle : ClientState()
    object Connecting : ClientState()
    object SocketOpenAwaitingRegister : ClientState()
    object Registered : ClientState()
    data class Error(val message: String, val recoverable: Boolean) : ClientState()
    object Disconnected : ClientState()

    val isReady: Boolean get() = this is Registered
}
