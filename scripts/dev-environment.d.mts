export const REPOSITORY_ROOT: string;
export const DEMO_HOME: string;
export const DEMO_CLAUDE_HOME: string;
export const DIST_DIR: string;

export function prepareDemoHome(demoHome?: string): void;
export function cleanupDemoHome(demoHome?: string): void;
export function installDependencies(): void;
export function runDemo(): void;
