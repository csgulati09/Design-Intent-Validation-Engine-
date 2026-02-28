/**
 * Append validation test results to a CSV file.
 * Creates the file with headers if it doesn't exist; otherwise appends rows.
 */

const fs = require('fs');
const path = require('path');

const CSV_HEADERS = ['fps', 'persona', 'strategy', 'text', 'type', 'testStepDescription', 'resultJson'];

/**
 * Escape a value for CSV: wrap in quotes if it contains comma, newline, or double quote.
 * Internal double quotes are escaped by doubling.
 * @param {string} value
 * @returns {string}
 */
function escapeCsvValue(value) {
  const str = value == null ? '' : String(value);
  const needsQuotes = /[",\r\n]/.test(str);
  const escaped = str.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

/**
 * Format a row of values as a CSV line.
 * @param {string[]} values
 * @returns {string}
 */
function toCsvLine(values) {
  return values.map(escapeCsvValue).join(',') + '\n';
}

/**
 * Append one or more result rows to the CSV file.
 * Creates the file with header row if it doesn't exist.
 * @param {string} csvPath - Path to the CSV file (e.g. validation-results.csv).
 * @param {Array<{ fps: number, persona: string, strategy: string, text: string, type: string, testStepDescription: string, resultJson: string }>} rows - Rows to append.
 */
function appendResultsToCsv(csvPath, rows) {
  if (!rows || rows.length === 0) return;

  const resolved = path.resolve(csvPath);
  const exists = fs.existsSync(resolved);

  const lines = [];
  if (!exists) {
    lines.push(toCsvLine(CSV_HEADERS));
  }

  for (const row of rows) {
    lines.push(
      toCsvLine([
        row.fps,
        row.persona,
        row.strategy,
        row.text,
        row.type,
        row.testStepDescription,
        row.resultJson,
      ])
    );
  }

  fs.appendFileSync(resolved, lines.join(''), 'utf8');
}

module.exports = {
  appendResultsToCsv,
  CSV_HEADERS,
};
