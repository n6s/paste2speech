import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleOcrPage} from '../public/ocr-table-resources.js';
import {ocrExportParts} from '../public/ocr-result-export.js';
import {reconstruct,exportText,tableText} from '../public/document-reconstruct.js';
const table='| Date | Activity |\n| --- | --- |\n| 0738 | Depart home |';
test('embedded tables expand in original Copy/TXT/Markdown and reader without source mutation',()=>{
 const raw={pages:[{index:0,markdown:'# Log\n\n[tbl-0.md](tbl-0.md)',tables:[{id:'tbl-0.md',content:table}],blocks:[{type:'title',content:'Log'},{type:'table',table_id:'tbl-0.md',content:table}],footer:'Page 1 footer'}]};
 const before=JSON.stringify(raw),txt=[...ocrExportParts(raw.pages)].join(''),md=[...ocrExportParts(raw.pages,true)].join('');
 assert.match(txt,/\[Page 1\].*0738.*Depart home.*Page 1 footer/s);assert.match(md,/<!-- Page 1 -->.*\| Date \| Activity \|.*Depart home/s);assert.doesNotMatch(txt,/tbl-0\.md/);assert.match(exportText(reconstruct(raw).articles),/Date: 0738; Activity: Depart home/);assert.equal(JSON.stringify(raw),before);
});
test('multiple and nested table references remain page-local, preserve order, and never fetch URLs',()=>{
 const pages=[{index:0,header:'Original header',markdown:'Before [tbl-0.md](./tbl-0.md) between [tbl-1.md](tbl-1.md) after.',tables:[{id:'tbl-0.md',content:'First [tbl-n.md](tbl-n.md)'},{id:'tbl-n.md',content:'Nested body'},{id:'tbl-1.md',content:'Second body'}]},{index:1,markdown:'[tbl-0.md](tbl-0.md) [website](https://example.org/tbl-1.md)',tables:[{id:'tbl-0.md',content:'Different page body'}],footer:'End footer'}];
 const text=[...ocrExportParts(pages,true)].join('');assert.match(text,/Before First Nested body between Second body after\..*<!-- Page 2 -->.*Different page body.*https:\/\/example.org\/tbl-1.md.*End footer/s);assert.equal(pages[0].markdown.includes('tbl-0.md'),true);
});
test('missing, cyclic, ambiguous and oversized table resources fail visibly rather than fabricate text',()=>{
 const missing=assembleOcrPage({markdown:'[tbl-0.md](tbl-0.md)'});assert.deepEqual(missing.unresolved,['tbl-0.md']);assert.match(missing.page.markdown,/tbl-0.md/);assert.equal(missing.notes.length,1);
 const cycle=assembleOcrPage({markdown:'[tbl-0.md](tbl-0.md)',tables:[{id:'tbl-0.md',content:'[tbl-1.md](tbl-1.md)'},{id:'tbl-1.md',content:'[tbl-0.md](tbl-0.md)'}]});assert.ok(cycle.unresolved.length);assert.throws(()=>assembleOcrPage({tables:[{id:'same',content:'one'},{id:'same',content:'two'}]}),/Ambiguous/);assert.throws(()=>assembleOcrPage({markdown:'[tbl-0.md](tbl-0.md)',tables:[{id:'tbl-0.md',content:'x'.repeat(100)}]},{maxCharacters:20}),/bound/);assert.throws(()=>assembleOcrPage({tables:{}}),/Unsupported/);
});
const activityForm='| 1. Incident Name: Exercise | | 2. Operational Period: Date From: Time From: Date To: Time To: |\n| --- | --- | --- |\n| 7. Activity Log (continuation): | | |\n| Date/Time | Notable Activities | |\n| 10/10 0738 | Depart home | |\n| 1102 | Day gas, portmottles | |\n| 1531 | Returned with runner | Safety note |';
test('activity form retains merged metadata once and actual time/activity rows including extra populated cells',()=>{
 const text=tableText(activityForm).text;assert.equal((text.match(/Incident Name/g)||[]).length,1);assert.equal((text.match(/Operational Period/g)||[]).length,1);assert.match(text,/10\/10 0738 — Depart home\n\n1102 — Day gas, portmottles\n\n1531 — Returned with runner; Column 3: Safety note/);assert.doesNotMatch(text,/Column 2|Operational Period[^\n]*: \./);assert.match(text,/7\. Activity Log/);
});
test('ordinary labeled tables and a date/activity row without form context keep their legitimate column meaning',()=>{
 assert.equal(tableText('| Name | Quantity |\n| --- | --- |\n| Supplies | 0 |').text,'Name: Supplies; Quantity: 0.');
 assert.equal(tableText('| Type | Label |\n| --- | --- |\n| Date/Time | Notable Activities |\n| Morning | Check |').text,'Type: Date/Time; Label: Notable Activities.\n\nType: Morning; Label: Check.');
});
