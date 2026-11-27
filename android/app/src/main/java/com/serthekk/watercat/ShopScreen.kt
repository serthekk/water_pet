package com.serthekk.watercat

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import java.util.Calendar

/** What an item looks like: her wearing it, the coat on her, or its icon. */
@Composable
internal fun ItemPreview(item: Catalog.Item, me: CatProfile, modifier: Modifier = Modifier) {
    val sprites = SpriteData.get(LocalContext.current)
    Box(modifier.clip(MaterialTheme.shapes.medium).background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
        when (item.kind) {
            "acc" -> CatThumb(me.look(), Modifier.fillMaxWidth(0.8f).height(70.dp), accessories = mapOf(item.ref to Worn(true)))
            "coat" -> CatThumb(sprites.presets[item.ref]?.look ?: me.look(), Modifier.fillMaxWidth(0.8f).height(70.dp))
            else -> Text(item.icon, fontSize = 40.sp)
        }
    }
}

/** The daily shop: six items, new ones at midnight, some waiting for her to grow. */
@Composable
internal fun ShopScreen(s: State, vm: HomeViewModel = viewModel()) {
    val ctx = LocalContext.current
    val view = LocalView.current
    val sound = SoundManager.get(ctx)
    val sprites = SpriteData.get(ctx)
    val ui by vm.ui.collectAsState()
    val me = s.cat(sprites)
    val owned = ui.bag + Catalog.ownedFree(me)
    val all = remember { Catalog.all(sprites) }
    val today = ui.today.ifEmpty { dayKey(System.currentTimeMillis()) }
    val items = remember(today, owned) { Catalog.todaysShop(all, owned, today) }
    var left by remember { mutableLongStateOf(Catalog.msToRefresh(Calendar.getInstance())) }
    LaunchedEffect(Unit) { while (true) { left = Catalog.msToRefresh(Calendar.getInstance()); delay(1_000) } }
    val stage = ui.stage
    Page {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Shop", style = MaterialTheme.typography.headlineSmall)
                Text("New items in ${Adventures.countdown(left)}", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
            }
            Box(Modifier.clip(MaterialTheme.shapes.large).background(MaterialTheme.colorScheme.primaryContainer).padding(horizontal = 14.dp, vertical = 8.dp)) {
                Text("🐟 ${ui.wallet.treats}", fontWeight = FontWeight.ExtraBold, fontSize = 18.sp)
            }
        }
        Text("${stage.icon} ${me.name} is a ${stage.name.lowercase()}. Earn 🐟 with good days and adventures.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (items.isEmpty()) SectionCard { Text("${me.name} owns everything in the shop! 🎉 Come back for new things later.") }
        items.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                row.forEach { item ->
                    val can = Catalog.canBuy(item, owned, stage, ui.wallet.treats)
                    Card(Modifier.weight(1f), shape = MaterialTheme.shapes.large, elevation = CardDefaults.cardElevation(1.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                        Column(Modifier.padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            ItemPreview(item, me, Modifier.fillMaxWidth().height(92.dp))
                            Text(item.label, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, maxLines = 1)
                            Text(item.tab.label, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            when (can) {
                                Catalog.CanBuy.Yes -> Button({
                                    vm.buy(item, onBought = {
                                        sound.chirp(); sound.haptic(view)
                                        Toast.makeText(ctx, "${item.label} is in the bag! 🎒", Toast.LENGTH_SHORT).show()
                                    })
                                }, Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium) { Text("🐟 ${item.price}", fontWeight = FontWeight.Bold) }
                                is Catalog.CanBuy.NeedTreats -> OutlinedButton({}, Modifier.fillMaxWidth(), enabled = false, shape = MaterialTheme.shapes.medium) { Text("🐟 ${item.price}") }
                                is Catalog.CanBuy.Locked -> OutlinedButton({}, Modifier.fillMaxWidth(), enabled = false, shape = MaterialTheme.shapes.medium) {
                                    Text("🔒 ${can.stage.name}", fontSize = 13.sp)
                                }
                                Catalog.CanBuy.Owned -> Text("In the bag ✓", color = MaterialTheme.colorScheme.primary)
                            }
                        }
                    }
                }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
        Growth.nextNeeds(ui.ageDays, ui.wallet.sipsTotal)?.let {
            Text("$it. Some things only fit a bigger cat 🔒", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
        }
    }
}

/** The bag: what she owns, by tab. Tap to wear / use. Clothes, coat and bed sync with the computer. */
@Composable
internal fun BagScreen(s: State, vm: HomeViewModel = viewModel()) {
    val ctx = LocalContext.current
    val view = LocalView.current
    val sound = SoundManager.get(ctx)
    val sprites = SpriteData.get(ctx)
    val ui by vm.ui.collectAsState()
    val me = s.cat(sprites)
    val owned = ui.bag + Catalog.ownedFree(me)
    val all = remember { Catalog.all(sprites) }
    var tab by remember { mutableIntStateOf(0) }
    val tabs = listOf("👕 Clothes", "🎨 Body", "🏡 House", "🎒 Finds")
    Page {
        Text("Bag", style = MaterialTheme.typography.headlineSmall)
        Card(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.large, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                CatThumb(me.look(), Modifier.size(96.dp), me.worn())
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(me.name, style = MaterialTheme.typography.titleLarge)
                    Text("${ui.stage.icon} ${ui.stage.name} · ${sprites.presets[me.preset]?.label ?: "own colours"}", fontSize = 13.sp)
                    if (s.paired) Text("Outfit, coat and bed show on ${s.desktopName} too.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            tabs.forEachIndexed { i, t ->
                Box(Modifier.weight(1f).clip(MaterialTheme.shapes.medium).background(if (tab == i) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh)
                    .clickable { tab = i }.padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
                    Text(t, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = if (tab == i) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface)
                }
            }
        }
        fun use(done: String) { sound.chirp(); sound.haptic(view); Toast.makeText(ctx, done, Toast.LENGTH_SHORT).show() }
        val cells: List<Triple<Catalog.Item, Boolean, () -> Unit>> = when (tab) {
            0 -> all.filter { it.kind == "acc" && it.id in owned }.map { item ->
                val on = me.isWearing(item.ref)
                Triple(item, on) { editCat(ctx) { it.wearing(item.ref, !on) }; use(if (on) "${item.label} off" else "${me.name} is wearing the ${item.label.lowercase()} ✨") }
            }
            1 -> (listOf(Catalog.Item("coat:gargorl", Catalog.Tab.Body, "coat", "gargorl", sprites.presets.getValue("gargorl").label, "🎨", 0)) + all.filter { it.kind == "coat" && it.id in owned })
                .map { item -> Triple(item, me.preset == item.ref) { sprites.presets[item.ref]?.let { p -> editCat(ctx) { it.withPreset(p) } }; use("New coat: ${item.label} 🎨") } }
            2 -> (listOf(Catalog.Item("spot:bed", Catalog.Tab.House, "spot", "bed", "Cat bed", "🛏️", 0)) + all.filter { it.tab == Catalog.Tab.House && it.id in owned }).map { item ->
                if (item.kind == "spot") Triple(item, me.sleepSpot == item.ref) { editCat(ctx) { it.withSleepSpot(item.ref) }; use("${me.name} sleeps in the ${item.label.lowercase()} now 💤") }
                else {
                    val placed = item.ref in ui.decor
                    Triple(item, placed) { vm.setDecor(item.ref, !placed); use(if (placed) "${item.label} put away" else "${item.label} is in the garden 🌼") }
                }
            }
            else -> emptyList()
        }
        if (tab == 3) {
            val finds = ui.bag.filter { it.startsWith("souvenir:") }.mapNotNull { Adventures.souvenirs[it.removePrefix("souvenir:")] }
            if (finds.isEmpty()) SectionCard { Text("Nothing yet. ${me.name} brings something home from every adventure 🧺") }
            finds.chunked(3).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEach { f ->
                        Card(Modifier.weight(1f), shape = MaterialTheme.shapes.large) {
                            Column(Modifier.fillMaxWidth().padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(f.icon, fontSize = 34.sp)
                                Text(f.label, fontSize = 12.sp, textAlign = TextAlign.Center, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                    repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        } else {
            if (cells.isEmpty()) SectionCard { Text("Nothing here yet: find things in the Shop 🛍️") }
            cells.chunked(2).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    row.forEach { (item, on, act) ->
                        Card(Modifier.weight(1f).clickable { act() }, shape = MaterialTheme.shapes.large,
                            colors = CardDefaults.cardColors(containerColor = if (on) MaterialTheme.colorScheme.tertiaryContainer else MaterialTheme.colorScheme.surface)) {
                            Column(Modifier.padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                ItemPreview(item, me, Modifier.fillMaxWidth().height(84.dp))
                                Text(item.label, fontWeight = FontWeight.Bold, maxLines = 1)
                                Text(
                                    when { item.kind == "acc" -> if (on) "Wearing ✓" else "Tap to wear"; item.kind == "decor" -> if (on) "In the garden ✓" else "Tap to place"; else -> if (on) "In use ✓" else "Tap to use" },
                                    fontSize = 12.sp, color = if (on) MaterialTheme.colorScheme.onTertiaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

