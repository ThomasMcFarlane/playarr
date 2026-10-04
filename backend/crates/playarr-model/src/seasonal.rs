//! Seasonal rail rules: date windows (fixed month/day ranges or relative to
//! Easter, optionally per hemisphere) plus the keywords/genres/tags that
//! make a title belong to the season. Pure and admin-editable: the rules
//! live in `HomeRailConfig::seasonal_rules`, falling back to
//! [`default_rules`].

use chrono::{Datelike, Duration, NaiveDate};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum Hemisphere {
    #[default]
    North,
    South,
}

/// One seasonal rule. A rule is active when `date` falls in its window and
/// (if set) its `hemisphere` matches the configured one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SeasonalRule {
    /// Stable key, also the localisation key for built-ins (`christmas`).
    pub key: String,
    /// Display name override; `None` uses the localised built-in name.
    #[serde(default)]
    pub name: Option<String>,
    /// `MM-DD` start of a fixed window (inclusive). The window wraps the new
    /// year when `end` is earlier than `start`.
    #[serde(default)]
    pub start: Option<String>,
    /// `MM-DD` end of a fixed window (inclusive).
    #[serde(default)]
    pub end: Option<String>,
    /// Easter-relative window: days before Easter Sunday the rule starts.
    #[serde(default)]
    pub easter_before_days: Option<u32>,
    /// Easter-relative window: days after Easter Sunday the rule ends.
    #[serde(default)]
    pub easter_after_days: Option<u32>,
    /// Only active for this hemisphere; `None` = both.
    #[serde(default)]
    pub hemisphere: Option<Hemisphere>,
    /// Whole words/phrases matched against title and overview.
    #[serde(default)]
    pub keywords: Vec<String>,
    /// Exact (case-insensitive) genre names.
    #[serde(default)]
    pub genres: Vec<String>,
    /// Exact (case-insensitive) tags, e.g. an admin's `christmas` tag.
    #[serde(default)]
    pub tags: Vec<String>,
}

fn parse_md(raw: &str) -> Option<(u32, u32)> {
    let (m, d) = raw.trim().split_once('-')?;
    let (m, d): (u32, u32) = (m.parse().ok()?, d.parse().ok()?);
    // 2000 is a leap year, so 02-29 is accepted.
    NaiveDate::from_ymd_opt(2000, m, d).map(|_| (m, d))
}

/// Why a rule is unusable, if it is.
pub fn validate_rule(rule: &SeasonalRule) -> Result<(), String> {
    if rule.key.trim().is_empty() {
        return Err("seasonal rule key must not be empty".into());
    }
    let fixed = rule.start.is_some() || rule.end.is_some();
    let easter = rule.easter_before_days.is_some() || rule.easter_after_days.is_some();
    if fixed == easter {
        return Err(format!(
            "rule '{}' needs either a start/end window or an Easter-relative window",
            rule.key
        ));
    }
    if fixed {
        for raw in [&rule.start, &rule.end] {
            match raw {
                Some(value) if parse_md(value).is_some() => {}
                _ => return Err(format!("rule '{}' has an invalid MM-DD date", rule.key)),
            }
        }
    }
    if rule.keywords.is_empty() && rule.genres.is_empty() && rule.tags.is_empty() {
        return Err(format!("rule '{}' has nothing to match", rule.key));
    }
    Ok(())
}

/// Western (Gregorian) Easter Sunday.
pub fn easter_sunday(year: i32) -> NaiveDate {
    let a = year % 19;
    let b = year / 100;
    let c = year % 100;
    let d = b / 4;
    let e = b % 4;
    let f = (b + 8) / 25;
    let g = (b - f + 1) / 3;
    let h = (19 * a + b - d - g + 15) % 30;
    let i = c / 4;
    let k = c % 4;
    let l = (32 + 2 * e + 2 * i - h - k) % 7;
    let m = (a + 11 * h + 22 * l) / 451;
    let month = (h + l - 7 * m + 114) / 31;
    let day = (h + l - 7 * m + 114) % 31 + 1;
    NaiveDate::from_ymd_opt(year, month as u32, day as u32).expect("valid easter date")
}

/// Whether `rule` is active on `date` for `hemisphere`.
pub fn rule_active(rule: &SeasonalRule, hemisphere: Hemisphere, date: NaiveDate) -> bool {
    if rule.hemisphere.is_some_and(|h| h != hemisphere) {
        return false;
    }
    if let (Some(start), Some(end)) = (&rule.start, &rule.end) {
        let (Some(start), Some(end)) = (parse_md(start), parse_md(end)) else {
            return false;
        };
        let now = (date.month(), date.day());
        return if start <= end {
            now >= start && now <= end
        } else {
            now >= start || now <= end
        };
    }
    if rule.easter_before_days.is_some() || rule.easter_after_days.is_some() {
        let easter = easter_sunday(date.year());
        let from = easter - Duration::days(i64::from(rule.easter_before_days.unwrap_or(0)));
        let to = easter + Duration::days(i64::from(rule.easter_after_days.unwrap_or(0)));
        return date >= from && date <= to;
    }
    false
}

/// First active rule, in list order.
pub fn active_rule(
    rules: &[SeasonalRule],
    hemisphere: Hemisphere,
    date: NaiveDate,
) -> Option<&SeasonalRule> {
    rules
        .iter()
        .find(|rule| rule_active(rule, hemisphere, date))
}

fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !(c.is_alphanumeric() || c == '\''))
        .filter(|w| !w.is_empty())
        .map(|w| w.to_string())
        .collect()
}

fn contains_phrase(haystack: &[String], phrase: &[String]) -> bool {
    !phrase.is_empty() && haystack.windows(phrase.len()).any(|w| w == phrase)
}

/// Whether a title belongs to `rule`'s season.
pub fn rule_matches(
    rule: &SeasonalRule,
    title: &str,
    overview: Option<&str>,
    genres: &[String],
    tags: &[String],
) -> bool {
    let eq = |list: &[String], wanted: &str| list.iter().any(|v| v.eq_ignore_ascii_case(wanted));
    if rule.genres.iter().any(|g| eq(genres, g)) || rule.tags.iter().any(|t| eq(tags, t)) {
        return true;
    }
    if rule.keywords.is_empty() {
        return false;
    }
    let mut text = words(title);
    if let Some(overview) = overview {
        text.push(String::new()); // phrase barrier between title and overview
        text.extend(words(overview));
    }
    rule.keywords
        .iter()
        .any(|keyword| contains_phrase(&text, &words(keyword)))
}

fn rule(
    key: &str,
    window: (&str, &str),
    keywords: &[&str],
    genres: &[&str],
    tags: &[&str],
) -> SeasonalRule {
    SeasonalRule {
        key: key.into(),
        name: None,
        start: Some(window.0.into()),
        end: Some(window.1.into()),
        easter_before_days: None,
        easter_after_days: None,
        hemisphere: None,
        keywords: keywords.iter().map(|s| s.to_string()).collect(),
        genres: genres.iter().map(|s| s.to_string()).collect(),
        tags: tags.iter().map(|s| s.to_string()).collect(),
    }
}

/// Built-in rules, in priority order (the first active one wins).
pub fn default_rules() -> Vec<SeasonalRule> {
    let mut easter = rule(
        "easter",
        ("01-01", "01-01"),
        &["easter", "bunny", "peter rabbit"],
        &[],
        &["easter"],
    );
    easter.start = None;
    easter.end = None;
    easter.easter_before_days = Some(14);
    easter.easter_after_days = Some(1);

    let mut summer_north = rule(
        "summer",
        ("06-01", "08-31"),
        &["summer", "beach", "surf", "vacation", "island", "road trip"],
        &[],
        &["summer"],
    );
    summer_north.hemisphere = Some(Hemisphere::North);
    let mut summer_south = summer_north.clone();
    summer_south.start = Some("12-01".into());
    summer_south.end = Some("02-28".into());
    summer_south.hemisphere = Some(Hemisphere::South);

    vec![
        rule(
            "halloween",
            ("10-01", "10-31"),
            &[
                "halloween",
                "haunted",
                "haunting",
                "ghost",
                "ghosts",
                "witch",
                "witches",
                "zombie",
                "zombies",
                "vampire",
                "vampires",
                "werewolf",
                "slasher",
                "trick or treat",
                "pumpkin",
                "monster",
                "monsters",
            ],
            &["Horror"],
            &["halloween"],
        ),
        rule(
            "christmas",
            ("12-01", "12-25"),
            &[
                "christmas",
                "xmas",
                "santa",
                "santa claus",
                "reindeer",
                "snowman",
                "nutcracker",
                "grinch",
                "scrooge",
                "noel",
                "north pole",
            ],
            &["Christmas", "Holiday"],
            &["christmas", "xmas"],
        ),
        rule(
            "new_year",
            ("12-26", "01-03"),
            &[
                "new year",
                "new year's",
                "new years",
                "countdown",
                "resolution",
            ],
            &[],
            &["new year", "new_year"],
        ),
        rule(
            "valentines",
            ("02-01", "02-14"),
            &[
                "valentine",
                "valentines",
                "valentine's",
                "love story",
                "wedding",
            ],
            &["Romance"],
            &["valentines", "valentine"],
        ),
        easter,
        summer_north,
        summer_south,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn easter_dates_match_the_calendar() {
        assert_eq!(easter_sunday(2024), d(2024, 3, 31));
        assert_eq!(easter_sunday(2025), d(2025, 4, 20));
        assert_eq!(easter_sunday(2026), d(2026, 4, 5));
    }

    #[test]
    fn fixed_window_wraps_the_new_year() {
        let rules = default_rules();
        let ny = rules.iter().find(|r| r.key == "new_year").unwrap();
        assert!(rule_active(ny, Hemisphere::North, d(2026, 12, 31)));
        assert!(rule_active(ny, Hemisphere::North, d(2027, 1, 2)));
        assert!(!rule_active(ny, Hemisphere::North, d(2027, 1, 4)));
    }

    #[test]
    fn summer_follows_the_hemisphere() {
        let rules = default_rules();
        let jul = d(2026, 7, 10);
        let jan = d(2027, 1, 10);
        assert_eq!(
            active_rule(&rules, Hemisphere::North, jul).unwrap().key,
            "summer"
        );
        assert!(active_rule(&rules, Hemisphere::South, jul).is_none());
        assert_eq!(
            active_rule(&rules, Hemisphere::South, jan).unwrap().key,
            "summer"
        );
        assert!(active_rule(&rules, Hemisphere::North, jan).is_none());
    }

    #[test]
    fn easter_window_is_relative_to_easter() {
        let rules = default_rules();
        let easter = rules.iter().find(|r| r.key == "easter").unwrap();
        assert!(rule_active(easter, Hemisphere::North, d(2026, 3, 22)));
        assert!(rule_active(easter, Hemisphere::North, d(2026, 4, 6)));
        assert!(!rule_active(easter, Hemisphere::North, d(2026, 3, 21)));
        assert!(!rule_active(easter, Hemisphere::North, d(2026, 4, 7)));
    }

    #[test]
    fn today_in_october_is_halloween() {
        let rules = default_rules();
        assert_eq!(
            active_rule(&rules, Hemisphere::North, d(2026, 10, 4))
                .unwrap()
                .key,
            "halloween"
        );
    }

    #[test]
    fn keywords_match_whole_words_only() {
        let rules = default_rules();
        let xmas = rules.iter().find(|r| r.key == "christmas").unwrap();
        assert!(rule_matches(
            xmas,
            "Home Alone: Santa Claus Edition",
            None,
            &[],
            &[]
        ));
        assert!(rule_matches(
            xmas,
            "Plain",
            Some("A grinch steals joy."),
            &[],
            &[]
        ));
        assert!(!rule_matches(xmas, "Santander", None, &[], &[]));
        assert!(rule_matches(xmas, "X", None, &["holiday".into()], &[]));
        assert!(rule_matches(xmas, "X", None, &[], &["Christmas".into()]));
        assert!(!rule_matches(
            xmas,
            "Die Hard",
            None,
            &["Action".into()],
            &[]
        ));
    }

    #[test]
    fn rules_validate() {
        for rule in default_rules() {
            validate_rule(&rule).unwrap();
        }
        let mut bad = default_rules().remove(0);
        bad.start = Some("13-40".into());
        assert!(validate_rule(&bad).is_err());
        bad.start = None;
        assert!(validate_rule(&bad).is_err());
    }
}
