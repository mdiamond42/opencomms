package com.opencomms.app.diagnostics

import com.opencomms.app.pairing.PairingParser
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import android.app.Application
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = Application::class)
class DiagnosticsExporterTest {

    private val placeholderToken = "DEV-PAIRING-TOKEN-PLACEHOLDER"
    private val placeholderMessageBody = "placeholder message body content xyz"

    @Test
    fun `export file does not contain literal token string`() {
        val context = RuntimeEnvironment.getApplication()
        val exporter = DiagnosticsExporter(context)
        val file = exporter.export()
        val content = file.readText()
        assertFalse(
            "Diagnostics export must not contain the literal token string",
            content.contains(placeholderToken)
        )
    }

    @Test
    fun `export file does not contain message body fixture text`() {
        val context = RuntimeEnvironment.getApplication()
        val exporter = DiagnosticsExporter(context)
        val file = exporter.export()
        val content = file.readText()
        assertFalse(
            "Diagnostics export must not contain message body text",
            content.contains(placeholderMessageBody)
        )
    }

    @Test
    fun `export produces valid JSON`() {
        val context = RuntimeEnvironment.getApplication()
        val exporter = DiagnosticsExporter(context)
        val file = exporter.export()
        val content = file.readText()
        val parsed = runCatching { Json.parseToJsonElement(content).jsonObject }
        assertTrue("Export must be valid JSON", parsed.isSuccess)
    }

    @Test
    fun `export contains required top-level fields`() {
        val context = RuntimeEnvironment.getApplication()
        val exporter = DiagnosticsExporter(context)
        val file = exporter.export()
        val obj = Json.parseToJsonElement(file.readText()).jsonObject
        assertNotNull(obj["generated_at"])
        assertNotNull(obj["identity"])
        assertNotNull(obj["contacts"])
        assertNotNull(obj["relay_accounts"])
        assertNotNull(obj["note"])
    }

    @Test
    fun `export note explicitly states exclusions`() {
        val context = RuntimeEnvironment.getApplication()
        val exporter = DiagnosticsExporter(context)
        val file = exporter.export()
        val obj = Json.parseToJsonElement(file.readText()).jsonObject
        val note = obj["note"]?.jsonPrimitive?.content ?: ""
        assertTrue("Note should mention token exclusion", note.contains("Tokens", ignoreCase = true))
        assertTrue("Note should mention message body exclusion", note.contains("message", ignoreCase = true))
    }
}
