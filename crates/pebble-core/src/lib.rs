// `async_trait` desugars every method into a `Pin<Box<dyn Future>>`, which is
// already `#[must_use]`, and stamps the generated function with `#[must_use]`
// on top of it. Newer clippy releases report that pair as `double_must_use`,
// and the attribute it asks us to remove is the macro's, not ours.
#![allow(clippy::double_must_use)]

pub mod error;
pub mod snippet;
pub mod traits;
pub mod types;

pub use error::{PebbleError, Result};
pub use snippet::{build_snippet, make_snippet, strip_html_for_snippet};
pub use types::*;
