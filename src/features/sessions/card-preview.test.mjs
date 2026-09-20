import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const {questionPreview}=await createJiti(import.meta.url).import('./card-preview.ts');
test('SDK skill expansion is compacted before truncation and file mentions retain the basename',()=>{
 const text='<skill name="wayfinder" location="/skills/wayfinder/SKILL.md">\nReferences are relative to /skills/wayfinder.\n\n'+('instructions '.repeat(200))+'\n</skill>\n\n探索可行方向';
 assert.equal(questionPreview(text),'/skill:wayfinder 探索可行方向');
 assert.equal(questionPreview('@/var/folders/91/tmp/handoff.md\n继续'),'@handoff.md\n继续');
 assert.equal(questionPreview('<skill name="example">这段是在讨论标记'),'<skill name="example">这段是在讨论标记');
});
