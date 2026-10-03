import test from 'node:test';
import assert from 'node:assert/strict';
import {validImportedStep} from '../backend/lib/excel.js';
test('structured import requires both an action and an expected result',()=>{
 for(const value of [null,undefined,42,[],{}, {action:'',expected:''},{action:'do',expected:' '},{action:' ',expected:'ok'}])assert.equal(validImportedStep(value),false);
 assert.equal(validImportedStep({action:' do ',expected:' ok '}),true);
});
test('text import keeps valid pipe-delimited steps and rejects empty halves',()=>{
 for(const value of ['', '|', 'do | ', ' | ok', 'without separator'])assert.equal(validImportedStep(value),false);
 for(const value of ['do | ok','do | ok | more detail'])assert.equal(validImportedStep(value),true);
});
