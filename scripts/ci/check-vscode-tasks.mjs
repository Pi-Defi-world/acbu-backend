import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PLATFORM_OVERRIDES = ["windows", "linux", "osx"];

function stripJsonComments(source) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
    } else if (character === "/" && nextCharacter === "/") {
      result += "  ";
      index += 1;
      while (
        index + 1 < source.length &&
        source[index + 1] !== "\n" &&
        source[index + 1] !== "\r"
      ) {
        result += " ";
        index += 1;
      }
    } else if (character === "/" && nextCharacter === "*") {
      result += "  ";
      index += 1;
      let commentClosed = false;
      while (index + 1 < source.length) {
        index += 1;
        if (source[index] === "*" && source[index + 1] === "/") {
          result += "  ";
          index += 1;
          commentClosed = true;
          break;
        }
        result += source[index] === "\n" ? "\n" : " ";
      }
      if (!commentClosed) {
        throw new SyntaxError("Unterminated block comment");
      }
    } else {
      result += character;
    }
  }

  return result;
}

function stripTrailingCommas(source) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }

    if (character === ",") {
      let nextIndex = index + 1;
      while (nextIndex < source.length && /\s/.test(source[nextIndex])) {
        nextIndex += 1;
      }
      if (source[nextIndex] === "}" || source[nextIndex] === "]") {
        continue;
      }
    }

    result += character;
  }

  return result;
}

export function parseJsonc(source) {
  try {
    const withoutBom = source.replace(/^\uFEFF/, "");
    return JSON.parse(stripTrailingCommas(stripJsonComments(withoutBom)));
  } catch (error) {
    throw new SyntaxError(`Invalid JSONC: ${error.message}`, { cause: error });
  }
}

function hasFolderOpenRunOn(configuration) {
  const runOn = configuration?.runOptions?.runOn;
  return typeof runOn === "string" && runOn.trim().toLowerCase() === "folderopen";
}

function displayRunOn(configuration) {
  return configuration.runOptions.runOn;
}

function taskLabel(task, index) {
  if (typeof task.label === "string" && task.label.trim()) {
    return task.label;
  }
  if (typeof task.taskName === "string" && task.taskName.trim()) {
    return task.taskName;
  }
  return `<task ${index + 1}>`;
}

function addRunOnFindings(configuration, label, file, findings) {
  if (hasFolderOpenRunOn(configuration)) {
    findings.push({
      file,
      taskLabel: label,
      runOn: displayRunOn(configuration),
      message: `Task "${label}" sets runOptions.runOn to "${displayRunOn(configuration)}"; folderOpen auto-run is not allowed`,
    });
  }

  for (const platform of PLATFORM_OVERRIDES) {
    const override = configuration?.[platform];
    if (hasFolderOpenRunOn(override)) {
      findings.push({
        file,
        taskLabel: `${label} (${platform})`,
        runOn: displayRunOn(override),
        message: `Task "${label}" ${platform} override sets runOptions.runOn to "${displayRunOn(override)}"; folderOpen auto-run is not allowed`,
      });
    }
  }
}

function inspectTasksFile(file) {
  const relativeFile = file.path;
  let configuration;
  try {
    configuration = parseJsonc(fs.readFileSync(file.absolutePath, "utf8"));
  } catch (error) {
    return [
      {
        file: relativeFile,
        taskLabel: "<unparsed>",
        message: `Unable to parse tasks.json; failing closed: ${error.message}`,
      },
    ];
  }

  if (configuration === null || typeof configuration !== "object" || Array.isArray(configuration)) {
    return [
      {
        file: relativeFile,
        taskLabel: "<top-level>",
        message: "Invalid tasks.json structure; expected a JSON object",
      },
    ];
  }

  const findings = [];
  addRunOnFindings(configuration, "<top-level>", relativeFile, findings);

  if (configuration.tasks !== undefined && !Array.isArray(configuration.tasks)) {
    findings.push({
      file: relativeFile,
      taskLabel: "<top-level>",
      message: 'Invalid tasks.json structure; "tasks" must be an array',
    });
    return findings;
  }

  for (const [index, task] of (configuration.tasks ?? []).entries()) {
    const label =
      task !== null && typeof task === "object" ? taskLabel(task, index) : `<task ${index + 1}>`;
    if (task === null || typeof task !== "object" || Array.isArray(task)) {
      findings.push({
        file: relativeFile,
        taskLabel: label,
        message: `Invalid tasks.json structure; ${label} must be an object`,
      });
      continue;
    }
    addRunOnFindings(task, label, relativeFile, findings);
  }

  return findings;
}

function findTasksFiles(rootDir) {
  const files = [];
  const root = path.resolve(rootDir);

  function walk(directory, insideVSCode) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git") {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink() && entry.name === ".vscode") {
        throw new Error(`Refusing to follow symbolic-link .vscode directory: ${path.relative(root, absolutePath)}`);
      }
      if (entry.isDirectory()) {
        walk(absolutePath, insideVSCode || entry.name === ".vscode");
      } else if (insideVSCode && entry.name === "tasks.json") {
        files.push({
          absolutePath,
          path: path.relative(root, absolutePath).split(path.sep).join("/"),
        });
      }
    }
  }

  walk(root, false);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function scanVscodeTasks(rootDir = process.cwd()) {
  return findTasksFiles(rootDir).flatMap(inspectTasksFile);
}

function escapeAnnotationProperty(value) {
  return String(value)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");
}

function escapeAnnotationData(value) {
  return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function reportFinding(finding) {
  const detail = `${finding.file}: ${finding.message}`;
  console.error(detail);
  console.log(
    `::error file=${escapeAnnotationProperty(finding.file)}::${escapeAnnotationData(finding.message)}`,
  );
}

function main() {
  const rootDir = process.argv[2] ?? process.cwd();
  let findings;
  try {
    findings = scanVscodeTasks(rootDir);
  } catch (error) {
    const message = `Unable to scan repository for VS Code tasks: ${error.message}`;
    console.error(message);
    console.log(`::error::${escapeAnnotationData(message)}`);
    process.exitCode = 1;
    return;
  }

  for (const finding of findings) {
    reportFinding(finding);
  }

  if (findings.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log("No VS Code tasks.json files configure folderOpen auto-run.");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
