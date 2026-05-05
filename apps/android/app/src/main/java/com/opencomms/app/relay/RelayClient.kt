package com.opencomms.app.relay

import android.util.Log
import com.opencomms.app.BuildConfig
import com.opencomms.app.protocol.RelayFrame
import com.opencomms.app.protocol.RelayFrameCodec
import com.opencomms.app.protocol.RegisterFrameBuilder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

private const val TAG = "RelayClient"
private val BACKOFF_DELAYS_MS = listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L)

class RelayClient(
    private val account: RelayAccount,
    private val userId: String
) {
    private val stateMachine = ClientStateMachine()
    val state: StateFlow<ClientState> = stateMachine.state

    private val _frames = MutableSharedFlow<RelayFrame>(extraBufferCapacity = 64)
    val frames: SharedFlow<RelayFrame> = _frames.asSharedFlow()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private var webSocket: WebSocket? = null
    private var reconnectAttempt = 0
    private var active = false

    private val okHttp = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    fun connect() {
        active = true
        reconnectAttempt = 0
        doConnect()
    }

    fun disconnect() {
        active = false
        webSocket?.close(1000, "User disconnected")
        webSocket = null
        stateMachine.onDisconnect()
    }

    fun send(jsonFrame: String): Boolean {
        val ws = webSocket ?: return false
        if (stateMachine.current !is ClientState.Registered) return false
        return ws.send(jsonFrame)
    }

    private fun doConnect() {
        stateMachine.onConnect()
        val wsUrl = account.relayUrl
            .replace("https://", "wss://")
            .replace("http://", "ws://")
            .trimEnd('/') + "/v0/ws"

        val request = Request.Builder()
            .url(wsUrl)
            .addHeader("Authorization", "Bearer ${account.token}")
            .build()

        webSocket = okHttp.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (BuildConfig.DEBUG) Log.d(TAG, "Socket open, sending register")
                stateMachine.onSocketOpen()
                reconnectAttempt = 0
                val frame = RegisterFrameBuilder.build(
                    userId = userId,
                    token = account.token
                )
                webSocket.send(frame)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val frame = RelayFrameCodec.decode(text)
                when (frame) {
                    is RelayFrame.Registered -> {
                        if (BuildConfig.DEBUG) Log.d(TAG, "Registered as ${frame.userId}; users online=${frame.usersOnline.size}")
                        stateMachine.onRegistered()
                    }
                    is RelayFrame.RelayError -> {
                        Log.e(TAG, "Relay error: ${frame.displayMessage}")
                        stateMachine.onError(frame.displayMessage, recoverable = true)
                    }
                    else -> {}
                }
                scope.launch { _frames.emit(frame) }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (BuildConfig.DEBUG) Log.d(TAG, "Socket closed: $code")
                stateMachine.onDisconnect()
                scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure, will reconnect")
                stateMachine.onDisconnect()
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        if (!active) return
        val delay = BACKOFF_DELAYS_MS.getOrElse(reconnectAttempt) { BACKOFF_DELAYS_MS.last() }
        reconnectAttempt++
        scope.launch {
            delay(delay)
            if (active) doConnect()
        }
    }
}
