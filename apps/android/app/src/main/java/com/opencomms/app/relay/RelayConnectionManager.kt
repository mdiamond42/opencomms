package com.opencomms.app.relay

import android.content.Context
import com.opencomms.app.protocol.RelayFrame
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow

class RelayConnectionManager(private val context: Context) {

    private val clients = mutableMapOf<String, RelayClient>()

    fun getOrCreate(account: RelayAccount, userId: String): RelayClient =
        clients.getOrPut(account.id) {
            RelayClient(account = account, userId = userId)
        }

    fun getClient(accountId: String): RelayClient? = clients[accountId]

    fun stateFor(accountId: String): StateFlow<ClientState>? = clients[accountId]?.state

    fun framesFor(accountId: String): SharedFlow<RelayFrame>? = clients[accountId]?.frames

    fun connectAll() = clients.values.forEach { it.connect() }

    fun disconnectAll() = clients.values.forEach { it.disconnect() }

    fun remove(accountId: String) {
        clients[accountId]?.disconnect()
        clients.remove(accountId)
    }

    companion object {
        @Volatile
        private var INSTANCE: RelayConnectionManager? = null

        fun getInstance(context: Context): RelayConnectionManager =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: RelayConnectionManager(context.applicationContext).also { INSTANCE = it }
            }
    }
}
