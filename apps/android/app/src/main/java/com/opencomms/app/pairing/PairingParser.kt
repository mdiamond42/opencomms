package com.opencomms.app.pairing

import com.opencomms.app.protocol.ParticipantKind
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.URLDecoder
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

object PairingParser {

    private val json = Json { ignoreUnknownKeys = true }
    private val uuidPattern = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
    private val inviteKeys = setOf("type", "invite_id", "mode", "issuer", "subject", "relay_url", "public_key", "capabilities", "project_id", "project_name", "agent_ids", "issued_at", "expires_at", "nonce", "safety_code", "signature")
    private val agentCardKeys = setOf("type", "agent_id", "display_name", "kind", "relay_url", "pairing_endpoint", "public_key", "capabilities", "issued_at", "expires_at", "signature")
    private val partyKeys = setOf("id", "kind", "display_name")
    private val publicKeyKeys = setOf("alg", "kid", "value")

    fun parse(raw: String): Result<PairingPayload> {
        val normalized = normalizeInviteLink(raw)
        val normalizedRaw = normalized.json
        val obj: JsonObject = runCatching {
            json.parseToJsonElement(normalizedRaw).jsonObject
        }.getOrElse { return Result.failure(PairingError.MalformedJson) }

        val type = requiredString(obj, "type").getOrElse { return Result.failure(PairingError.UnsupportedType) }
        if (normalized.fromInviteLink && type != "opencomms_pairing_invite_v1") {
            return Result.failure(PairingError.UnsupportedType)
        }
        if (normalized.fromTrustCard && type != "opencomms_agent_card_v1") {
            return Result.failure(PairingError.UnsupportedType)
        }

        val relayUrl = requiredString(obj, "relay_url").getOrElse { return Result.failure(PairingError.MissingRelay) }
            .takeIf { it.isNotBlank() }
            ?: return Result.failure(PairingError.MissingRelay)

        val pairingEndpoint = optionalString(obj, "pairing_endpoint").getOrElse { return Result.failure(PairingError.MissingContact) }
        val pairingToken = optionalString(obj, "pairing_token").getOrElse { return Result.failure(PairingError.MissingContact) }
        val token = optionalString(obj, "token").getOrElse { return Result.failure(PairingError.MissingContact) }
        val expiresAt = optionalString(obj, "expires_at").getOrElse { return Result.failure(PairingError.MissingContact) }
        val serverPublicKey = optionalString(obj, "server_public_key").getOrElse { return Result.failure(PairingError.MissingContact) }

        val contact: PairingContact = when {
            type == "opencomms_pairing_invite_v1" -> {
                validateInviteMetadata(obj).getOrElse { return Result.failure(it) }
                parseInviteSubject(obj).getOrElse { return Result.failure(it) }
            }
            type == "opencomms_agent_card_v1" -> {
                validateAgentCardMetadata(obj).getOrElse { return Result.failure(it) }
                val id = requiredString(obj, "agent_id").getOrElse { return Result.failure(PairingError.MissingContact) }.takeIf { it.isNotBlank() }
                    ?: return Result.failure(PairingError.MissingContact)
                val displayName = requiredString(obj, "display_name").getOrElse { return Result.failure(PairingError.MissingContact) }.takeIf { it.isNotBlank() }
                    ?: return Result.failure(PairingError.MissingContact)
                val capabilities = parseRequiredStringArray(obj["capabilities"]).getOrElse { return Result.failure(it) }
                PairingContact(id = id, displayName = displayName, kind = ParticipantKind.AGENT, capabilities = capabilities)
            }
            obj.containsKey("contact") -> {
                val contactObj = runCatching { obj["contact"]!!.jsonObject }
                    .getOrElse { return Result.failure(PairingError.MissingContact) }

                val id = requiredString(contactObj, "id").getOrElse { return Result.failure(PairingError.MissingContact) }.takeIf { it.isNotBlank() }
                    ?: return Result.failure(PairingError.MissingContact)
                val displayName = requiredString(contactObj, "display_name").getOrElse { return Result.failure(PairingError.MissingContact) }.takeIf { it.isNotBlank() }
                    ?: return Result.failure(PairingError.MissingContact)
                val kindStr = requiredString(contactObj, "kind").getOrElse { return Result.failure(PairingError.BadKind) }
                val kind = ParticipantKind.fromString(kindStr)
                    ?: return Result.failure(PairingError.BadKind)
                val capabilities = runCatching {
                    contactObj["capabilities"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()
                }.getOrElse { emptyList() }

                PairingContact(id = id, displayName = displayName, kind = kind, capabilities = capabilities)
            }
            obj.containsKey("contact_id") -> {
                val id = requiredString(obj, "contact_id").getOrElse { return Result.failure(PairingError.MissingContact) }.takeIf { it.isNotBlank() }
                    ?: return Result.failure(PairingError.MissingContact)
                val displayName = requiredString(obj, "contact_display_name").getOrElse { return Result.failure(PairingError.MissingContact) }.takeIf { it.isNotBlank() }
                    ?: return Result.failure(PairingError.MissingContact)
                val kindStr = requiredString(obj, "contact_kind").getOrElse { return Result.failure(PairingError.BadKind) }
                val kind = ParticipantKind.fromString(kindStr)
                    ?: return Result.failure(PairingError.BadKind)

                PairingContact(id = id, displayName = displayName, kind = kind)
            }
            else -> return Result.failure(PairingError.MissingContact)
        }

        val issuer = if (type == "opencomms_pairing_invite_v1") {
            runCatching {
                val issuerObj = obj["issuer"]!!.jsonObject
                val kind = ParticipantKind.fromString(requiredString(issuerObj, "kind").getOrThrow())
                    ?: return Result.failure(PairingError.BadKind)
                if (kind != ParticipantKind.HUMAN) return Result.failure(PairingError.BadKind)
                PairingIssuer(
                    id = requiredString(issuerObj, "id").getOrThrow(),
                    kind = kind,
                    displayName = requiredString(issuerObj, "display_name").getOrThrow()
                )
            }.getOrElse { return Result.failure(PairingError.MissingContact) }
        } else null
        val agentIds = if (type == "opencomms_pairing_invite_v1") {
            parseOptionalStringArray(obj["agent_ids"]).getOrElse { return Result.failure(it) }
        } else {
            runCatching { obj["agent_ids"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList() }
                .getOrElse { emptyList() }
        }

        return Result.success(
            PairingPayload(
                type = type,
                relayUrl = relayUrl,
                pairingEndpoint = pairingEndpoint,
                pairingToken = pairingToken,
                token = token,
                expiresAt = expiresAt,
                contact = contact,
                serverPublicKey = serverPublicKey,
                inviteId = optionalString(obj, "invite_id").getOrElse { return Result.failure(PairingError.MissingContact) },
                mode = optionalString(obj, "mode").getOrElse { return Result.failure(PairingError.MissingContact) },
                issuer = issuer,
                projectId = optionalString(obj, "project_id").getOrElse { return Result.failure(PairingError.MissingContact) },
                projectName = optionalString(obj, "project_name").getOrElse { return Result.failure(PairingError.MissingContact) },
                agentIds = agentIds,
                safetyCode = optionalString(obj, "safety_code").getOrElse { return Result.failure(PairingError.MissingContact) }
            )
        )
    }

    private fun parseInviteSubject(obj: JsonObject): Result<PairingContact> {
        val subjectObj = runCatching { obj["subject"]!!.jsonObject }
            .getOrElse { return Result.failure(PairingError.MissingContact) }
        val id = requiredString(subjectObj, "id").getOrElse { return Result.failure(PairingError.MissingContact) }.takeIf { it.isNotBlank() }
            ?: return Result.failure(PairingError.MissingContact)
        val displayName = requiredString(subjectObj, "display_name").getOrElse { return Result.failure(PairingError.MissingContact) }.takeIf { it.isNotBlank() }
            ?: return Result.failure(PairingError.MissingContact)
        val kindStr = requiredString(subjectObj, "kind").getOrElse { return Result.failure(PairingError.BadKind) }
        val kind = ParticipantKind.fromString(kindStr)
            ?: return Result.failure(PairingError.BadKind)
        val capabilities = parseRequiredStringArray(obj["capabilities"]).getOrElse { return Result.failure(it) }
        return Result.success(PairingContact(id = id, displayName = displayName, kind = kind, capabilities = capabilities))
    }

    private fun validateAgentCardMetadata(obj: JsonObject): Result<Unit> {
        requireOnlyKeys(obj, agentCardKeys).getOrElse { return Result.failure(it) }
        if (requiredString(obj, "type").getOrElse { return Result.failure(PairingError.UnsupportedType) } != "opencomms_agent_card_v1") {
            return Result.failure(PairingError.UnsupportedType)
        }
        if (requiredString(obj, "kind").getOrElse { return Result.failure(PairingError.BadKind) } != "agent") {
            return Result.failure(PairingError.BadKind)
        }
        requiredString(obj, "agent_id").getOrElse { return Result.failure(PairingError.MissingContact) }.takeIf { it.isNotBlank() }
            ?: return Result.failure(PairingError.MissingContact)
        requiredString(obj, "display_name").getOrElse { return Result.failure(PairingError.MissingContact) }.takeIf { it.isNotBlank() }
            ?: return Result.failure(PairingError.MissingContact)
        requiredString(obj, "issued_at").getOrElse { return Result.failure(PairingError.MissingContact) }
        optionalString(obj, "expires_at").getOrElse { return Result.failure(PairingError.MissingContact) }
        optionalString(obj, "pairing_endpoint").getOrElse { return Result.failure(PairingError.MissingContact) }
        parseRequiredStringArray(obj["capabilities"]).getOrElse { return Result.failure(it) }
        val signature = requiredString(obj, "signature").getOrElse { return Result.failure(PairingError.MissingContact) }.takeIf { it.isNotBlank() }
            ?: return Result.failure(PairingError.MissingContact)
        val publicKeyObj = runCatching { obj["public_key"]!!.jsonObject }
            .getOrElse { return Result.failure(PairingError.MissingContact) }
        requireOnlyKeys(publicKeyObj, publicKeyKeys).getOrElse { return Result.failure(it) }
        val alg = requiredString(publicKeyObj, "alg").getOrElse { return Result.failure(PairingError.MissingContact) }
        val value = requiredString(publicKeyObj, "value").getOrElse { return Result.failure(PairingError.MissingContact) }.takeIf { it.isNotBlank() }
            ?: return Result.failure(PairingError.MissingContact)
        val kid = requiredString(publicKeyObj, "kid").getOrElse { return Result.failure(PairingError.MissingContact) }.takeIf { it.isNotBlank() }
            ?: return Result.failure(PairingError.MissingContact)
        if (alg != "ed25519" || kid.isBlank() || !verifyInviteSignature(obj, value, signature)) {
            return Result.failure(PairingError.MissingContact)
        }
        return Result.success(Unit)
    }

    private fun validateInviteMetadata(obj: JsonObject): Result<Unit> {
        requireOnlyKeys(obj, inviteKeys).getOrElse { return Result.failure(it) }
        val inviteId = requiredString(obj, "invite_id").getOrElse { return Result.failure(PairingError.MissingContact) }.takeIf { it.isNotBlank() }
            ?: return Result.failure(PairingError.MissingContact)
        if (!uuidPattern.matches(inviteId)) return Result.failure(PairingError.MissingContact)
        requiredString(obj, "issued_at").getOrElse { return Result.failure(PairingError.MissingContact) }
        requiredString(obj, "expires_at").getOrElse { return Result.failure(PairingError.MissingContact) }
        val nonce = requiredString(obj, "nonce").getOrElse { return Result.failure(PairingError.MissingContact) }.takeIf { it.isNotBlank() }
            ?: return Result.failure(PairingError.MissingContact)
        val signature = requiredString(obj, "signature").getOrElse { return Result.failure(PairingError.MissingContact) }.takeIf { it.isNotBlank() }
            ?: return Result.failure(PairingError.MissingContact)
        val publicKeyObj = runCatching { obj["public_key"]!!.jsonObject }
            .getOrElse { return Result.failure(PairingError.MissingContact) }
        requireOnlyKeys(publicKeyObj, publicKeyKeys).getOrElse { return Result.failure(it) }
        val alg = requiredString(publicKeyObj, "alg").getOrElse { return Result.failure(PairingError.MissingContact) }
        val kid = requiredString(publicKeyObj, "kid").getOrElse { return Result.failure(PairingError.MissingContact) }.takeIf { it.isNotBlank() }
            ?: return Result.failure(PairingError.MissingContact)
        val value = requiredString(publicKeyObj, "value").getOrElse { return Result.failure(PairingError.MissingContact) }.takeIf { it.isNotBlank() }
            ?: return Result.failure(PairingError.MissingContact)
        if (alg != "ed25519" || inviteId.isBlank() || nonce.isBlank() || signature.isBlank() || kid.isBlank() || value.isBlank()) {
            return Result.failure(PairingError.MissingContact)
        }
        val issuerObj = runCatching { obj["issuer"]!!.jsonObject }.getOrElse { return Result.failure(PairingError.MissingContact) }
        requireOnlyKeys(issuerObj, partyKeys).getOrElse { return Result.failure(it) }
        if (requiredString(issuerObj, "kind").getOrElse { return Result.failure(PairingError.MissingContact) } != "human") {
            return Result.failure(PairingError.BadKind)
        }
        val subjectObj = runCatching { obj["subject"]!!.jsonObject }.getOrElse { return Result.failure(PairingError.MissingContact) }
        requireOnlyKeys(subjectObj, partyKeys).getOrElse { return Result.failure(it) }
        val mode = requiredString(obj, "mode").getOrElse { return Result.failure(PairingError.MissingContact) }
        val subjectKind = requiredString(subjectObj, "kind").getOrElse { return Result.failure(PairingError.MissingContact) }
        when (mode) {
            "human_to_human" -> {
                if (subjectKind != "human") return Result.failure(PairingError.BadKind)
                if (hasNonNull(obj, "project_id") || hasNonNull(obj, "project_name") || hasNonNull(obj, "agent_ids")) {
                    return Result.failure(PairingError.MissingContact)
                }
            }
            "own_agent" -> {
                if (subjectKind != "agent") return Result.failure(PairingError.BadKind)
                if (hasNonNull(obj, "project_id") || hasNonNull(obj, "project_name") || hasNonNull(obj, "agent_ids")) {
                    return Result.failure(PairingError.MissingContact)
                }
            }
            "friend_project_agents" -> {
                if (subjectKind != "human" && subjectKind != "agent") return Result.failure(PairingError.BadKind)
                val projectId = optionalString(obj, "project_id").getOrElse { return Result.failure(PairingError.MissingContact) }
                val projectName = optionalString(obj, "project_name").getOrElse { return Result.failure(PairingError.MissingContact) }
                if (projectId.isNullOrBlank() || projectName.isNullOrBlank()) return Result.failure(PairingError.MissingContact)
                val agentIds = parseRequiredStringArray(obj["agent_ids"]).getOrElse { return Result.failure(it) }
                if (agentIds.isEmpty()) return Result.failure(PairingError.MissingContact)
            }
            else -> return Result.failure(PairingError.UnsupportedType)
        }
        parseRequiredStringArray(obj["capabilities"]).getOrElse { return Result.failure(it) }
        if (mode != "friend_project_agents") parseOptionalStringArray(obj["agent_ids"]).getOrElse { return Result.failure(it) }
        if (!verifyInviteSignature(obj, value, signature)) return Result.failure(PairingError.MissingContact)
        return Result.success(Unit)
    }

    private fun requiredString(obj: JsonObject, key: String): Result<String> {
        val primitive = runCatching { obj[key]!!.jsonPrimitive }.getOrElse { return Result.failure(PairingError.MissingContact) }
        if (!primitive.isString) return Result.failure(PairingError.MissingContact)
        return Result.success(primitive.content)
    }

    private fun requireOnlyKeys(obj: JsonObject, allowed: Set<String>): Result<Unit> {
        return if (obj.keys.all { allowed.contains(it) }) Result.success(Unit) else Result.failure(PairingError.MissingContact)
    }

    private fun optionalString(obj: JsonObject, key: String): Result<String?> {
        val element = obj[key] ?: return Result.success(null)
        if (element is JsonNull) return Result.success(null)
        val primitive = runCatching { element.jsonPrimitive }.getOrElse { return Result.failure(PairingError.MissingContact) }
        if (!primitive.isString) return Result.failure(PairingError.MissingContact)
        return Result.success(primitive.content)
    }

    private fun parseRequiredStringArray(element: JsonElement?): Result<List<String>> {
        val array = runCatching { element!!.jsonArray }
            .getOrElse { return Result.failure(PairingError.MissingContact) }
        val values = array.map { item ->
            val primitive = runCatching { item.jsonPrimitive }
                .getOrElse { return Result.failure(PairingError.MissingContact) }
            if (!primitive.isString) return Result.failure(PairingError.MissingContact)
            primitive.content
        }
        if (values.any { it.isBlank() }) return Result.failure(PairingError.MissingContact)
        if (values != values.distinct().sorted()) return Result.failure(PairingError.MissingContact)
        return Result.success(values)
    }

    private fun hasNonNull(obj: JsonObject, key: String): Boolean {
        val element = obj[key] ?: return false
        return element !is JsonNull
    }

    private fun parseOptionalStringArray(element: JsonElement?): Result<List<String>> {
        if (element == null || element is JsonNull) return Result.success(emptyList())
        val array = runCatching { element.jsonArray }
            .getOrElse { return Result.failure(PairingError.MissingContact) }
        val values = array.map { item ->
            val primitive = runCatching { item.jsonPrimitive }
                .getOrElse { return Result.failure(PairingError.MissingContact) }
            if (!primitive.isString) return Result.failure(PairingError.MissingContact)
            primitive.content
        }
        if (values.any { it.isBlank() }) return Result.failure(PairingError.MissingContact)
        if (values != values.distinct().sorted()) return Result.failure(PairingError.MissingContact)
        return Result.success(values)
    }

    private data class NormalizedInvite(val json: String, val fromInviteLink: Boolean, val fromTrustCard: Boolean)

    private fun normalizeInviteLink(raw: String): NormalizedInvite {
        val trimmed = raw.trim()
        val candidate = extractSupportedPairingUri(trimmed) ?: return NormalizedInvite(raw, false, false)
        val query = candidate.substringAfter("?", "").substringBefore("#")
        val fragment = candidate.substringAfter("#", "")
        val invite = query.split("&").firstOrNull { it.startsWith("invite=") }?.substringAfter("invite=")
            ?: fragment.split("&").firstOrNull { it.startsWith("invite=") }?.substringAfter("invite=")
        val card = query.split("&").firstOrNull { it.startsWith("card=") }?.substringAfter("card=")
            ?: fragment.split("&").firstOrNull { it.startsWith("card=") }?.substringAfter("card=")
        val encoded = invite ?: card ?: return NormalizedInvite(raw, false, false)
        return runCatching {
            NormalizedInvite(
                String(Base64.getUrlDecoder().decode(URLDecoder.decode(encoded, "UTF-8"))),
                invite != null,
                card != null && invite == null
            )
        }.getOrElse { NormalizedInvite(raw, false, false) }
    }

    private fun extractSupportedPairingUri(trimmed: String): String? {
        val direct = when {
            trimmed.startsWith("opencomms://pair?") -> trimmed
            trimmed.startsWith("${"https"}://opencomms.local/pair#") -> trimmed
            else -> null
        }
        if (direct != null) return direct
        val webFallbackPattern = "${"https"}://opencomms\\.local/pair#[^\\s<>\"']+"
        return Regex("(?:opencomms://pair\\?[^\\s<>\"']+|$webFallbackPattern)")
            .find(trimmed)
            ?.value
    }

    private fun verifyInviteSignature(obj: JsonObject, publicKeyBase64Url: String, signatureBase64Url: String): Boolean = runCatching {
        val rawPublicKey = Base64.getUrlDecoder().decode(publicKeyBase64Url)
        val signatureBytes = Base64.getUrlDecoder().decode(signatureBase64Url)
        require(rawPublicKey.size == 32 && signatureBytes.size == 64)
        val payload = JsonObject(obj.filterKeys { it != "signature" })
        val keyPrefix = byteArrayOf(
            0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00
        )
        val publicKey = KeyFactory.getInstance("Ed25519")
            .generatePublic(X509EncodedKeySpec(keyPrefix + rawPublicKey))
        val verifier = Signature.getInstance("Ed25519")
        verifier.initVerify(publicKey)
        verifier.update(canonicalize(payload).toByteArray(Charsets.UTF_8))
        verifier.verify(signatureBytes)
    }.getOrDefault(false)

    private fun canonicalize(element: JsonElement): String = when (element) {
        is JsonObject -> element.keys.sorted().joinToString(prefix = "{", postfix = "}", separator = ",") { key ->
            jsonString(key) + ":" + canonicalize(element.getValue(key))
        }
        is kotlinx.serialization.json.JsonArray -> element.joinToString(prefix = "[", postfix = "]", separator = ",") { canonicalize(it) }
        is JsonPrimitive -> when {
            element.isString -> jsonString(element.content)
            element.booleanOrNull != null -> element.content
            else -> element.content
        }
        else -> error("Unsupported JSON element")
    }

    private fun jsonString(value: String): String = buildString {
        append('"')
        for (ch in value) {
            when (ch) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\u000C' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (ch < ' ') append("\\u%04x".format(ch.code)) else append(ch)
            }
        }
        append('"')
    }
}
