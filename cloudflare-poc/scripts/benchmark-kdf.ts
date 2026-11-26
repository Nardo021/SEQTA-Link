// Run each KDF in a separate fresh Node process for host-side comparison.
// These numbers are NOT Cloudflare deployed CPU/peak-memory measurements.
import { verifyArgon2Phc, verifyLegacyScrypt } from "../src/compat.ts";
import { PASSWORD, ARGON2_DEFAULT, SCRYPT_LEGACY } from "../test/password-fixtures.ts";

const mode = process.argv[2];
if (mode !== "argon2" && mode !== "scrypt") throw new Error("Specify argon2 or scrypt");
const fn = mode === "argon2" ? verifyArgon2Phc : verifyLegacyScrypt;
const stored = mode === "argon2" ? ARGON2_DEFAULT : SCRYPT_LEGACY;
const baseline = process.memoryUsage().rss;
const startCPU = process.cpuUsage();
const start = process.hrtime.bigint();
const ok = fn(PASSWORD, stored);
const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
const cpu = process.cpuUsage(startCPU);
const peak = process.resourceUsage().maxRSS;
if (!ok) throw new Error("Synthetic password verification failed");
console.log(JSON.stringify({
  kind: "NODE_HOST_PROXY_ONLY",
  mode,
  ok,
  wall_ms: Math.round(elapsed * 100) / 100,
  cpu_ms: Math.round((cpu.user + cpu.system) / 10) / 100,
  baseline_rss_kib: Math.round(baseline / 1024),
  process_peak_rss_kib: peak,
}));
