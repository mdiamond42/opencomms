package com.opencomms.app.ui.common

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    primary = Color(0xFF1565C0),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD0E4FF),
    secondary = Color(0xFF455A64),
    surface = Color(0xFFFAFAFA),
    background = Color(0xFFF5F5F5),
    error = Color(0xFFB00020)
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF90CAF9),
    onPrimary = Color(0xFF003063),
    primaryContainer = Color(0xFF004494),
    secondary = Color(0xFF90A4AE),
    surface = Color(0xFF1E1E1E),
    background = Color(0xFF121212),
    error = Color(0xFFCF6679)
)

@Composable
fun OpenCommsTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content
    )
}
