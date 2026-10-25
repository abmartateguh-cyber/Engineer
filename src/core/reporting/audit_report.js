'use strict';

const { getFeatureMaturity } = require('../maturity/feature_maturity');
const MAX_REPORT_CONTEXT_BYTES = 1024 * 1024;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function hasRequiredText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasExplicitVersions(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.entries(value).every(([name, version]) => hasRequiredText(name) && hasRequiredText(version))
  );
}

function hasValidConvergenceDiagnostics(value) {
  const validStatuses = new Set(['converged', 'not-converged', 'not-applicable', 'unavailable']);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !validStatuses.has(value.status) ||
    !Array.isArray(value.residuals)
  ) {
    return false;
  }

  const validResiduals = value.residuals.every(
    (residual) =>
      residual &&
      typeof residual === 'object' &&
      !Array.isArray(residual) &&
      hasRequiredText(residual.metric) &&
      Number.isFinite(residual.value) &&
      hasRequiredText(residual.units)
  );
  if (!validResiduals) return false;

  if (value.status === 'converged' || value.status === 'not-converged') return value.residuals.length > 0;
  return hasRequiredText(value.reason);
}

class AuditReportGenerator {
  static generateComprehensiveReport(projectContext) {
    if (!projectContext || typeof projectContext !== 'object' || Array.isArray(projectContext)) {
      return {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Project evidence is required to generate a report.' }
      };
    }

    let serializedContext;
    try {
      serializedContext = JSON.stringify(projectContext);
    } catch {
      return {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Project evidence must be serializable JSON data.' }
      };
    }
    if (typeof serializedContext !== 'string') {
      return {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Project evidence must be serializable JSON data.' }
      };
    }
    if (Buffer.byteLength(serializedContext, 'utf8') > MAX_REPORT_CONTEXT_BYTES) {
      return {
        success: false,
        status: 'resource-exhausted',
        error: {
          code: 'RESOURCE_EXHAUSTED',
          message: `Project evidence exceeds the ${MAX_REPORT_CONTEXT_BYTES}-byte report limit.`
        }
      };
    }

    const requiredText = ['projectId', 'projectName', 'projectRevision', 'engineVersion'];
    const missing = requiredText.filter((key) => !hasRequiredText(projectContext[key]));
    if (missing.length > 0) {
      return {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: `Required project evidence is missing: ${missing.join(', ')}.`
        }
      };
    }

    if (!hasExplicitVersions(projectContext.dependencyVersions)) {
      return {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Project dependency versions must be supplied explicitly as a name-to-version object.'
        }
      };
    }

    if (
      !Array.isArray(projectContext.inputs) ||
      projectContext.inputs.length === 0 ||
      !Array.isArray(projectContext.results) ||
      projectContext.results.length === 0
    ) {
      return {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'At least one input artifact and one result are required.' }
      };
    }

    const invalidInput = projectContext.inputs.find(
      (input) => !input || !hasRequiredText(input.hash) || !hasRequiredText(input.units)
    );
    if (invalidInput) {
      return {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Every input artifact must include a content hash and units.' }
      };
    }

    if (
      !Array.isArray(projectContext.assumptions) ||
      projectContext.assumptions.some((assumption) => !hasRequiredText(assumption)) ||
      !Array.isArray(projectContext.warnings) ||
      projectContext.warnings.some((warning) => !hasRequiredText(warning))
    ) {
      return {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Project assumptions and warnings must be supplied explicitly as arrays, which may be empty.'
        }
      };
    }

    const inputHashes = new Set(projectContext.inputs.map((input) => input.hash));
    const invalidResult = projectContext.results.find(
      (result) =>
        !result ||
        !hasRequiredText(result.domain) ||
        !hasRequiredText(result.name) ||
        !hasRequiredText(result.units) ||
        result.projectRevision !== projectContext.projectRevision ||
        !hasRequiredText(result.engineVersion) ||
        !hasRequiredText(result.backendVersion) ||
        !hasExplicitVersions(result.dependencyVersions) ||
        !hasValidConvergenceDiagnostics(result.convergenceDiagnostics) ||
        !Array.isArray(result.warnings) ||
        result.warnings.some((warning) => !hasRequiredText(warning)) ||
        !Array.isArray(result.inputHashes) ||
        result.inputHashes.length === 0 ||
        result.inputHashes.some((hash) => !hasRequiredText(hash) || !inputHashes.has(hash))
    );
    if (invalidResult) {
      return {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message:
            'Every result must include its project revision, engine and backend versions, dependency versions, convergence diagnostics, warnings, units, and hashes that match supplied input artifacts.'
        }
      };
    }

    const domainMaturities = projectContext.results.map((result) => ({
      domain: result.domain,
      maturity: getFeatureMaturity(result.domain).state
    }));
    const resultsWithMaturity = projectContext.results.map((result) => ({
      ...result,
      validationLevel: getFeatureMaturity(result.domain).state
    }));
    const validationLevel = domainMaturities.every((item) => item.maturity === 'released')
      ? 'released'
      : 'experimental';
    const report = {
      projectId: projectContext.projectId,
      projectName: projectContext.projectName,
      projectRevision: projectContext.projectRevision,
      engineVersion: projectContext.engineVersion,
      dependencyVersions: projectContext.dependencyVersions,
      inputs: projectContext.inputs,
      results: resultsWithMaturity,
      assumptions: projectContext.assumptions,
      warnings: projectContext.warnings,
      domainMaturities,
      validationLevel,
      generatedAt: new Date().toISOString()
    };

    return { success: true, report, htmlReport: renderHtml(report) };
  }
}

function renderHtml(report) {
  const json = escapeHtml(JSON.stringify(report, null, 2));
  const maturityRows = report.domainMaturities
    .map((item) => `<li>${escapeHtml(item.domain)}: ${escapeHtml(item.maturity)}</li>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Engineering evidence report — ${escapeHtml(report.projectId)}</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; color: #172033; }
  .status { padding: .75rem 1rem; border: 1px solid #a16207; background: #fef3c7; color: #713f12; }
  pre { overflow: auto; padding: 1rem; background: #f3f4f6; }
</style></head>
<body>
  <h1>Engineering evidence report</h1>
  <p class="status">Validation maturity: ${escapeHtml(report.validationLevel)}. This report does not make certification or compliance claims.</p>
  <h2>Project</h2>
  <p>${escapeHtml(report.projectName)} — ${escapeHtml(report.projectId)} — revision ${escapeHtml(report.projectRevision)}</p>
  <p>Engine version: ${escapeHtml(report.engineVersion)}</p>
  <h2>Domain maturity</h2><ul>${maturityRows}</ul>
  <h2>Provenance and results</h2>
  <pre>${json}</pre>
</body></html>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AuditReportGenerator };
}
