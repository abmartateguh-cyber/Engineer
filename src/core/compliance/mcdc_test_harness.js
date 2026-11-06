'use strict';

/**
 * MC/DC (Modified Condition/Decision Coverage) test-vector generator and
 * verification gate.
 *
 * Implements the unique-cause interpretation of MC/DC (the standard DO-178C
 * reading): for every condition occurrence in a decision, the generator
 * searches for a pair of test vectors that differ only in that condition's
 * outcome and for which the decision outcome flips. Duplicated conditions
 * (e.g. `A && A`) cannot satisfy independent influence, so they are reported
 * honestly as unreachable.
 *
 * The boolean parser supports `&&`, `||`, `!`, parentheses, and atomic
 * conditions (identifiers, including compound atoms such as `P > Pset`).
 * A safety-relevant decision extractor accepts a JS function-body string or a
 * pre-defined object of named boolean expressions (e.g. PSV relief-valve
 * logic) and reduces it to an expression tree.
 */

const EXHAUSTIVE_COMBO_LIMIT = 2000000;
const MAX_CONDITIONS = 16;

const FORMAT_TRUE = 'T';
const FORMAT_FALSE = 'F';

function formatBool(value) {
  return value ? FORMAT_TRUE : FORMAT_FALSE;
}

function formatVector(inputs, decision) {
  return '(' + inputs.map(formatBool).join(',') + ')->' + formatBool(decision);
}

function isDelimiterAt(text, index) {
  const ch = text[index];
  if (ch === '(' || ch === ')') return true;
  if (ch === '&' && text[index + 1] === '&') return true;
  if (ch === '|' && text[index + 1] === '|') return true;
  if (ch === '!' && text[index + 1] !== '=') return true;
  return false;
}

function tokenize(expression) {
  if (typeof expression !== 'string') {
    throw new Error('Boolean expression must be a string');
  }
  const tokens = [];
  const n = expression.length;
  let i = 0;
  while (i < n) {
    const ch = expression[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch });
      i++;
      continue;
    }
    if (ch === '!' && expression[i + 1] !== '=') {
      tokens.push({ type: 'not' });
      i++;
      continue;
    }
    if (ch === '&' && expression[i + 1] === '&') {
      tokens.push({ type: 'and' });
      i += 2;
      continue;
    }
    if (ch === '|' && expression[i + 1] === '|') {
      tokens.push({ type: 'or' });
      i += 2;
      continue;
    }
    let j = i;
    while (j < n && !isDelimiterAt(expression, j)) j++;
    if (j === i) {
      throw new Error('Invalid boolean expression near index ' + i);
    }
    const atom = expression.slice(i, j).trim();
    if (atom === '') {
      throw new Error('Invalid boolean expression: empty atom near index ' + i);
    }
    tokens.push({ type: 'atom', value: atom });
    i = j;
  }
  return tokens;
}

class ExpressionParser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() {
    return this.tokens[this.pos];
  }

  next() {
    return this.tokens[this.pos++];
  }

  parse() {
    const node = this.parseOr();
    if (this.pos !== this.tokens.length) {
      throw new Error('Unexpected token in boolean expression');
    }
    return node;
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.peek() && this.peek().type === 'or') {
      this.next();
      left = { type: 'or', left, right: this.parseAnd() };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseUnary();
    while (this.peek() && this.peek().type === 'and') {
      this.next();
      left = { type: 'and', left, right: this.parseUnary() };
    }
    return left;
  }

  parseUnary() {
    if (this.peek() && this.peek().type === 'not') {
      this.next();
      return { type: 'not', child: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const token = this.next();
    if (!token) {
      throw new Error('Unexpected end of boolean expression');
    }
    if (token.type === 'paren' && token.value === '(') {
      const node = this.parseOr();
      const close = this.next();
      if (!close || close.type !== 'paren' || close.value !== ')') {
        throw new Error('Missing closing parenthesis in boolean expression');
      }
      return node;
    }
    if (token.type === 'atom') {
      return { type: 'atom', name: token.value };
    }
    throw new Error('Unexpected token in boolean expression: ' + token.value);
  }
}

function parseBooleanExpression(expression) {
  const tokens = tokenize(expression);
  const parser = new ExpressionParser(tokens);
  return parser.parse();
}

function collectLeaves(node, leaves) {
  if (node.type === 'atom') {
    leaves.push(node);
    return;
  }
  if (node.type === 'not') {
    collectLeaves(node.child, leaves);
    return;
  }
  collectLeaves(node.left, leaves);
  collectLeaves(node.right, leaves);
}

function prepareAst(ast) {
  const leaves = [];
  collectLeaves(ast, leaves);
  const variableOrder = [];
  const variableIds = new Map();
  for (const leaf of leaves) {
    if (!variableIds.has(leaf.name)) {
      variableIds.set(leaf.name, variableOrder.length);
      variableOrder.push(leaf.name);
    }
    leaf.variableIndex = variableIds.get(leaf.name);
  }
  return { leaves, variableOrder };
}

function evaluate(ast, values) {
  if (ast.type === 'atom') return values[ast.variableIndex];
  if (ast.type === 'not') return !evaluate(ast.child, values);
  if (ast.type === 'and') return evaluate(ast.left, values) && evaluate(ast.right, values);
  return evaluate(ast.left, values) || evaluate(ast.right, values);
}

function buildTruthTable(ast, variableCount) {
  const rows = [];
  const total = 1 << variableCount;
  for (let k = 0; k < total; k++) {
    const inputs = [];
    for (let v = 0; v < variableCount; v++) {
      inputs.push(((k >>> v) & 1) === 1);
    }
    rows.push({ index: k, inputs, decision: evaluate(ast, inputs) });
  }
  return rows;
}

function differOnlyAt(left, right, variableIndex) {
  for (let i = 0; i < left.length; i++) {
    if (i === variableIndex) {
      if (left[i] === right[i]) return false;
    } else if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

function findPairsForCondition(rows, variableIndex, occurrenceCount) {
  if (occurrenceCount > 1) return [];
  const pairs = [];
  for (let a = 0; a < rows.length; a++) {
    for (let b = a + 1; b < rows.length; b++) {
      if (!differOnlyAt(rows[a].inputs, rows[b].inputs, variableIndex)) continue;
      if (rows[a].decision === rows[b].decision) continue;
      const from = rows[a];
      const to = rows[b];
      pairs.push({
        from,
        to,
        fromLabel: formatVector(from.inputs, from.decision),
        toLabel: formatVector(to.inputs, to.decision)
      });
    }
  }
  return pairs;
}

function selectMinimalVectorSet(pairsByCondition, rowCount) {
  const m = pairsByCondition.length;
  if (m === 0) return [];

  let combos = 1;
  let exhaustive = true;
  for (let i = 0; i < m; i++) {
    combos *= pairsByCondition[i].length;
    if (combos > EXHAUSTIVE_COMBO_LIMIT) {
      exhaustive = false;
      break;
    }
  }

  const used = new Array(rowCount).fill(false);
  const chosen = new Array(m);

  if (exhaustive) {
    let bestSize = Infinity;
    let bestChosen = null;
    const dfs = (i, usedCount) => {
      if (usedCount >= bestSize) return;
      if (i === m) {
        bestSize = usedCount;
        bestChosen = chosen.slice();
        return;
      }
      for (const pair of pairsByCondition[i]) {
        const wasFrom = used[pair.from.index];
        const wasTo = used[pair.to.index];
        used[pair.from.index] = true;
        used[pair.to.index] = true;
        chosen[i] = pair;
        dfs(i + 1, usedCount + (wasFrom ? 0 : 1) + (wasTo ? 0 : 1));
        used[pair.from.index] = wasFrom;
        used[pair.to.index] = wasTo;
      }
    };
    dfs(0, 0);
    return bestChosen;
  }

  const greedy = [];
  for (let i = 0; i < m; i++) {
    let bestPair = null;
    let bestAdd = Infinity;
    for (const pair of pairsByCondition[i]) {
      const add = (used[pair.from.index] ? 0 : 1) + (used[pair.to.index] ? 0 : 1);
      if (add < bestAdd) {
        bestAdd = add;
        bestPair = pair;
      }
    }
    greedy.push(bestPair);
    used[bestPair.from.index] = true;
    used[bestPair.to.index] = true;
  }
  return greedy;
}

function findTopLevelAssignment(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (ch === '=' && depth === 0) {
      const prev = text[i - 1];
      const next = text[i + 1];
      if (prev !== '=' && prev !== '!' && prev !== '<' && prev !== '>' && next !== '=' && next !== '>') {
        return i;
      }
    }
  }
  return -1;
}

function extractDecisionFromFunctionBody(bodyString) {
  if (typeof bodyString !== 'string') {
    throw new Error('Function body must be a string');
  }
  let text = String(bodyString);
  text = text.replace(/^\s*function\b[^{]*/, ' ');
  text = text.replace(/^\s*\([^)]*\)\s*=>/, ' ');
  text = text.replace(/[{}]/g, ' ').trim();
  text = text.replace(/;$/, '').trim();
  text = text.replace(/\breturn\s+/, ' ').trim();
  const splitIndex = findTopLevelAssignment(text);
  if (splitIndex !== -1) {
    const lhs = text.slice(0, splitIndex).trim();
    const rhs = text.slice(splitIndex + 1).trim();
    return { name: lhs || 'decision', expression: rhs };
  }
  return { name: 'decision', expression: text };
}

function prepareInput(input) {
  if (input && typeof input === 'object' && input.type) {
    return { name: input.name || 'decision', expression: input.expression || '', ast: input };
  }
  if (typeof input === 'string') {
    const extracted = extractDecisionFromFunctionBody(input);
    const ast = parseBooleanExpression(extracted.expression);
    return { name: extracted.name, expression: extracted.expression, ast };
  }
  throw new Error('Expected a boolean expression string or an AST');
}

function analyzeMcDc(input) {
  const prepared = prepareInput(input);
  const { leaves, variableOrder } = prepareAst(prepared.ast);
  const variableCount = variableOrder.length;
  if (variableCount === 0) {
    throw new Error('No conditions found in decision expression');
  }
  if (variableCount > MAX_CONDITIONS) {
    throw new Error('MC/DC analysis limited to ' + MAX_CONDITIONS + ' distinct conditions (got ' + variableCount + ')');
  }

  const rows = buildTruthTable(prepared.ast, variableCount);

  const occurrenceCounts = new Map();
  for (const leaf of leaves) {
    occurrenceCounts.set(leaf.variableIndex, (occurrenceCounts.get(leaf.variableIndex) || 0) + 1);
  }

  const conditions = leaves.map((leaf, id) => ({
    id,
    name: leaf.name,
    variableIndex: leaf.variableIndex
  }));

  const pairsByCondition = conditions.map((condition) =>
    findPairsForCondition(rows, condition.variableIndex, occurrenceCounts.get(condition.variableIndex))
  );

  const coverableIndexes = [];
  conditions.forEach((condition, i) => {
    if (pairsByCondition[i].length > 0) coverableIndexes.push(i);
  });
  const selectedSubset = selectMinimalVectorSet(
    coverableIndexes.map((i) => pairsByCondition[i]),
    rows.length
  );

  const selectedPairs = new Array(conditions.length).fill(null);
  if (selectedSubset) {
    coverableIndexes.forEach((ci, j) => {
      selectedPairs[ci] = selectedSubset[j];
    });
  }

  const conditionCoverage = conditions.map((condition, i) => {
    const pair = selectedPairs[i];
    const duplicated = occurrenceCounts.get(condition.variableIndex) > 1;
    return {
      id: condition.id,
      name: condition.name,
      variableIndex: condition.variableIndex,
      covered: pair !== null,
      unreachable: duplicated && pair === null,
      redundant: !duplicated && pair === null,
      pair
    };
  });

  const coveredConditions = conditionCoverage.filter((c) => c.covered).length;
  const totalConditions = conditions.length;
  const coveragePercent =
    totalConditions === 0 ? 0 : Math.round((coveredConditions / totalConditions) * 100 * 1e4) / 1e4;

  const vectorIndexes = [];
  for (const pair of selectedPairs) {
    if (pair) {
      vectorIndexes.push(pair.from.index, pair.to.index);
    }
  }
  const uniqueIndexes = [...new Set(vectorIndexes)].sort((a, b) => a - b);
  const testVectors = uniqueIndexes.map((k) => rows[k].inputs.slice());

  return {
    name: prepared.name,
    expression: prepared.expression,
    variables: variableOrder.slice(),
    conditions,
    truthTable: rows.map((r) => ({ inputs: r.inputs.slice(), decision: r.decision })),
    mcdc: {
      source: 'unique-cause',
      totalConditions,
      coveredConditions,
      coveragePercent,
      conditionCoverage,
      testVectors,
      vectorCount: testVectors.length
    }
  };
}

function summarize(report) {
  return (
    report.mcdc.coveragePercent +
    '% (' +
    report.mcdc.coveredConditions +
    '/' +
    report.mcdc.totalConditions +
    '), ' +
    report.mcdc.vectorCount +
    ' vectors'
  );
}

module.exports = {
  parseBooleanExpression,
  extractDecisionFromFunctionBody,
  analyzeMcDc,
  summarize,
  formatVector,
  MAX_CONDITIONS
};
