//! Diagnostics HTTP surfaces: [`snapshot`] is the data, [`router`] is the
//! limited public-facing mount, [`internal_router`] is the fuller
//! operator-only mount (see each module's doc comment for the split
//! rationale).

pub mod internal_router;
pub mod router;
pub mod snapshot;

pub use internal_router::InternalDiagnosticsState;
pub use router::DiagnosticsState;
pub use snapshot::{capture, DiagnosticsSnapshot, ProcessClock};
