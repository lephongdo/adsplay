import { createServer } from 'node:http';
import { createApp } from './app';
import { getConfig } from './config';
import { logInfo } from './logger';
import { getSystemStatus } from './services/system.service';

const config = getConfig();
const app = createApp();
const server = createServer(app);

server.listen(config.port, '0.0.0.0', () => {
    logInfo('server.started', { port: config.port });

    const status = getSystemStatus();
    for (const address of status.localIps) {
        logInfo('server.available', { url: `http://${address}:${config.port}` });
    }
});
