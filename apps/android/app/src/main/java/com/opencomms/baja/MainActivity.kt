package com.opencomms.baja

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.opencomms.app.ui.MainActivity as AppMainActivity

/**
 * Legacy launcher shim. Redirects to the new com.opencomms.app.ui.MainActivity.
 * This class exists so the applicationId (com.opencomms.baja) can remain unchanged
 * during this build cycle. Once a Play Store release is in scope, rename the applicationId
 * to com.opencomms.app and remove this shim.
 */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivity(Intent(this, AppMainActivity::class.java))
        finish()
    }
}
