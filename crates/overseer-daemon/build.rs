// Ensure cargo rebuilds overseer-daemon whenever the frontend dist/ changes.
//
// rust_embed (with #[allow_missing = true]) can't emit rerun-if-changed for a
// folder that didn't exist at build time, so cargo won't know to recompile when
// `pnpm vite-build` later populates dist/.  This build script closes that gap.
fn main() {
    println!("cargo:rerun-if-changed=../../dist");
}
