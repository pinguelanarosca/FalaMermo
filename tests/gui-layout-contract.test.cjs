// CSS/source contracts only. These tests do not claim native popup homologation.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=name=>fs.readFileSync(require.resolve('../'+name),'utf8');
test('popup intrinsic dimensions do not depend on an initial vh viewport',()=>{
 const html=read('popup.html');assert.match(html,/width:380px;min-width:380px;height:590px;min-height:590px/);assert.doesNotMatch(html,/\b(?:max-height|height):[^;}]*vh/);assert.match(html,/#globalTasks \.fm-global-jobs\{flex:1;max-height:none;min-height:0\}/);assert.match(read('popup.js'),/window\.innerHeight>=300/);
});
test('Shadow DOM receives exactly the stylesheet edited in content.css',()=>{
 const source=read('content.js'),context=vm.createContext({});vm.runInContext(source.replace('__require("extension/src/content/entrypoint.ts");','globalThis.modules=__modules;'),context);const m={exports:{}};context.modules['extension/src/content/styles/hud.css?raw'](m,m.exports,()=>{});assert.equal(m.exports,read('content.css'));assert.match(m.exports,/data-minimized="true"\]>.ext-hud-body\{display:none!important\}/);
});
test('expanded HUD is bounded by viewport; its list alone may shrink',()=>{
 const css=read('content.css');assert.match(css,/box-sizing: border-box/);assert.match(css,/max-height: calc\(100vh - 48px\)/);assert.match(css,/#ext-global-jobs \.fm-global-jobs\{flex:1;min-height:0\}/);assert.match(css,/#ext-global-jobs>\.fm-global-hud>:not\(\.fm-global-jobs\)\{flex-shrink:0\}/);assert.match(read('popup.html'),/@media\(max-height:500px\)/);
});
test('collapsed cards cannot fill spare grid height or show non-header children',()=>{
 const source=read('global-hud.js');assert.match(source,/align-content:start;grid-auto-rows:max-content/);assert.match(source,/align-self:start/);assert.match(source,/data-collapsed="true"\]>{1}:not\(\.fm-global-card-header\)\{display:none!important\}/);assert.match(source,/card\.node\.dataset\.collapsed=String\(collapsed\)/);
});
test('scrollbar rules are scoped to extension surfaces and preserve scroll overflow',()=>{
 const source=read('global-hud.js');assert.match(source,/overflow:auto;overscroll-behavior:contain/);assert.match(source,/scrollbar-width:none!important;scrollbar-gutter:auto!important/);assert.match(source,/::-webkit-scrollbar\{display:none!important;width:0!important;height:0!important\}/);const content=read('content.css');assert.doesNotMatch(content,/(?:^|\n)(?:html|body|\*)\s*\{[^}]*scrollbar/);assert.match(content,/\.ext-hud-card,.ext-hud-card \*\{scrollbar-width:none!important/);
});
