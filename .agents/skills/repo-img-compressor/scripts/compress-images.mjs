#!/usr/bin/env node

import { access, lstat, realpath, rename, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const QUALITY = 90;
const EFFORT = 6;
const SUPPORTED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function printUsage() {
	process.stdout.write(`Usage:
  node compress-images.mjs [--root <repo-root>] [--dry-run] [--force] [--allow-larger] [--allow-untracked] [--preview] <image> [...]

Options:
  --root <path>      Repository root. Defaults to the current directory.
  --dry-run          Validate inputs and print source-to-output mappings only.
  --force            Overwrite an existing destination WebP.
  --allow-larger     Keep a quality-90 result even when it is not smaller.
  --allow-untracked  Permit explicitly named, non-ignored untracked docs images.
  --preview          Write <name>.preview.webp and keep the source unchanged.
  -h, --help         Show this help.
`);
}

function parseArgs(argv) {
	let root = process.cwd();
	let dryRun = false;
	let force = false;
	let allowLarger = false;
	let allowUntracked = false;
	let preview = false;
	const inputs = [];

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];

		if (argument === "--root") {
			const value = argv[index + 1];
			if (!value) throw new Error("--root requires a path.");
			root = value;
			index += 1;
		} else if (argument.startsWith("--root=")) {
			root = argument.slice("--root=".length);
		} else if (argument === "--dry-run") {
			dryRun = true;
		} else if (argument === "--force") {
			force = true;
		} else if (argument === "--allow-larger") {
			allowLarger = true;
		} else if (argument === "--allow-untracked") {
			allowUntracked = true;
		} else if (argument === "--preview") {
			preview = true;
		} else if (argument === "-h" || argument === "--help") {
			return {
				help: true,
				root,
				dryRun,
				force,
				allowLarger,
				allowUntracked,
				preview,
				inputs,
			};
		} else if (argument.startsWith("-")) {
			throw new Error(`Unknown option: ${argument}`);
		} else {
			inputs.push(argument);
		}
	}

	if (inputs.length === 0) throw new Error("Provide at least one image.");
	return {
		help: false,
		root,
		dryRun,
		force,
		allowLarger,
		allowUntracked,
		preview,
		inputs,
	};
}

function isWithin(parent, child) {
	const relative = path.relative(parent, child);
	return (
		relative !== "" &&
		!relative.startsWith(`..${path.sep}`) &&
		relative !== ".." &&
		!path.isAbsolute(relative)
	);
}

function toPosix(value) {
	return value.split(path.sep).join("/");
}

async function exists(file) {
	try {
		await access(file);
		return true;
	} catch {
		return false;
	}
}

function resolveSharp(repoRoot) {
	try {
		return createRequire(path.join(repoRoot, "package.json")).resolve("sharp");
	} catch (error) {
		if (error?.code !== "MODULE_NOT_FOUND") throw error;
		throw new Error(
			"sharp is unavailable. Run npm install from the SubTandem repository root to restore locked development dependencies.",
		);
	}
}

async function runGit(repoRoot, arguments_) {
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const { stdout } = await promisify(execFile)("git", arguments_, {
		cwd: repoRoot,
		encoding: "utf8",
	});
	return stdout;
}

async function validateGitScope(repoRoot, sourceRelative, allowUntracked) {
	try {
		await runGit(repoRoot, ["check-ignore", "--quiet", "--", sourceRelative]);
		throw new Error(`Input is ignored by Git: ${sourceRelative}`);
	} catch (error) {
		if (error?.code !== 1) throw error;
	}

	try {
		await runGit(repoRoot, ["ls-files", "--error-unmatch", "--", sourceRelative]);
		return;
	} catch (error) {
		if (error?.code !== 1) throw error;
	}

	if (!allowUntracked) {
		throw new Error(
			`Input is not tracked by Git: ${sourceRelative}. Use --allow-untracked only for an explicitly requested new docs image.`,
		);
	}
}

async function buildPlan(input, context) {
	const requestedPath = path.resolve(context.repoRoot, input);
	const requestedStat = await lstat(requestedPath);
	if (!requestedStat.isFile() || requestedStat.isSymbolicLink()) {
		throw new Error(
			`Input must be a regular file, not a directory or symlink: ${input}`,
		);
	}

	const source = await realpath(requestedPath);
	if (!isWithin(context.docsRoot, source)) {
		throw new Error(`Input must be inside docs: ${input}`);
	}

	const extension = path.extname(source).toLowerCase();
	if (!SUPPORTED_EXTENSIONS.has(extension)) {
		throw new Error(
			`Unsupported image type ${extension || "(none)"}: ${input}`,
		);
	}

	const sourceRelative = toPosix(path.relative(context.repoRoot, source));

	const metadata = await context.sharp(source).metadata();
	if ((metadata.pages ?? 1) > 1) {
		throw new Error(`Animated images are not supported: ${input}`);
	}
	if (!metadata.width || !metadata.height) {
		throw new Error(`Could not determine image dimensions: ${input}`);
	}

	const output = context.preview
		? path.join(
				path.dirname(source),
				`${path.basename(source, extension)}.preview.webp`,
			)
		: extension === ".webp"
			? source
			: path.join(
					path.dirname(source),
					`${path.basename(source, extension)}.webp`,
				);
	const sourceInfo = await stat(source);
	const oriented = metadata.autoOrient ?? {
		width: metadata.width,
		height: metadata.height,
	};

	return {
		source,
		output,
		sourceRelative,
		outputRelative: toPosix(path.relative(context.repoRoot, output)),
		sourceBytes: sourceInfo.size,
		width: oriented.width,
		height: oriented.height,
	};
}

function ensureUniqueOutputs(plans) {
	const seen = new Map();
	for (const plan of plans) {
		const previous = seen.get(plan.output);
		if (previous) {
			throw new Error(
				`Multiple inputs map to the same output: ${previous.sourceRelative} and ${plan.sourceRelative}`,
			);
		}
		seen.set(plan.output, plan);
	}
}

async function validateCollisions(plans, force) {
	for (const plan of plans) {
		if (plan.output !== plan.source && (await exists(plan.output)) && !force) {
			throw new Error(
				`Destination already exists: ${plan.outputRelative}. Use --force only after confirming replacement.`,
			);
		}
	}
}

async function compress(plan, context) {
	const temporary = path.join(
		path.dirname(plan.output),
		`.${path.basename(plan.output)}.${process.pid}.${Date.now()}.tmp.webp`,
	);

	try {
		await context
			.sharp(plan.source, { failOn: "warning" })
			.rotate()
			.webp({
				quality: QUALITY,
				alphaQuality: 100,
				effort: EFFORT,
				smartSubsample: true,
			})
			.toFile(temporary);

		const outputMetadata = await context.sharp(temporary).metadata();
		const outputInfo = await stat(temporary);
		if (
			outputMetadata.format !== "webp" ||
			outputMetadata.width !== plan.width ||
			outputMetadata.height !== plan.height ||
			outputInfo.size === 0
		) {
			throw new Error(`Output validation failed: ${plan.outputRelative}`);
		}

		const savingPercent =
			Math.round((1 - outputInfo.size / plan.sourceBytes) * 10000) / 100;
		if (outputInfo.size >= plan.sourceBytes && !context.allowLarger) {
			await rm(temporary, { force: true });
			return {
				status: "skipped-not-smaller",
				source: plan.sourceRelative,
				output: plan.outputRelative,
				width: outputMetadata.width,
				height: outputMetadata.height,
				sourceBytes: plan.sourceBytes,
				candidateBytes: outputInfo.size,
				savingPercent,
				sourceKept: true,
			};
		}

		await rename(temporary, plan.output);
		return {
			status: context.preview ? "previewed" : "compressed",
			source: plan.sourceRelative,
			output: plan.outputRelative,
			width: outputMetadata.width,
			height: outputMetadata.height,
			sourceBytes: plan.sourceBytes,
			outputBytes: outputInfo.size,
			savingPercent,
			sourceKept: context.preview || plan.source !== plan.output,
		};
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		printUsage();
		return;
	}

	const repoRoot = await realpath(path.resolve(options.root));
	const docsRoot = await realpath(path.join(repoRoot, "docs"));
	const context = {
		repoRoot,
		docsRoot,
		sharp: null,
		allowLarger: options.allowLarger,
		preview: options.preview,
	};
	const scopedSources = [];

	for (const input of options.inputs) {
		const requestedPath = path.resolve(repoRoot, input);
		const requestedStat = await lstat(requestedPath);
		if (!requestedStat.isFile() || requestedStat.isSymbolicLink()) {
			throw new Error(
				`Input must be a regular file, not a directory or symlink: ${input}`,
			);
		}
		const source = await realpath(requestedPath);
		if (!isWithin(docsRoot, source)) {
			throw new Error(`Input must be inside docs: ${input}`);
		}
		const sourceRelative = toPosix(path.relative(repoRoot, source));
		await validateGitScope(repoRoot, sourceRelative, options.allowUntracked);
		scopedSources.push(source);
	}

	context.sharp = (await import(resolveSharp(repoRoot))).default;
	const plans = [];

	for (const input of scopedSources) {
		plans.push(await buildPlan(input, context));
	}

	ensureUniqueOutputs(plans);
	await validateCollisions(plans, options.force);

	if (options.dryRun) {
		process.stdout.write(
			`${JSON.stringify(
				{
					quality: QUALITY,
					dryRun: true,
					preview: options.preview,
					results: plans.map((plan) => ({
						source: plan.sourceRelative,
						output: plan.outputRelative,
						width: plan.width,
						height: plan.height,
						sourceBytes: plan.sourceBytes,
					})),
				},
				null,
				2,
			)}\n`,
		);
		return;
	}

	const results = [];
	for (const plan of plans) {
		results.push(await compress(plan, context));
	}

	process.stdout.write(
		`${JSON.stringify(
			{
				quality: QUALITY,
				dryRun: false,
				preview: options.preview,
				results,
			},
			null,
			2,
		)}\n`,
	);
}

main().catch((error) => {
	process.stderr.write(`repo-img-compressor: ${error.message}\n`);
	process.exitCode = 1;
});
