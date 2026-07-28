using Playarr.Core.Models;

namespace Playarr.Xbox
{
    /// <summary>
    /// The discriminant for <see cref="PairingState"/>. Mirrors the cases of
    /// tvOS's <c>TVPairingState</c> enum.
    /// </summary>
    public enum PairingStateKind
    {
        SignedOut,
        RequestingCode,
        AwaitingApproval,
        SignedIn,
        Failed,
    }

    /// <summary>
    /// The pairing state <see cref="XboxAppEnvironment"/> exposes -- a port
    /// of tvOS's <c>TVPairingState</c>, an enum with associated values. C#
    /// enums can't carry a payload, so this is a small immutable class with
    /// factory members instead of a real discriminated union.
    /// </summary>
    /// <remarks>
    /// A consumer switches on <see cref="Kind"/> (e.g. in a page's Render()
    /// method -- see <c>Views/LoginPage.xaml.cs</c>) and only reads
    /// <see cref="PendingCode"/> when <see cref="Kind"/> is
    /// <see cref="PairingStateKind.AwaitingApproval"/>, or
    /// <see cref="FailureMessage"/> when it's
    /// <see cref="PairingStateKind.Failed"/>. Both are <c>null</c> for every
    /// other kind, by construction -- there's no case where a caller who
    /// only checks <see cref="Kind"/> can observe garbage from the "wrong"
    /// case's payload the way an unvalidated union might.
    /// </remarks>
    public sealed class PairingState
    {
        public PairingStateKind Kind { get; }

        /// <summary>Only non-null when <see cref="Kind"/> is <see cref="PairingStateKind.AwaitingApproval"/>.</summary>
        public DeviceCodeResponse? PendingCode { get; }

        /// <summary>Only non-null when <see cref="Kind"/> is <see cref="PairingStateKind.Failed"/>.</summary>
        public string? FailureMessage { get; }

        private PairingState(PairingStateKind kind, DeviceCodeResponse? pendingCode, string? failureMessage)
        {
            Kind = kind;
            PendingCode = pendingCode;
            FailureMessage = failureMessage;
        }

        public static PairingState SignedOut { get; } = new PairingState(PairingStateKind.SignedOut, null, null);

        public static PairingState RequestingCode { get; } =
            new PairingState(PairingStateKind.RequestingCode, null, null);

        public static PairingState SignedIn { get; } = new PairingState(PairingStateKind.SignedIn, null, null);

        public static PairingState AwaitingApproval(DeviceCodeResponse pendingCode) =>
            new PairingState(PairingStateKind.AwaitingApproval, pendingCode, null);

        public static PairingState Failed(string message) =>
            new PairingState(PairingStateKind.Failed, null, message);
    }
}
