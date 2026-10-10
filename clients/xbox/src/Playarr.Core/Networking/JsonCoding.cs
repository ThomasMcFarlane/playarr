using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Playarr.Core.Models;

namespace Playarr.Core.Networking
{
    /// <summary>
    /// Shared <see cref="JsonSerializerSettings"/> for every wire type in
    /// this assembly. Port of <c>PlayarrJSONCoding</c> in the iOS client's
    /// PlayarrKit, centralised here for the same reason: so date handling
    /// stays identical at every call site.
    /// </summary>
    public static class JsonCoding
    {
        /// <summary>
        /// Settings used for both directions.
        /// </summary>
        /// <remarks>
        /// <para>
        /// Property names are <em>not</em> auto-converted to snake_case.
        /// Every wire type in this assembly carries explicit
        /// <c>[JsonProperty("...")]</c> attributes, mirroring the iOS
        /// client's explicit <c>CodingKeys</c>. That is more typing and
        /// considerably harder to get silently wrong: a renamed C# property
        /// cannot quietly change the wire contract.
        /// </para>
        /// <para>
        /// The backend's <c>DateTime&lt;Utc&gt;</c> fields are serialised by
        /// chrono's default RFC 3339 impl, which emits a <c>+00:00</c>
        /// offset rather than <c>Z</c> and includes fractional seconds only
        /// when they are non-zero. <see cref="IsoDateTimeConverter"/>
        /// accepts both shapes on the way in; on the way out we always emit
        /// fractional seconds and an explicit offset, which the server's
        /// chrono deserialiser accepts.
        /// </para>
        /// <para>
        /// <see cref="NullValueHandling.Ignore"/> matters for request
        /// bodies: several endpoints treat an absent field and an explicit
        /// <c>null</c> differently (an absent field means "leave unchanged",
        /// a null means "clear"), and omitting nulls is the shape the other
        /// clients already send.
        /// </para>
        /// </remarks>
        public static JsonSerializerSettings CreateSettings()
        {
            var settings = new JsonSerializerSettings
            {
                NullValueHandling = NullValueHandling.Ignore,
                MissingMemberHandling = MissingMemberHandling.Ignore,
                DateParseHandling = DateParseHandling.None,
                DateTimeZoneHandling = DateTimeZoneHandling.Utc,
            };

            settings.Converters.Add(new IsoDateTimeConverter
            {
                DateTimeStyles = System.Globalization.DateTimeStyles.AdjustToUniversal,
                DateTimeFormat = "yyyy-MM-ddTHH:mm:ss.FFFFFFFzzz",
            });
            settings.Converters.Add(new SensitiveConverter());
            settings.Converters.Add(new ClientPlatformConverter());

            return settings;
        }

        private static readonly JsonSerializerSettings SharedSettings = CreateSettings();

        public static string Serialize(object value) =>
            JsonConvert.SerializeObject(value, SharedSettings);

        public static T? Deserialize<T>(string json) where T : class =>
            JsonConvert.DeserializeObject<T>(json, SharedSettings);

        public static T? DeserializeValue<T>(string json) where T : struct =>
            JsonConvert.DeserializeObject<T?>(json, SharedSettings);
    }

    /// <summary>
    /// Round-trips <see cref="Sensitive{T}"/> transparently, exactly as the
    /// wrapped value. See that type's remarks for why redaction is a
    /// logging concern rather than a serialization one.
    /// </summary>
    internal sealed class SensitiveConverter : JsonConverter
    {
        public override bool CanConvert(Type objectType) =>
            objectType.IsGenericType &&
            objectType.GetGenericTypeDefinition() == typeof(Sensitive<>);

        public override object? ReadJson(
            JsonReader reader,
            Type objectType,
            object? existingValue,
            JsonSerializer serializer)
        {
            // Direct construction for the wrapped types in use: Activator needs constructor metadata that the
            // .NET Native release build strips.
            if (objectType == typeof(Sensitive<string>))
            {
                return new Sensitive<string>(serializer.Deserialize<string>(reader)!);
            }

            var wrapped = objectType.GetGenericArguments()[0];
            var value = serializer.Deserialize(reader, wrapped);
            return Activator.CreateInstance(objectType, value);
        }

        public override void WriteJson(JsonWriter writer, object? value, JsonSerializer serializer)
        {
            if (value is null)
            {
                writer.WriteNull();
                return;
            }

            serializer.Serialize(writer, ((ISensitive)value).ExposeBoxed());
        }
    }

    /// <summary>
    /// Encodes <see cref="ClientPlatform"/> using its kebab-case wire name
    /// rather than the C# member name, and decodes an unrecognised value to
    /// <c>null</c> instead of throwing -- see
    /// <see cref="ClientPlatformExtensions.FromWireName"/>.
    /// </summary>
    internal sealed class ClientPlatformConverter : JsonConverter
    {
        public override bool CanConvert(Type objectType) =>
            objectType == typeof(ClientPlatform) || objectType == typeof(ClientPlatform?);

        public override object? ReadJson(
            JsonReader reader,
            Type objectType,
            object? existingValue,
            JsonSerializer serializer)
        {
            var raw = reader.Value as string;
            var parsed = ClientPlatformExtensions.FromWireName(raw);

            if (parsed is null && objectType == typeof(ClientPlatform))
            {
                throw new JsonSerializationException(
                    $"unknown client platform \"{raw}\"");
            }

            return parsed;
        }

        public override void WriteJson(JsonWriter writer, object? value, JsonSerializer serializer)
        {
            if (value is ClientPlatform platform)
            {
                writer.WriteValue(platform.WireName());
                return;
            }

            writer.WriteNull();
        }
    }
}
