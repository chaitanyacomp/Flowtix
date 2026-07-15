/**
 * Parse Prisma schema.prisma for model / Restrict-FK dependency discovery.
 * Uses the schema file (source of truth) so validation works even if the
 * generated client is stale relative to migrations.
 */

const fs = require("fs");
const path = require("path");

/**
 * @typedef {object} ParsedRelation
 * @property {string} fromModel
 * @property {string} fieldName
 * @property {string} toModel
 * @property {string[]} fromFields
 * @property {string} onDelete
 * @property {boolean} isList
 */

/**
 * @param {string} schemaText
 * @returns {{ models: string[]; relations: ParsedRelation[] }}
 */
function parsePrismaSchemaModels(schemaText) {
  const models = [];
  /** @type {ParsedRelation[]} */
  const relations = [];

  const modelHeaderRe = /\bmodel\s+(\w+)\s*\{/g;
  let match;
  while ((match = modelHeaderRe.exec(schemaText)) !== null) {
    const modelName = match[1];
    const bodyStart = match.index + match[0].length;
    let depth = 1;
    let j = bodyStart;
    while (j < schemaText.length && depth > 0) {
      const ch = schemaText[j];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      j += 1;
    }
    const body = schemaText.slice(bodyStart, j - 1);
    models.push(modelName);

    for (const rawLine of body.split("\n")) {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;
      if (!trimmed.includes("@relation")) continue;

      const fieldMatch = trimmed.match(/^(\w+)\s+(\w+)(\??|\[\])?/);
      if (!fieldMatch) continue;
      const fieldName = fieldMatch[1];
      const toModel = fieldMatch[2];
      const isList = Boolean(fieldMatch[3] && fieldMatch[3].includes("["));

      const fieldsMatch = trimmed.match(/fields:\s*\[([^\]]*)\]/);
      const fromFields = fieldsMatch
        ? fieldsMatch[1]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      // Only FK-owning side (has fields:) participates in cleanup ordering.
      if (!fromFields.length) continue;

      let onDelete = "Restrict";
      const onDeleteMatch = trimmed.match(/onDelete:\s*(\w+)/);
      if (onDeleteMatch) onDelete = onDeleteMatch[1];

      relations.push({
        fromModel: modelName,
        fieldName,
        toModel,
        fromFields,
        onDelete,
        isList,
      });
    }

    modelHeaderRe.lastIndex = j;
  }

  return { models: [...new Set(models)], relations };
}

function defaultSchemaPath() {
  return path.join(__dirname, "../../../prisma/schema.prisma");
}

/**
 * @param {string} [schemaPath]
 */
function loadPrismaSchemaGraph(schemaPath = defaultSchemaPath()) {
  const schemaText = fs.readFileSync(schemaPath, "utf8");
  return parsePrismaSchemaModels(schemaText);
}

/**
 * Restrict (and NoAction) FKs that block parent delete.
 * @param {ParsedRelation[]} relations
 */
function getBlockingRelations(relations) {
  return relations.filter((r) => r.onDelete === "Restrict" || r.onDelete === "NoAction");
}

module.exports = {
  parsePrismaSchemaModels,
  loadPrismaSchemaGraph,
  getBlockingRelations,
  defaultSchemaPath,
};
