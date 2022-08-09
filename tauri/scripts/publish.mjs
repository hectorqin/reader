import fs from "fs-extra";
import { createRequire } from "module";
import { execSync } from "child_process";
import { resolveUpdateLog } from "./updatelog.mjs";
import path from "path"

const require = createRequire(import.meta.url);

// publish
async function resolvePublish() {
  const flag = process.argv[2] ?? "patch";
  const rootDir = path.resolve(import.meta.url.replace("file://", ""), "../../../");
  const packageJson = require(path.resolve(rootDir, "web/package.json"));
  const tauriPackageJson = require(path.resolve(rootDir, "tauri/package.json"));
  const tauriJson = require(path.resolve(rootDir, "tauri/src-tauri/tauri.conf.json"));

  const oldVersion = packageJson.version;
  let [a, b, c] = packageJson.version.split(".").map(Number);

  if (flag === "major") {
    a += 1;
    b = 0;
    c = 0;
  } else if (flag === "minor") {
    b += 1;
    c = 0;
  } else if (flag === "patch") {
    c += 1;
  } else throw new Error(`invalid flag "${flag}"`);

  const nextVersion = `${a}.${b}.${c}`;
  packageJson.version = nextVersion;
  tauriJson.package.version = nextVersion;
  tauriPackageJson.version = nextVersion;

  // 发布更新前先写更新日志
  const nextTag = `v${nextVersion}`;
  await resolveUpdateLog(nextTag);

  const buildFileContent = await fs.readFile(path.resolve(rootDir, "build.gradle.kts"), "utf8");
  await fs.writeFile(
    path.resolve(rootDir, "build.gradle.kts"),
    buildFileContent.replace(`version = "${oldVersion}"`, `version = "${nextVersion}"`)
  );

  const cliBuildContent = await fs.readFile(path.resolve(rootDir, "cli.gradle"), "utf8");
  await fs.writeFile(
    path.resolve(rootDir, "cli.gradle"),
    cliBuildContent.replace(`version = '${oldVersion}'`, `version = '${nextVersion}'`)
  );

  await fs.writeFile(
    path.resolve(rootDir, "web/package.json"),
    JSON.stringify(packageJson, undefined, 2)
  );
  await fs.writeFile(
    path.resolve(rootDir, "tauri/src-tauri/tauri.conf.json"),
    JSON.stringify(tauriJson, undefined, 2)
  );
  await fs.writeFile(
    path.resolve(rootDir, "tauri/package.json"),
    JSON.stringify(tauriPackageJson, undefined, 2)
  );

  execSync(`cd ${rootDir};git add ./web/package.json`);
  execSync(`cd ${rootDir};git add ./tauri/package.json`);
  execSync(`cd ${rootDir};git add ./tauri/src-tauri/tauri.conf.json`);
  execSync(`cd ${rootDir};git add ./build.gradle.kts`);
  execSync(`cd ${rootDir};git add ./cli.gradle`);
  // execSync(`cd ${rootDir};git commit -m "v${nextVersion}"`);
  // execSync(`cd ${rootDir};git tag -a v${nextVersion} -m "v${nextVersion}"`);
  // execSync(`cd ${rootDir};git push`);
  // execSync(`cd ${rootDir};git push origin v${nextVersion}`);
  console.log(`Publish Successfully...`);
}

resolvePublish();
