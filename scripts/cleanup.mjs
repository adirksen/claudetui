import { DIST_DIR, cleanupDemoHome } from "./dev-environment.mjs";
import { rmSync } from "node:fs";

cleanupDemoHome();
rmSync(DIST_DIR, { recursive: true, force: true });
console.log("Removed generated .dev-home and dist directories.");
