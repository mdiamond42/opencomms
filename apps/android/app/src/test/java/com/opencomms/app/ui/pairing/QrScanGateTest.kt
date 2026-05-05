package com.opencomms.app.ui.pairing

import org.junit.Assert.assertEquals
import org.junit.Test

class QrScanGateTest {

    @Test
    fun `rejected QR does not permanently lock scanner`() {
        val gate = QrScanGate()
        val seen = mutableListOf<String>()

        val first = gate.tryAccept("bad-qr") { raw ->
            seen += raw
            false
        }
        val second = gate.tryAccept("good-qr") { raw ->
            seen += raw
            true
        }

        assertEquals(QrScanOutcome.Rejected, first)
        assertEquals(QrScanOutcome.Accepted, second)
        assertEquals(listOf("bad-qr", "good-qr"), seen)
    }

    @Test
    fun `accepted QR locks duplicate analyzer callbacks`() {
        val gate = QrScanGate()
        var acceptedCalls = 0

        val first = gate.tryAccept("good-qr") {
            acceptedCalls += 1
            true
        }
        val second = gate.tryAccept("good-qr-again") {
            acceptedCalls += 1
            true
        }

        assertEquals(QrScanOutcome.Accepted, first)
        assertEquals(QrScanOutcome.IgnoredAlreadyAccepted, second)
        assertEquals(1, acceptedCalls)
    }

    @Test
    fun `manual reset re-enables scanner after accepted QR`() {
        val gate = QrScanGate()

        assertEquals(QrScanOutcome.Accepted, gate.tryAccept("first") { true })
        gate.reset()
        assertEquals(QrScanOutcome.Accepted, gate.tryAccept("second") { true })
    }
}
