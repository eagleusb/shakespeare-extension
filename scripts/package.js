import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageJson = await Bun.file(path.join(root, "package.json")).json();
const manifest = await Bun.file(path.join(root, "src/manifest.json")).json();

if (packageJson.version !== manifest.version) {
  throw new Error("package.json and src/manifest.json versions must match");
}

const artifactDirectory = path.join(root, "artifacts");
await mkdir(artifactDirectory, { recursive: true });

const archive = path.join(
  artifactDirectory,
  `shakespeare-${packageJson.version}.zip`,
);
const zip = Bun.spawnSync(["zip", "-r", "-FS", archive, ".", "-x", ".*"], {
  cwd: path.join(root, "dist"),
  stdout: "inherit",
  stderr: "inherit",
});

if (zip.exitCode !== 0) {
  throw new Error(`zip failed with exit code ${zip.exitCode}`);
}

console.log(archive);
