"use strict";

const { appError } = require("../util");
const openai = require("./openai-responses");
const anthropic = require("./anthropic");

const ADAPTERS = { openai, anthropic };

function getAdapter(providerId) {
  const adapter = ADAPTERS[providerId || "openai"];
  if (!adapter) throw appError("unknown_provider", `Unknown AI provider: ${providerId}`);
  return adapter;
}

module.exports = { getAdapter, ADAPTERS };
