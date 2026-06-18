"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { appError, assertString, assertObject } = require("../util");
const { createProject, normalize, nowIso } = require("./schema");

function dir() {
  const d = path.join(app.getPath("userData"), "projects");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function pointerFile() {
  return path.join(app.getPath("userData"), "active-project.json");
}

function isValidId(id) {
  // ids are UUIDs we mint; never trust renderer-supplied paths.
  return typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id);
}

function fileFor(id) {
  if (!isValidId(id)) throw appError("bad_id", "Invalid project id.");
  return path.join(dir(), `${id}.json`);
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readProject(id) {
  const file = fileFor(id);
  if (!fs.existsSync(file)) throw appError("not_found", "Project not found.");
  return normalize(JSON.parse(fs.readFileSync(file, "utf8")));
}

function persist(project) {
  const normalized = normalize(project);
  normalized.project.updatedAt = nowIso();
  writeAtomic(fileFor(normalized.project.id), JSON.stringify(normalized, null, 2));
  return normalized;
}

function list() {
  return fs
    .readdirSync(dir())
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const p = normalize(JSON.parse(fs.readFileSync(path.join(dir(), f), "utf8")));
        return {
          id: p.project.id,
          name: p.project.name,
          status: p.project.status,
          profile: p.classification.profile,
          updatedAt: p.project.updatedAt
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function get(id) {
  return readProject(id);
}

function create(input) {
  const name = input && typeof input.name === "string" ? input.name : undefined;
  const project = persist(createProject(name));
  setActive(project.project.id);
  return project;
}

function update(id, patch) {
  assertObject(patch, "patch");
  const current = readProject(id);
  // Shallow-merge top-level sections; renderer owns the full section objects.
  const merged = { ...current, ...patch, project: { ...current.project, ...(patch.project || {}) } };
  merged.project.id = current.project.id; // id is immutable
  return persist(merged);
}

function remove(id) {
  fs.rmSync(fileFor(id), { force: true });
  if (getActive() === id) setActive("");
  return { ok: true };
}

function setActive(id) {
  if (id && !isValidId(id)) throw appError("bad_id", "Invalid project id.");
  writeAtomic(pointerFile(), JSON.stringify({ id: id || null }));
  return { id: id || null };
}

function getActive() {
  try {
    const { id } = JSON.parse(fs.readFileSync(pointerFile(), "utf8"));
    if (id && fs.existsSync(fileFor(id))) return id;
  } catch {
    /* none */
  }
  return null;
}

function exportProject(id) {
  return JSON.stringify(readProject(id), null, 2);
}

function importProject(json) {
  assertString(json, "import payload", { max: 32 * 1024 * 1024 });
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw appError("bad_import", "Import file is not valid JSON.");
  }
  const project = normalize(parsed);
  // Re-id on collision so importing never clobbers an existing project.
  if (fs.existsSync(fileFor(project.project.id))) {
    const { uuid } = require("../util");
    project.project.id = uuid();
    project.project.name = `${project.project.name} (imported)`;
  }
  const saved = persist(project);
  setActive(saved.project.id);
  return saved;
}

module.exports = {
  list, get, create, update, remove, setActive, getActive,
  exportProject, importProject, persist, readProject
};
