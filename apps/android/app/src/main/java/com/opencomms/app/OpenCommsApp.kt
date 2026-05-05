package com.opencomms.app

import android.app.Application

class OpenCommsApp : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    companion object {
        lateinit var instance: OpenCommsApp
            private set
    }
}
