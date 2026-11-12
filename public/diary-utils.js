(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DiaryCalendar = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var DAY = 86400000;
  var statuses = ['not_written', 'in_progress', 'written'];
  function todayISO(now) {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now || new Date());
    var values = {}; parts.forEach(function (part) { values[part.type] = part.value; });
    return values.year + '-' + values.month + '-' + values.day;
  }
  function key(year, month, day) { return year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0'); }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function validYear(value, today) { return Number.isInteger(Number(value)) && Number(value) >= 2023 && Number(value) <= Number(today.slice(0, 4)); }
  function validateUpdate(date, status, today) {
    if (!validDate(date) || date < '2023-01-01' || date > today) return 'Choose a date from 1 January 2023 through today.';
    if (statuses.indexOf(status) === -1) return 'Choose Not written, In progress or Written.';
    return '';
  }
  function daysInMonth(year, month) { return new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); }
  function offset(year, month) { return (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7; }
  function stats(year, entries, today) {
    var start = Date.UTC(Number(year), 0, 1), longest = 0, streak = 0, previous = null;
    var dates = Object.keys(entries).filter(function (date) { return validDate(date) && date.slice(0, 4) === String(year) && date <= today && entries[date] === 'written'; }).sort();
    dates.forEach(function (date) {
      var day = Date.parse(date + 'T00:00:00Z');
      streak = previous !== null && day - previous === DAY ? streak + 1 : 1;
      longest = Math.max(longest, streak); previous = day;
    });
    return { written: dates.length, longestStreak: longest, dayOfYear: Number(today.slice(0, 4)) === Number(year) ? Math.floor((Date.parse(today + 'T00:00:00Z') - start) / DAY) + 1 : null };
  }
  return { todayISO: todayISO, key: key, validDate: validDate, validYear: validYear, validateUpdate: validateUpdate, daysInMonth: daysInMonth, offset: offset, stats: stats };
});
