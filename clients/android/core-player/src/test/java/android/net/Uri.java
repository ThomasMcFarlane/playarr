package android.net;

// Minimal JVM stand-in for android.net.Uri, shadowing the throwing stub in
// android.jar so Media3's DataSpec can be used in plain unit tests without
// Robolectric. Only what the data-source tests touch is implemented. Plain
// comments (not Javadoc) on purpose: the JDK 17 lint in CI crashes parsing
// Javadoc/KDoc in unit-test sources (List.removeLast needs JDK 21).
public final class Uri {
    private final java.net.URI uri;

    private Uri(java.net.URI uri) {
        this.uri = uri;
    }

    public static Uri parse(String value) {
        return new Uri(java.net.URI.create(value));
    }

    public String getScheme() {
        return uri.getScheme();
    }

    public String getHost() {
        return uri.getHost();
    }

    public String getPath() {
        return uri.getPath();
    }

    @Override
    public String toString() {
        return uri.toString();
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof Uri && ((Uri) other).uri.equals(uri);
    }

    @Override
    public int hashCode() {
        return uri.hashCode();
    }
}
