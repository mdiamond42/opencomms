package com.opencomms.app.ui.pairing

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingScreenStateTest {

    @Test
    fun `scan tab hides camera after successful QR validation so contact card is visible`() {
        assertTrue(shouldShowQrScanner(selectedTab = 0, hasValidatedPayload = false))
        assertFalse(shouldShowQrScanner(selectedTab = 0, hasValidatedPayload = true))
        assertFalse(shouldShowQrScanner(selectedTab = 1, hasValidatedPayload = false))
    }
}
