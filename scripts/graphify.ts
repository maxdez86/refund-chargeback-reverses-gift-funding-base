import {
  DEFAULT_QUERY_BUDGET,
  MAX_QUERY_BUDGET,
  parseQueryArguments,
} from "./lib/graphify-context.ts";
import { GraphifyRuntime, defaultRepositoryRoot } from "./lib/graphify-runtime.ts";

function usage(): string {
  return [
    "Usage:",
    "  pnpm graphify:doctor",
    "  pnpm graphify:build",
    `  pnpm graphify:query -- "<seed>" [--mode bfs|dfs] [--budget 1..${MAX_QUERY_BUDGET}]`,
    "",
    `Query defaults: mode=bfs, budget=${DEFAULT_QUERY_BUDGET} tokens (empirically calibrated).`,
    "All query output is experimental discovery and requires native source verification.",
  ].join("\n");
}

function main(): void {
  const [command, ...arguments_] = process.argv.slice(2);
  const runtime = new GraphifyRuntime({ repositoryRoot: defaultRepositoryRoot(import.meta.url) });

  if (command === "doctor") {
    for (const line of runtime.doctor()) console.log(`OK: ${line}`);
    return;
  }
  if (command === "build") {
    const metadata = runtime.build();
    console.log(
      `Graphify code-only graph ready: ${metadata.nodeCount} nodes, ${metadata.edgeCount} edges, ${metadata.graphSha256}`,
    );
    return;
  }
  if (command === "query") {
    const { output } = runtime.query(parseQueryArguments(arguments_));
    console.log(output);
    return;
  }

  console.error(usage());
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
