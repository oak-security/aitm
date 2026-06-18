"use strict";

const crypto = require("node:crypto");

class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "AppError";
  }
}

function appError(code, message) {
  return new AppError(code, message);
}

function assertString(value, field, { max = 100000, allowEmpty = false } = {}) {
  if (typeof value !== "string") throw appError("bad_input", `${field} must be a string.`);
  if (!allowEmpty && !value.trim()) throw appError("bad_input", `${field} must not be empty.`);
  if (value.length > max) throw appError("bad_input", `${field} is too long.`);
  return value;
}

function assertArray(value, field, { max = 10000 } = {}) {
  if (!Array.isArray(value)) throw appError("bad_input", `${field} must be an array.`);
  if (value.length > max) throw appError("bad_input", `${field} has too many entries.`);
  return value;
}

function assertObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw appError("bad_input", `${field} must be an object.`);
  }
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function uuid() {
  return crypto.randomUUID();
}

module.exports = { AppError, appError, assertString, assertArray, assertObject, sha256, uuid };
