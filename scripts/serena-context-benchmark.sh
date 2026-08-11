#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
results_root="${RESULTS_DIR:-$repo_root/.tmp/serena-context-benchmark}"
runs="${RUNS:-3}"
model="${MODEL:-gpt-5.6-luna}"
reasoning="${REASONING:-low}"
task_filter="${TASK_FILTER:-}"
tasks_file="$repo_root/benchmarks/serena-context/tasks.tsv"

mkdir -p "$results_root"
printf '%s\n' 'repeat,arm,task,elapsed_seconds,input_tokens,cached_input_tokens,uncached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens,mcp_calls,command_calls,retries,status' > "$results_root/summary.csv"

for repeat in $(seq 1 "$runs"); do
  case $((repeat % 3)) in
    1) arms=(control semantic memory) ;;
    2) arms=(semantic memory control) ;;
    0) arms=(memory control semantic) ;;
  esac

  for arm in "${arms[@]}"; do
    while IFS=$'\t' read -r task_id task_prompt; do
      if [[ -n "$task_filter" && "$task_id" != "$task_filter" ]]; then
        continue
      fi

      run_dir="$results_root/repeat-$repeat/$arm/$task_id"
      mkdir -p "$run_dir"
      config_args=(-c features.hooks=false)
      arm_instruction=""

      case "$arm" in
        control)
          config_args+=(-c mcp_servers.serena.enabled=false)
          arm_instruction="Serena is disabled for this run. Use native read-only repository tools efficiently."
          ;;
        semantic)
          config_args+=(-c mcp_servers.serena.enabled=true)
          arm_instruction="Use Serena semantic retrieval for TypeScript code. Serena memories are disabled. Use native exact-text search for non-code files."
          ;;
        memory)
          config_args+=(-c mcp_servers.serena.enabled=true)
          arm_instruction="Use Serena semantic retrieval for TypeScript code. When a curated memory can replace repository discovery, read only that memory with 'serena memories read <name>' through the native shell. Use native exact-text search for non-code files."
          ;;
      esac

      full_prompt="$arm_instruction

$task_prompt

Return concise evidence. Distinguish source evidence from inference."
      full_prompt="$full_prompt
Answer only this task. Do not inspect benchmark definitions, benchmark scripts, previous benchmark output, or Serena configuration files."
      start_epoch="$(date +%s.%N)"
      status=0
      codex exec --json --ephemeral -s read-only -m "$model" -c "model_reasoning_effort=\"$reasoning\"" "${config_args[@]}" "$full_prompt" > "$run_dir/events.jsonl" 2> "$run_dir/stderr.log" || status=$?
      end_epoch="$(date +%s.%N)"
      elapsed="$(awk -v start="$start_epoch" -v end="$end_epoch" 'BEGIN { printf "%.3f", end - start }')"
      printf '%s\n' "$full_prompt" > "$run_dir/prompt.txt"
      printf '%s\n' "$status" > "$run_dir/exit-status.txt"

      node - "$run_dir/events.jsonl" "$results_root/summary.csv" "$repeat" "$arm" "$task_id" "$elapsed" "$status" <<'NODE'
const fs = require("fs");
const [eventsPath, summaryPath, repeat, arm, task, elapsed, status] = process.argv.slice(2);
const events = fs.readFileSync(eventsPath, "utf8").split("\n").filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
});
const completed = [...events].reverse().find((event) => event.type === "turn.completed");
const usage = completed?.usage ?? {};
const input = usage.input_tokens ?? 0;
const cached = usage.cached_input_tokens ?? 0;
const output = usage.output_tokens ?? 0;
const reasoning = usage.reasoning_output_tokens ?? 0;
const mcpCalls = events.filter((event) => event.type === "item.completed" && event.item?.type === "mcp_tool_call").length;
const commandCalls = events.filter((event) => event.type === "item.completed" && event.item?.type === "command_execution").length;
const retries = events.filter((event) => JSON.stringify(event).toLowerCase().includes("retry")).length;
const values = [repeat, arm, task, elapsed, input, cached, input - cached, output, reasoning, input + output, mcpCalls, commandCalls, retries, status];
fs.appendFileSync(summaryPath, `${values.join(",")}\n`);
NODE
    done < "$tasks_file"
  done
done

printf 'Benchmark complete: %s\n' "$results_root/summary.csv"
