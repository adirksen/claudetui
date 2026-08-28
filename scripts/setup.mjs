import { DEMO_CLAUDE_HOME, installDependencies, prepareDemoHome } from "./dev-environment.mjs";

installDependencies();
prepareDemoHome();
console.log(`\nDemo environment ready. Run \`npm run dev:demo\` to use ${DEMO_CLAUDE_HOME}.`);
