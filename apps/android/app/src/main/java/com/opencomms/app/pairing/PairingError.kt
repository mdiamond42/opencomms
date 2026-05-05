package com.opencomms.app.pairing

sealed class PairingError : Exception() {
    object MalformedJson : PairingError()
    object UnsupportedType : PairingError()
    object MissingRelay : PairingError()
    object MissingContact : PairingError()
    object BadKind : PairingError()
    object Expired : PairingError()
    object MissingToken : PairingError()
    object EndpointNotImplemented : PairingError()
}
