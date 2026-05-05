package com.opencomms.app.ui.common

import com.opencomms.app.protocol.ParticipantKind

fun kindLabel(kind: ParticipantKind): String = when (kind) {
    ParticipantKind.HUMAN -> "Human"
    ParticipantKind.AGENT -> "Agent"
    ParticipantKind.DEVICE -> "Device"
    ParticipantKind.SERVICE -> "Service"
}
