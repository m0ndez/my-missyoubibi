export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // A weak or missing login configuration stops the server here, loudly, instead of serving it.
    const problem = (await import("./lib/auth")).configProblem();
    if (problem) throw new Error(problem);
    (await import("./lib/scheduler")).startScheduler();
  }
}
