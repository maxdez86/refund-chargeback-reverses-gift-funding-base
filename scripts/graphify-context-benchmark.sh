#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
benchmark_dir="$repo_root/benchmarks/graphify-context"
evidence_file="$benchmark_dir/evidence.json"
tasks_file="$benchmark_dir/tasks.tsv"
queries_file="$benchmark_dir/queries.tsv"
cache_base="${XDG_CACHE_HOME:-${HOME:?HOME is required}/.cache}"
cache_root="${BENCHMARK_CACHE_DIR:-$cache_base/brimax-life-graphify-benchmark}"
state_file="$cache_root/current-state.env"
graphify_version="0.9.39"
graphify_wheel_sha="2e1d602677d90ba2e94472828a7ffbea288421bd809d8feb55bff827a21c32f7"
serena_version="1.7.0"
benchmark_model="${MODEL:-gpt-5.6-luna}"
benchmark_reasoning="${REASONING:-low}"
judge_model="${JUDGE_MODEL:-gpt-5.6-sol}"
judge_reasoning="${JUDGE_REASONING:-high}"

usage() {
  cat <<'USAGE'
Usage: scripts/graphify-context-benchmark.sh COMMAND [OPTIONS]

Commands:
  dry-run              Validate fixtures and print the frozen experiment without installing or writing.
  verify [--no-install]
                       Validate fixtures, prerequisites, corpus counts, and prepared artifacts if present.
  prepare              Install pinned Graphify, create sanitized copies, and build a frozen raw graph.
  pilot                Run the 4-arm, 2-task, 4-repeat pilot (32 fresh Codex runs).
  run                  Run the 3-arm, 7-task, 6-repeat main experiment (126 fresh Codex runs).

Environment:
  BENCHMARK_CACHE_DIR   External cache root; defaults under XDG_CACHE_HOME or ~/.cache.
  GRAPHIFY_ARM          Main Graphify arm: graphify-cli or graphify-mcp. Required by run.
  TASK_FILTER           Optional exact task ID for diagnostic execution.
  REPEAT_FILTER         Optional exact repeat number for diagnostic execution.

The harness never runs Graphify's Codex installer and never writes a graph or raw result into the repository.
USAGE
}

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

sha256_file() {
  sha256sum "$1" | awk '{print $1}'
}

directory_digest() {
  local target="$1"
  (
    cd "$target"
    find . -type f ! -path './.graphifyignore' -print0 \
      | sort -z \
      | xargs -0 sha256sum
  ) | sha256sum | awk '{print $1}'
}

serena_directory_digest() {
  local target="$1"
  (
    cd "$target"
    find . -type f ! -path './.graphifyignore' ! -path './.serena/cache/*' -print0 \
      | sort -z \
      | xargs -0 sha256sum
  ) | sha256sum | awk '{print $1}'
}

working_tree_digest() {
  git ls-files -co --exclude-standard -z \
    | sort -zu \
    | while IFS= read -r -d '' file; do
        if [[ -f "$file" ]]; then
          sha256sum "$file"
        else
          printf 'missing  %s\n' "$file"
        fi
      done \
    | sha256sum \
    | awk '{print $1}'
}

toml_string() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"
}

toml_array() {
  node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' "$@"
}

load_state() {
  [[ -f "$state_file" ]] || fail "no prepared benchmark state at $state_file; run prepare first"
  # The state file is generated only by this script with shell-escaped local paths and hashes.
  # shellcheck disable=SC1090
  source "$state_file"
  [[ -d "${TASK_WORKSPACE:-}" ]] || fail "prepared task workspace is missing"
  [[ -d "${SERENA_WORKSPACE:-}" ]] || fail "prepared Serena workspace is missing"
  [[ -f "${GRAPH_JSON:-}" ]] || fail "prepared graph is missing"
}

validate_fixtures() {
  node - "$benchmark_dir" <<'NODE'
const fs = require("fs");
const path = require("path");
const root = process.argv[2];
const taskLines = fs.readFileSync(path.join(root, "tasks.tsv"), "utf8").trim().split("\n");
const queryLines = fs.readFileSync(path.join(root, "queries.tsv"), "utf8").trim().split("\n");
const gold = JSON.parse(fs.readFileSync(path.join(root, "gold.json"), "utf8"));
const evidence = JSON.parse(fs.readFileSync(path.join(root, "evidence.json"), "utf8"));
const scoreSchema = JSON.parse(fs.readFileSync(path.join(root, "score.schema.json"), "utf8"));
const taskIds = taskLines.map((line) => line.split("\t", 1)[0]);
const queryRows = queryLines.slice(1).map((line) => line.split("\t"));
const queryIds = [...new Set(queryRows.map(([taskId]) => taskId))];
if (taskIds.length !== 7 || new Set(taskIds).size !== 7) throw new Error("tasks.tsv must contain 7 unique tasks");
if (queryIds.length !== 6) throw new Error("queries.tsv must cover 6 unique useful tasks");
if (new Set(queryRows.map(([taskId, seed]) => `${taskId}\t${seed}`)).size !== queryRows.length) {
  throw new Error("queries.tsv contains a duplicate task/seed pair");
}
if (queryRows.some((row) => row.length !== 7 || !["1000", "2000"].includes(row[3]))) {
  throw new Error("queries.tsv contains a malformed or uncalibrated query");
}
if (queryIds.some((id) => !taskIds.includes(id))) throw new Error("queries.tsv contains an unknown task");
if (Object.keys(gold.tasks).sort().join("\n") !== queryIds.sort().join("\n")) throw new Error("gold/query task sets differ");
if (evidence.graphify.version !== "0.9.39") throw new Error("Graphify evidence version is not pinned");
if (!scoreSchema.required.includes("totalScore")) throw new Error("score schema is incomplete");
NODE
}

validate_current_corpus() {
  local corpus_root="${1:-$repo_root}"
  node - "$corpus_root" "$evidence_file" <<'NODE'
const fs = require("fs");
const path = require("path");
const [root, evidencePath] = process.argv.slice(2);
const expected = JSON.parse(fs.readFileSync(evidencePath, "utf8")).expectedGraphCorpus;
const extensions = new Set(Object.keys(expected.extensions));
const skipDirs = new Set([
  ".git", ".serena", ".codex", ".claude", ".tmp", ".terraform", ".opentofu",
  "node_modules", "dist", "build", "coverage", "benchmarks", "docs"
]);
const skipFiles = new Set([
  "install-opentofu.sh", "pnpm-lock.yaml", ".terraform.lock.hcl",
  ".mcp.json",
  "serena-context-benchmark.sh", "graphify-context-benchmark.sh",
  "graphify-context-results.ts", "graphify-context-results.test.ts"
]);
const counts = Object.fromEntries([...extensions].map((extension) => [extension, 0]));
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name) || entry.name.startsWith("cdk.out")) continue;
      walk(path.join(directory, entry.name));
      continue;
    }
    if (!entry.isFile() || skipFiles.has(entry.name) || entry.name === "package.json") continue;
    const extension = path.extname(entry.name);
    if (extensions.has(extension)) counts[extension] += 1;
  }
}
walk(root);
const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
const mismatches = [];
for (const [extension, count] of Object.entries(expected.extensions)) {
  if (counts[extension] !== count) mismatches.push(`${extension}: expected ${count}, found ${counts[extension]}`);
}
if (total !== expected.total) mismatches.push(`total: expected ${expected.total}, found ${total}`);
if (mismatches.length) throw new Error(`Graph corpus changed; deliberately rebaseline before running:\n${mismatches.join("\n")}`);
process.stdout.write(`${JSON.stringify({ total, extensions: counts })}\n`);
NODE
}

print_matrix() {
  cat <<'MATRIX'
Pilot (32 runs):
  repeat 1: control, serena, graphify-mcp, graphify-cli
  repeat 2: serena, graphify-cli, control, graphify-mcp
  repeat 3: graphify-cli, graphify-mcp, serena, control
  repeat 4: graphify-mcp, control, graphify-cli, serena
  tasks: tool-overhead, api-flow

Main (126 runs):
  repeat 1: control, serena, selected Graphify
  repeat 2: serena, selected Graphify, control
  repeat 3: selected Graphify, control, serena
  repeats 4-6 repeat that balanced cycle
  tasks: all 7 frozen tasks
MATRIX
}

dry_run() {
  validate_fixtures
  validate_current_corpus
  print_matrix
  printf 'External cache: %s\n' "$cache_root"
  printf 'Benchmark model: %s (%s)\n' "$benchmark_model" "$benchmark_reasoning"
  printf 'Judge model: %s (%s)\n' "$judge_model" "$judge_reasoning"
  printf 'Graphify: graphifyy[terraform,mcp]==%s\n' "$graphify_version"
  printf '%s\n' 'No files, tools, graphs, or benchmark runs were created.'
}

verify_prepared_state() {
  load_state
  local actual_source actual_graph
  actual_source="$(directory_digest "$TASK_WORKSPACE")"
  actual_graph="$(sha256_file "$GRAPH_JSON")"
  [[ "$actual_source" == "$SOURCE_DIGEST" ]] || fail "task workspace digest drifted"
  [[ "$actual_graph" == "$GRAPH_DIGEST" ]] || fail "frozen graph digest drifted"
  [[ "$(serena_directory_digest "$SERENA_WORKSPACE")" == "$SERENA_DIGEST" ]] || fail "Serena workspace digest drifted"
  "$GRAPHIFY_BIN" --version | grep -F "$graphify_version" >/dev/null \
    || fail "prepared Graphify version differs from $graphify_version"
  serena --version | grep -F "$serena_version" >/dev/null \
    || fail "Serena version differs from $serena_version"
  pnpm exec tsx "$repo_root/scripts/graphify-context-results.ts" \
    validate-graph "$GRAPH_JSON" "$TASK_WORKSPACE"
  printf 'Prepared artifacts verified: %s\n' "$SNAPSHOT_ROOT"
}

verify() {
  local no_install="false"
  if [[ "${1:-}" == "--no-install" ]]; then no_install="true"; fi
  require_command git
  require_command node
  require_command pnpm
  require_command sha256sum
  validate_fixtures
  validate_current_corpus
  if [[ "$no_install" == "false" ]]; then
    require_command uv
    require_command curl
    require_command rsync
    require_command codex
    require_command serena
  fi
  if [[ -f "$state_file" ]]; then verify_prepared_state; fi
  printf 'Verification passed%s.\n' "$([[ "$no_install" == "true" ]] && printf ' without installation checks')"
}

install_graphify() {
  require_command uv
  require_command curl
  local tool_root="$cache_root/tools/graphify-$graphify_version"
  local venv="$tool_root/venv"
  local wheel="$tool_root/graphifyy-$graphify_version-py3-none-any.whl"
  local metadata="$tool_root/pypi.json"
  local graphify_bin="$venv/bin/graphify"
  mkdir -p "$tool_root"

  if [[ ! -x "$graphify_bin" ]]; then
    curl -fsSL "https://pypi.org/pypi/graphifyy/$graphify_version/json" -o "$metadata"
    local wheel_url
    wheel_url="$(node - "$metadata" "$graphify_wheel_sha" <<'NODE'
const fs = require("fs");
const [metadataPath, expected] = process.argv.slice(2);
const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
const artifact = metadata.urls.find((item) => item.packagetype === "bdist_wheel" && item.digests.sha256 === expected);
if (!artifact) process.exit(1);
process.stdout.write(artifact.url);
NODE
)" || fail "PyPI metadata did not contain the pinned wheel hash"
    curl -fsSL "$wheel_url" -o "$wheel"
    [[ "$(sha256_file "$wheel")" == "$graphify_wheel_sha" ]] || fail "downloaded Graphify wheel hash mismatch"
    /usr/bin/time -v -o "$tool_root/install-metrics.txt" uv venv "$venv"
    /usr/bin/time -v -a -o "$tool_root/install-metrics.txt" \
      uv pip install --python "$venv/bin/python" "${wheel}[terraform,mcp]"
  fi
  "$graphify_bin" --version | grep -F "$graphify_version" >/dev/null \
    || fail "installed Graphify executable does not report $graphify_version"
  printf '%s\n' "$graphify_bin"
}

copy_sanitized_project() {
  local destination="$1"
  mkdir -p "$destination"
  rsync -a \
    --exclude '/.git/' \
    --exclude '/.serena/' \
    --exclude '/.codex/' \
    --exclude '/.claude/' \
    --exclude '/.mcp.json' \
    --exclude '/.tmp/' \
    --exclude '/benchmarks/' \
    --exclude '/docs/experimentation/' \
    --exclude '**/node_modules/' \
    --exclude '**/dist/' \
    --exclude '**/build/' \
    --exclude '**/coverage/' \
    --exclude '/cdk.out*/' \
    --exclude '**/.terraform/' \
    --exclude '**/.opentofu/' \
    --exclude '**/*.tfstate' \
    --exclude '**/*.tfstate.*' \
    --exclude '**/.terraform.lock.hcl' \
    --exclude '/pnpm-lock.yaml' \
    --exclude '/install-opentofu.sh' \
    --exclude '/scripts/serena-context-benchmark.sh' \
    --exclude '/scripts/graphify-context-benchmark.sh' \
    --exclude '/scripts/graphify-context-results.ts' \
    --exclude '/scripts/graphify-context-results.test.ts' \
    "$repo_root/" "$destination/"
}

write_graphify_ignore() {
  local destination="$1"
  cat > "$destination/.graphifyignore" <<'IGNORE'
**/node_modules/**
**/dist/**
**/build/**
**/coverage/**
cdk.out*/**
**/.terraform/**
**/.opentofu/**
**/*.tfstate
**/*.tfstate.*
.tmp/**
docs/**
benchmarks/**
.serena/**
.codex/**
.claude/**
.mcp.json
install-opentofu.sh
pnpm-lock.yaml
pnpm-workspace.yaml
**/.terraform.lock.hcl
package.json
**/package.json
scripts/serena-context-benchmark.sh
scripts/graphify-context-benchmark.sh
scripts/graphify-context-results.ts
scripts/graphify-context-results.test.ts
scripts/validate-github-env-writers.rb
graphify-out/**
IGNORE
}

write_state() {
  local snapshot_root="$1" task_workspace="$2" serena_workspace="$3"
  local graph_json="$4" graphify_bin="$5" source_digest="$6"
  local graph_digest="$7" serena_digest="$8" results_root="$9"
  mkdir -p "$cache_root"
  {
    printf 'SNAPSHOT_ROOT=%q\n' "$snapshot_root"
    printf 'TASK_WORKSPACE=%q\n' "$task_workspace"
    printf 'SERENA_WORKSPACE=%q\n' "$serena_workspace"
    printf 'GRAPH_JSON=%q\n' "$graph_json"
    printf 'GRAPHIFY_BIN=%q\n' "$graphify_bin"
    printf 'GRAPHIFY_MCP_BIN=%q\n' "$(dirname "$graphify_bin")/graphify-mcp"
    printf 'SOURCE_DIGEST=%q\n' "$source_digest"
    printf 'GRAPH_DIGEST=%q\n' "$graph_digest"
    printf 'SERENA_DIGEST=%q\n' "$serena_digest"
    printf 'RESULTS_ROOT=%q\n' "$results_root"
  } > "$state_file"
}

refresh_experiment_manifest() {
  load_state
  MANIFEST_REPOSITORY_HEAD="$(git rev-parse HEAD)" \
    MANIFEST_REPOSITORY_DIRTY_STATE_DIGEST="$(working_tree_digest)" \
    MANIFEST_SOURCE_DIGEST="$SOURCE_DIGEST" \
    MANIFEST_GRAPH_DIGEST="$GRAPH_DIGEST" \
    MANIFEST_SERENA_DIGEST="$SERENA_DIGEST" \
    MANIFEST_QUERY_DIGEST="$(sha256_file "$queries_file")" \
    MANIFEST_TASK_DIGEST="$(sha256_file "$tasks_file")" \
    MANIFEST_GOLD_DIGEST="$(sha256_file "$benchmark_dir/gold.json")" \
    MANIFEST_EVIDENCE_DIGEST="$(sha256_file "$evidence_file")" \
    MANIFEST_GRAPHIFY_VERSION="$graphify_version" \
    MANIFEST_CODEX_VERSION="$(codex --version)" \
    MANIFEST_SERENA_VERSION="$(serena --version)" \
    MANIFEST_PYTHON_VERSION="$(python3 --version)" \
    MANIFEST_UV_VERSION="$(uv --version)" \
    MANIFEST_NODE_VERSION="$(node --version)" \
    MANIFEST_MODEL="$benchmark_model" \
    MANIFEST_REASONING="$benchmark_reasoning" \
    node - "$RESULTS_ROOT/manifest.json" <<'NODE'
const fs = require("fs");
fs.writeFileSync(process.argv[2], JSON.stringify({
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  repositoryHead: process.env.MANIFEST_REPOSITORY_HEAD,
  repositoryDirtyStateDigest: process.env.MANIFEST_REPOSITORY_DIRTY_STATE_DIGEST,
  sourceDigest: process.env.MANIFEST_SOURCE_DIGEST,
  graphDigest: process.env.MANIFEST_GRAPH_DIGEST,
  serenaDigest: process.env.MANIFEST_SERENA_DIGEST,
  queryDigest: process.env.MANIFEST_QUERY_DIGEST,
  taskDigest: process.env.MANIFEST_TASK_DIGEST,
  goldDigest: process.env.MANIFEST_GOLD_DIGEST,
  evidenceDigest: process.env.MANIFEST_EVIDENCE_DIGEST,
  graphifyVersion: process.env.MANIFEST_GRAPHIFY_VERSION,
  codexVersion: process.env.MANIFEST_CODEX_VERSION,
  serenaVersion: process.env.MANIFEST_SERENA_VERSION,
  pythonVersion: process.env.MANIFEST_PYTHON_VERSION,
  uvVersion: process.env.MANIFEST_UV_VERSION,
  nodeVersion: process.env.MANIFEST_NODE_VERSION,
  model: process.env.MANIFEST_MODEL,
  reasoning: process.env.MANIFEST_REASONING
}, null, 2) + "\n");
NODE
}

prepare() {
  verify --no-install
  require_command rsync
  require_command uv
  require_command curl
  require_command rg
  require_command serena
  require_command codex
  [[ -x /usr/bin/time ]] || fail "/usr/bin/time is required for build metrics"

  mkdir -p "$cache_root/workspaces" "$cache_root/graphs" "$cache_root/results"
  local snapshot_root task_workspace serena_workspace graphify_bin source_digest
  snapshot_root="$(mktemp -d "$cache_root/workspaces/snapshot.XXXXXX")"
  task_workspace="$snapshot_root/task"
  serena_workspace="$snapshot_root/serena"
  copy_sanitized_project "$task_workspace"
  copy_sanitized_project "$serena_workspace"
  validate_current_corpus "$task_workspace"
  mkdir -p "$serena_workspace/.serena"
  cp "$repo_root/.serena/project.yml" "$serena_workspace/.serena/project.yml"
  cp "$repo_root/.serena/.gitignore" "$serena_workspace/.serena/.gitignore"
  source_digest="$(directory_digest "$task_workspace")"
  graphify_bin="$(install_graphify)"

  local graph_dir graph_json
  graph_dir="$cache_root/graphs/$source_digest-$(basename "$snapshot_root")"
  graph_json="$graph_dir/graphify-out/graph.json"
  mkdir -p "$graph_dir"
  write_graphify_ignore "$task_workspace"
  local build_status=0
  env \
    -u GRAPHIFY_OUT \
    -u OPENAI_API_KEY \
    -u ANTHROPIC_API_KEY \
    -u GOOGLE_API_KEY \
    GRAPHIFY_QUERY_LOG_DISABLE=1 \
    /usr/bin/time -v -o "$graph_dir/build-metrics.txt" \
    "$graphify_bin" extract "$task_workspace" \
      --code-only --no-cluster --force --out "$graph_dir" \
      > >(tee "$graph_dir/build.stdout.log") \
      2> >(tee "$graph_dir/build.stderr.log" >&2) || build_status=$?
  rm "$task_workspace/.graphifyignore"
  [[ "$build_status" == "0" ]] || fail "Graphify extraction exited with status $build_status"
  rg -F 'found 266 code' "$graph_dir/build.stdout.log" "$graph_dir/build.stderr.log" >/dev/null \
    || fail "Graphify did not report the frozen 266-file corpus"
  if rg -i 'syntax errors|partial extraction|traceback' \
    "$graph_dir/build.stdout.log" "$graph_dir/build.stderr.log" >/dev/null; then
    fail "Graphify reported a syntax or partial-extraction warning; inspect $graph_dir/build.stdout.log and build.stderr.log"
  fi
  [[ -f "$graph_json" ]] || fail "Graphify did not create $graph_json"

  pnpm exec tsx "$repo_root/scripts/graphify-context-results.ts" \
    validate-graph "$graph_json" "$task_workspace"
  local graph_digest serena_digest results_root
  graph_digest="$(sha256_file "$graph_json")"
  serena_digest="$(serena_directory_digest "$serena_workspace")"
  results_root="$cache_root/results/$source_digest-$graph_digest"
  mkdir -p "$results_root"
  write_state "$snapshot_root" "$task_workspace" "$serena_workspace" \
    "$graph_json" "$graphify_bin" "$source_digest" "$graph_digest" \
    "$serena_digest" "$results_root"

  refresh_experiment_manifest
  verify_prepared_state
}

task_prompt() {
  local task_id="$1"
  awk -F '\t' -v id="$task_id" '$1 == id { sub(/^[^\t]*\t/, ""); print; exit }' "$tasks_file"
}

arm_prompt() {
  local arm="$1" task_id="$2"
  local seed mode budget depth _verification _calibration traversal_flag row_task

  case "$arm" in
    control)
      printf '%s' 'Retrieval mode: native read-only shell only. Serena and Graphify are unavailable. Use focused exact-text search and focused reads.'
      ;;
    serena)
      printf '%s' 'Retrieval mode: use Serena semantic retrieval for TypeScript and TSX. Serena memories are absent. Use native exact-text search for non-code files, completeness checks, and focused source verification. Graphify is unavailable.'
      ;;
    graphify-cli)
      if [[ "$task_id" == "tool-overhead" ]]; then
        printf '%s' 'Retrieval mode: the Graphify CLI is available, but this task requires no repository or graph inspection. Serena is unavailable.'
      else
        printf '%s' 'Retrieval mode: run each frozen Graphify CLI discovery query once:'
        while IFS=$'\t' read -r row_task seed mode budget depth _verification _calibration; do
          [[ "$row_task" == "$task_id" ]] || continue
          traversal_flag=""
          [[ "$mode" == "dfs" ]] && traversal_flag="--dfs"
          printf '\n- `graphify query %q %s --budget %s --graph %q`' \
            "$seed" "$traversal_flag" "$budget" "$GRAPH_JSON"
        done < <(tail -n +2 "$queries_file")
        printf '%s' ' Do not raise a budget or retry a truncated result; record it as a tool failure. Use `graphify path` or `graphify explain` only when needed. Do not use context hints. Verify citations and every INFERRED or AMBIGUOUS edge in exact source; completeness tasks require exact native search. Serena is unavailable.'
      fi
      ;;
    graphify-mcp)
      if [[ "$task_id" == "tool-overhead" ]]; then
        printf '%s' 'Retrieval mode: the minimal Graphify MCP toolset is available, but this task requires no repository or graph inspection. Serena is unavailable.'
      else
        printf '%s' 'Retrieval mode: run query_graph once for each frozen discovery query:'
        while IFS=$'\t' read -r row_task seed mode budget depth _verification _calibration; do
          [[ "$row_task" == "$task_id" ]] || continue
          printf '\n- question `%s`, mode `%s`, depth %s, token_budget %s' \
            "$seed" "$mode" "$depth" "$budget"
        done < <(tail -n +2 "$queries_file")
        printf '%s' ' Do not raise a budget or retry a truncated result; record it as a tool failure. Use get_node, get_neighbors, or shortest_path only when needed; do not pass context hints. Verify citations and every INFERRED or AMBIGUOUS edge in exact source; completeness tasks require exact native search. Serena is unavailable.'
      fi
      ;;
    *) fail "unknown arm: $arm" ;;
  esac
}

codex_config_for_arm() {
  local arm="$1"
  CODEX_CONFIG_ARGS=(
    -c "model_reasoning_effort=$(toml_string "$benchmark_reasoning")"
    -c 'features.hooks=false'
    -c 'history.persistence="none"'
    -c 'web_search="disabled"'
    -c 'approval_policy="never"'
  )
  case "$arm" in
    control|graphify-cli) ;;
    serena)
      CODEX_CONFIG_ARGS+=(
        -c "mcp_servers.serena.command=$(toml_string "serena")"
        -c "mcp_servers.serena.args=$(toml_array start-mcp-server --context=codex --project "$SERENA_WORKSPACE")"
        -c 'mcp_servers.serena.required=true'
        -c 'mcp_servers.serena.startup_timeout_sec=60'
      )
      ;;
    graphify-mcp)
      CODEX_CONFIG_ARGS+=(
        -c "mcp_servers.graphify.command=$(toml_string "$GRAPHIFY_MCP_BIN")"
        -c "mcp_servers.graphify.env={GRAPHIFY_OUT=$(toml_string "$(dirname "$GRAPH_JSON")"),GRAPHIFY_QUERY_LOG_DISABLE=\"1\"}"
        -c 'mcp_servers.graphify.required=true'
        -c 'mcp_servers.graphify.startup_timeout_sec=60'
        -c 'mcp_servers.graphify.enabled_tools=["query_graph","get_node","get_neighbors","shortest_path"]'
      )
      ;;
  esac
}

run_one() {
  local phase="$1" repeat="$2" arm="$3" task_id="$4"
  local task_filter="${TASK_FILTER:-}" repeat_filter="${REPEAT_FILTER:-}"
  [[ -z "$task_filter" || "$task_filter" == "$task_id" ]] || return 0
  [[ -z "$repeat_filter" || "$repeat_filter" == "$repeat" ]] || return 0

  verify_prepared_state >/dev/null
  local prompt instruction run_dir start_epoch end_epoch elapsed status actual_source
  instruction="$(arm_prompt "$arm" "$task_id")"
  prompt="$instruction

$(task_prompt "$task_id")

Return concise evidence and distinguish exact source evidence from inference. Answer only this task. Do not inspect benchmark definitions, harness scripts, gold checklists, previous results, Serena configuration or memories, Graphify output files, or parent directories."
  run_dir="$RESULTS_ROOT/$phase/repeat-$repeat/$arm/$task_id"
  mkdir -p "$run_dir"
  printf '%s\n' "$prompt" > "$run_dir/prompt.txt"
  codex_config_for_arm "$arm"
  status=0
  start_epoch="$(date +%s.%N)"
  PATH="$(dirname "$GRAPHIFY_BIN"):$PATH" \
    GRAPHIFY_OUT="$(dirname "$GRAPH_JSON")" \
    GRAPHIFY_QUERY_LOG_DISABLE=1 \
    codex exec --json --ephemeral --ignore-user-config --strict-config \
      --ignore-rules --skip-git-repo-check -s read-only -C "$TASK_WORKSPACE" -m "$benchmark_model" \
      -o "$run_dir/answer.txt" "${CODEX_CONFIG_ARGS[@]}" "$prompt" \
      > "$run_dir/events.jsonl" 2> "$run_dir/stderr.log" || status=$?
  end_epoch="$(date +%s.%N)"
  elapsed="$(awk -v start="$start_epoch" -v end="$end_epoch" 'BEGIN { printf "%.3f", end - start }')"
  actual_source="$(directory_digest "$TASK_WORKSPACE")"

  RUN_META_ARM="$arm" RUN_META_TASK="$task_id" RUN_META_REPEAT="$repeat" \
    RUN_META_ELAPSED="$elapsed" RUN_META_STATUS="$status" \
    RUN_META_SOURCE_EXPECTED="$SOURCE_DIGEST" RUN_META_SOURCE_ACTUAL="$actual_source" \
    RUN_META_GRAPH_EXPECTED="$GRAPH_DIGEST" RUN_META_GRAPH_ACTUAL="$(sha256_file "$GRAPH_JSON")" \
    node - "$run_dir/metadata.json" "$RESULTS_ROOT/manifest.json" <<'NODE'
const fs = require("fs");
const experimentManifest = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
fs.writeFileSync(process.argv[2], JSON.stringify({
  arm: process.env.RUN_META_ARM,
  task: process.env.RUN_META_TASK,
  repeat: Number(process.env.RUN_META_REPEAT),
  elapsedSeconds: Number(process.env.RUN_META_ELAPSED),
  exitStatus: Number(process.env.RUN_META_STATUS),
  expected: { source: process.env.RUN_META_SOURCE_EXPECTED, graph: process.env.RUN_META_GRAPH_EXPECTED },
  actual: { source: process.env.RUN_META_SOURCE_ACTUAL, graph: process.env.RUN_META_GRAPH_ACTUAL },
  sourceModified: process.env.RUN_META_SOURCE_EXPECTED !== process.env.RUN_META_SOURCE_ACTUAL,
  experimentManifest,
  forbiddenPaths: ["benchmarks/", ".serena/", "graphify-context-results", "serena-context-benchmark"]
}, null, 2) + "\n");
NODE
  pnpm exec tsx "$repo_root/scripts/graphify-context-results.ts" parse-run \
    "$run_dir/events.jsonl" "$run_dir/metadata.json" "$evidence_file" "$run_dir/summary.json"
  printf '%s\n' "$status" > "$run_dir/exit-status.txt"
}

run_pilot() {
  refresh_experiment_manifest
  [[ "$benchmark_model" == "gpt-5.6-luna" && "$benchmark_reasoning" == "low" ]] \
    || fail "measured pilot runs are locked to gpt-5.6-luna with low reasoning"
  local repeat arm task
  for repeat in 1 2 3 4; do
    case "$repeat" in
      1) arms=(control serena graphify-mcp graphify-cli) ;;
      2) arms=(serena graphify-cli control graphify-mcp) ;;
      3) arms=(graphify-cli graphify-mcp serena control) ;;
      4) arms=(graphify-mcp control graphify-cli serena) ;;
    esac
    for arm in "${arms[@]}"; do
      for task in tool-overhead api-flow; do run_one pilot "$repeat" "$arm" "$task"; done
    done
  done
  printf 'Pilot complete: %s\n' "$RESULTS_ROOT/pilot"
}

run_main() {
  refresh_experiment_manifest
  [[ "$benchmark_model" == "gpt-5.6-luna" && "$benchmark_reasoning" == "low" ]] \
    || fail "measured main runs are locked to gpt-5.6-luna with low reasoning"
  local graphify_arm="${GRAPHIFY_ARM:-}"
  [[ "$graphify_arm" == "graphify-cli" || "$graphify_arm" == "graphify-mcp" ]] \
    || fail "GRAPHIFY_ARM must be graphify-cli or graphify-mcp after blind pilot scoring"
  local repeat arm task
  for repeat in 1 2 3 4 5 6; do
    case "$(((repeat - 1) % 3))" in
      0) arms=(control serena "$graphify_arm") ;;
      1) arms=(serena "$graphify_arm" control) ;;
      2) arms=("$graphify_arm" control serena) ;;
    esac
    for arm in "${arms[@]}"; do
      while IFS=$'\t' read -r task _prompt; do run_one main "$repeat" "$arm" "$task"; done < "$tasks_file"
    done
  done
  printf 'Main experiment complete: %s\n' "$RESULTS_ROOT/main"
}

command_name="${1:-}"
case "$command_name" in
  dry-run) dry_run ;;
  verify) shift; verify "${1:-}" ;;
  prepare) prepare ;;
  pilot) run_pilot ;;
  run) run_main ;;
  -h|--help|help) usage ;;
  *) usage; [[ -n "$command_name" ]] && exit 1 ;;
esac
