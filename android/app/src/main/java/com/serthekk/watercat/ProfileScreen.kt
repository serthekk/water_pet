package com.serthekk.watercat

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import java.util.Calendar

/** The cat's profile card (name, pronouns, age, friendship, stats, friend code, About / Personality) and her streak. */
@Composable
internal fun ProfileScreen(s: State, now: Long, vm: HomeViewModel = viewModel()) {
    val ui by vm.ui.collectAsState()
    val me = s.cat(SpriteData.get(LocalContext.current))
    Page {
        ProfileCard(s, me, ui, now)
        StreakCard(ui.streak, me.name)
        Text("Edit ${me.name}'s name, look and items in Settings → 🐱 ${me.name}.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth().padding(top = 4.dp))
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ProfileCard(s: State, me: CatProfile, ui: HomeUi, now: Long) {
    val ctx = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val sprites = SpriteData.get(ctx)
    val today = dayKey(now)
    val age = PetStats.ageDays(ui.adoptedOn.ifEmpty { today }, today)
    val friend = PetStats.friendship(ui.wallet.sipsTotal)
    val (weight, height, whiskers) = PetStats.measures(me.id, age, me.look().fluffy).format()
    val code = remember(s.deviceId) { PetStats.friendCode(s.deviceId) }
    var tab by remember { mutableIntStateOf(0) }
    val cal = Calendar.getInstance().apply { timeInMillis = now }
    Card(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.extraLarge, elevation = CardDefaults.cardElevation(2.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Box {
            // a faint paw-print stamp in the corner
            Text("🐾", fontSize = 72.sp, modifier = Modifier.align(Alignment.TopEnd).padding(10.dp).rotate(-18f).alpha(0.12f))
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(118.dp).clip(MaterialTheme.shapes.large).background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
                        CatThumb(me.look(), Modifier.size(96.dp), me.worn(), sprites.seasonalFor(cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)))
                    }
                    Spacer(Modifier.width(16.dp))
                    Column {
                        Text(me.name, style = MaterialTheme.typography.headlineSmall)
                        Text("${me.pronouns} · day $age together", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                InfoRow("AGE", "$age day${if (age == 1) "" else "s"}")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Label("FRIENDSHIP")
                    Column(Modifier.weight(1f)) {
                        Text("${friend.name} ${friend.heart}", fontWeight = FontWeight.Bold)
                        if (friend.nextName != null) {
                            LinearProgressIndicator(progress = { friend.progress }, Modifier.fillMaxWidth().padding(top = 4.dp).height(6.dp).clip(MaterialTheme.shapes.small),
                                color = MaterialTheme.colorScheme.secondary, drawStopIndicator = {})
                            Text("on the way to ${friend.nextName}", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Label("FRIEND CODE")
                    Text(code, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary, letterSpacing = 1.sp,
                        modifier = Modifier.clickable {
                            clipboard.setText(AnnotatedString(code))
                            Toast.makeText(ctx, "Friend code copied", Toast.LENGTH_SHORT).show()
                        })
                    Text("  ⧉", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    Stat("⚖️", weight); Stat("📏", height); Stat("〰️", "$whiskers whiskers")
                }
            }
        }
        // About / Personality
        Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer).padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("ABOUT", "PERSONALITY").forEachIndexed { i, t ->
                Box(Modifier.weight(1f).clip(MaterialTheme.shapes.medium).background(if (tab == i) MaterialTheme.colorScheme.primaryContainer else Color.Transparent)
                    .clickable { tab = i }.padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
                    Text(t, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, color = if (tab == i) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer).padding(start = 18.dp, end = 18.dp, bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (tab == 0) {
                Text(me.description.ifBlank { "Nothing written about ${me.name} yet. Tell the world in Settings → 🐱 ${me.name}." })
                val (they, _, their) = PetStats.pronounWords(me.gender)
                val coat = sprites.presets[me.preset]?.label ?: "$their own colours"
                val spot = when (me.sleepSpot) { "bed" -> "$their cat bed"; "tree" -> "the cat tree"; "box" -> "a cardboard box"; "none" -> "wherever $they drop${if (they == "they") "" else "s"}"; else -> "a different spot every night" }
                Text("🎨 $coat · 💤 sleeps in $spot", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
            } else {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { PetStats.traits(me.id).forEach { SuggestionChip({}, label = { Text(it) }) } }
                val mood = catMood(s.total(today), s.goalCups, s.quietStart, s.quietEnd, cal)
                Text("Favourite drink: ${s.drinkWord} 💧 · Mood today: ${when (mood) { "happy" -> "happy 😺"; "sad" -> "a bit thirsty 🥺"; else -> "cozy 🙂" }}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
            }
        }
    }
}

@Composable private fun Label(t: String) = Text(t, Modifier.width(120.dp), fontSize = 12.sp, letterSpacing = 1.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)

@Composable
private fun InfoRow(label: String, value: String) = Row(verticalAlignment = Alignment.CenterVertically) {
    Label(label)
    Text(value, fontWeight = FontWeight.Bold)
}

@Composable
private fun Stat(icon: String, value: String) = Row(verticalAlignment = Alignment.CenterVertically) {
    Text(icon, fontSize = 15.sp)
    Spacer(Modifier.width(4.dp))
    Text(value, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
}
