// Explicit isolated acceptance configuration. Default local usage is unchanged.
const environmentFile = process.env.EDITOR_ENV_FILE || '.env';

function composeArguments() {
  const result = ['compose'];
  const project = process.env.EDITOR_COMPOSE_PROJECT;
  if (project) {
    if (!/^docsnest-(check|compat)-[a-f0-9]{12}$/.test(project)) {
      throw new Error('Browser test requires an owned isolated project');
    }
    result.push('--project-name', project);
  }
  result.push('--env-file', environmentFile, '-f', 'infra/compose/compose.yaml');
  if (process.env.EDITOR_COMPOSE_OVERRIDE) {
    result.push('-f', process.env.EDITOR_COMPOSE_OVERRIDE);
  }
  return result;
}

module.exports = { environmentFile, composeArguments };
