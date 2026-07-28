using System;
using System.Net;
using Playarr.Core.Models;

namespace Playarr.Core.Networking
{
    /// <summary>
    /// Every failure <c>PlayarrApiClient</c> can raise. Port of
    /// <c>APIError</c> in the iOS client's PlayarrKit.
    /// </summary>
    /// <remarks>
    /// Status-code-specific instances carry the server's own
    /// <see cref="ApiErrorBody"/> when the response body decoded as one, so
    /// a screen can show the real server-provided message instead of a
    /// generic one.
    /// </remarks>
    public class ApiException : Exception
    {
        public ApiException(
            ApiErrorKind kind,
            string message,
            HttpStatusCode? statusCode = null,
            ApiErrorBody? body = null,
            Exception? innerException = null)
            : base(message, innerException)
        {
            Kind = kind;
            StatusCode = statusCode;
            Body = body;
        }

        public ApiErrorKind Kind { get; }

        public HttpStatusCode? StatusCode { get; }

        public ApiErrorBody? Body { get; }

        /// <summary>
        /// A message worth putting in front of a viewer, preferring the
        /// server's own <c>message</c> field when one decoded.
        /// </summary>
        public string DisplayMessage
        {
            get
            {
                if (!string.IsNullOrWhiteSpace(Body?.Message))
                {
                    return Body!.Message;
                }

                switch (Kind)
                {
                    case ApiErrorKind.InvalidBaseUrl:
                        return "The server address isn't valid.";
                    case ApiErrorKind.Transport:
                        return "Playarr couldn't reach the server.";
                    case ApiErrorKind.InvalidResponse:
                        return "The server sent back a response Playarr couldn't understand.";
                    case ApiErrorKind.Decoding:
                        return "The server's response didn't match what this app expected.";
                    case ApiErrorKind.Unauthorized:
                        return "You're not signed in.";
                    case ApiErrorKind.NotFound:
                        return "That wasn't found.";
                    case ApiErrorKind.Conflict:
                        return "That request already changed state.";
                    case ApiErrorKind.UnprocessableEntity:
                        return "The server couldn't fulfil that.";
                    case ApiErrorKind.ServiceUnavailable:
                        return "The server can't handle that right now.";
                    default:
                        return StatusCode is { } status
                            ? $"The server returned an unexpected error ({(int)status})."
                            : "The server returned an unexpected error.";
                }
            }
        }

        public static ApiException ForStatus(HttpStatusCode status, ApiErrorBody? body)
        {
            var kind = status switch
            {
                HttpStatusCode.Unauthorized => ApiErrorKind.Unauthorized,
                HttpStatusCode.NotFound => ApiErrorKind.NotFound,
                HttpStatusCode.Conflict => ApiErrorKind.Conflict,
                (HttpStatusCode)422 => ApiErrorKind.UnprocessableEntity,
                HttpStatusCode.ServiceUnavailable => ApiErrorKind.ServiceUnavailable,
                _ => ApiErrorKind.Http,
            };

            return new ApiException(kind, $"HTTP {(int)status}", status, body);
        }
    }

    public enum ApiErrorKind
    {
        InvalidBaseUrl,
        Transport,
        InvalidResponse,
        Decoding,
        Unauthorized,

        /// <summary>
        /// <c>404</c> -- e.g. an unknown work, or an unknown media file.
        /// </summary>
        NotFound,

        Conflict,
        UnprocessableEntity,

        /// <summary>
        /// <c>503</c> -- no on-demand transcode capacity available on this
        /// node. Distinct from a generic failure because the right response
        /// is "try again shortly", not "something is broken".
        /// </summary>
        ServiceUnavailable,

        /// <summary>Any other non-2xx status.</summary>
        Http,
    }
}
