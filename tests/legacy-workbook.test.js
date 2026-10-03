import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx-js-style';
import {workbookPreview} from '../backend/services/legacy-generator.js';
test('original workbook preview preserves UI/API levels and aligned steps',()=>{
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet([
    {'用例标题':'查询','模块':'搜索','优先级':'P1','是否冒烟':'是','前置准备':'已登录','测试步骤':'1. 输入\n2. 查询','预期结果':'1. 展示\n2. 匹配','备注':'REQ-001；测试层级：UI'},
    {'用例标题':'接口','模块':'搜索','优先级':'P2','是否冒烟':'否','前置准备':'鉴权','测试步骤':'请求接口','预期结果':'返回记录','备注':'REQ-002；测试层级：API'}
  ]),'全量用例');
  const rows=workbookPreview(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
  assert.equal(rows.length,2);assert.equal(rows[0].caseType,'ui');assert.equal(rows[1].caseType,'api');assert.equal(rows[0].steps.length,2);assert.deepEqual(rows[0].requirementIds,['REQ-001']);assert.equal(rows[0].smoke,true);
});
