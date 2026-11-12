'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const d=require('../public/diary-utils');
test('calendar handles leap years and Monday-first offsets',()=>{
 assert.equal(d.daysInMonth(2024,1),29);assert.equal(d.daysInMonth(2023,1),28);assert.equal(d.offset(2024,0),0);assert.equal(d.offset(2023,0),6);
 assert.equal(d.key(2023,0,2),'2023-01-02');
});
test('current day of year accounts for leap years and is hidden for past years',()=>{
 assert.equal(d.stats(2024,{},'2024-12-31').dayOfYear,366);assert.equal(d.stats(2023,{},'2023-12-31').dayOfYear,365);assert.equal(d.stats(2023,{},'2026-11-12').dayOfYear,null);
});
test('yearly written count and longest streak only include completed past dates',()=>{
 const entries={'2024-02-28':'written','2024-02-29':'written','2024-03-01':'written','2024-03-02':'in_progress','2024-03-03':'written','2024-03-04':'not_written','2024-03-05':'written','2025-01-01':'written','2024-03-06':'written'};
 assert.deepEqual(d.stats(2024,entries,'2024-03-05'),{written:5,longestStreak:3,dayOfYear:65});
});
test('updates reject impossible, future and pre-2023 dates and unknown statuses',()=>{
 for(const date of ['2023-02-29','2024-02-30','2022-12-31','2026-11-13','2026-1-01','bad']) assert.ok(d.validateUpdate(date,'written','2026-11-12'),date);
 assert.equal(d.validateUpdate('2024-02-29','in_progress','2026-11-12'),'');assert.equal(d.validateUpdate('2023-01-01','not_written','2026-11-12'),'');assert.ok(d.validateUpdate('2026-11-12','other','2026-11-12'));
 assert.equal(d.validYear(2022,'2026-11-12'),false);assert.equal(d.validYear(2027,'2026-11-12'),false);
});
test('today uses India time across UTC midnight boundaries',()=>{
 assert.equal(d.todayISO(new Date('2026-11-11T20:00:00Z')),'2026-11-12');assert.equal(d.todayISO(new Date('2026-12-31T20:00:00Z')),'2027-01-01');
});
