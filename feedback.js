import { logEvent, sanitize } from './diagnostics.js';
const KEY = 'badgeFeedback';
const PREFIX = 'clear-export-badge:';
const NOTICE = 'teambition-export-result';
const DEFAULT_TITLE = '点击导出当前 Teambition 问题单';
const FEEDBACK_MS = 10000;
let badgeTimer;
let queue = Promise.resolve();
const serialize = action => {
  const result = queue.catch(() => {}).then(action);
  queue = result;
  return result;
};
async function reset() {
  clearTimeout(badgeTimer);
  const current = (await chrome.storage.session.get(KEY))[KEY];
  if (current) await chrome.alarms.clear(PREFIX + current.job);
  await chrome.storage.session.remove(KEY);
  await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setTitle({ title: DEFAULT_TITLE });
  await chrome.notifications.clear(NOTICE).catch(() => {});
}
export function resetFeedback() { return serialize(reset); }
export function finishFeedback(job, { title, error, partial = false }) {
  return serialize(async () => {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title });
    const expires = Date.now() + FEEDBACK_MS;
    await chrome.storage.session.set({ [KEY]: { job, expires } });
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => expireFeedback(PREFIX + job).catch(() => {}), FEEDBACK_MS);
    try { await chrome.alarms.create(PREFIX + job, { when: expires }); }
    catch (failure) {
      // A scheduling failure must not leave a permanent error badge.
      await reset();
      await logEvent(job, 'background', 'badge.timer-failed', { message: failure.message }, 'warn');
    }
    if (error || partial) {
      try {
        await chrome.notifications.create(NOTICE, {
          type: 'basic', iconUrl: chrome.runtime.getURL('icon128.png'),
          title: partial ? 'Teambition：部分附件未取得' : 'Teambition 导出失败',
          message: String(sanitize(error || '已保存文件，但有附件缺失。点击查看详情和排查日志。')).slice(0, 220),
          buttons: [{ title: '查看详情和日志' }], requireInteraction: false
        });
        await logEvent(job, 'background', 'feedback.notification-sent', { partial });
      } catch (failure) {
        await logEvent(job, 'background', 'feedback.notification-unavailable', { message: failure.message }, 'warn');
      }
    }
  });
}
// Both the short in-memory timer and the persistent alarm check job ownership.
function expireFeedback(name) {
  return serialize(async () => {
    const state = await chrome.storage.session.get([KEY, 'activeExport']);
    const current = state[KEY];
    if (!current || name !== PREFIX + current.job) return;
    if (state.activeExport?.expires > Date.now()) {
      await chrome.alarms.create(name, { when: Date.now() + 30000 });
      return;
    }
    if (current.expires > Date.now()) {
      await chrome.alarms.create(name, { when: current.expires });
      return;
    }
    await reset();
  });
}
export function installFeedbackHandlers() {
  chrome.alarms.onAlarm.addListener(alarm => {
    if (!alarm.name.startsWith(PREFIX)) return;
    return expireFeedback(alarm.name).catch(() => {});
  });
  const openDetails = async id => {
    if (id !== NOTICE) return;
    const active = (await chrome.storage.session.get('activeExport')).activeExport;
    if (!active || active.expires <= Date.now()) await resetFeedback();
    await chrome.runtime.openOptionsPage();
  };
  chrome.notifications.onClicked.addListener(openDetails);
  chrome.notifications.onButtonClicked.addListener((id, index) => index === 0 ? openDetails(id) : undefined);
  chrome.runtime.onStartup.addListener(() => resetFeedback().catch(() => {}));
  chrome.runtime.onInstalled.addListener(() => resetFeedback().catch(() => {}));
}
