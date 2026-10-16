import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function listRepositoryFiles() {
  try {
    return execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { encoding: "utf8" });
  } catch (error) {
    if (error?.status !== 0 || typeof error?.stdout !== "string") throw error;
    return error.stdout;
  }
}

const repositoryFiles = listRepositoryFiles().split("\0").filter(Boolean);
const forbiddenFiles = new Set([".env", ".env.local", ".env.production", "id_rsa", "id_ed25519"]);
const patterns = [
  { label: "Google API key", value: /AIza[0-9A-Za-z_-]{30,}/u },
  { label: "GitHub token", value: /gh[pousr]_[0-9A-Za-z]{30,}/u },
  { label: "private key", value: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u }
];
const findings = [];

for (const path of repositoryFiles) {
  const basename = path.split("/").at(-1);
  if (basename && forbiddenFiles.has(basename)) findings.push(`${path}: secret file must not be tracked`);
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  for (const pattern of patterns) {
    if (path === "scripts/scan-secrets.mjs") continue;
    if (pattern.value.test(content)) findings.push(`${path}: possible ${pattern.label}`);
  }
}

if (findings.length > 0) {
  console.error("Potential secrets found:\n" + findings.map((finding) => `- ${finding}`).join("\n"));
  process.exit(1);
}

console.log(`Secret scan passed for ${repositoryFiles.length} repository files.`);
