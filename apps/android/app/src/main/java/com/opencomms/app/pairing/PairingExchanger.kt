package com.opencomms.app.pairing

interface PairingExchanger {
    suspend fun exchange(payload: PairingPayload): Result<String>
}

class NotImplementedExchanger : PairingExchanger {
    override suspend fun exchange(payload: PairingPayload): Result<String> =
        Result.failure(PairingError.EndpointNotImplemented)
}
