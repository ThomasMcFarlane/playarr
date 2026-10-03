//! `playarr-portability` -- the portable per-user data package.
//!
//! The normative description is `docs/formats/user-data-export-v1.md`. This
//! crate is deliberately free of database and HTTP code so the format, the
//! reader's hardening and the matching rules can be tested on their own and
//! reused by any client or tool.

pub mod archive;
pub mod csv_view;
pub mod format;
pub mod matching;

pub use archive::{
    package_to_bytes, parse_json, read_package, write_package, Limits, PackageError,
};
pub use format::*;
