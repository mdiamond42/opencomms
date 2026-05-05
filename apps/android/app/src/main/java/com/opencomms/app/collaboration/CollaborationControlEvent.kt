package com.opencomms.app.collaboration

enum class CollaborationControlEvent(val wireName: String, val humanMessage: String) {
    DISCONNECT("disconnect", "The collaboration has been disconnected by the authorizer."),
    RECONNECT("reconnect", "The collaboration has been reconnected by the authorizer."),
    REVOKE("revoke", "The collaboration authorization has been revoked by the authorizer.")
}
