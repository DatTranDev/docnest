/** Scoped adapter for Next's directory resolver. No vulnerable braces dependency. */
const { globSync } = require('tinyglobby');
exports.globSync = (patterns, options = {}) =>
  globSync(patterns, { ...options, expandDirectories: false }).map((directory) =>
    directory === '/' || /^[A-Za-z]:\/$/.test(directory) ? directory : directory.replace(/\/$/, ''),
  );
