import assert from 'node:assert/strict';
import {installFeedbackHandlers,resetFeedback,finishFeedback} from '../feedback.js';
const state={},handlers={},alarms=new Map(),badges=[],notices=[];
let now=1000000,opened=0,rejectNotifications=false,rejectTimer=false;
const timers = new Map(); let nextTimer = 0;
const originalSetTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = (fn, ms) => { const id = ++nextTimer; timers.set(id, {fn, ms}); return id; };
globalThis.clearTimeout = id => timers.delete(id);
const toasts = [];
const originalNow=Date.now;Date.now=()=>now;
globalThis.chrome={
 scripting:{async executeScript(options){toasts.push(options);}},
 runtime:{getURL:p=>'chrome-extension://test/'+p,onStartup:{addListener(fn){handlers.startup=fn;}},onInstalled:{addListener(fn){handlers.install=fn;}},async openOptionsPage(){opened++;}},
 action:{async setBadgeText({text}){badges.push(text);},async setTitle(){},async setBadgeBackgroundColor(){}},
 storage:{session:{async get(key){return key===null?{...state}:Array.isArray(key)?Object.fromEntries(key.map(k=>[k,state[k]])):{[key]:state[key]};},async set(v){Object.assign(state,v);},async remove(k){delete state[k];}}},
 alarms:{onAlarm:{addListener(fn){handlers.alarm=fn;}},async create(name,options){if(rejectTimer)throw Error('unavailable');alarms.set(name,options);},async clear(name){alarms.delete(name);}},
 notifications:{onClicked:{addListener(fn){handlers.click=fn;}},onButtonClicked:{addListener(fn){handlers.button=fn;}},async create(id,options){if(rejectNotifications)throw Error('blocked');notices.push({id,...options});},async clear(){}}
};
try {
 installFeedbackHandlers();
 await finishFeedback('old',{tabId:5,badge:'失败',color:'red',title:'failed',error:'下载失败'});
 assert.equal(notices.length,1);assert.equal(alarms.get('clear-export-badge:old').when,now+10000);
 assert.equal(toasts.length,0);
 const oldTimer = [...timers.values()].at(-1);assert.equal(oldTimer.ms,10000);
 now+=10001;await oldTimer.fn();assert.equal(badges.at(-1),'');assert(!state.badgeFeedback);
 await finishFeedback('old2',{badge:'失败',color:'red',title:'failed',error:'bad'});
 const staleTimer = [...timers.values()].at(-1);
 await resetFeedback();badges.push('读取');await staleTimer.fn();assert.equal(badges.at(-1),'读取');
 await handlers.alarm({name:'clear-export-badge:old2'});assert.equal(badges.at(-1),'读取');
 await finishFeedback('new',{badge:'完成',color:'green',title:'done'});
 now+=10001;state.activeExport={job:'running',expires:now+60000};
 await handlers.alarm({name:'clear-export-badge:new'});assert.equal(badges.at(-1),'');assert.equal(alarms.get('clear-export-badge:new').when,now+30000);
 delete state.activeExport;
 await handlers.button('teambition-export-result',0);assert.equal(opened,1);assert.equal(badges.at(-1),'');
 rejectNotifications=true;
 await finishFeedback('blocked',{tabId:5,badge:'失败',color:'red',title:'failed',error:'bad'});assert.equal(badges.at(-1),'');assert(alarms.has('clear-export-badge:blocked'));
 await handlers.install();assert.equal(badges.at(-1),'');
 rejectTimer=true;
 await finishFeedback('timerfail',{badge:'失败',color:'red',title:'failed'});assert.equal(badges.at(-1),'');
 assert.equal(toasts.length,0);
 console.log('PASS: timed badge cleanup, stale alarms, active exports, notification button, blocked notifications, reload cleanup, and timer failure fallback.');
} finally {Date.now=originalNow;globalThis.setTimeout=originalSetTimeout;globalThis.clearTimeout=originalClearTimeout;}
