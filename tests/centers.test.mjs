import test from "node:test";
import assert from "node:assert/strict";
import {centerSearchResults, cityShortcuts, matchesCenter, rememberCenter} from "../src/centers.js";
import {loadSettings, searchCenters} from "../src/services.js";

const [tianjin, shanghai] = cityShortcuts;
test("an old home and last center migrate independently without copying GPS or photos into the center list", () => {
  const stored = { home: {...tianjin,id:"my-home",type:"home",photo:"test-photo",time:100},center:shanghai,saved:[tianjin],radius:5 };
  const previous=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
  try {
    Object.defineProperty(globalThis,"localStorage",{value:{getItem:()=>JSON.stringify(stored)},configurable:true});
    const s=loadSettings();
    assert.deepEqual(s.centers.map(p=>p.name),["上海","天津"]);
    assert.ok(matchesCenter(s.home,s.centers[1]));
    assert.ok(!("photo" in s.centers[1] || "time" in s.centers[1]));
    assert.equal(s.saved[0].id,tianjin.id); assert.equal(s.radius,5);
  } finally { if(previous)Object.defineProperty(globalThis,"localStorage",previous);else delete globalThis.localStorage; }
});
test("switching cities doesn't duplicate records, and a relocated home keeps both addresses",()=>{
  let list=rememberCenter([], {...tianjin,id:"my-home"});
  list=rememberCenter(list,{...shanghai,id:"my-home"});
  list=rememberCenter(list,{...tianjin,id:"my-home",name:"天津住处"});
  assert.deepEqual(list.map(p=>p.name),["天津住处","上海"]);
  const nearby={...tianjin,id:"gps-1",name:"当前位置"};
  assert.equal(rememberCenter([nearby],{...nearby,id:"gps-2",lat:nearby.lat+0.00003}).length,1);
});
test("full city names work without a network connection",async()=>{
  assert.deepEqual(await searchCenters(" 天津市 "),[tianjin]);
  assert.deepEqual(await searchCenters("上海"),[shanghai]);
});
test("likenamed landmarks show their own districts and malformed results are discarded",()=>{
  const poi=(id,district,lon)=>({geometry:{type:"Point",coordinates:[lon,31.2]},properties:{name:"人民广场",city:"上海市",district,osm_type:"N",osm_id:id}});
  const a=poi(1,"黄浦区",121.47),b=poi(2,"松江区",121.22);
  const places=centerSearchResults([a,b,a,poi(3,"bad",999),null]);
  assert.equal(places.length,2);assert.match(places[0].hint,/黄浦区/);assert.match(places[1].hint,/松江区/);
});
