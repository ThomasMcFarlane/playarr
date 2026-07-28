using System;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.Serialization;
using Newtonsoft.Json;

namespace Playarr.Core.Networking
{
    /// <summary>
    /// Serialises an enum using its <see cref="EnumMemberAttribute"/> wire
    /// value, and decodes an unrecognised value to the enum's zero member
    /// instead of throwing.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The tolerance is the point. The Kotlin mirror on Android
    /// (kotlinx.serialization) and the Swift mirror in PlayarrKit both
    /// throw on an enum value they do not know, which means a server that
    /// grows one new catalog kind or one new platform breaks decoding of the
    /// <em>entire</em> response for every client build older than that
    /// change -- including responses whose new value the screen would never
    /// have displayed.
    /// </para>
    /// <para>
    /// Every enum using this converter therefore declares an explicit
    /// <c>Unknown = 0</c> member, and a value this build has never heard of
    /// arrives as <c>Unknown</c>. Screens then render it as an unremarkable
    /// "something else" rather than failing the request. Round-tripping an
    /// <c>Unknown</c> back to the server is not supported and never needed:
    /// the client only ever sends values it chose itself.
    /// </para>
    /// </remarks>
    public sealed class TolerantEnumConverter : JsonConverter
    {
        private static readonly Dictionary<Type, Dictionary<string, object>> ByWireValue =
            new Dictionary<Type, Dictionary<string, object>>();

        private static readonly Dictionary<Type, Dictionary<object, string>> ByMember =
            new Dictionary<Type, Dictionary<object, string>>();

        private static readonly object CacheLock = new object();

        public override bool CanConvert(Type objectType) =>
            UnderlyingEnumType(objectType) != null;

        public override object? ReadJson(
            JsonReader reader,
            Type objectType,
            object? existingValue,
            JsonSerializer serializer)
        {
            var enumType = UnderlyingEnumType(objectType)
                ?? throw new JsonSerializationException($"{objectType} is not an enum");

            if (reader.TokenType == JsonToken.Null)
            {
                // A nullable enum property stays null; a non-nullable one
                // falls back to the zero member, same as an unknown string.
                return Nullable.GetUnderlyingType(objectType) != null
                    ? null
                    : Activator.CreateInstance(enumType);
            }

            var raw = reader.Value?.ToString();
            var lookup = WireValueLookup(enumType);

            if (raw != null && lookup.TryGetValue(raw, out var known))
            {
                return known;
            }

            return Activator.CreateInstance(enumType);
        }

        public override void WriteJson(JsonWriter writer, object? value, JsonSerializer serializer)
        {
            if (value is null)
            {
                writer.WriteNull();
                return;
            }

            var names = MemberLookup(value.GetType());
            writer.WriteValue(names.TryGetValue(value, out var wire) ? wire : value.ToString());
        }

        private static Type? UnderlyingEnumType(Type type)
        {
            var candidate = Nullable.GetUnderlyingType(type) ?? type;
            return candidate.GetTypeInfo().IsEnum ? candidate : null;
        }

        private static Dictionary<string, object> WireValueLookup(Type enumType)
        {
            lock (CacheLock)
            {
                if (ByWireValue.TryGetValue(enumType, out var cached))
                {
                    return cached;
                }

                var forward = new Dictionary<string, object>(StringComparer.Ordinal);
                var reverse = new Dictionary<object, string>();

                foreach (var field in enumType.GetTypeInfo().DeclaredFields)
                {
                    if (!field.IsStatic)
                    {
                        continue;
                    }

                    var member = field.GetCustomAttribute<EnumMemberAttribute>();
                    var wire = member?.Value ?? field.Name;
                    var value = field.GetValue(null);

                    forward[wire] = value;
                    reverse[value] = wire;
                }

                ByWireValue[enumType] = forward;
                ByMember[enumType] = reverse;
                return forward;
            }
        }

        private static Dictionary<object, string> MemberLookup(Type enumType)
        {
            WireValueLookup(enumType);
            lock (CacheLock)
            {
                return ByMember[enumType];
            }
        }
    }
}
