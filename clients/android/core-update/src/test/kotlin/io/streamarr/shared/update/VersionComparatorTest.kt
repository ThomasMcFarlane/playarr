package io.streamarr.shared.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VersionComparatorTest {

    @Test
    fun `equal versions compare as zero`() {
        assertEquals(0, VersionComparator.compare("1.2.3", "1.2.3"))
    }

    @Test
    fun `a lower patch version is less than a higher one`() {
        assertTrue(VersionComparator.isLessThan("1.2.3", "1.2.4"))
        assertFalse(VersionComparator.isLessThan("1.2.4", "1.2.3"))
    }

    @Test
    fun `a lower minor version is less than a higher one, even with a higher patch`() {
        assertTrue(VersionComparator.isLessThan("1.9.9", "1.10.0"))
    }

    @Test
    fun `a lower major version is less than a higher one, even with lower minor patch`() {
        assertTrue(VersionComparator.isLessThan("1.99.99", "2.0.0"))
    }

    @Test
    fun `missing trailing components are treated as zero`() {
        assertEquals(0, VersionComparator.compare("1.2", "1.2.0"))
        assertTrue(VersionComparator.isLessThan("1.2", "1.2.1"))
    }

    @Test
    fun `pre-release and build-metadata suffixes are ignored, comparing only the numeric prefix`() {
        assertEquals(0, VersionComparator.compare("2.4.1-beta.1", "2.4.1"))
        assertEquals(0, VersionComparator.compare("2.4.1+abc123", "2.4.1"))
    }

    @Test
    fun `a malformed version with no numeric component sorts as entirely zero, not as up to date`() {
        assertTrue(VersionComparator.isLessThan("not-a-version", "0.0.1"))
        assertEquals(0, VersionComparator.compare("not-a-version", "0.0.0"))
    }

    @Test
    fun `the client's own build version at the exact server floor is not less than it`() {
        assertFalse(VersionComparator.isLessThan("2.4.1", "2.4.1"))
    }
}
