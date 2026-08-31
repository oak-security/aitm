"use strict";

const { app } = require("electron");
const { createEngine } = require("@oak-security/aitm-engine");
const keyStore = require("./keystore");
const { emitStream } = require("./stream");

let runtime;

function getRuntime() {
  if (!runtime) {
    runtime = createEngine({
      dataDir: app.getPath("userData"),
      keyStore,
      onEvent: emitStream
    });
  }
  return runtime;
}

module.exports = { getRuntime };
