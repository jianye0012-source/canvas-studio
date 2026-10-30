// Wall-clock budgets for the motion tests. On a developer's machine a budget is the product's target: the agent
// compiles, checks and repairs a take in seconds. A CI runner is shared and runs the suite's files in parallel; the
// first Linux run measured the exit-car compile + QA at 8.3 s (1.1 s on an M-series Mac, budget 3 s) and a repair at
// 27 s (budget 10 s). There (CI is set, as GitHub Actions sets it) a budget is CI_FACTOR times as long: it still
// catches a slowdown by an order of magnitude, and no longer the runner's load.
const CI_FACTOR = 5;

/** The budget for a timing check on this machine, in ms. */
export const budgetMs = ms => (process.env.CI ? ms * CI_FACTOR : ms);
