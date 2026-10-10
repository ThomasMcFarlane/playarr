using System;
using System.Collections.Generic;

namespace Playarr.Core.Models
{
    /// <summary>
    /// Mirrors <c>playarr_model::sensitive::Sensitive&lt;T&gt;</c> from the
    /// backend (<c>backend/crates/playarr-model/src/sensitive.rs</c>) and
    /// <c>Sensitive</c> from the iOS client's PlayarrKit.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Wrap access tokens, refresh tokens, and any other secret that ends up
    /// on a domain model in <see cref="Sensitive{T}"/> so a stray
    /// <c>ToString()</c>, log line, or crash breadcrumb can never leak it.
    /// <see cref="ToString"/> always returns the literal string
    /// <c>"REDACTED"</c> regardless of the wrapped value.
    /// </para>
    /// <para>
    /// JSON handling is intentionally transparent -- it round-trips exactly
    /// like the wrapped value on the wire (see
    /// <c>Playarr.Core.Networking.SensitiveConverter</c>) -- because callers
    /// that legitimately need the secret (attaching an
    /// <c>Authorization</c> header, persisting a session) still have to get
    /// it out via <see cref="ExposeSecret"/>. Redaction here is a logging
    /// concern, not a serialization one: do not rely on this type alone to
    /// keep secrets out of payloads handed to other layers.
    /// </para>
    /// </remarks>
    /// <typeparam name="T">The wrapped secret's type.</typeparam>
    public readonly struct Sensitive<T> : IEquatable<Sensitive<T>>, ISensitive
    {
        private readonly T _value;

        public Sensitive(T value)
        {
            _value = value;
        }

        /// <summary>
        /// Explicit, greppable escape hatch -- named to match the Rust
        /// <c>expose_secret()</c> method and the Swift
        /// <c>exposeSecret()</c> so an audit for any of the three finds
        /// every call site across the whole codebase.
        /// </summary>
        public T ExposeSecret() => _value;

        object? ISensitive.ExposeBoxed() => _value;

        /// <summary>Always <c>"REDACTED"</c>. See the type remarks.</summary>
        public override string ToString() => "REDACTED";

        public bool Equals(Sensitive<T> other) =>
            EqualityComparer<T>.Default.Equals(_value, other._value);

        public override bool Equals(object? obj) =>
            obj is Sensitive<T> other && Equals(other);

        public override int GetHashCode() =>
            _value is null ? 0 : EqualityComparer<T>.Default.GetHashCode(_value);

        public static bool operator ==(Sensitive<T> left, Sensitive<T> right) => left.Equals(right);

        public static bool operator !=(Sensitive<T> left, Sensitive<T> right) => !left.Equals(right);
    }

    /// <summary>
    /// Non-generic access to a <see cref="Sensitive{T}"/>'s value for serialization, so the JSON converter needs no
    /// reflection (the .NET Native release build strips the metadata <c>GetMethod</c> would need).
    /// </summary>
    public interface ISensitive
    {
        object? ExposeBoxed();
    }
}
