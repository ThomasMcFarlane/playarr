import Foundation

/// The signed-in profile's household state (`GET /api/v1/household/status`).
/// `state` is `unrestricted`, `allowed`, `outside_schedule` or
/// `budget_exhausted`; the server decides, the client only mirrors it.
public struct HouseholdStatusSnapshot: Codable, Sendable, Equatable {
    public var restricted: Bool
    public var state: String
    public var remainingSeconds: Int64?
    public var windowEndsAt: String?
    public var nextStartAt: String?
    public var resetsAt: String?
    public var dailyBudgetMinutes: Int?
    public var timezone: String?
    public var maxRating: String?
    public var serverTime: String
    public var offlineValidUntil: String
    public var guardianFor: [String]

    enum CodingKeys: String, CodingKey {
        case restricted, state, timezone
        case remainingSeconds = "remaining_seconds"
        case windowEndsAt = "window_ends_at"
        case nextStartAt = "next_start_at"
        case resetsAt = "resets_at"
        case dailyBudgetMinutes = "daily_budget_minutes"
        case maxRating = "max_rating"
        case serverTime = "server_time"
        case offlineValidUntil = "offline_valid_until"
        case guardianFor = "guardian_for"
    }

    public init(
        restricted: Bool = false,
        state: String = "unrestricted",
        remainingSeconds: Int64? = nil,
        windowEndsAt: String? = nil,
        nextStartAt: String? = nil,
        resetsAt: String? = nil,
        dailyBudgetMinutes: Int? = nil,
        timezone: String? = nil,
        maxRating: String? = nil,
        serverTime: String = "",
        offlineValidUntil: String = "",
        guardianFor: [String] = []
    ) {
        self.restricted = restricted
        self.state = state
        self.remainingSeconds = remainingSeconds
        self.windowEndsAt = windowEndsAt
        self.nextStartAt = nextStartAt
        self.resetsAt = resetsAt
        self.dailyBudgetMinutes = dailyBudgetMinutes
        self.timezone = timezone
        self.maxRating = maxRating
        self.serverTime = serverTime
        self.offlineValidUntil = offlineValidUntil
        self.guardianFor = guardianFor
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        restricted = try c.decodeIfPresent(Bool.self, forKey: .restricted) ?? false
        state = try c.decodeIfPresent(String.self, forKey: .state) ?? "unrestricted"
        remainingSeconds = try c.decodeIfPresent(Int64.self, forKey: .remainingSeconds)
        windowEndsAt = try c.decodeIfPresent(String.self, forKey: .windowEndsAt)
        nextStartAt = try c.decodeIfPresent(String.self, forKey: .nextStartAt)
        resetsAt = try c.decodeIfPresent(String.self, forKey: .resetsAt)
        dailyBudgetMinutes = try c.decodeIfPresent(Int.self, forKey: .dailyBudgetMinutes)
        timezone = try c.decodeIfPresent(String.self, forKey: .timezone)
        maxRating = try c.decodeIfPresent(String.self, forKey: .maxRating)
        serverTime = try c.decodeIfPresent(String.self, forKey: .serverTime) ?? ""
        offlineValidUntil = try c.decodeIfPresent(String.self, forKey: .offlineValidUntil) ?? ""
        guardianFor = try c.decodeIfPresent([String].self, forKey: .guardianFor) ?? []
    }
}

public struct HouseholdApproval: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var profileUserID: String
    public var kind: String
    public var subject: String
    public var note: String?
    public var status: String
    public var requestedAt: String
    public var grantExpiresAt: String?

    enum CodingKeys: String, CodingKey {
        case id, kind, subject, note, status
        case profileUserID = "profile_user_id"
        case requestedAt = "requested_at"
        case grantExpiresAt = "grant_expires_at"
    }

    public init(
        id: String,
        profileUserID: String,
        kind: String,
        subject: String,
        note: String? = nil,
        status: String,
        requestedAt: String = "",
        grantExpiresAt: String? = nil
    ) {
        self.id = id
        self.profileUserID = profileUserID
        self.kind = kind
        self.subject = subject
        self.note = note
        self.status = status
        self.requestedAt = requestedAt
        self.grantExpiresAt = grantExpiresAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        profileUserID = try c.decode(String.self, forKey: .profileUserID)
        kind = try c.decode(String.self, forKey: .kind)
        subject = try c.decode(String.self, forKey: .subject)
        note = try c.decodeIfPresent(String.self, forKey: .note)
        status = try c.decode(String.self, forKey: .status)
        requestedAt = try c.decodeIfPresent(String.self, forKey: .requestedAt) ?? ""
        grantExpiresAt = try c.decodeIfPresent(String.self, forKey: .grantExpiresAt)
    }
}

public struct CreateHouseholdApprovalRequest: Codable, Sendable, Equatable {
    public var kind: String
    public var subject: String
    public var note: String?

    public init(kind: String, subject: String, note: String? = nil) {
        self.kind = kind
        self.subject = subject
        self.note = note
    }
}

public struct DecideHouseholdApprovalRequest: Codable, Sendable, Equatable {
    public var approve: Bool
    public var pin: String?

    public init(approve: Bool, pin: String? = nil) {
        self.approve = approve
        self.pin = pin
    }
}

/// Why the server refused a request for household or child-control reasons.
public enum HouseholdBlock: Sendable, Equatable {
    case outsideSchedule(nextStartAt: String?)
    case budgetExhausted(resetsAt: String?)
    /// Rating, unrated, tag or folder rule; the associated value is the server's code.
    case content(reason: String)

    /// The block carried by a `403 household_blocked` body, else `nil`.
    public static func parse(status: Int, body: Data?) -> HouseholdBlock? {
        guard status == 403, let object = errorObject(body) else { return nil }
        guard (object["error"] as? String) == "household_blocked" else { return nil }
        guard let details = object["details"] as? [String: Any],
              let reason = details["reason"] as? String else { return nil }
        switch reason {
        case "outside_schedule":
            return .outsideSchedule(nextStartAt: details["next_start_at"] as? String)
        case "budget_exhausted":
            return .budgetExhausted(resetsAt: details["resets_at"] as? String)
        default:
            return .content(reason: reason)
        }
    }

    public static func parse(error: Error) -> HouseholdBlock? {
        guard case APIError.http(let status, _, let raw) = error else { return nil }
        return parse(status: status, body: raw)
    }

    /// Seconds until a `429 pin_locked` lifts, else `nil`.
    public static func pinLockSeconds(error: Error) -> Int? {
        guard case APIError.http(let status, _, let raw) = error, status == 429,
              let object = errorObject(raw),
              (object["error"] as? String) == "pin_locked" else { return nil }
        let details = object["details"] as? [String: Any]
        return (details?["retry_after_seconds"] as? Int) ?? 60
    }

    private static func errorObject(_ body: Data?) -> [String: Any]? {
        guard let body, !body.isEmpty else { return nil }
        return (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
    }
}

/// Why the profile cannot watch right now, derived from the server's status.
public enum HouseholdBlockState: Sendable, Equatable {
    case outsideSchedule(until: String?)
    case budgetExhausted(until: String?)

    public init?(status: HouseholdStatusSnapshot?) {
        switch status?.state {
        case "outside_schedule": self = .outsideSchedule(until: status?.nextStartAt)
        case "budget_exhausted": self = .budgetExhausted(until: status?.resetsAt)
        default: return nil
        }
    }

    public init(block: HouseholdBlock) {
        switch block {
        case .outsideSchedule(let next): self = .outsideSchedule(until: next)
        case .budgetExhausted(let reset): self = .budgetExhausted(until: reset)
        case .content: self = .outsideSchedule(until: nil)
        }
    }

    public var until: String? {
        switch self {
        case .outsideSchedule(let until), .budgetExhausted(let until): return until
        }
    }

    /// The approval `subject` that would lift this block.
    public var approvalSubject: String {
        switch self {
        case .outsideSchedule: return "schedule"
        case .budgetExhausted: return "budget"
        }
    }
}

/// Shared wording so iOS and tvOS match Web and Android.
public enum HouseholdCopy {
    public static func title(for state: HouseholdBlockState) -> String {
        switch state {
        case .outsideSchedule: return "Not available right now"
        case .budgetExhausted: return "That's all for today"
        }
    }

    public static func description(for state: HouseholdBlockState, formattedUntil: String?) -> String {
        switch state {
        case .outsideSchedule:
            if let formattedUntil { return "This profile can watch again at \(formattedUntil)." }
            return "This profile can't watch at this time."
        case .budgetExhausted:
            if let formattedUntil { return "Today's watch time is used up. It resets at \(formattedUntil)." }
            return "Today's watch time is used up."
        }
    }

    public static func remaining(minutes: Int) -> String {
        "\(minutes) min left"
    }

    public static let askGuardian = "Ask a guardian for more time"
    public static let requestSent = "Request sent. A guardian can approve it on their profile."
    public static let requestFailed = "Couldn't send the request. Try again."
    public static let switchProfile = "Switch profile"
}

public enum HouseholdFormat {
    public static func date(fromISO iso: String?) -> Date? {
        guard let iso else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }

    /// An ISO instant in the device's time zone and language, or `nil`.
    public static func instant(
        _ iso: String?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String? {
        guard let date = date(fromISO: iso) else { return nil }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// Whole minutes left in the last hour of a budget or schedule window,
    /// else `nil`. Uses the nearer of the two limits, like the server.
    public static func remainingMinutes(status: HouseholdStatusSnapshot?, now: Date) -> Int? {
        guard let status, status.state == "allowed" else { return nil }
        var candidates: [Double] = []
        if let seconds = status.remainingSeconds { candidates.append(Double(seconds) / 60.0) }
        if let end = date(fromISO: status.windowEndsAt) {
            candidates.append(end.timeIntervalSince(now) / 60.0)
        }
        guard let nearest = candidates.min() else { return nil }
        let minutes = max(0, Int(nearest.rounded(.up)))
        return minutes <= 60 ? minutes : nil
    }
}

public struct HouseholdClient: Sendable {
    private let transport: any PlayarrRequestTransport

    public init(transport: any PlayarrRequestTransport) {
        self.transport = transport
    }

    public func status() async throws -> HouseholdStatusSnapshot {
        try await transport.getJSON("/api/v1/household/status")
    }

    public func approvals() async throws -> [HouseholdApproval] {
        try await transport.getJSON("/api/v1/household/approvals")
    }

    public func requestApproval(subject: String, kind: String = "time", note: String? = nil) async throws -> HouseholdApproval {
        try await transport.sendJSON(
            method: "POST",
            "/api/v1/household/approvals",
            body: CreateHouseholdApprovalRequest(kind: kind, subject: subject, note: note)
        )
    }

    public func decide(approvalID: String, approve: Bool, pin: String?) async throws -> HouseholdApproval {
        try await transport.sendJSON(
            method: "POST",
            "/api/v1/household/approvals/\(approvalID)/decision",
            body: DecideHouseholdApprovalRequest(approve: approve, pin: pin)
        )
    }
}
