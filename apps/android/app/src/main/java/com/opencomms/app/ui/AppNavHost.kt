package com.opencomms.app.ui

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.opencomms.app.identity.IdentityRepository
import com.opencomms.app.ui.chat.ChatScreen
import com.opencomms.app.ui.collaboration.ConnectAgentsScreen
import com.opencomms.app.ui.contacts.ContactsScreen
import com.opencomms.app.ui.onboarding.OnboardingScreen
import com.opencomms.app.ui.pairing.PairingScreen
import com.opencomms.app.ui.settings.SettingsScreen

object Routes {
    const val ONBOARDING = "onboarding"
    const val CONTACTS = "contacts"
    const val PAIRING = "pairing"
    const val CONNECT_AGENTS = "connect_agents"
    const val CHAT = "chat/{contactId}"
    const val SETTINGS = "settings"

    fun chat(contactId: String) = "chat/$contactId"
}

@Composable
fun AppNavHost() {
    val context = LocalContext.current
    val navController = rememberNavController()
    val startDestination = determineStart(context)

    NavHost(navController = navController, startDestination = startDestination) {
        composable(Routes.ONBOARDING) {
            OnboardingScreen(
                onComplete = { navController.navigate(Routes.CONTACTS) {
                    popUpTo(Routes.ONBOARDING) { inclusive = true }
                }},
                onScanQr = { navController.navigate(Routes.PAIRING) },
                onPastePayload = { navController.navigate(Routes.PAIRING) }
            )
        }
        composable(Routes.CONTACTS) {
            ContactsScreen(
                onContactClick = { contactId -> navController.navigate(Routes.chat(contactId)) },
                onAddContact = { navController.navigate(Routes.PAIRING) },
                onConnectAgents = { navController.navigate(Routes.CONNECT_AGENTS) },
                onSettings = { navController.navigate(Routes.SETTINGS) }
            )
        }
        composable(Routes.PAIRING) {
            PairingScreen(
                onBack = { navController.popBackStack() },
                onPaired = { navController.popBackStack() }
            )
        }
        composable(Routes.CONNECT_AGENTS) {
            ConnectAgentsScreen(onBack = { navController.popBackStack() })
        }
        composable(
            route = Routes.CHAT,
            arguments = listOf(navArgument("contactId") { type = NavType.StringType })
        ) { backStackEntry ->
            val contactId = backStackEntry.arguments?.getString("contactId") ?: return@composable
            ChatScreen(
                contactId = contactId,
                onBack = { navController.popBackStack() }
            )
        }
        composable(Routes.SETTINGS) {
            SettingsScreen(
                onBack = { navController.popBackStack() },
                onIdentityRegenerated = {
                    navController.navigate(Routes.ONBOARDING) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }
    }
}

private fun determineStart(context: Context): String {
    val identity = IdentityRepository(context).get()
    return if (identity == null) Routes.ONBOARDING else Routes.CONTACTS
}
