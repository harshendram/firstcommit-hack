package com.rakshak.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.rakshak.wear.WatchMode
import com.rakshak.wear.WatchUiState

@Composable
fun RakshakWatchScreen(
    state: WatchUiState,
    onCheckIn: () -> Unit,
    onStartMic: () -> Unit,
    onStopMic: () -> Unit,
    onSimulateFall: () -> Unit,
    onImOkay: () -> Unit = {},
) {
    val sos = state.mode == WatchMode.SOS
    val canStartCheckIn =
        !sos && state.connected && (state.phase == "idle" || state.phase == "complete")
    val checkInActive = state.conversationLive

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(if (sos) Color(0xFF1A0A0A) else Color(0xFF0A111A))
            .padding(12.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = if (sos) "SOS" else "ALLY",
            style = MaterialTheme.typography.title3,
            color = if (sos) Color(0xFFF87171) else Color(0xFF5EEAD4),
            textAlign = TextAlign.Center,
        )
        Text(
            text = state.statusMessage,
            style = MaterialTheme.typography.caption2,
            color = when {
                sos -> Color(0xFFFECACA)
                canStartCheckIn -> Color(0xFF34D399)
                else -> Color(0xFF9BB3D0)
            },
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 4.dp, bottom = 4.dp),
        )
        if (canStartCheckIn) {
            Text(
                text = if (state.fallArmed) "Companion · first movement on" else "Companion",
                style = MaterialTheme.typography.caption3,
                color = Color(0xFF6B849E),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(bottom = 8.dp),
            )
        } else if (state.measuringVitals || !state.vitalsLine.isNullOrBlank()) {
            Text(
                text = when {
                    state.measuringVitals -> "Stay still · snug fit"
                    state.vitalsLine == "Vitals unavailable" -> "Sensors unavailable"
                    else -> state.vitalsLine.orEmpty()
                },
                style = MaterialTheme.typography.caption3,
                color = Color(0xFF94A3B8),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(bottom = 8.dp),
                maxLines = 2,
            )
        } else {
            Spacer(modifier = Modifier.height(8.dp))
        }

        if (!sos) {
            Button(
                onClick = onCheckIn,
                enabled = canStartCheckIn,
                colors = ButtonDefaults.buttonColors(
                    backgroundColor = Color(0xFF0D9488),
                    contentColor = Color.White,
                    disabledBackgroundColor = Color(0xFF1F2D3F),
                    disabledContentColor = Color(0xFF6B849E),
                ),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (state.phase == "complete") "Again" else "Talk")
            }

            Spacer(modifier = Modifier.height(6.dp))
            Button(
                onClick = onImOkay,
                enabled = canStartCheckIn,
                colors = ButtonDefaults.buttonColors(
                    backgroundColor = Color(0xFF14532D),
                    contentColor = Color.White,
                    disabledBackgroundColor = Color(0xFF1F2D3F),
                    disabledContentColor = Color(0xFF6B849E),
                ),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("I'm okay")
            }

            Spacer(modifier = Modifier.height(6.dp))
        }

        Button(
            onClick = { if (state.recording) onStopMic() else onStartMic() },
            colors = ButtonDefaults.buttonColors(
                backgroundColor = if (state.recording) Color(0xFFF59E0B) else Color(0xFF1F2D3F),
                contentColor = Color.White,
            ),
            modifier = Modifier.fillMaxWidth(),
            enabled = checkInActive,
        ) {
            Text(
                when {
                    state.recording -> "Send now"
                    checkInActive -> "Talk now"
                    else -> "Talk"
                }
            )
        }

        if (canStartCheckIn) {
            Spacer(modifier = Modifier.height(6.dp))
            Button(
                onClick = onSimulateFall,
                colors = ButtonDefaults.buttonColors(
                    backgroundColor = Color(0xFF1F2D3F),
                    contentColor = Color(0xFF9BB3D0),
                ),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Last resort")
            }
        }

        if (state.lastAiText.isNotBlank()) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = state.lastAiText,
                style = MaterialTheme.typography.caption3,
                color = Color(0xFFE6EDF7),
                textAlign = TextAlign.Center,
                maxLines = 3,
            )
        }
    }
}
