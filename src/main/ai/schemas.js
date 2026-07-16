"use strict";

// Domain profiles span generic IT through Web3. AI proposes one; the user can override.
const PROFILES = [
  "Unclassified",
  "Generic IT system",
  "Web application / SaaS",
  "Cloud / infrastructure",
  "Mobile application",
  "Enterprise network",
  "Data pipeline / ML system",
  "IoT / embedded",
  "ICS / OT",
  "DeFi protocol",
  "Layer 1 blockchain",
  "Layer 2 / rollup",
  "Bridge / cross-chain system",
  "DAO / governance system",
  "Oracle / keeper network",
  "Wallet / custody system",
  "Appchain / module",
  "Other"
];

const STRIDE_CATEGORIES = [
  "Spoofing",
  "Tampering",
  "Repudiation",
  "Information disclosure",
  "Denial of service",
  "Elevation of privilege"
];

const item = (props, req) => ({ type: "object", additionalProperties: false, required: req, properties: props });
const str = { type: "string" };
const strArray = { type: "array", items: { type: "string" } };

function classificationSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["profile", "confidence", "rationale", "evidence", "coordinationRelevant", "warnings"],
    properties: {
      profile: { type: "string", enum: PROFILES },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      rationale: str,
      evidence: strArray,
      coordinationRelevant: { type: "boolean" },
      warnings: strArray
    }
  };
}

function traceModelSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["protectedAssets", "threatActors", "roles", "invariants", "components", "trustBoundaries", "valueFlows", "openQuestions"],
    properties: {
      protectedAssets: { type: "array", items: item({ name: str, location: str, access: str, impact: str }, ["name", "location", "access", "impact"]) },
      threatActors: { type: "array", items: item({ name: str, capability: str, targets: str, coordinationPotential: str }, ["name", "capability", "targets", "coordinationPotential"]) },
      roles: { type: "array", items: item({ role: str, holder: str, powers: str, constraints: str }, ["role", "holder", "powers", "constraints"]) },
      invariants: { type: "array", items: item({ name: str, type: str, statement: str, consequence: str }, ["name", "type", "statement", "consequence"]) },
      components: { type: "array", items: item({ name: str, kind: str, trust: str, privileges: str, dependencies: str }, ["name", "kind", "trust", "privileges", "dependencies"]) },
      trustBoundaries: { type: "array", items: item({ name: str, from: str, to: str, risk: str }, ["name", "from", "to", "risk"]) },
      valueFlows: { type: "array", items: item({ name: str, flow: str, assets: str }, ["name", "flow", "assets"]) },
      openQuestions: strArray
    }
  };
}

function strideSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["threats", "warnings"],
    properties: {
      threats: {
        type: "array",
        items: item(
          {
            surface: str,
            category: { type: "string", enum: STRIDE_CATEGORIES },
            title: str,
            scenario: str,
            likelihood: { type: "string", enum: ["N/A", "Low", "Medium", "High"] },
            impact: { type: "string", enum: ["N/A", "Informational", "Low", "Medium", "High", "Critical"] },
            risk: { type: "string", enum: ["N/A", "Informational", "Low", "Medium", "High", "Critical"] },
            mitigations: str,
            tags: strArray,
            isApplicable: { type: "boolean" }
          },
          ["surface", "category", "title", "scenario", "likelihood", "impact", "risk", "mitigations", "tags", "isApplicable"]
        )
      },
      warnings: strArray
    }
  };
}

function attackTreeSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["name", "nodes"],
    properties: {
      name: str,
      nodes: {
        type: "array",
        items: item({ id: str, parentId: str, label: str, linkedThreatIds: strArray }, ["id", "parentId", "label", "linkedThreatIds"])
      }
    }
  };
}

function coordinationSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["scenarios", "notes"],
    properties: {
      scenarios: {
        type: "array",
        items: item(
          { actors: str, asset: str, coalition: str, incentive: str, consequence: str, mitigation: str },
          ["actors", "asset", "coalition", "incentive", "consequence", "mitigation"]
        )
      },
      notes: str
    }
  };
}

function scopeFilterSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["include", "note"],
    properties: { include: strArray, note: str }
  };
}

function reportSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["markdown"],
    properties: { markdown: str }
  };
}

module.exports = {
  PROFILES,
  STRIDE_CATEGORIES,
  classificationSchema,
  traceModelSchema,
  strideSchema,
  attackTreeSchema,
  coordinationSchema,
  scopeFilterSchema,
  reportSchema
};
