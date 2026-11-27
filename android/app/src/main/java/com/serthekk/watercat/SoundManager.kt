package com.serthekk.watercat

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.SoundPool
import android.os.Build
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.Calendar
import java.util.concurrent.ConcurrentHashMap

/** Sound settings (this phone only), kept in DataStore. Defaults = the desktop's. */
data class SoundSettings(
    val soundOn: Boolean = true,
    val volume: Float = 0.5f, // desktop default 0.5
    val meowStyle: String = "random", // "random" or a Meow id
    val cupChirp: Boolean = true, // a logged drink chirps (off: it meows, like the desktop)
    val haptics: Boolean = true,
)

private val Context.soundStore: DataStore<Preferences> by preferencesDataStore(name = "sound_settings")

/** The desktop's meow styles (assets/meows/meows.json), as res/raw/meow_<id>.ogg. */
enum class Meow(val id: String, val label: String, val res: Int) {
    ORIGINAL("original", "Original meow", R.raw.meow_original),
    DEEP_PURR("deep-purr", "Deep Purr", R.raw.meow_deep_purr),
    MEW("mew", "Mew", R.raw.meow_mew),
    NYAH_NYAH("nyah-nyah", "Nyah Nyah ⸜(｡˃ ᵕ ˂ )⸝♡", R.raw.meow_nyah_nyah),
    PURRINA("purrina", "Purrina", R.raw.meow_purrina),
    RRREOW("rrreow", "Rrreow", R.raw.meow_rrreow),
    SINGING_CAT("singing-cat", "Singing cat", R.raw.meow_singing_cat),
}

/**
 * All in-app sound, app-wide (created once in WaterCatApp, never in a composable).
 *
 * - Short effects + meows are preloaded into one SoundPool at startup; a sound asked for
 *   before it finished loading plays as soon as it is ready (if that is within a second).
 * - The 20 s party loop plays through MediaPlayer with transient audio focus.
 * - Levels are the desktop's: every clip was converted at the desktop's level for volume 1.0
 *   and plays at the chosen volume; "quiet" (quiet hours) uses the desktop's softer factors.
 * - Paused / resumed with the app (ProcessLifecycleOwner): nothing plays in the background.
 */
class SoundManager private constructor(private val ctx: Context) : DefaultLifecycleObserver {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val store = ctx.soundStore
    val settings: StateFlow<SoundSettings> = store.data.map { p ->
        SoundSettings(
            soundOn = p[K_ON] ?: true,
            volume = (p[K_VOLUME] ?: 0.5f).coerceIn(0f, 1f),
            meowStyle = p[K_STYLE] ?: "random",
            cupChirp = p[K_CHIRP] ?: true,
            haptics = p[K_HAPTICS] ?: true,
        )
    }.stateIn(scope, SharingStarted.Eagerly, SoundSettings())

    private val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
    private val pool = SoundPool.Builder().setMaxStreams(6).setAudioAttributes(attrs).build()
    private val ids = HashMap<Int, Int>() // raw res -> SoundPool sample id
    private val loaded = ConcurrentHashMap.newKeySet<Int>() // sample ids ready to play
    private val pending = ConcurrentHashMap<Int, () -> Unit>() // sample id -> play once loaded
    private val askedAt = ConcurrentHashMap<Int, Long>()

    private var lastMeow: Meow? = null
    private var meowStream = 0
    private var purrStream = 0
    private var purrUntil = 0L
    private var purrJob: Job? = null
    private var party: MediaPlayer? = null
    private var partyFocus: AudioFocusRequest? = null
    private var inForeground = false

    init {
        pool.setOnLoadCompleteListener { _, sampleId, status ->
            if (status != 0) return@setOnLoadCompleteListener
            loaded += sampleId
            val waited = SystemClock.elapsedRealtime() - (askedAt.remove(sampleId) ?: 0L)
            pending.remove(sampleId)?.let { if (waited < 1000) scope.launch { it() } }
        }
        val all = Meow.entries.map { it.res } + listOf(R.raw.sfx_chirp, R.raw.sfx_squeak, R.raw.sfx_purr_loop)
        for (res in all) ids[res] = pool.load(ctx, res, 1)
        ProcessLifecycleOwner.get().lifecycle.addObserver(this)
    }

    // --- lifecycle: silent in the background --------------------------------
    override fun onStart(owner: LifecycleOwner) {
        inForeground = true
        pool.autoResume()
    }

    override fun onStop(owner: LifecycleOwner) {
        inForeground = false
        pool.autoPause()
        stopPurr(fade = false)
        stopParty()
    }

    // --- settings ------------------------------------------------------------
    fun setSoundOn(on: Boolean) = save { it[K_ON] = on }.also { if (!on) { stopPurr(false); stopParty() } }
    fun setVolume(v: Float) = save { it[K_VOLUME] = v.coerceIn(0f, 1f) }
    fun setMeowStyle(id: String) = save { it[K_STYLE] = id }
    fun setCupChirp(on: Boolean) = save { it[K_CHIRP] = on }
    fun setHaptics(on: Boolean) = save { it[K_HAPTICS] = on }
    private fun save(f: (androidx.datastore.preferences.core.MutablePreferences) -> Unit) {
        scope.launch { store.edit { f(it) } }
    }

    private fun canPlay() = settings.value.soundOn && inForeground

    /** Quiet hours: the desktop plays softer versions then. */
    fun quietNow(): Boolean {
        val s = Store.get(ctx).now
        val c = Calendar.getInstance()
        return isQuietAt(c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE), s.quietStart, s.quietEnd)
    }

    private fun play(res: Int, level: Float, loop: Boolean = false, onStream: (Int) -> Unit = {}) {
        val id = ids[res] ?: return
        val v = (level * settings.value.volume).coerceIn(0f, 1f)
        val go = {
            val stream = pool.play(id, v, v, 1, if (loop) -1 else 0, 1f)
            if (stream == 0) android.util.Log.w(TAG, "SoundPool refused to play res $res")
            onStream(stream)
        }
        if (id in loaded) go() else {
            // play() before onLoadComplete would be silently dropped: wait for it instead
            askedAt[id] = SystemClock.elapsedRealtime()
            pending[id] = go
        }
    }

    // --- the sounds (the desktop's triggers) ---------------------------------
    /** A meow in her style ("random" never repeats the last one, like the desktop). The previous meow fades out. */
    fun meow(style: String = settings.value.meowStyle) {
        if (!canPlay()) return
        val m = Meow.entries.firstOrNull { it.id == style }
            ?: Meow.entries.filter { it != lastMeow }.random()
        lastMeow = m
        val prev = meowStream
        if (prev != 0) fadeOut(prev, 40)
        play(m.res, 1f) { meowStream = it }
    }

    /** Logged a drink: two quick rising notes (or a meow, with the chirp turned off). */
    fun cupLogged() {
        if (settings.value.cupChirp) chirp(quietNow()) else meow()
    }

    fun chirp(quiet: Boolean = false) {
        if (canPlay()) play(R.raw.sfx_chirp, if (quiet) 0.12f / 0.32f else 1f)
    }

    /** Nose boop. */
    fun squeak(quiet: Boolean = quietNow()) {
        if (canPlay()) play(R.raw.sfx_squeak, if (quiet) 0.1f / 0.25f else 1f)
    }

    /** Purr for [seconds]; a purr while one plays extends it (never two at once). */
    fun purr(seconds: Float, quiet: Boolean = quietNow()) {
        if (!canPlay()) return
        val level = if (quiet) 0.3f / 0.9f else 1f
        purrUntil = maxOf(purrUntil, SystemClock.elapsedRealtime() + (seconds * 1000).toLong())
        if (purrStream != 0 && purrJob?.isActive == true) return
        play(R.raw.sfx_purr_loop, 0f, loop = true) { stream ->
            purrStream = stream
            purrJob = scope.launch {
                // 0.35 s fade in, hold, 0.7 s fade out (the desktop's purr envelope)
                val vol = level * settings.value.volume
                ramp(stream, 0f, vol, 350)
                while (SystemClock.elapsedRealtime() < purrUntil - 700) delay(50)
                ramp(stream, vol, 0f, 700)
                pool.stop(stream)
                if (purrStream == stream) purrStream = 0
            }
        }
    }

    private fun stopPurr(fade: Boolean) {
        val s = purrStream
        purrJob?.cancel()
        purrStream = 0
        purrUntil = 0
        if (s != 0) if (fade) fadeOut(s, 200) else pool.stop(s)
    }

    private suspend fun ramp(stream: Int, from: Float, to: Float, ms: Long) {
        val steps = (ms / 25).coerceAtLeast(1)
        for (i in 1..steps) {
            val v = from + (to - from) * i / steps
            pool.setVolume(stream, v, v)
            delay(25)
        }
    }

    private fun fadeOut(stream: Int, ms: Long) {
        scope.launch {
            ramp(stream, settings.value.volume, 0f, ms)
            pool.stop(stream)
        }
    }

    /** The goal party: ~20 s synth loop (only when not in quiet hours, like the desktop). */
    fun startParty() {
        if (!canPlay() || quietNow() || party != null) return
        val am = ctx.getSystemService(AudioManager::class.java)
        val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setOnAudioFocusChangeListener { if (it == AudioManager.AUDIOFOCUS_LOSS || it == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) stopParty() }
            .build()
        if (am.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) return
        partyFocus = focus
        val mp = MediaPlayer.create(ctx, R.raw.music_party, focus.audioAttributes, am.generateAudioSessionId()) ?: run { stopParty(); return }
        val v = settings.value.volume
        mp.setVolume(v, v)
        mp.setOnCompletionListener { stopParty() }
        party = mp
        mp.start()
    }

    val partyPlaying: Boolean get() = party != null

    fun stopParty() {
        party?.let { runCatching { it.stop() }; it.release() }
        party = null
        partyFocus?.let { ctx.getSystemService(AudioManager::class.java).abandonAudioFocusRequest(it) }
        partyFocus = null
    }

    /** A light tap feeling with every reward (if haptics are on). */
    fun haptic(view: View) {
        if (!settings.value.haptics) return
        view.performHapticFeedback(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY)
    }

    companion object {
        private const val TAG = "WaterCatSound"
        private val K_ON = booleanPreferencesKey("soundOn")
        private val K_VOLUME = floatPreferencesKey("volume")
        private val K_STYLE = stringPreferencesKey("meowStyle")
        private val K_CHIRP = booleanPreferencesKey("cupChirp")
        private val K_HAPTICS = booleanPreferencesKey("haptics")

        @Volatile private var instance: SoundManager? = null
        fun get(ctx: Context): SoundManager = instance ?: synchronized(this) { instance ?: SoundManager(ctx.applicationContext).also { instance = it } }
    }
}
