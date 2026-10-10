package io.playarr.mobile.ui

import java.text.Collator

/**
 * Library title order, as web's `Intl.Collator(undefined, { numeric: true, sensitivity: "base" })`: case and accents are
 * ignored and runs of digits compare by value, so "2 ..." sorts before "10 ...".
 */
internal object PlayarrTitleOrder : Comparator<String> {
    private val chunk = Regex("\\d+|\\D+")
    private val collator: Collator = Collator.getInstance().apply { strength = Collator.PRIMARY }

    override fun compare(a: String, b: String): Int {
        val left = chunk.findAll(a).map { it.value }.iterator()
        val right = chunk.findAll(b).map { it.value }.iterator()
        while (left.hasNext() && right.hasNext()) {
            val x = left.next()
            val y = right.next()
            val result = if (x[0].isDigit() && y[0].isDigit()) {
                val xs = x.trimStart('0')
                val ys = y.trimStart('0')
                if (xs.length != ys.length) xs.length - ys.length else xs.compareTo(ys)
            } else {
                synchronized(collator) { collator.compare(x, y) }
            }
            if (result != 0) return result
        }
        return (if (left.hasNext()) 1 else 0) - (if (right.hasNext()) 1 else 0)
    }
}
