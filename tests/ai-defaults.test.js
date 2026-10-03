import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultQwenConfig,requireModelKey} from '../backend/services/ai-defaults.js';
test('Qwen default has no inherited credentials and requires explicit configuration',()=>{
  const config=defaultQwenConfig();assert.equal(config.enabled,true);assert.equal(config.provider,'Qwen');assert.equal(config.apiKeyEncrypted,'');
  assert.throws(()=>requireModelKey(config),/尚未配置 API Key/);assert.doesNotThrow(()=>requireModelKey({...config,apiKeyEncrypted:'configured'}));
});
