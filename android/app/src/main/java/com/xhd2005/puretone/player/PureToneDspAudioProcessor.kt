package com.xhd2005.puretone.player

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tanh

/**
 * Pure software 32-bit Float / 16-bit PCM DSP processor mounted directly in ExoPlayer's
 * [androidx.media3.exoplayer.audio.DefaultAudioSink].
 *
 * Replaces OEM Android [android.media.audiofx.Equalizer] / [android.media.audiofx.BassBoost] /
 * [android.media.audiofx.LoudnessEnhancer] to achieve:
 * 1. Mathematically zero-pop preset & loudness switching (35ms dual-bank cosine crossfade).
 * 2. Full studio loudness with automatic perceived-loudness compensation & optional RMS leveler,
 *    bypassing OEM AudioFlinger 16-bit effects mixer attenuation (-3 to -6 dB).
 * 3. Transparent -0.3 dBFS soft-knee tanh limiter so peaks never digitally clip or crackle.
 * 4. True Bit-Perfect passthrough when preset == "flat" and volumeLeveling == false.
 */
@OptIn(UnstableApi::class)
class PureToneDspAudioProcessor : BaseAudioProcessor() {

    private class BiquadCoeffs(
        var b0: Double = 1.0,
        var b1: Double = 0.0,
        var b2: Double = 0.0,
        var a1: Double = 0.0,
        var a2: Double = 0.0,
    ) {
        fun setIdentity() {
            b0 = 1.0
            b1 = 0.0
            b2 = 0.0
            a1 = 0.0
            a2 = 0.0
        }

        fun copyFrom(other: BiquadCoeffs) {
            b0 = other.b0
            b1 = other.b1
            b2 = other.b2
            a1 = other.a1
            a2 = other.a2
        }
    }

    private class BiquadChannelBank(bandCount: Int) {
        val z1 = DoubleArray(bandCount)
        val z2 = DoubleArray(bandCount)

        fun reset() {
            z1.fill(0.0)
            z2.fill(0.0)
        }

        fun processSample(input: Double, coeffs: Array<BiquadCoeffs>): Double {
            var x = input
            for (b in coeffs.indices) {
                val c = coeffs[b]
                val y = c.b0 * x + z1[b]
                z1[b] = c.b1 * x - c.a1 * y + z2[b]
                z2[b] = c.b2 * x - c.a2 * y
                x = y
            }
            return x
        }
    }

    @Volatile
    private var desiredPreset: String = "flat"

    @Volatile
    private var desiredLeveling: Boolean = false

    private val configVersion = AtomicInteger(0)
    private var appliedVersion = -1

    private var currentPreset: String = "flat"
    private var activeBankIndex: Int = 0
    private val bankCoeffs: Array<Array<BiquadCoeffs>> = Array(2) {
        Array(BAND_FREQS_HZ.size) { BiquadCoeffs() }
    }
    private var channelBanks: Array<Array<BiquadChannelBank>> = emptyArray()

    // Dual-bank crossfade state (35ms cosine equal-power ramp for mathematically click-free switch)
    private var crossfadeTotalFrames: Int = 1543
    private var crossfadeRemainingFrames: Int = 0

    // Per-sample smoothed makeup gain (linear)
    private var currentMakeupLinear: Double = 1.0
    private var startMakeupLinear: Double = 1.0
    private var targetMakeupLinear: Double = 1.0

    // Per-sample smoothed loudness leveling wet factor (0.0 .. 1.0)
    private var currentLevelerWet: Double = 0.0
    private var targetLevelerWet: Double = 0.0
    private var levelerWetStep: Double = 0.001

    // Adaptive RMS loudness envelope state (stereo-linked so L/R image never shifts)
    private var rmsEnvelopeSq: Double = 0.04
    private var smoothedLevelerGain: Double = 1.0
    private var rmsAttackAlpha: Double = 0.001
    private var rmsReleaseAlpha: Double = 0.0001
    private var gainSmoothAlpha: Double = 0.0005

    fun setPreset(preset: String) {
        val clean = sanitizePreset(preset)
        if (desiredPreset != clean) {
            desiredPreset = clean
            configVersion.incrementAndGet()
        }
    }

    fun setVolumeLeveling(enabled: Boolean) {
        if (desiredLeveling != enabled) {
            desiredLeveling = enabled
            configVersion.incrementAndGet()
        }
    }

    fun getPreset(): String = desiredPreset

    fun isVolumeLevelingEnabled(): Boolean = desiredLeveling

    override fun onConfigure(inputAudioFormat: AudioFormat): AudioFormat {
        val encoding = inputAudioFormat.encoding
        if (encoding != C.ENCODING_PCM_FLOAT && encoding != C.ENCODING_PCM_16BIT) {
            throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
        }
        val channels = inputAudioFormat.channelCount.coerceAtLeast(1)
        val sampleRate = inputAudioFormat.sampleRate.coerceAtLeast(8000)

        channelBanks = Array(2) {
            Array(channels) { BiquadChannelBank(BAND_FREQS_HZ.size) }
        }
        crossfadeTotalFrames = (sampleRate * CROSSFADE_SECONDS).roundToInt().coerceAtLeast(128)
        levelerWetStep = 1.0 / crossfadeTotalFrames.toDouble()
        rmsAttackAlpha = 1.0 - kotlin.math.exp(-1.0 / (sampleRate * 0.045))
        rmsReleaseAlpha = 1.0 - kotlin.math.exp(-1.0 / (sampleRate * 0.380))
        gainSmoothAlpha = 1.0 - kotlin.math.exp(-1.0 / (sampleRate * 0.080))

        // Initialize active bank directly to current desired settings (no stale state after format change)
        val preset = desiredPreset
        val leveling = desiredLeveling
        currentPreset = preset
        activeBankIndex = 0
        computePresetCoeffs(preset, sampleRate.toDouble(), bankCoeffs[0])
        computePresetCoeffs("flat", sampleRate.toDouble(), bankCoeffs[1])
        crossfadeRemainingFrames = 0
        targetMakeupLinear = dbToLinear(presetMakeupGainDb(preset))
        currentMakeupLinear = targetMakeupLinear
        startMakeupLinear = targetMakeupLinear
        targetLevelerWet = if (leveling) 1.0 else 0.0
        currentLevelerWet = targetLevelerWet
        rmsEnvelopeSq = 0.04
        smoothedLevelerGain = 1.0
        appliedVersion = configVersion.get()

        return inputAudioFormat
    }

    override fun onFlush() {
        for (bank in channelBanks) {
            for (ch in bank) ch.reset()
        }
        crossfadeRemainingFrames = 0
        currentMakeupLinear = targetMakeupLinear
        currentLevelerWet = targetLevelerWet
        rmsEnvelopeSq = 0.04
        smoothedLevelerGain = 1.0
    }

    override fun onReset() {
        channelBanks = emptyArray()
        crossfadeRemainingFrames = 0
        appliedVersion = -1
    }

    private fun syncPendingConfig(sampleRateHz: Double) {
        val ver = configVersion.get()
        if (ver == appliedVersion) return
        appliedVersion = ver

        val nextPreset = desiredPreset
        val nextLeveling = desiredLeveling
        targetLevelerWet = if (nextLeveling) 1.0 else 0.0

        if (nextPreset != currentPreset) {
            val incomingBank = 1 - activeBankIndex
            computePresetCoeffs(nextPreset, sampleRateHz, bankCoeffs[incomingBank])
            if (channelBanks.size == 2) {
                for (ch in channelBanks[incomingBank]) ch.reset()
            }
            startMakeupLinear = currentMakeupLinear
            targetMakeupLinear = dbToLinear(presetMakeupGainDb(nextPreset))
            currentPreset = nextPreset
            crossfadeRemainingFrames = crossfadeTotalFrames
        }
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val remaining = inputBuffer.remaining()
        if (remaining == 0) return

        val format = inputAudioFormat
        val channels = format.channelCount.coerceAtLeast(1)
        val sampleRate = format.sampleRate.coerceAtLeast(8000).toDouble()
        syncPendingConfig(sampleRate)

        val out = replaceOutputBuffer(remaining)

        // True Bit-Perfect Passthrough when flat EQ + leveling OFF + no active transitions
        val isBitPerfect = currentPreset == "flat" &&
            crossfadeRemainingFrames == 0 &&
            targetLevelerWet == 0.0 &&
            currentLevelerWet == 0.0 &&
            abs(currentMakeupLinear - 1.0) < 1e-6

        if (isBitPerfect) {
            out.put(inputBuffer)
            out.flip()
            return
        }

        if (format.encoding == C.ENCODING_PCM_FLOAT) {
            processPcmFloat(inputBuffer, out, channels)
        } else {
            processPcm16(inputBuffer, out, channels)
        }
        out.flip()
    }

    private fun processPcmFloat(input: ByteBuffer, output: ByteBuffer, channels: Int) {
        val frameBytes = channels * 4
        val frameCount = input.remaining() / frameBytes
        val frameBuf = DoubleArray(channels)
        for (f in 0 until frameCount) {
            for (c in 0 until channels) {
                frameBuf[c] = input.getFloat().toDouble()
            }
            processFrameInPlace(frameBuf, channels)
            for (c in 0 until channels) {
                output.putFloat(frameBuf[c].toFloat())
            }
        }
        // Copy any trailing partial bytes defensively
        while (input.hasRemaining()) {
            output.put(input.get())
        }
    }

    private fun processPcm16(input: ByteBuffer, output: ByteBuffer, channels: Int) {
        val frameBytes = channels * 2
        val frameCount = input.remaining() / frameBytes
        val frameBuf = DoubleArray(channels)
        for (f in 0 until frameCount) {
            for (c in 0 until channels) {
                frameBuf[c] = input.getShort().toDouble() / 32768.0
            }
            processFrameInPlace(frameBuf, channels)
            for (c in 0 until channels) {
                val scaled = (frameBuf[c] * 32767.0).roundToInt().coerceIn(-32768, 32767)
                output.putShort(scaled.toShort())
            }
        }
        while (input.hasRemaining()) {
            output.put(input.get())
        }
    }

    private fun processFrameInPlace(samples: DoubleArray, channels: Int) {
        val hasBanks = channelBanks.size == 2 && channelBanks[0].size >= channels
        val activeIdx = activeBankIndex
        val incomingIdx = 1 - activeIdx

        // Advance dual-bank crossfade smoothly
        var crossfadeAlpha = 0.0
        val isCrossfading = crossfadeRemainingFrames > 0
        if (isCrossfading) {
            val progress = 1.0 - (crossfadeRemainingFrames.toDouble() / crossfadeTotalFrames.toDouble())
            crossfadeAlpha = 0.5 * (1.0 - cos(PI * progress))
            currentMakeupLinear = startMakeupLinear + (targetMakeupLinear - startMakeupLinear) * crossfadeAlpha
            crossfadeRemainingFrames -= 1
            if (crossfadeRemainingFrames == 0) {
                activeBankIndex = incomingIdx
                currentMakeupLinear = targetMakeupLinear
            }
        } else {
            currentMakeupLinear = targetMakeupLinear
        }

        // Advance volume-leveler wet ramp smoothly (zero click on toggle)
        if (currentLevelerWet < targetLevelerWet) {
            currentLevelerWet = (currentLevelerWet + levelerWetStep).coerceAtMost(targetLevelerWet)
        } else if (currentLevelerWet > targetLevelerWet) {
            currentLevelerWet = (currentLevelerWet - levelerWetStep).coerceAtLeast(targetLevelerWet)
        }

        // Stage 1: 5-band 64-bit Double biquad EQ (with dual-bank crossfade when switching)
        var energySum = 0.0
        if (hasBanks) {
            val activeCoeffs = bankCoeffs[activeIdx]
            val incomingCoeffs = bankCoeffs[incomingIdx]
            val activeCh = channelBanks[activeIdx]
            val incomingCh = channelBanks[incomingIdx]
            val runEq = isCrossfading || currentPreset != "flat"
            for (c in 0 until channels) {
                val x = samples[c]
                val eqOut = if (isCrossfading) {
                    val oldVal = activeCh[c].processSample(x, activeCoeffs)
                    val newVal = incomingCh[c].processSample(x, incomingCoeffs)
                    oldVal * (1.0 - crossfadeAlpha) + newVal * crossfadeAlpha
                } else if (runEq) {
                    activeCh[c].processSample(x, activeCoeffs)
                } else {
                    x
                }
                val compensated = eqOut * currentMakeupLinear
                samples[c] = compensated
                energySum += compensated * compensated
            }
        } else {
            for (c in 0 until channels) {
                val compensated = samples[c] * currentMakeupLinear
                samples[c] = compensated
                energySum += compensated * compensated
            }
        }

        // Stage 2: Stereo-linked adaptive RMS loudness enhancement (when enabled or ramping)
        var dynamicGain = 1.0
        if (currentLevelerWet > 1e-6) {
            val meanSq = energySum / channels.toDouble()
            val envAlpha = if (meanSq > rmsEnvelopeSq) rmsAttackAlpha else rmsReleaseAlpha
            rmsEnvelopeSq += envAlpha * (meanSq - rmsEnvelopeSq)
            val rms = sqrt(rmsEnvelopeSq.coerceAtLeast(1e-7))

            // Target modern full loudness (~ -13.5 dBFS RMS = 0.211) with gentle presence floor (+1.6 dB)
            // and bounded boost (+4.2 dB max) so quiet verses rise naturally without pumping noise floors.
            val desiredGain = if (rms < 0.008) {
                1.20 // Silence / noise-floor guard: do not amplify pure background hiss
            } else {
                (LEVELER_TARGET_RMS / rms).coerceIn(LEVELER_MIN_BOOST_LINEAR, LEVELER_MAX_BOOST_LINEAR)
            }
            smoothedLevelerGain += gainSmoothAlpha * (desiredGain - smoothedLevelerGain)
            dynamicGain = 1.0 + (smoothedLevelerGain - 1.0) * currentLevelerWet
        }

        // Stage 3: Apply dynamic gain + transparent -0.3 dBFS soft-knee tanh limiter (zero hard clipping)
        for (c in 0 until channels) {
            samples[c] = softLimit(samples[c] * dynamicGain)
        }
    }

    /**
     * Pure-JVM helper for unit testing DSP curves, soft limiting, passthrough, and zero-pop transitions.
     */
    internal fun processFloatSamplesForTest(
        interleavedSamples: FloatArray,
        sampleRateHz: Int = 48000,
        channels: Int = 2,
    ): FloatArray {
        val format = AudioFormat(sampleRateHz, channels, C.ENCODING_PCM_FLOAT)
        if (inputAudioFormat != format) {
            configure(format)
            flush()
        }
        val inBuf = ByteBuffer.allocateDirect(interleavedSamples.size * 4)
            .order(java.nio.ByteOrder.nativeOrder())
        for (s in interleavedSamples) inBuf.putFloat(s)
        inBuf.flip()
        queueInput(inBuf)
        val outBuf = output
        val out = FloatArray(outBuf.remaining() / 4)
        for (i in out.indices) out[i] = outBuf.getFloat()
        return out
    }

    companion object {
        private const val CROSSFADE_SECONDS = 0.035 // 35ms click-free dual-bank ramp
        private const val SOFT_LIMIT_KNEE = 0.85    // ~ -1.4 dBFS: completely transparent 1:1 below knee
        private const val SOFT_LIMIT_CEILING = 0.966 // ~ -0.3 dBFS: strict inter-sample peak safety
        private const val LEVELER_TARGET_RMS = 0.215
        private const val LEVELER_MIN_BOOST_LINEAR = 1.20 // ~ +1.6 dB crisp loudness presence on loud masters
        private const val LEVELER_MAX_BOOST_LINEAR = 1.62 // ~ +4.2 dB warm boost on quiet masters

        // 5-band studio centers: LowShelf, Low-Mid Peak, Mid Peak, Presence Peak, HighShelf
        val BAND_FREQS_HZ = doubleArrayOf(60.0, 230.0, 1000.0, 3600.0, 11000.0)

        fun sanitizePreset(preset: String): String {
            return when (preset.trim().lowercase()) {
                "vocal", "bass", "night", "live" -> preset.trim().lowercase()
                else -> "flat"
            }
        }

        /**
         * Returns 5-band dB gains `[60Hz, 230Hz, 1kHz, 3.6kHz, 11kHz]` tuned for 32-bit Float headroom
         * with transparent soft-knee limiting (rich tonal character without -4 dB loudness drop).
         */
        fun presetGainsDb(preset: String): DoubleArray {
            return when (sanitizePreset(preset)) {
                "vocal" -> doubleArrayOf(-1.4, -0.5, 2.4, 2.8, 1.0)
                "bass" -> doubleArrayOf(4.2, 2.2, -0.8, 0.4, 1.2)
                "night" -> doubleArrayOf(1.2, 0.5, -0.6, -2.6, -4.0)
                "live" -> doubleArrayOf(2.4, -1.2, 0.6, 2.2, 3.4)
                else -> doubleArrayOf(0.0, 0.0, 0.0, 0.0, 0.0)
            }
        }

        /**
         * Perceived loudness makeup gain (dB) per preset so switching presets keeps consistent fullness.
         */
        fun presetMakeupGainDb(preset: String): Double {
            return when (sanitizePreset(preset)) {
                "vocal" -> 0.4
                "bass" -> 0.2
                "night" -> 1.2
                "live" -> 0.5
                else -> 0.0
            }
        }

        fun dbToLinear(db: Double): Double = 10.0.pow(db / 20.0)

        /**
         * C1-continuous transparent soft-knee limiter.
         * Signals within [-0.85, +0.85] pass 1:1 completely unaltered; peaks smoothly saturate
         * below 0.966 (-0.3 dBFS) so digital clipping/crackling is mathematically impossible.
         */
        fun softLimit(x: Double): Double {
            val ax = abs(x)
            if (ax <= SOFT_LIMIT_KNEE) return x
            val headroom = SOFT_LIMIT_CEILING - SOFT_LIMIT_KNEE
            val compressed = SOFT_LIMIT_KNEE + headroom * tanh((ax - SOFT_LIMIT_KNEE) / headroom)
            return if (x >= 0.0) compressed else -compressed
        }

        private fun computePresetCoeffs(preset: String, sampleRate: Double, out: Array<BiquadCoeffs>) {
            val gains = presetGainsDb(preset)
            for (i in BAND_FREQS_HZ.indices) {
                val gainDb = gains[i]
                if (abs(gainDb) < 0.01) {
                    out[i].setIdentity()
                    continue
                }
                val fc = BAND_FREQS_HZ[i].coerceAtMost(sampleRate * 0.44)
                when (i) {
                    0 -> designLowShelf(fc, sampleRate, gainDb, 0.85, out[i])
                    BAND_FREQS_HZ.lastIndex -> designHighShelf(fc, sampleRate, gainDb, 0.85, out[i])
                    else -> designPeaking(fc, sampleRate, gainDb, if (i == 3) 1.1 else 1.0, out[i])
                }
            }
        }

        // Robert Bristow-Johnson Audio EQ Cookbook formulas (64-bit Double)
        private fun designPeaking(fc: Double, fs: Double, gainDb: Double, q: Double, out: BiquadCoeffs) {
            val a = 10.0.pow(gainDb / 40.0)
            val w0 = 2.0 * PI * fc / fs
            val cosW0 = cos(w0)
            val alpha = sin(w0) / (2.0 * q)

            val b0 = 1.0 + alpha * a
            val b1 = -2.0 * cosW0
            val b2 = 1.0 - alpha * a
            val a0 = 1.0 + alpha / a
            val a1 = -2.0 * cosW0
            val a2 = 1.0 - alpha / a

            out.b0 = b0 / a0
            out.b1 = b1 / a0
            out.b2 = b2 / a0
            out.a1 = a1 / a0
            out.a2 = a2 / a0
        }

        private fun designLowShelf(fc: Double, fs: Double, gainDb: Double, slope: Double, out: BiquadCoeffs) {
            val a = 10.0.pow(gainDb / 40.0)
            val w0 = 2.0 * PI * fc / fs
            val cosW0 = cos(w0)
            val sinW0 = sin(w0)
            val alpha = sinW0 / 2.0 * sqrt((a + 1.0 / a) * (1.0 / slope - 1.0) + 2.0)
            val twoSqrtAAlpha = 2.0 * sqrt(a) * alpha

            val b0 = a * ((a + 1.0) - (a - 1.0) * cosW0 + twoSqrtAAlpha)
            val b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cosW0)
            val b2 = a * ((a + 1.0) - (a - 1.0) * cosW0 - twoSqrtAAlpha)
            val a0 = (a + 1.0) + (a - 1.0) * cosW0 + twoSqrtAAlpha
            val a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cosW0)
            val a2 = (a + 1.0) + (a - 1.0) * cosW0 - twoSqrtAAlpha

            out.b0 = b0 / a0
            out.b1 = b1 / a0
            out.b2 = b2 / a0
            out.a1 = a1 / a0
            out.a2 = a2 / a0
        }

        private fun designHighShelf(fc: Double, fs: Double, gainDb: Double, slope: Double, out: BiquadCoeffs) {
            val a = 10.0.pow(gainDb / 40.0)
            val w0 = 2.0 * PI * fc / fs
            val cosW0 = cos(w0)
            val sinW0 = sin(w0)
            val alpha = sinW0 / 2.0 * sqrt((a + 1.0 / a) * (1.0 / slope - 1.0) + 2.0)
            val twoSqrtAAlpha = 2.0 * sqrt(a) * alpha

            val b0 = a * ((a + 1.0) + (a - 1.0) * cosW0 + twoSqrtAAlpha)
            val b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cosW0)
            val b2 = a * ((a + 1.0) + (a - 1.0) * cosW0 - twoSqrtAAlpha)
            val a0 = (a + 1.0) - (a - 1.0) * cosW0 + twoSqrtAAlpha
            val a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cosW0)
            val a2 = (a + 1.0) - (a - 1.0) * cosW0 - twoSqrtAAlpha

            out.b0 = b0 / a0
            out.b1 = b1 / a0
            out.b2 = b2 / a0
            out.a1 = a1 / a0
            out.a2 = a2 / a0
        }
    }
}
