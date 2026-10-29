const assert=require('assert'),C=require('../wishwave-discovery-preferences.js');
const base=[{query:'Resident Evil',featured:false},{query:'Nintendo Game Boy',featured:true},{query:'LEGO Star Wars',featured:true},{query:'Vinyl records',featured:true},{query:'Vintage cameras',featured:true}];
let state=C.valid({entries:[{topic:'Resident Evil',preference:'more'},{topic:'LEGO',preference:'hidden'}],variety:'balanced'});
let plan=C.plan(state,base,[],8);assert.equal(plan[0].query,'Resident Evil');assert(plan.some(x=>x.featured));assert(!plan.some(x=>/lego/i.test(x.query)));assert(C.allow(state,{title:'Nintendo Game Boy'}));assert(!C.allow(state,{title:'LEGO Star Wars 75300'}));assert(C.allow(state,{title:'Legolas figure'}),'hidden words cannot match inside unrelated words');
assert(C.preferenceScore(state,{title:'Resident Evil 4 GameCube'})>0);
state=C.valid({entries:[{topic:'Resident Evil',preference:'less'}]});assert(C.preferenceScore(state,{title:'Resident Evil 4'})<0);assert(C.allow(state,{title:'Resident Evil 4'}),'Less is not a hard exclusion');assert(!C.plan(state,base,[],8).some(x=>x.query==='Resident Evil'));
state=C.valid({entries:[{topic:'Resident Evil',preference:'neutral'}]});assert(!C.topics(state,[{query:'Resident Evil',score:20}]).length);assert(!C.plan(state,base,[],8).some(x=>x.query==='Resident Evil'));
const reset=C.valid({resetAt:100,observations:[{topic:'Old',at:90},{topic:'New',at:120}]});assert.equal(reset.observations.length,1);assert(!C.plan(reset,base,[],8).some(x=>!x.featured));
assert(C.match('Pokémon','Pokemon Charizard PSA 10'));assert(C.match('Gaming','Nintendo Game Boy'));assert(!C.match('Resident Evil','Resident art print'));assert(C.match('ゲーム','ゲーム ソフト'));
assert.equal(C.valid({entries:[{topic:'same',preference:'more'},{topic:'Same',preference:'hidden'}]}).entries.length,1);assert.equal(C.plan(C.blank(),base,[],1).length,1);
const personalised=Array.from({length:6},(_,i)=>({query:'Topic '+i,featured:false})),discovery=Array.from({length:8},(_,i)=>({query:'Explore '+i,featured:true}));const f=C.plan({...C.blank(),variety:'focused'},[...personalised,...discovery],[],9),a=C.plan({...C.blank(),variety:'adventurous'},[...personalised,...discovery],[],9);assert(a.filter(x=>x.featured).length>f.filter(x=>x.featured).length);
console.log('PASS: explicit retrieval, exploration balance, hidden exclusions, Less versus Hide, removal, reset cutoff, Unicode and bounded controls');

assert.equal(C.topicLabel('LEGO 75356 Star Wars Executor Super Star Destroyer'),'LEGO Star Wars');
assert.equal(C.topicLabel('LEGO Botanicals Orchid Complete set'),'LEGO Botanicals');
assert.equal(C.topicLabel('Nintendo Game Boy Camera'),'Retro Nintendo');
assert.equal(C.topicLabel('New Balance'),'New Balance');
assert(C.match('Retro Nintendo',{title:'Nintendo Game Boy Camera'}));
assert(!C.match('Retro Nintendo',{title:'Nintendo Switch OLED'}));
