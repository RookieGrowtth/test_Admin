// Explicit local migration. Stop the server first to avoid concurrent state writes.
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {state,saveState} from '../backend/core/state.js';
import {dataDir} from '../backend/config/index.js';
import {defaultQwenConfig} from '../backend/services/ai-defaults.js';
const backup=join(dataDir,'config-backups');await mkdir(backup,{recursive:true,mode:0o700});
await writeFile(join(backup,'ai-configs-'+Date.now()+'.json'),JSON.stringify(state.aiConfigs),{mode:0o600,flag:'wx'});
state.aiConfigs=[defaultQwenConfig()];saveState(state);
console.log('Default set to Qwen; API Key is empty. Previous encrypted configurations backed up locally.');
