package com.opencomms.app.ui.pairing

import android.Manifest
import android.content.pm.PackageManager
import android.util.Size
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

enum class QrScanOutcome {
    Accepted,
    Rejected,
    IgnoredAlreadyAccepted
}

class QrScanGate {
    private var accepted = false

    @Synchronized
    fun tryAccept(rawValue: String, onScanned: (String) -> Boolean): QrScanOutcome {
        if (accepted) return QrScanOutcome.IgnoredAlreadyAccepted
        accepted = true
        val acceptedByCaller = onScanned(rawValue)
        return if (acceptedByCaller) {
            QrScanOutcome.Accepted
        } else {
            accepted = false
            QrScanOutcome.Rejected
        }
    }

    @Synchronized
    fun reset() {
        accepted = false
    }
}

@Composable
fun QrScanTab(
    errorMessage: String?,
    onRetry: () -> Unit,
    onScanned: (String) -> Boolean
) {
    val context = LocalContext.current
    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                    PackageManager.PERMISSION_GRANTED
        )
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> hasCameraPermission = granted }

    if (hasCameraPermission) {
        QrCameraPreview(
            errorMessage = errorMessage,
            onRetry = onRetry,
            onScanned = onScanned
        )
    } else {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(48.dp))
            Text(
                "Camera permission is needed to scan QR codes.",
                style = MaterialTheme.typography.bodyMedium
            )
            Spacer(modifier = Modifier.height(16.dp))
            Button(onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }) {
                Text("Grant camera permission")
            }
        }
    }
}

@Composable
private fun QrCameraPreview(
    errorMessage: String?,
    onRetry: () -> Unit,
    onScanned: (String) -> Boolean
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val executor = remember { Executors.newSingleThreadExecutor() }
    val scanGate = remember { QrScanGate() }
    var scanStatus by remember { mutableStateOf("Point camera at a pairing QR code") }

    DisposableEffect(Unit) {
        onDispose { executor.shutdown() }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(
            factory = { ctx ->
                val previewView = PreviewView(ctx)
                val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
                cameraProviderFuture.addListener({
                    val cameraProvider = cameraProviderFuture.get()
                    val preview = Preview.Builder().build().also {
                        it.setSurfaceProvider(previewView.surfaceProvider)
                    }
                    val barcodeScanner = BarcodeScanning.getClient()
                    val analysis = ImageAnalysis.Builder()
                        .setTargetResolution(Size(1280, 720))
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                    analysis.setAnalyzer(executor) { imageProxy ->
                        val mediaImage = imageProxy.image
                        if (mediaImage != null) {
                            val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                            barcodeScanner.process(image)
                                .addOnSuccessListener { barcodes ->
                                    barcodes.firstOrNull { it.format == Barcode.FORMAT_QR_CODE }
                                        ?.rawValue
                                        ?.let { value ->
                                            when (scanGate.tryAccept(value, onScanned)) {
                                                QrScanOutcome.Accepted -> scanStatus = "QR detected. Review and confirm the contact below."
                                                QrScanOutcome.Rejected -> scanStatus = "QR detected, but it was not a valid OpenComms pairing code. Try another QR or use Paste link."
                                                QrScanOutcome.IgnoredAlreadyAccepted -> Unit
                                            }
                                    }
                                }
                                .addOnCompleteListener { imageProxy.close() }
                        } else {
                            imageProxy.close()
                        }
                    }
                    runCatching {
                        cameraProvider.unbindAll()
                        cameraProvider.bindToLifecycle(
                            lifecycleOwner,
                            CameraSelector.DEFAULT_BACK_CAMERA,
                            preview,
                            analysis
                        )
                    }
                }, ContextCompat.getMainExecutor(ctx))
                previewView
            },
            modifier = Modifier.fillMaxSize()
        )
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = errorMessage ?: scanStatus,
                color = if (errorMessage == null) androidx.compose.ui.graphics.Color.White else MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium
            )
            if (errorMessage != null) {
                Spacer(modifier = Modifier.height(8.dp))
                Button(
                    modifier = Modifier.fillMaxWidth(),
                    onClick = {
                        scanGate.reset()
                        scanStatus = "Point camera at a pairing QR code"
                        onRetry()
                    }
                ) {
                    Text("Scan again")
                }
            }
        }
    }
}
