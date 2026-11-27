package com.serthekk.watercat

import android.content.Context
import androidx.room.AutoMigration
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

/*
 * The game's data (Room). Water cups, settings and alarms stay where they were (Store /
 * DataStore, synced with the desktop); this holds what only the phone has:
 *   goals        her goals (starter plan + her own), in her order
 *   completions  which goal was done on which day
 *   ledger       every reward / purchase, one row per unique key (see GameRules)
 *   inventory    items she owns (shop, step 6)
 *   meta         small values: best streak, adoption day, starter plan seeded, ...
 */

@Entity(tableName = "goals")
data class GoalEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val title: String,
    val icon: String,
    val sips: Int = GameRules.DEFAULT_GOAL_SIPS,
    val kind: String = "custom", // "water" = done when the day's water goal is reached
    val position: Int = 0,
    val archived: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "completions", primaryKeys = ["goalId", "date"], indices = [Index("date")])
data class CompletionEntity(val goalId: Long, val date: String, val at: Long = System.currentTimeMillis())

@Entity(tableName = "ledger", indices = [Index(value = ["key"], unique = true), Index("date")])
data class LedgerEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val key: String,
    val date: String,
    val sips: Int,
    val treats: Int,
    val note: String,
    val at: Long = System.currentTimeMillis(),
) {
    fun toReward() = Reward(key, date, sips, treats, note)

    companion object {
        fun of(r: Reward) = LedgerEntity(key = r.key, date = r.date, sips = r.sips, treats = r.treats, note = r.note)
    }
}

@Entity(tableName = "inventory")
data class InventoryEntity(@PrimaryKey val itemId: String, val source: String, val acquiredAt: Long = System.currentTimeMillis())

/** One trip out in the garden (Adventures). The times are stored, so the countdown survives the app being closed. */
@Entity(tableName = "adventures", indices = [Index("date")])
data class AdventureEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val date: String,
    val startedAt: Long,
    val returnsAt: Long,
    val storyId: Int,
    val treats: Int,
    val claimedAt: Long? = null,
) {
    fun trip() = Adventures.Trip(id, date, startedAt, returnsAt, storyId, treats, claimedAt != null)
}

@Entity(tableName = "meta")
data class MetaEntity(@PrimaryKey val key: String, val value: String)

@Dao
interface GoalDao {
    @Query("SELECT * FROM goals WHERE archived = 0 ORDER BY position, id")
    fun observeActive(): Flow<List<GoalEntity>>

    @Query("SELECT * FROM goals WHERE archived = 0 ORDER BY position, id")
    suspend fun active(): List<GoalEntity>

    @Query("SELECT * FROM goals WHERE id = :id")
    suspend fun byId(id: Long): GoalEntity?

    @Insert
    suspend fun insert(goal: GoalEntity): Long

    @Update
    suspend fun update(goal: GoalEntity)

    @Update
    suspend fun updateAll(goals: List<GoalEntity>)

    @Query("SELECT COALESCE(MAX(position), -1) + 1 FROM goals")
    suspend fun nextPosition(): Int
}

@Dao
interface CompletionDao {
    @Query("SELECT * FROM completions WHERE date = :date")
    fun observeFor(date: String): Flow<List<CompletionEntity>>

    @Query("SELECT * FROM completions WHERE date = :date")
    suspend fun forDate(date: String): List<CompletionEntity>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(c: CompletionEntity): Long

    @Query("DELETE FROM completions WHERE goalId = :goalId AND date = :date")
    suspend fun delete(goalId: Long, date: String)
}

@Dao
interface LedgerDao {
    @Query("SELECT * FROM ledger ORDER BY at")
    fun observeAll(): Flow<List<LedgerEntity>>

    /** Ignored when the key is already there: a reward is never paid twice. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(e: LedgerEntity): Long

    @Query("SELECT key FROM ledger WHERE date = :date")
    suspend fun keysFor(date: String): List<String>

    @Query("DELETE FROM ledger WHERE key IN (:keys)")
    suspend fun deleteKeys(keys: List<String>)

    @Query("SELECT COALESCE(SUM(treats), 0) FROM ledger")
    suspend fun treats(): Int

    @Query("SELECT COALESCE(SUM(sips), 0) FROM ledger WHERE date = :date")
    suspend fun sipsOn(date: String): Int

    /** Days with something done (a goal or a glass): the care streak. */
    @Query("SELECT DISTINCT date FROM ledger WHERE sips > 0")
    fun observeActiveDays(): Flow<List<String>>
}

@Dao
interface InventoryDao {
    @Query("SELECT * FROM inventory ORDER BY acquiredAt")
    fun observe(): Flow<List<InventoryEntity>>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(item: InventoryEntity): Long
}

@Dao
interface AdventureDao {
    @Query("SELECT * FROM adventures ORDER BY startedAt DESC LIMIT 1")
    fun observeLatest(): Flow<AdventureEntity?>

    @Query("SELECT * FROM adventures ORDER BY startedAt DESC LIMIT 1")
    suspend fun latest(): AdventureEntity?

    @Query("SELECT * FROM adventures WHERE claimedAt IS NOT NULL ORDER BY startedAt DESC")
    fun observeClaimed(): Flow<List<AdventureEntity>>

    @Query("SELECT storyId FROM adventures ORDER BY startedAt DESC LIMIT 6")
    suspend fun recentStories(): List<Int>

    @Insert
    suspend fun insert(a: AdventureEntity): Long

    @Query("UPDATE adventures SET claimedAt = :at WHERE id = :id AND claimedAt IS NULL")
    suspend fun claim(id: Long, at: Long): Int
}

@Dao
interface MetaDao {
    @Query("SELECT value FROM meta WHERE `key` = :key")
    suspend fun get(key: String): String?

    @Query("SELECT value FROM meta WHERE `key` = :key")
    fun observe(key: String): Flow<String?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(m: MetaEntity)
}

@Database(
    entities = [GoalEntity::class, CompletionEntity::class, LedgerEntity::class, InventoryEntity::class, MetaEntity::class, AdventureEntity::class],
    version = 2, exportSchema = true,
    autoMigrations = [AutoMigration(from = 1, to = 2)], // 2: adventures (a new table; everything else is kept)
)
abstract class GameDb : RoomDatabase() {
    abstract fun goals(): GoalDao
    abstract fun completions(): CompletionDao
    abstract fun ledger(): LedgerDao
    abstract fun inventory(): InventoryDao
    abstract fun meta(): MetaDao
    abstract fun shop(): ShopDao
    abstract fun adventures(): AdventureDao

    companion object {
        @Volatile private var instance: GameDb? = null
        fun get(ctx: Context): GameDb = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(ctx.applicationContext, GameDb::class.java, "watercat-game.db").build().also { instance = it }
        }
    }
}

/** Buying: the price comes off as a ledger entry, the item goes in the bag, in one transaction. */
@Dao
abstract class ShopDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    abstract suspend fun insertLedger(e: LedgerEntity): Long

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    abstract suspend fun insertItem(item: InventoryEntity): Long

    @Query("SELECT COALESCE(SUM(treats), 0) FROM ledger")
    abstract suspend fun treats(): Int

    @Transaction
    open suspend fun buy(itemId: String, price: Int, date: String, note: String): Boolean {
        if (treats() < price) return false
        if (insertItem(InventoryEntity(itemId, "shop")) < 0) return false // already hers
        insertLedger(LedgerEntity(key = "shop:$itemId", date = date, sips = 0, treats = -price, note = note))
        return true
    }
}
