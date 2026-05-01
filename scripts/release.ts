import { spawnSync } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"

type ReleaseType =
  | "major"
  | "minor"
  | "patch"
  | "fix"
  | "premajor"
  | "preminor"
  | "prepatch"
  | "prerelease"

type Options = {
  dryRun: boolean
  allowDirty: boolean
  skipChecks: boolean
  noPush: boolean
  preid: string
  sourceBranch: string
  targetBranch: string
}

type PackageJson = {
  name: string
  version: string
  [key: string]: unknown
}

const releaseTypes = new Set<ReleaseType>([
  "major",
  "minor",
  "patch",
  "fix",
  "premajor",
  "preminor",
  "prepatch",
  "prerelease",
])

const args = process.argv.slice(2)

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

async function main(): Promise<void> {
  const { releaseType, options } = parseArgs(args)
  const originalBranch = getCurrentBranch()

  if (!options.allowDirty) {
    assertCleanWorkingTree()
  }

  if (options.sourceBranch === options.targetBranch) {
    throw new Error("Source and target branches must be different.")
  }

  if (!options.dryRun) {
    checkoutBranch(options.sourceBranch)
    pullBranch(options.sourceBranch)
  }

  if (!options.skipChecks) {
    run("bun", ["run", "lint"])
    run("bun", ["run", "typecheck"])
    run("bun", ["run", "test"])
  }

  const packageJson = await readPackageJson()
  const previousVersion = packageJson.version
  const nextVersion = bumpVersion(previousVersion, releaseType, options.preid)
  packageJson.version = nextVersion

  await writeFile("package.json", `${JSON.stringify(packageJson, null, 2)}\n`, "utf8")
  console.log(`${packageJson.name}: ${previousVersion} -> ${nextVersion}`)

  try {
    run("bun", ["run", "build"])
  } catch (error) {
    packageJson.version = previousVersion
    await writeFile("package.json", `${JSON.stringify(packageJson, null, 2)}\n`, "utf8")
    console.error(`Restored package version to ${previousVersion}.`)
    throw error
  }

  if (options.dryRun) {
    packageJson.version = previousVersion
    await writeFile("package.json", `${JSON.stringify(packageJson, null, 2)}\n`, "utf8")
    console.log("Dry run complete. Restored package.json.")
    return
  }

  run("git", ["add", "package.json"])
  run("git", ["commit", "-m", `Release v${nextVersion}`])

  if (!options.noPush) {
    run("git", ["push", "origin", options.sourceBranch])
  }

  checkoutBranch(options.targetBranch)
  pullBranch(options.targetBranch)
  run("git", [
    "merge",
    "--no-ff",
    options.sourceBranch,
    "-m",
    `Merge ${options.sourceBranch} into ${options.targetBranch} for v${nextVersion}`,
  ])

  if (!options.noPush) {
    run("git", ["push", "origin", options.targetBranch])
    console.log(`Pushed ${options.targetBranch}. GitHub Actions will publish v${nextVersion}.`)
  } else {
    console.log(
      `Merged locally into ${options.targetBranch}. Push it to trigger the release workflow.`,
    )
  }

  if (originalBranch !== options.targetBranch) {
    console.log(`Release finished on ${options.targetBranch}; started on ${originalBranch}.`)
  }
}

function parseArgs(argv: string[]): { releaseType: Exclude<ReleaseType, "fix">; options: Options } {
  const [rawReleaseType, ...rawOptions] = argv

  if (!rawReleaseType || rawReleaseType === "-h" || rawReleaseType === "--help") {
    printHelp()
    process.exit(rawReleaseType ? 0 : 1)
  }

  if (!releaseTypes.has(rawReleaseType as ReleaseType)) {
    throw new Error(`Unknown release type: ${rawReleaseType}`)
  }

  const options: Options = {
    dryRun: false,
    allowDirty: false,
    skipChecks: false,
    noPush: false,
    preid: "next",
    sourceBranch: "dev",
    targetBranch: "main",
  }

  for (let index = 0; index < rawOptions.length; index += 1) {
    const option = rawOptions[index]

    if (option === "--dry-run") {
      options.dryRun = true
      continue
    }

    if (option === "--allow-dirty") {
      options.allowDirty = true
      continue
    }

    if (option === "--skip-checks") {
      options.skipChecks = true
      continue
    }

    if (option === "--no-push") {
      options.noPush = true
      continue
    }

    if (option === "--preid") {
      options.preid = readOptionValue(rawOptions, index, option)
      index += 1
      continue
    }

    if (option === "--source-branch") {
      options.sourceBranch = readOptionValue(rawOptions, index, option)
      index += 1
      continue
    }

    if (option === "--target-branch") {
      options.targetBranch = readOptionValue(rawOptions, index, option)
      index += 1
      continue
    }

    throw new Error(`Unknown option: ${option}`)
  }

  const releaseType = rawReleaseType === "fix" ? "patch" : rawReleaseType

  return {
    releaseType: releaseType as Exclude<ReleaseType, "fix">,
    options,
  }
}

function readOptionValue(options: string[], index: number, name: string): string {
  const value = options[index + 1]
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

async function readPackageJson(): Promise<PackageJson> {
  return JSON.parse(await readFile("package.json", "utf8")) as PackageJson
}

function bumpVersion(
  version: string,
  releaseType: Exclude<ReleaseType, "fix">,
  preid: string,
): string {
  const parsed = parseVersion(version)

  if (releaseType === "major") {
    return `${parsed.major + 1}.0.0`
  }

  if (releaseType === "minor") {
    return `${parsed.major}.${parsed.minor + 1}.0`
  }

  if (releaseType === "patch") {
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
  }

  if (releaseType === "premajor") {
    return `${parsed.major + 1}.0.0-${preid}.0`
  }

  if (releaseType === "preminor") {
    return `${parsed.major}.${parsed.minor + 1}.0-${preid}.0`
  }

  if (releaseType === "prepatch") {
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}-${preid}.0`
  }

  if (!parsed.prerelease) {
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}-${preid}.0`
  }

  const prereleaseParts = parsed.prerelease.split(".")
  const lastPart = prereleaseParts.at(-1)
  const nextNumber = lastPart && /^\d+$/.test(lastPart) ? Number(lastPart) + 1 : 0
  const nextPrerelease =
    lastPart && /^\d+$/.test(lastPart)
      ? [...prereleaseParts.slice(0, -1), String(nextNumber)].join(".")
      : `${parsed.prerelease}.${nextNumber}`

  return `${parsed.major}.${parsed.minor}.${parsed.patch}-${nextPrerelease}`
}

function parseVersion(version: string): {
  major: number
  minor: number
  patch: number
  prerelease?: string
} {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!match) {
    throw new Error(`Unsupported package version: ${version}`)
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  }
}

function assertCleanWorkingTree(): void {
  const result = spawnSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || "Could not check git status")
  }

  if (result.stdout.trim()) {
    throw new Error("Working tree is not clean. Commit changes or pass --allow-dirty.")
  }
}

function getCurrentBranch(): string {
  return readGit(["branch", "--show-current"]) || "HEAD"
}

function checkoutBranch(branch: string): void {
  if (branchExists(branch)) {
    run("git", ["checkout", branch])
    return
  }

  if (remoteBranchExists(branch)) {
    run("git", ["checkout", "-b", branch, `origin/${branch}`])
    return
  }

  throw new Error(`Branch not found: ${branch}`)
}

function pullBranch(branch: string): void {
  if (remoteBranchExists(branch)) {
    run("git", ["pull", "--ff-only", "origin", branch])
  }
}

function branchExists(branch: string): boolean {
  return gitSucceeds(["rev-parse", "--verify", `refs/heads/${branch}`])
}

function remoteBranchExists(branch: string): boolean {
  return gitSucceeds(["rev-parse", "--verify", `refs/remotes/origin/${branch}`])
}

function readGit(args: string[]): string {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || `Command failed: git ${args.join(" ")}`)
  }

  return result.stdout.trim()
}

function gitSucceeds(args: string[]): boolean {
  const result = spawnSync("git", args, {
    stdio: "ignore",
    shell: false,
  })

  return result.status === 0
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
  })

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`)
  }
}

function printHelp(): void {
  console.log(`Usage:
  bun run release <major|minor|patch|fix|premajor|preminor|prepatch|prerelease> [options]

Options:
  --dry-run          Validate the version bump and build without committing or merging.
  --preid <id>       Prerelease identifier. Defaults to next.
  --skip-checks      Skip lint, typecheck, and test.
  --allow-dirty      Allow releasing from a dirty working tree.
  --no-push          Commit and merge locally without pushing.
  --source-branch <branch>
                     Branch to release from. Defaults to dev.
  --target-branch <branch>
                     Branch that triggers publishing. Defaults to main.

Examples:
  bun run release fix
  bun run release minor
  bun run release preminor --preid beta
  bun run release patch --dry-run
`)
}
