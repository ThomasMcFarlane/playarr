//! Pure title and identifier matching. The importer supplies candidates; this
//! module only decides, and never guesses between close alternatives.

use std::collections::BTreeSet;

use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::format::ItemRef;

/// Minimum blended similarity for a fuzzy (non-exact) title match.
pub const FUZZY_THRESHOLD: f64 = 0.92;
/// The best fuzzy candidate must beat the runner-up by this much.
pub const FUZZY_MARGIN: f64 = 0.03;

/// A work on the destination server considered for a title match.
#[derive(Debug, Clone)]
pub struct WorkCandidate {
    pub id: Uuid,
    pub kind: String,
    pub title: String,
    pub year: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolution {
    Matched(Uuid),
    Ambiguous(Vec<Uuid>),
    NoMatch,
}

/// NFKC, case folded, punctuation removed, `&` read as "and", whitespace
/// collapsed, one leading article dropped.
pub fn normalize_title(title: &str) -> String {
    let folded: String = title
        .nfkc()
        .flat_map(char::to_lowercase)
        .flat_map(|c| -> Vec<char> {
            if c == '&' {
                " and ".chars().collect()
            } else if c.is_alphanumeric() {
                vec![c]
            } else {
                vec![' ']
            }
        })
        .collect();
    let mut words: Vec<&str> = folded.split_whitespace().collect();
    if words.len() > 1 && matches!(words[0], "the" | "a" | "an") {
        words.remove(0);
    }
    words.join(" ")
}

/// Identifier hits per provider, in any order: one distinct work is a match,
/// several are ambiguous, none means the caller may fall back to the title.
pub fn resolve_by_ids(hits: &[Vec<Uuid>]) -> Resolution {
    let distinct: BTreeSet<Uuid> = hits.iter().flatten().copied().collect();
    match distinct.len() {
        0 => Resolution::NoMatch,
        1 => Resolution::Matched(*distinct.iter().next().expect("one element")),
        _ => Resolution::Ambiguous(distinct.into_iter().collect()),
    }
}

fn years_agree(a: Option<i32>, b: Option<i32>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => (a - b).abs() <= 1,
        _ => true,
    }
}

fn similarity(a: &str, b: &str) -> f64 {
    0.5 * strsim::normalized_levenshtein(a, b) + 0.5 * strsim::jaro_winkler(a, b)
}

/// Title fallback. Only candidates of the same `kind` whose year agrees are
/// considered.
pub fn resolve_by_title(item: &ItemRef, candidates: &[WorkCandidate]) -> Resolution {
    let wanted = normalize_title(&item.title);
    if wanted.is_empty() {
        return Resolution::NoMatch;
    }
    let pool: Vec<(&WorkCandidate, String)> = candidates
        .iter()
        .filter(|c| c.kind == item.kind && years_agree(item.year, c.year))
        .map(|c| (c, normalize_title(&c.title)))
        .collect();

    let exact: Vec<Uuid> = pool
        .iter()
        .filter(|(_, title)| *title == wanted)
        .map(|(c, _)| c.id)
        .collect();
    match exact.len() {
        1 => return Resolution::Matched(exact[0]),
        n if n > 1 => return Resolution::Ambiguous(exact),
        _ => {}
    }

    let mut scored: Vec<(f64, Uuid)> = pool
        .iter()
        .map(|(c, title)| (similarity(&wanted, title), c.id))
        .filter(|(score, _)| *score >= FUZZY_THRESHOLD)
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    match scored.as_slice() {
        [] => Resolution::NoMatch,
        [(_, id)] => Resolution::Matched(*id),
        [(best, id), (second, _), ..] if best - second >= FUZZY_MARGIN => Resolution::Matched(*id),
        close => Resolution::Ambiguous(close.iter().map(|(_, id)| *id).collect()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(title: &str, year: Option<i32>) -> ItemRef {
        ItemRef {
            kind: "movie".into(),
            title: title.into(),
            year,
            ..ItemRef::default()
        }
    }

    fn cand(title: &str, year: Option<i32>) -> WorkCandidate {
        WorkCandidate {
            id: Uuid::new_v4(),
            kind: "movie".into(),
            title: title.into(),
            year,
        }
    }

    #[test]
    fn normalisation_folds_case_punctuation_articles_and_width() {
        assert_eq!(normalize_title("The Sample Trilogy"), "sample trilogy");
        assert_eq!(normalize_title("Salt & Pepper"), "salt and pepper");
        assert_eq!(normalize_title("ＤＥＭＯ·Ｘ"), "demo x");
        assert_eq!(normalize_title("The"), "the");
        assert_eq!(normalize_title("Zoé"), normalize_title("Zoe\u{301}"));
    }

    #[test]
    fn identifiers_decide_match_ambiguity_or_nothing() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        assert_eq!(resolve_by_ids(&[vec![a], vec![a]]), Resolution::Matched(a));
        assert!(
            matches!(resolve_by_ids(&[vec![a], vec![b]]), Resolution::Ambiguous(v) if v.len() == 2)
        );
        assert_eq!(resolve_by_ids(&[vec![], vec![]]), Resolution::NoMatch);
    }

    #[test]
    fn exact_normalised_title_matches_when_unique() {
        let c = cand("The Sample Movie", Some(1999));
        let r = resolve_by_title(&item("sample movie", Some(1999)), std::slice::from_ref(&c));
        assert_eq!(r, Resolution::Matched(c.id));
    }

    #[test]
    fn year_disagreement_excludes_a_candidate() {
        let c = cand("Sample Title", Some(1984));
        assert_eq!(
            resolve_by_title(&item("Sample Title", Some(2021)), &[c]),
            Resolution::NoMatch
        );
    }

    #[test]
    fn same_title_twice_is_ambiguous_without_a_year() {
        let (a, b) = (
            cand("Sample Title", Some(1984)),
            cand("Sample Title", Some(2021)),
        );
        assert!(matches!(
            resolve_by_title(&item("Sample Title", None), &[a, b]),
            Resolution::Ambiguous(v) if v.len() == 2
        ));
        // With a year the same data resolves.
        let (a, b) = (
            cand("Sample Title", Some(1984)),
            cand("Sample Title", Some(2021)),
        );
        let expect = b.id;
        assert_eq!(
            resolve_by_title(&item("Sample Title", Some(2021)), &[a, b]),
            Resolution::Matched(expect)
        );
    }

    #[test]
    fn fuzzy_matches_only_when_close_and_unique() {
        let c = cand("Spider-Man: Homecoming", Some(2017));
        assert_eq!(
            resolve_by_title(
                &item("Spiderman Homecoming", Some(2017)),
                std::slice::from_ref(&c)
            ),
            Resolution::Matched(c.id)
        );
        assert_eq!(
            resolve_by_title(&item("Spider-Man 2", Some(2017)), std::slice::from_ref(&c)),
            Resolution::NoMatch
        );
    }

    #[test]
    fn kind_must_agree() {
        let mut c = cand("Orbit", Some(1995));
        c.kind = "series".into();
        assert_eq!(
            resolve_by_title(&item("Orbit", Some(1995)), &[c]),
            Resolution::NoMatch
        );
    }

    #[test]
    fn unicode_titles_match() {
        let c = cand("日本語タイトル", Some(2001));
        assert_eq!(
            resolve_by_title(
                &item("日本語タイトル", Some(2001)),
                std::slice::from_ref(&c)
            ),
            Resolution::Matched(c.id)
        );
    }
}
