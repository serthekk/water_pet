package com.serthekk.watercat

import android.content.Context
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import org.json.JSONObject

/** One of the desktop's colour themes (themes.js, exported to assets/themes.json). */
class DesktopTheme(val id: String, val label: String, val dark: Boolean, val vars: Map<String, Color>) {
    private fun v(k: String) = vars.getValue(k)

    /**
     * Desktop CSS variables -> Material 3 roles: bg = background, card = surface, ink = text,
     * muted = secondary text, line = outlines, accent = primary (buttons), hover = secondary
     * (pink highlights), check = tertiary (checks / progress), soft = containers.
     */
    fun scheme(): ColorScheme {
        val onAccent = if (dark) v("bg") else Color.White
        val common = { s: ColorScheme ->
            s.copy(
                surfaceVariant = v("soft"), onSurfaceVariant = v("muted"),
                outline = v("muted"), outlineVariant = v("line"),
                surfaceContainerLowest = v("card"), surfaceContainerLow = v("card"), surfaceContainer = lerp(v("card"), v("bg"), 0.5f),
                surfaceContainerHigh = lerp(v("card"), v("soft"), 0.5f), surfaceContainerHighest = v("soft"),
                surfaceBright = v("card"), surfaceDim = v("bg"),
            )
        }
        return common(
            if (dark) darkColorScheme(
                primary = v("accent"), onPrimary = onAccent, primaryContainer = v("soft"), onPrimaryContainer = v("ink"),
                secondary = v("hover"), onSecondary = v("ink"), secondaryContainer = lerp(v("hover"), v("bg"), 0.55f), onSecondaryContainer = v("ink"),
                tertiary = v("check"), onTertiary = onAccent, tertiaryContainer = lerp(v("check"), v("bg"), 0.7f), onTertiaryContainer = v("ink"),
                background = v("bg"), onBackground = v("ink"), surface = v("card"), onSurface = v("ink"),
            ) else lightColorScheme(
                primary = v("accent"), onPrimary = onAccent, primaryContainer = v("soft"), onPrimaryContainer = v("ink"),
                secondary = v("hover"), onSecondary = v("ink"), secondaryContainer = lerp(v("hover"), v("card"), 0.65f), onSecondaryContainer = v("ink"),
                tertiary = v("check"), onTertiary = onAccent, tertiaryContainer = lerp(v("check"), v("card"), 0.75f), onTertiaryContainer = v("ink"),
                background = v("bg"), onBackground = v("ink"), surface = v("card"), onSurface = v("ink"),
            ),
        )
    }

    companion object {
        @Volatile private var cache: List<DesktopTheme>? = null
        fun all(ctx: Context): List<DesktopTheme> = cache ?: synchronized(this) {
            cache ?: parse(JSONObject(ctx.assets.open("themes.json").bufferedReader().use { it.readText() })).also { cache = it }
        }

        fun parse(json: JSONObject): List<DesktopTheme> {
            val a = json.getJSONArray("themes")
            return (0 until a.length()).map { i ->
                val t = a.getJSONObject(i)
                val v = t.getJSONObject("vars")
                DesktopTheme(t.getString("id"), t.getString("label"), t.optBoolean("dark"), v.keys().asSequence().associateWith { Color(hexColor(v.getString(it))) })
            }
        }
    }
}

private val Context.uiStore: DataStore<Preferences> by preferencesDataStore(name = "ui_settings")

/** Look-and-feel settings of this phone (DataStore). */
class UiPrefs private constructor(ctx: Context) {
    private val store = ctx.uiStore
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val theme: StateFlow<String> = store.data.map { it[K_THEME] ?: "cream" }.stateIn(scope, SharingStarted.Eagerly, "cream")
    fun setTheme(id: String) { scope.launch { store.edit { it[K_THEME] = id } } }

    companion object {
        private val K_THEME = stringPreferencesKey("theme")
        @Volatile private var instance: UiPrefs? = null
        fun get(ctx: Context): UiPrefs = instance ?: synchronized(this) { instance ?: UiPrefs(ctx.applicationContext).also { instance = it } }
    }
}

// Nunito (SIL Open Font License, assets/licenses/OFL-Nunito.txt): one variable font file.
@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
private fun nunito(w: Int) = Font(R.font.nunito, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))
val Nunito = FontFamily(nunito(400), nunito(500), nunito(600), nunito(700), nunito(800), nunito(900))

private val AppTypography: Typography = Typography().let { t ->
    fun TextStyle.n(w: FontWeight? = null) = copy(fontFamily = Nunito, fontWeight = w ?: fontWeight)
    t.copy(
        displayLarge = t.displayLarge.n(FontWeight.ExtraBold), displayMedium = t.displayMedium.n(FontWeight.ExtraBold), displaySmall = t.displaySmall.n(FontWeight.ExtraBold),
        headlineLarge = t.headlineLarge.n(FontWeight.ExtraBold), headlineMedium = t.headlineMedium.n(FontWeight.ExtraBold), headlineSmall = t.headlineSmall.n(FontWeight.ExtraBold),
        titleLarge = t.titleLarge.n(FontWeight.Bold), titleMedium = t.titleMedium.n(FontWeight.Bold), titleSmall = t.titleSmall.n(FontWeight.Bold),
        bodyLarge = t.bodyLarge.n(FontWeight.Medium), bodyMedium = t.bodyMedium.n(FontWeight.Medium), bodySmall = t.bodySmall.n(FontWeight.Medium),
        labelLarge = t.labelLarge.n(FontWeight.Bold), labelMedium = t.labelMedium.n(FontWeight.Bold), labelSmall = t.labelSmall.n(FontWeight.Bold),
    )
}

// Soft, rounded cards (24 dp) like the desktop windows' cards.
val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

@Composable
fun WaterCatTheme(content: @Composable () -> Unit) {
    val ctx = LocalContext.current
    val prefs = remember { UiPrefs.get(ctx) }
    val id by prefs.theme.collectAsState()
    val themes = remember { DesktopTheme.all(ctx) }
    val theme = themes.firstOrNull { it.id == id } ?: themes.first()
    val scheme = remember(theme.id) { theme.scheme() }
    MaterialTheme(colorScheme = scheme, typography = AppTypography, shapes = AppShapes, content = content)
}
