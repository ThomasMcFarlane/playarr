package io.streamarr.shared.download

import androidx.sqlite.db.SupportSQLiteDatabase
import io.streamarr.shared.download.db.STREAMARR_DOWNLOAD_MIGRATION_1_2
import io.streamarr.shared.download.db.STREAMARR_DOWNLOAD_MIGRATION_3_4
import java.lang.reflect.Proxy
import org.junit.Assert.assertEquals
import org.junit.Test

class DownloadServerRoutingTest {
    @Test
    fun `download ticket URL preserves owning origin and encodes the ticket id`() {
        assertEquals(
            "https://secondary.example:9443/api/v1/downloads/ticket%2Fone/file",
            downloadTicketFileUrl("https://secondary.example:9443/", "ticket/one"),
        )
    }

    @Test
    fun `schema migration preserves rows and marks their server as unresolved primary`() {
        val statements = mutableListOf<String>()
        val database = recordingDatabase(statements)

        STREAMARR_DOWNLOAD_MIGRATION_1_2.migrate(database)

        assertEquals(
            listOf("ALTER TABLE download_metadata ADD COLUMN serverUrl TEXT NOT NULL DEFAULT ''"),
            statements,
        )
    }

    @Test
    fun `quality label migration preserves downloads created before labels were stored`() {
        val statements = mutableListOf<String>()
        val database = recordingDatabase(statements)

        STREAMARR_DOWNLOAD_MIGRATION_3_4.migrate(database)

        assertEquals(
            listOf("ALTER TABLE download_metadata ADD COLUMN qualityLabel TEXT NOT NULL DEFAULT ''"),
            statements,
        )
    }

    private fun recordingDatabase(statements: MutableList<String>) = Proxy.newProxyInstance(
        SupportSQLiteDatabase::class.java.classLoader,
        arrayOf(SupportSQLiteDatabase::class.java),
    ) { proxy, method, arguments ->
        when (method.name) {
            "execSQL" -> statements += arguments.orEmpty().first() as String
            "toString" -> "FakeSupportSQLiteDatabase"
            "hashCode" -> System.identityHashCode(proxy)
            "equals" -> proxy === arguments?.firstOrNull()
            else -> error("Unexpected database call: ${method.name}")
        }
    } as SupportSQLiteDatabase
}
