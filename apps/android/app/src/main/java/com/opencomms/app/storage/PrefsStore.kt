package com.opencomms.app.storage

import android.content.Context
import android.content.SharedPreferences
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private const val PREFS_NAME = "opencomms_prefs"

object PrefsStore {

    @PublishedApi
    internal val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getString(context: Context, key: String): String? =
        prefs(context).getString(key, null)

    fun putString(context: Context, key: String, value: String) {
        prefs(context).edit().putString(key, value).apply()
    }

    fun remove(context: Context, key: String) {
        prefs(context).edit().remove(key).apply()
    }

    fun clearAll(context: Context) {
        prefs(context).edit().clear().apply()
    }

    inline fun <reified T> getObject(context: Context, key: String): T? {
        val raw = getString(context, key) ?: return null
        return runCatching { json.decodeFromString<T>(raw) }.getOrNull()
    }

    inline fun <reified T> putObject(context: Context, key: String, value: T) {
        putString(context, key, json.encodeToString(value))
    }
}
