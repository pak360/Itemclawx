/**
 * Skill Config Utilities
 * Direct read/write access to skill configuration in ~/.openclaw/openclaw.json
 * This bypasses the Gateway RPC for faster and more reliable config updates.
 *
 * All file I/O uses async fs/promises to avoid blocking the main thread.
 */
import { readFile, writeFile, access, cp, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { constants } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getOpenClawDir, getResourcesDir } from './paths';
import { logger } from './logger';

const OPENCLAW_CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');

interface SkillEntry {
    enabled?: boolean;
    apiKey?: string;
    env?: Record<string, string>;
}

interface OpenClawConfig {
    skills?: {
        entries?: Record<string, SkillEntry>;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

async function fileExists(p: string): Promise<boolean> {
    try { await access(p, constants.F_OK); return true; } catch { return false; }
}

/**
 * Read the current OpenClaw config
 */
async function readConfig(): Promise<OpenClawConfig> {
    if (!(await fileExists(OPENCLAW_CONFIG_PATH))) {
        return {};
    }
    try {
        const raw = await readFile(OPENCLAW_CONFIG_PATH, 'utf-8');
        return JSON.parse(raw);
    } catch (err) {
        console.error('Failed to read openclaw config:', err);
        return {};
    }
}

/**
 * Write the OpenClaw config
 */
async function writeConfig(config: OpenClawConfig): Promise<void> {
    const json = JSON.stringify(config, null, 2);
    await writeFile(OPENCLAW_CONFIG_PATH, json, 'utf-8');
}

/**
 * Get skill config
 */
export async function getSkillConfig(skillKey: string): Promise<SkillEntry | undefined> {
    const config = await readConfig();
    return config.skills?.entries?.[skillKey];
}

/**
 * Persist the enabled/disabled state for a skill into openclaw.json.
 * Called when the user toggles a skill in the UI so the preference
 * survives Gateway restarts.
 */
export async function setSkillEnabled(
    skillKey: string,
    enabled: boolean,
): Promise<{ success: boolean; error?: string }> {
    try {
        const config = await readConfig();
        if (!config.skills) config.skills = {};
        if (!config.skills.entries) config.skills.entries = {};
        const entry = config.skills.entries[skillKey] || {};
        entry.enabled = enabled;
        config.skills.entries[skillKey] = entry;
        await writeConfig(config);
        return { success: true };
    } catch (err) {
        console.error('Failed to set skill enabled state:', err);
        return { success: false, error: String(err) };
    }
}

/**
 * Update skill config (apiKey and env)
 */
export async function updateSkillConfig(
    skillKey: string,
    updates: { apiKey?: string; env?: Record<string, string> }
): Promise<{ success: boolean; error?: string }> {
    try {
        const config = await readConfig();

        // Ensure skills.entries exists
        if (!config.skills) {
            config.skills = {};
        }
        if (!config.skills.entries) {
            config.skills.entries = {};
        }

        // Get or create skill entry
        const entry = config.skills.entries[skillKey] || {};

        // Update apiKey
        if (updates.apiKey !== undefined) {
            const trimmed = updates.apiKey.trim();
            if (trimmed) {
                entry.apiKey = trimmed;
            } else {
                delete entry.apiKey;
            }
        }

        // Update env
        if (updates.env !== undefined) {
            const newEnv: Record<string, string> = {};

            for (const [key, value] of Object.entries(updates.env)) {
                const trimmedKey = key.trim();
                if (!trimmedKey) continue;

                const trimmedVal = value.trim();
                if (trimmedVal) {
                    newEnv[trimmedKey] = trimmedVal;
                }
            }

            if (Object.keys(newEnv).length > 0) {
                entry.env = newEnv;
            } else {
                delete entry.env;
            }
        }

        // Save entry back
        config.skills.entries[skillKey] = entry;

        await writeConfig(config);
        return { success: true };
    } catch (err) {
        console.error('Failed to update skill config:', err);
        return { success: false, error: String(err) };
    }
}

/**
 * Get all skill configs (for syncing to frontend)
 */
export async function getAllSkillConfigs(): Promise<Record<string, SkillEntry>> {
    const config = await readConfig();
    return config.skills?.entries || {};
}

/**
 * Built-in skills from the openclaw package's extensions directory.
 */
const BUILTIN_SKILLS = [
    { slug: 'feishu-doc',   sourceExtension: 'feishu' },
    { slug: 'feishu-drive', sourceExtension: 'feishu' },
    { slug: 'feishu-perm',  sourceExtension: 'feishu' },
    { slug: 'feishu-wiki',  sourceExtension: 'feishu' },
] as const;

/**
 * Custom skills bundled with ItemClawX in resources/skills/<slug>/.
 * These are proprietary skills not part of the openclaw package.
 */
const CUSTOM_BUNDLED_SKILLS = [
    'unis-ticket',
] as const;

/**
 * Skills that should be enabled by default on fresh installs.
 * Empty set = all skills start disabled; the user must explicitly enable them.
 */
const DEFAULT_ENABLED_SKILLS = new Set<string>([]);

/**
 * Ensure built-in skills are deployed to ~/.openclaw/skills/<slug>/.
 * Skips any skill that already has a SKILL.md present (idempotent).
 * On fresh installs, disables all skills except those in DEFAULT_ENABLED_SKILLS.
 * Runs at app startup; all errors are logged and swallowed so they never
 * block the normal startup flow.
 */
export async function ensureBuiltinSkillsInstalled(): Promise<void> {
    const skillsRoot = join(homedir(), '.openclaw', 'skills');
    const newlyInstalled: string[] = [];

    // Deploy openclaw extension skills
    for (const { slug, sourceExtension } of BUILTIN_SKILLS) {
        const targetDir = join(skillsRoot, slug);
        const targetManifest = join(targetDir, 'SKILL.md');

        if (existsSync(targetManifest)) {
            continue;
        }

        const openclawDir = getOpenClawDir();
        const sourceDir = join(openclawDir, 'extensions', sourceExtension, 'skills', slug);

        if (!existsSync(join(sourceDir, 'SKILL.md'))) {
            logger.warn(`Built-in skill source not found, skipping: ${sourceDir}`);
            continue;
        }

        try {
            await mkdir(targetDir, { recursive: true });
            await cp(sourceDir, targetDir, { recursive: true });
            logger.info(`Installed built-in skill: ${slug} -> ${targetDir}`);
            newlyInstalled.push(slug);
        } catch (error) {
            logger.warn(`Failed to install built-in skill ${slug}:`, error);
        }
    }

    // Deploy custom bundled skills from resources/skills/
    const resourcesDir = getResourcesDir();
    for (const slug of CUSTOM_BUNDLED_SKILLS) {
        const targetDir = join(skillsRoot, slug);
        const targetManifest = join(targetDir, 'SKILL.md');

        if (existsSync(targetManifest)) {
            continue;
        }

        const sourceDir = join(resourcesDir, 'skills', slug);

        if (!existsSync(join(sourceDir, 'SKILL.md'))) {
            logger.warn(`Custom bundled skill source not found, skipping: ${sourceDir}`);
            continue;
        }

        try {
            await mkdir(targetDir, { recursive: true });
            await cp(sourceDir, targetDir, { recursive: true });
            logger.info(`Installed custom bundled skill: ${slug} -> ${targetDir}`);
            newlyInstalled.push(slug);
        } catch (error) {
            logger.warn(`Failed to install custom bundled skill ${slug}:`, error);
        }
    }

    // Set default enabled/disabled state for newly installed skills
    if (newlyInstalled.length > 0) {
        await applyDefaultSkillStates(newlyInstalled);
    }
}

/**
 * Write default enabled/disabled state into openclaw.json for newly installed skills.
 * Skills not in DEFAULT_ENABLED_SKILLS are disabled by default.
 */
async function applyDefaultSkillStates(slugs: string[]): Promise<void> {
    try {
        const config = await readConfig();
        if (!config.skills) config.skills = {};
        if (!config.skills.entries) config.skills.entries = {};

        let changed = false;
        for (const slug of slugs) {
            // Only set default if no entry exists yet (don't override user preference)
            if (!config.skills.entries[slug]) {
                const shouldEnable = DEFAULT_ENABLED_SKILLS.has(slug);
                config.skills.entries[slug] = { enabled: shouldEnable };
                if (!shouldEnable) {
                    logger.info(`Disabled skill by default: ${slug}`);
                }
                changed = true;
            }
        }

        if (changed) {
            await writeConfig(config);
        }
    } catch (error) {
        logger.warn('Failed to apply default skill states:', error);
    }
}
