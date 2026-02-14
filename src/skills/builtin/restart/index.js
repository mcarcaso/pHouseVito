import { execSync } from 'child_process';

export const skill = {
  name: 'restart',
  description: 'Restart the Vito server process via PM2 without killing the orchestrator',
  tools: [
    {
      name: 'restart_server',
      description: 'Restart the Vito server process. Use this after code changes or when channels need to reload.',
      input_schema: {
        type: 'object',
        properties: {}
      },
      async execute() {
        try {
          const output = execSync('pm2 restart vito-server', { encoding: 'utf-8' });
          return `Server restarted successfully!\n\n${output}`;
        } catch (error) {
          return `Failed to restart server: ${error.message}`;
        }
      }
    }
  ]
};
