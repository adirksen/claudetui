#!/usr/bin/env node

import { startApp, stopApp } from "../src/app.js";
import { parseMouseFlag } from "../src/ui/mouse.js";

// Ensure errors are visible even if blessed has taken over the screen
process.on("uncaughtException", (err) => {
  try {
    stopApp();
  } catch {
    // Screen may already be destroyed
  }
  console.error("claudetui crashed:", err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  try {
    stopApp();
  } catch {
    // Screen may already be destroyed
  }
  console.error("claudetui unhandled rejection:", err);
  process.exit(1);
});

// Use await to keep the process alive — this is the key fix.
// Without it, program.parse() returns synchronously and Node exits.
try {
  await startApp({ mouse: parseMouseFlag(process.argv) });
} catch (err) {
  console.error("Failed to start claudetui:", err);
  process.exit(1);
}
