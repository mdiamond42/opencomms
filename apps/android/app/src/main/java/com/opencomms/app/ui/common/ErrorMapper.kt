package com.opencomms.app.ui.common

import android.content.Context
import com.opencomms.app.R
import com.opencomms.app.pairing.PairingError

object ErrorMapper {

    fun pairingErrorMessage(context: Context, error: PairingError): String = when (error) {
        is PairingError.MalformedJson -> context.getString(R.string.pairing_error_malformed_json)
        is PairingError.UnsupportedType -> context.getString(R.string.pairing_error_unsupported_type)
        is PairingError.MissingRelay -> context.getString(R.string.pairing_error_missing_relay)
        is PairingError.MissingContact -> context.getString(R.string.pairing_error_missing_contact)
        is PairingError.BadKind -> context.getString(R.string.pairing_error_bad_kind)
        is PairingError.Expired -> context.getString(R.string.pairing_error_expired)
        is PairingError.MissingToken -> context.getString(R.string.pairing_error_missing_token)
        is PairingError.EndpointNotImplemented -> context.getString(R.string.pairing_error_endpoint_not_implemented)
    }

    fun relayErrorMessage(context: Context, code: String, relayMessage: String): String = when (code) {
        "unknown_recipient" -> context.getString(R.string.relay_error_unknown_recipient)
        "unauthorized", "auth_failed" -> context.getString(R.string.relay_error_unauthorized)
        "rate_limited" -> context.getString(R.string.relay_error_rate_limited)
        else -> context.getString(R.string.relay_error_generic, code)
    }
}
