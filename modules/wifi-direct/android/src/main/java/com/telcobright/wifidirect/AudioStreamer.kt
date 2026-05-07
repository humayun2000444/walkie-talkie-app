package com.telcobright.wifidirect

import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.util.Log

/**
 * Native real-time audio streaming with echo cancellation.
 * Captures PCM audio, sends it as raw bytes, and plays received audio directly.
 * No file I/O, no base64, no encoding overhead.
 */
class AudioStreamer {

    companion object {
        private const val TAG = "AudioStreamer"
        const val SAMPLE_RATE = 16000
        const val CHANNEL_IN = AudioFormat.CHANNEL_IN_MONO
        const val CHANNEL_OUT = AudioFormat.CHANNEL_OUT_MONO
        const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
        // 20ms frames at 16kHz mono 16-bit = 640 bytes
        const val FRAME_SIZE = SAMPLE_RATE * 2 * 20 / 1000  // 640 bytes
    }

    private var audioRecord: AudioRecord? = null
    private var audioTrack: AudioTrack? = null
    private var echoCanceler: AcousticEchoCanceler? = null
    private var noiseSuppressor: NoiseSuppressor? = null

    private var captureThread: Thread? = null
    private var isStreaming = false
    private var isMuted = false
    private var playbackEnabled = false

    // Callback: sends captured PCM data to peers
    var onAudioCaptured: ((ByteArray) -> Unit)? = null

    fun startStreaming() {
        if (isStreaming) return
        isStreaming = true

        // Setup playback
        val minPlayBuf = AudioTrack.getMinBufferSize(SAMPLE_RATE, CHANNEL_OUT, ENCODING)
        audioTrack = AudioTrack(
            AudioManager.STREAM_VOICE_CALL,
            SAMPLE_RATE,
            CHANNEL_OUT,
            ENCODING,
            maxOf(minPlayBuf, FRAME_SIZE * 4),
            AudioTrack.MODE_STREAM
        )
        audioTrack?.play()
        playbackEnabled = true

        // Setup capture
        val minRecBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_IN, ENCODING)
        audioRecord = AudioRecord(
            MediaRecorder.AudioSource.VOICE_COMMUNICATION, // enables platform AEC
            SAMPLE_RATE,
            CHANNEL_IN,
            ENCODING,
            maxOf(minRecBuf, FRAME_SIZE * 4)
        )

        // Enable echo cancellation
        audioRecord?.audioSessionId?.let { sessionId ->
            if (AcousticEchoCanceler.isAvailable()) {
                echoCanceler = AcousticEchoCanceler.create(sessionId)
                echoCanceler?.enabled = true
                Log.i(TAG, "Echo cancellation enabled")
            }
            if (NoiseSuppressor.isAvailable()) {
                noiseSuppressor = NoiseSuppressor.create(sessionId)
                noiseSuppressor?.enabled = true
                Log.i(TAG, "Noise suppression enabled")
            }
        }

        audioRecord?.startRecording()

        // Capture loop: read PCM and send
        captureThread = Thread {
            val buffer = ByteArray(FRAME_SIZE)
            while (isStreaming) {
                val read = audioRecord?.read(buffer, 0, FRAME_SIZE) ?: -1
                if (read > 0 && !isMuted) {
                    onAudioCaptured?.invoke(buffer.copyOf(read))
                }
            }
        }.apply { isDaemon = true; priority = Thread.MAX_PRIORITY; start() }

        Log.i(TAG, "Streaming started (AEC=${echoCanceler != null}, NS=${noiseSuppressor != null})")
    }

    fun stopStreaming() {
        isStreaming = false
        playbackEnabled = false
        captureThread?.join(500)
        captureThread = null

        audioRecord?.stop()
        audioRecord?.release()
        audioRecord = null

        audioTrack?.stop()
        audioTrack?.release()
        audioTrack = null

        echoCanceler?.release()
        echoCanceler = null
        noiseSuppressor?.release()
        noiseSuppressor = null

        Log.i(TAG, "Streaming stopped")
    }

    /**
     * Play received PCM audio directly — no file I/O.
     * Only plays when streaming is active or playback is enabled.
     */
    fun playAudio(pcmData: ByteArray) {
        if (!playbackEnabled) return  // not in a call, ignore incoming audio

        if (audioTrack == null) {
            val minPlayBuf = AudioTrack.getMinBufferSize(SAMPLE_RATE, CHANNEL_OUT, ENCODING)
            audioTrack = AudioTrack(
                AudioManager.STREAM_VOICE_CALL,
                SAMPLE_RATE,
                CHANNEL_OUT,
                ENCODING,
                maxOf(minPlayBuf, FRAME_SIZE * 4),
                AudioTrack.MODE_STREAM
            )
            audioTrack?.play()
            Log.i(TAG, "AudioTrack created lazily for playback")
        }
        audioTrack?.write(pcmData, 0, pcmData.size)
    }

    fun setMuted(muted: Boolean) {
        isMuted = muted
    }

    fun enablePlayback() {
        playbackEnabled = true
    }

    fun isActive(): Boolean = isStreaming
}
