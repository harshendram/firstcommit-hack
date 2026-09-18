package com.rakshak.wear

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import com.rakshak.wear.ui.RakshakWatchScreen

class MainActivity : ComponentActivity() {
    private val viewModel: RakshakViewModel by viewModels()

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { /* no-op */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Keep screen awake during check-in / SOS conversation
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val perms = mutableListOf(
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.BODY_SENSORS,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            perms += Manifest.permission.ACTIVITY_RECOGNITION
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            perms += "android.permission.HIGH_SAMPLING_RATE_SENSORS"
        }
        permissionLauncher.launch(perms.toTypedArray())
        viewModel.connect()

        setContent {
            val state by viewModel.uiState.collectAsState()
            RakshakWatchScreen(
                state = state,
                onCheckIn = { viewModel.startCheckIn() },
                onStartMic = { viewModel.startMicCapture() },
                onStopMic = { viewModel.stopMicCapture() },
                onSimulateFall = { viewModel.triggerFallManually() },
                onImOkay = { viewModel.imOkay() },
            )
        }
    }
}
