package io.legado.app.utils

inline fun <T> attempt(f: () -> T): AttemptResult<T> {
    var value: T? = null
    var error: Throwable? = null
    try {
        value = f()
    } catch(t: Throwable) {
        error = t
    }
    return AttemptResult(value, error)
}

data class AttemptResult<out T> @PublishedApi internal constructor(val value: T?, val error: Throwable?) {
    inline fun <R> then(f: (T) -> R): AttemptResult<R> {
        if (isError) {
            @Suppress("UNCHECKED_CAST")
            return this as AttemptResult<R>
        }

        return attempt { f(value as T) }
    }

    inline val isError: Boolean
        get() = error != null

    inline val hasValue: Boolean
        get() = error == null
}