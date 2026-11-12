/**
 * KTR flags (plan.md section 7). All off by default. "true" or "1" turns a flag on, anything else is off (the
 * X402_METER_ENABLED convention). Pure: the caller passes the env object and whether the stop file exists, so this
 * module never touches the file system. The file switch .swarm-state/ktr-stop overrides every flag.
 *
 * Two flags are added to the plan's list for milestone 1, both off:
 *   TOOL_ROUTER_SNAPSHOT_FETCH   the snapshot refresh CLI may fetch public catalogs over the network
 *   TOOL_ROUTER_MCP_LIST_LIVE    the MCP adapter may call tools/list on an approved REMOTE server (never a package)
 */
export interface KtrFlags {
  enabled: boolean;
  shadow: boolean;
  externalDiscovery: boolean;
  modelFallback: boolean;
  executionEnabled: boolean;
  experienceCapture: boolean;
  skillCrystallisation: boolean;
  marketplaceEnabled: boolean;
  rentalMainnet: boolean;
  snapshotFetch: boolean;
  mcpListLive: boolean;
  /** S6b (Founder 2026-10-24 "yes" to the migration): the router also reads approved and listed skill v2 records */
  skillsV2Read: boolean;
  /** .swarm-state/ktr-stop exists: everything is off, whatever the env says. */
  stopped: boolean;
}

export const FLAG_ENV: Record<Exclude<keyof KtrFlags, 'stopped'>, string> = {
  enabled: 'TOOL_ROUTER_ENABLED',
  shadow: 'TOOL_ROUTER_SHADOW_MODE',
  externalDiscovery: 'TOOL_ROUTER_EXTERNAL_DISCOVERY',
  modelFallback: 'TOOL_ROUTER_MODEL_FALLBACK',
  executionEnabled: 'TOOL_ROUTER_EXECUTION_ENABLED',
  experienceCapture: 'TOOL_EXPERIENCE_CAPTURE',
  skillCrystallisation: 'TOOL_SKILL_CRYSTALLISATION',
  marketplaceEnabled: 'SKILLS_MARKETPLACE_ENABLED',
  rentalMainnet: 'SKILL_RENTAL_MAINNET_ENABLED',
  snapshotFetch: 'TOOL_ROUTER_SNAPSHOT_FETCH',
  mcpListLive: 'TOOL_ROUTER_MCP_LIST_LIVE',
  skillsV2Read: 'TOOL_SKILLS_V2_READ',
};

export const STOP_FILE = '.swarm-state/ktr-stop';

const on = (v: string | undefined): boolean => v === 'true' || v === '1';

export function readFlags(env: Record<string, string | undefined> = process.env, opts: { stopFileExists?: boolean } = {}): KtrFlags {
  const stopped = opts.stopFileExists === true;
  const out = { stopped } as KtrFlags;
  for (const [k, name] of Object.entries(FLAG_ENV) as Array<[Exclude<keyof KtrFlags, 'stopped'>, string]>) {
    out[k] = !stopped && on(env[name]);
  }
  // Milestone 1 was offline (decision D2). From S4 the Execution Gateway may execute when TOOL_ROUTER_EXECUTION_ENABLED
  // is set (default off; read only native tools only, core/tool-gateway). Marketplace and mainnet stay off even when set.
  out.marketplaceEnabled = false;
  out.rentalMainnet = false;
  return out;
}

/** Every flag off: the default a test or a library caller starts from. */
export const ALL_OFF: KtrFlags = readFlags({});
