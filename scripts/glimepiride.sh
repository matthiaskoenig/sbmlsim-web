#!/usr/bin/env bash
# Build the assets of the example `docs/examples/glimepiride.md`: the glimepiride app of
# pkdb_models, simulated in the browser on sbmlsim-core.
#
#   scripts/glimepiride.sh
#
# The steps, each with the tool of the repository it belongs to:
#
# 1. sbmlsim exports the panels and the app of the model as the bundle `panelbundle/1`
#    (`python -m sbmlsim.serve --export`), run in the environment of pkdb_models with the
#    checkout of sbmlsim, so the bundle carries the bodies the service answers and the SBML with
#    the formulas of the derived targets compiled in;
# 2. sbmlsim-core prepares every SBML of the bundle (`scripts/prepare_model.py`: SBML L3V2, the
#    uncertainties of `distrib` stripped) and compiles it into `model.wasm` and `model.json`;
# 3. the bundle, the compiled models, the JavaScript of sbmlsim-core (the loader, the pool of
#    workers and the panel endpoint), its runtime and its notices of third parties are copied
#    into `docs/examples/glimepiride/`, with `SOURCES.json` naming the commits they come from;
# 4. the npm package `pkpdutils-core`, the kernel of pkpdutils as WebAssembly, is unpacked from
#    the registry at the version `PKPDUTILS_CORE` names and its loader and runtime are copied
#    next to those of sbmlsim-core. It is a released package and not a checkout, so `SOURCES.json`
#    carries its version where the others carry a commit, and `nca.mjs` of the example analyses
#    the curves of the panels with it.
#
# The checkouts are siblings of this repository unless the variables name them:
# SBMLSIM_REPO (sbmlsim), SBMLSIM_CORE_REPO (sbmlsim-core, with its CLI built:
# `cargo build --release -p sbmlsim-cli`) and PKDB_MODELS_REPO (pkdb_models). The assets are
# committed, so the documentation builds without any of them.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sbmlsim="$(cd "${SBMLSIM_REPO:-$here/../sbmlsim}" && pwd)"
core="$(cd "${SBMLSIM_CORE_REPO:-$here/../sbmlsim-core}" && pwd)"
pkdb="$(cd "${PKDB_MODELS_REPO:-$here/../pkdb_models}" && pwd)"
cli="$core/target/release/sbmlsim-core"
out="$here/docs/examples/glimepiride"
model="glimepiride"
# the release of the kernel of pkpdutils the example analyses its curves with
pkpdutils_core="${PKPDUTILS_CORE:-0.7.0}"

if [[ ! -x "$cli" ]]; then
  echo "error: $cli does not exist, build it with 'cargo build --release -p sbmlsim-cli' in $core" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "1. export the bundle of $model with sbmlsim"
uv run --quiet --directory "$pkdb" --with-editable "$sbmlsim" \
  python -m sbmlsim.serve --model "$model=pkdb_models.models.glimepiride:MODEL" --export "$work/export" >/dev/null

echo "2. prepare and compile its models with sbmlsim-core"
"$cli" runtime -o "$work/runtime" >/dev/null
bundle="$work/export/$model"
for sbml in "$bundle"/models/*/model.xml; do
  dir="$(dirname "$sbml")"
  (cd "$core" && uv run --quiet scripts/prepare_model.py "$sbml" -o "$dir/prepared.xml")
  "$cli" compile "$dir/prepared.xml" -o "$dir" >/dev/null
  rm "$dir/prepared.xml"
done

echo "3. stage the assets into ${out#"$here"/}"
rm -rf "$out/bundle" "$out/sbmlsim-core"
mkdir -p "$out/bundle/models" "$out/sbmlsim-core/runtime"
cp "$bundle/bundle.json" "$out/bundle/"
for dir in "$bundle"/models/*/; do
  key="$(basename "$dir")"
  mkdir -p "$out/bundle/models/$key"
  # the compiled model only: the SBML is the one of pkdb_models with the formulas compiled in,
  # which the export writes again
  cp "$dir/model.wasm" "$dir/model.json" "$out/bundle/models/$key/"
done
cp "$core"/js/{loader,pool,worker,panels}.mjs "$out/sbmlsim-core/"
cp "$work/runtime"/{engine.wasm,mathlib.wasm} "$out/sbmlsim-core/runtime/"
cp "$work/runtime/THIRD_PARTY.md" "$out/sbmlsim-core/THIRD_PARTY.md"
cp "$core/LICENSE" "$out/sbmlsim-core/LICENSE"

echo "4. unpack pkpdutils-core $pkpdutils_core of the registry"
rm -rf "$out/pkpdutils-core"
mkdir -p "$out/pkpdutils-core/runtime" "$work/npm"
(cd "$work/npm" && npm pack --silent "pkpdutils-core@$pkpdutils_core" >/dev/null && tar xzf "pkpdutils-core-$pkpdutils_core.tgz")
# the loader and the module alone: the example drives one instance and needs no pool of workers
cp "$work/npm/package/loader.mjs" "$out/pkpdutils-core/"
cp "$work/npm/package/runtime/pkpdutils-core.wasm" "$out/pkpdutils-core/runtime/"
cp "$work/npm/package/LICENSE" "$out/pkpdutils-core/LICENSE"

commit() { git -C "$1" rev-parse HEAD; }
cat >"$out/SOURCES.json" <<EOF
{
  "sbmlsim": "$(commit "$sbmlsim")",
  "sbmlsim-core": "$(commit "$core")",
  "pkdb_models": "$(commit "$pkdb")",
  "pkpdutils-core": "$pkpdutils_core"
}
EOF
echo "done: $(du -sh "$out" | cut -f1) in ${out#"$here"/}"
