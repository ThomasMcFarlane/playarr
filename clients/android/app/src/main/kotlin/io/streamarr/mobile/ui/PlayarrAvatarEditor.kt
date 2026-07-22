package io.streamarr.mobile.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ImageDecoder
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.os.Build
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.graphics.createBitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.streamarr.shared.data.model.ProfileAvatarKind
import io.streamarr.shared.data.model.ProfileAvatarPreference
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import kotlin.math.max
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val PlayarrAvatarMaxUploadBytes = 10 * 1024 * 1024
internal const val PlayarrAvatarOutputSize = 512
private const val PlayarrAvatarPreviewSize = 480
private const val PlayarrAvatarDecodeMaxDimension = 4096

internal data class PlayarrAvatarCrop(
    val zoom: Float = 1f,
    val offsetX: Float = 0f,
    val offsetY: Float = 0f,
)

internal data class PlayarrAvatarDrawRect(
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float,
)

internal fun playarrAvatarDrawRect(
    imageWidth: Int,
    imageHeight: Int,
    crop: PlayarrAvatarCrop,
    size: Int,
): PlayarrAvatarDrawRect {
    require(imageWidth > 0 && imageHeight > 0 && size > 0)
    val baseScale = max(size.toFloat() / imageWidth, size.toFloat() / imageHeight)
    val zoom = crop.zoom.coerceIn(1f, 3f)
    val drawWidth = imageWidth * baseScale * zoom
    val drawHeight = imageHeight * baseScale * zoom
    val maxOffsetX = max(0f, (drawWidth - size) / 2f)
    val maxOffsetY = max(0f, (drawHeight - size) / 2f)
    val offsetX = crop.offsetX.coerceIn(-1f, 1f) * maxOffsetX
    val offsetY = crop.offsetY.coerceIn(-1f, 1f) * maxOffsetY
    return PlayarrAvatarDrawRect(
        x = (size - drawWidth) / 2f + offsetX,
        y = (size - drawHeight) / 2f + offsetY,
        width = drawWidth,
        height = drawHeight,
    )
}

internal fun dragPlayarrAvatarCrop(
    imageWidth: Int,
    imageHeight: Int,
    crop: PlayarrAvatarCrop,
    size: Int,
    deltaX: Float,
    deltaY: Float,
): PlayarrAvatarCrop {
    val rect = playarrAvatarDrawRect(imageWidth, imageHeight, crop, size)
    val maxOffsetX = max(0f, (rect.width - size) / 2f)
    val maxOffsetY = max(0f, (rect.height - size) / 2f)
    return crop.copy(
        offsetX = if (maxOffsetX == 0f) 0f else (crop.offsetX + deltaX / maxOffsetX).coerceIn(-1f, 1f),
        offsetY = if (maxOffsetY == 0f) 0f else (crop.offsetY + deltaY / maxOffsetY).coerceIn(-1f, 1f),
    )
}

internal fun renderPlayarrAvatarBitmap(
    source: Bitmap,
    crop: PlayarrAvatarCrop,
    size: Int,
): Bitmap {
    val output = createBitmap(size, size)
    val rect = playarrAvatarDrawRect(source.width, source.height, crop, size)
    Canvas(output).drawBitmap(
        source,
        null,
        RectF(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height),
        Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG),
    )
    return output
}

internal fun renderPlayarrAvatarDataUrl(source: Bitmap, crop: PlayarrAvatarCrop): String {
    val output = renderPlayarrAvatarBitmap(source, crop, PlayarrAvatarOutputSize)
    return try {
        val bytes = ByteArrayOutputStream().use { stream ->
            check(output.compress(Bitmap.CompressFormat.JPEG, 86, stream))
            stream.toByteArray()
        }
        "data:image/jpeg;base64,${Base64.encodeToString(bytes, Base64.NO_WRAP)}"
    } finally {
        output.recycle()
    }
}

private enum class PlayarrAvatarInputFailure {
    UnsupportedType,
    TooLarge,
    UploadFailed,
}

private class PlayarrAvatarInputException(
    val failure: PlayarrAvatarInputFailure,
) : IllegalArgumentException()

internal fun playarrAvatarPresetLabelKey(preset: String): PlayarrString = when (preset) {
    "astronaut" -> PlayarrString.SettingsAvatarAstronaut
    "cat" -> PlayarrString.SettingsAvatarCat
    "dinosaur" -> PlayarrString.SettingsAvatarDinosaur
    "robot" -> PlayarrString.SettingsAvatarRobot
    "pirate" -> PlayarrString.SettingsAvatarPirate
    "alien" -> PlayarrString.SettingsAvatarAlien
    else -> PlayarrString.SettingsAvatarPresetLabel
}

private fun readPlayarrAvatarBytes(context: Context, uri: Uri): ByteArray {
    val mimeType = context.contentResolver.getType(uri)?.substringBefore(';')?.lowercase()
    if (mimeType != null && mimeType !in setOf("image/jpeg", "image/png", "image/webp")) {
        throw PlayarrAvatarInputException(PlayarrAvatarInputFailure.UnsupportedType)
    }
    return context.contentResolver.openInputStream(uri)?.use { input ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        var total = 0
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            total += read
            if (total > PlayarrAvatarMaxUploadBytes) {
                throw PlayarrAvatarInputException(PlayarrAvatarInputFailure.TooLarge)
            }
            output.write(buffer, 0, read)
        }
        output.toByteArray()
    } ?: throw PlayarrAvatarInputException(PlayarrAvatarInputFailure.UploadFailed)
}

private fun playarrAvatarSampleSize(width: Int, height: Int): Int {
    var sampleSize = 1
    while (max(width / sampleSize, height / sampleSize) > PlayarrAvatarDecodeMaxDimension) {
        sampleSize *= 2
    }
    return sampleSize
}

private fun decodePlayarrAvatar(context: Context, uri: Uri): Bitmap {
    val bytes = readPlayarrAvatarBytes(context, uri)
    if (bytes.isEmpty()) throw PlayarrAvatarInputException(PlayarrAvatarInputFailure.UploadFailed)
    val bitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))) { decoder, info, _ ->
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            decoder.setTargetSampleSize(playarrAvatarSampleSize(info.size.width, info.size.height))
        }
    } else {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) null else {
            BitmapFactory.decodeByteArray(
                bytes,
                0,
                bytes.size,
                BitmapFactory.Options().apply {
                    inSampleSize = playarrAvatarSampleSize(bounds.outWidth, bounds.outHeight)
                },
            )
        }
    }
    return bitmap?.takeIf { it.width > 0 && it.height > 0 }
        ?: throw PlayarrAvatarInputException(PlayarrAvatarInputFailure.UploadFailed)
}

@Composable
internal fun PlayarrAvatarSettings(
    userId: String,
    preference: ProfileAvatarPreference?,
    isTelevision: Boolean,
    onSaveAvatar: (ProfileAvatarPreference) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var editorBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var loading by remember { mutableStateOf(false) }
    var processing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val unsupportedTypeError = playarrString(PlayarrString.SettingsAvatarUnsupportedType)
    val tooLargeError = playarrString(PlayarrString.SettingsAvatarTooLarge)
    val uploadFailedError = playarrString(PlayarrString.SettingsAvatarUploadFailed)
    val saveFailedError = playarrString(PlayarrString.SettingsAvatarSaveFailed)
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            loading = true
            error = null
            runCatching { withContext(Dispatchers.IO) { decodePlayarrAvatar(context, uri) } }
                .onSuccess { editorBitmap = it }
                .onFailure {
                    error = when ((it as? PlayarrAvatarInputException)?.failure) {
                        PlayarrAvatarInputFailure.UnsupportedType -> unsupportedTypeError
                        PlayarrAvatarInputFailure.TooLarge -> tooLargeError
                        PlayarrAvatarInputFailure.UploadFailed, null -> uploadFailedError
                    }
                }
            loading = false
        }
    }
    val resolved = resolvedPlayarrProfileAvatarPreference(userId, preference)
    val currentCustomDescription = playarrString(PlayarrString.SettingsAvatarCurrentCustom)

    Text(playarrString(PlayarrString.SettingsAvatarPresetLabel), color = WebInkSoft, fontSize = 12.sp)
    LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        items(playarrProfileAvatarPresetIds) { preset ->
            val selected = resolved.kind == ProfileAvatarKind.Preset && resolved.value == preset
            val presetDescription = playarrString(playarrAvatarPresetLabelKey(preset))
            androidx.compose.material3.Surface(
                onClick = { onSaveAvatar(ProfileAvatarPreference(ProfileAvatarKind.Preset, preset)) },
                modifier = Modifier
                    .size(76.dp)
                    .then(if (selected) Modifier.border(3.dp, WebPink, CircleShape) else Modifier)
                    .semantics { contentDescription = presetDescription },
                shape = CircleShape,
                color = androidx.compose.ui.graphics.Color.Transparent,
            ) {
                PlayarrProfileAvatar(
                    userId = userId,
                    preference = ProfileAvatarPreference(ProfileAvatarKind.Preset, preset),
                    modifier = Modifier.fillMaxSize(),
                    glyphSize = 31.sp,
                )
            }
        }
        if (resolved.kind == ProfileAvatarKind.Custom) {
            item {
                PlayarrProfileAvatar(
                    userId = userId,
                    preference = resolved,
                    modifier = Modifier
                        .size(76.dp)
                        .border(3.dp, WebPink, CircleShape)
                        .semantics { contentDescription = currentCustomDescription },
                    glyphSize = 31.sp,
                )
            }
        }
    }
    if (isTelevision) {
        Text(playarrString(PlayarrString.SettingsAvatarPresetsOnly), color = WebInkMuted, fontSize = 11.sp)
    } else {
        Button(
            onClick = { picker.launch(arrayOf("image/jpeg", "image/png", "image/webp")) },
            enabled = !loading && !processing,
        ) {
            if (loading) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Text(playarrString(PlayarrString.SettingsAvatarUploading))
            } else {
                Text(
                    playarrString(
                        if (resolved.kind == ProfileAvatarKind.Custom) {
                            PlayarrString.SettingsAvatarReplacePhoto
                        } else {
                            PlayarrString.SettingsAvatarUploadPhoto
                        },
                    ),
                )
            }
        }
        Text(playarrString(PlayarrString.SettingsAvatarDeviceNote), color = WebInkMuted, fontSize = 11.sp)
    }
    error?.let { Text(it, color = androidx.compose.material3.MaterialTheme.colorScheme.error, fontSize = 11.sp) }

    editorBitmap?.let { source ->
        PlayarrAvatarCropDialog(
            source = source,
            processing = processing,
            onDismiss = {
                if (!processing) {
                    source.recycle()
                    editorBitmap = null
                }
            },
            onSave = { crop ->
                scope.launch {
                    processing = true
                    error = null
                    runCatching { withContext(Dispatchers.Default) { renderPlayarrAvatarDataUrl(source, crop) } }
                        .onSuccess { dataUrl ->
                            onSaveAvatar(ProfileAvatarPreference(ProfileAvatarKind.Custom, dataUrl))
                            source.recycle()
                            editorBitmap = null
                        }
                        .onFailure { error = saveFailedError }
                    processing = false
                }
            },
        )
    }
}

@Composable
private fun PlayarrAvatarCropDialog(
    source: Bitmap,
    processing: Boolean,
    onDismiss: () -> Unit,
    onSave: (PlayarrAvatarCrop) -> Unit,
) {
    var crop by remember(source) { mutableStateOf(PlayarrAvatarCrop()) }
    val preview = remember(source, crop) { renderPlayarrAvatarBitmap(source, crop, PlayarrAvatarPreviewSize) }
    DisposableEffect(preview) { onDispose(preview::recycle) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(playarrString(PlayarrString.SettingsAvatarCropTitle)) },
        text = {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 620.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    playarrString(PlayarrString.SettingsAvatarCropDescription),
                    color = WebInkMuted,
                    fontSize = 12.sp,
                )
                Image(
                    bitmap = preview.asImageBitmap(),
                    contentDescription = playarrString(PlayarrString.SettingsAvatarCropPreview),
                    contentScale = ContentScale.FillBounds,
                    modifier = Modifier
                        .size(260.dp)
                        .align(Alignment.CenterHorizontally)
                        .clip(CircleShape)
                        .pointerInput(source) {
                            detectDragGestures { change, dragAmount ->
                                change.consume()
                                crop = dragPlayarrAvatarCrop(
                                    imageWidth = source.width,
                                    imageHeight = source.height,
                                    crop = crop,
                                    size = size.width,
                                    deltaX = dragAmount.x,
                                    deltaY = dragAmount.y,
                                )
                            }
                        },
                )
                AvatarCropSlider(playarrString(PlayarrString.SettingsAvatarZoom), crop.zoom, 1f..3f) {
                    crop = crop.copy(zoom = it)
                }
                AvatarCropSlider(
                    playarrString(PlayarrString.SettingsAvatarHorizontalPosition),
                    crop.offsetX,
                    -1f..1f,
                ) { crop = crop.copy(offsetX = it) }
                AvatarCropSlider(
                    playarrString(PlayarrString.SettingsAvatarVerticalPosition),
                    crop.offsetY,
                    -1f..1f,
                ) { crop = crop.copy(offsetY = it) }
                OutlinedButton(
                    onClick = { crop = PlayarrAvatarCrop() },
                    enabled = !processing,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(playarrString(PlayarrString.SettingsAvatarResetCrop)) }
            }
        },
        confirmButton = {
            Button(onClick = { onSave(crop) }, enabled = !processing) {
                if (processing) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    Text(playarrString(PlayarrString.SettingsAvatarSaveCrop))
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !processing) {
                Text(playarrString(PlayarrString.CommonCancel))
            }
        },
    )
}

@Composable
private fun AvatarCropSlider(
    label: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    onValueChange: (Float) -> Unit,
) {
    Column {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, color = WebInk, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
            Text(String.format(java.util.Locale.ROOT, "%.2f", value), color = WebInkMuted, fontSize = 11.sp)
        }
        Slider(value = value, onValueChange = onValueChange, valueRange = range)
    }
}
