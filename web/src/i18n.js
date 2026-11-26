// Tiny i18n: one dictionary, one global language, useLang() re-renders the app on switch.
import { useSyncExternalStore } from 'react';

const DICT = {
  en: {
    loading: 'Loading…',
    tagline: 'Ask business data in plain language. Point with @.',
    username: 'Username', password: 'Password', signIn: 'Sign in', signOut: 'Sign out',
    navChat: 'Chat', navAgents: 'Agents', navRoutines: 'Routines', navUsage: 'AI usage',
    newChat: '+ New chat', newChatTitle: 'New chat', history: 'Chat history', noChats: 'No chats yet',
    del: 'Delete', delChat: 'Delete chat', menu: 'Menu', closeMenu: 'Close menu',
    noAccess: 'Role "{role}" can’t use AI in this domain (roles.canUse in domain.config)',
    homeTitle: 'Ask anything about {name}',
    homeHintA: 'Type', homeHintB: 'to pick the agent that answers, or point at the data you mean',
    placeholder: 'Ask a question… use @ to pick an agent or point at data, e.g. @platform',
    pickerHead: 'Agents answer · Data tags point at data',
    pickTag: 'Pick {label} →', searchTag: 'Search {label}…', noMatch: 'No matches',
    openPicker: 'Pick an agent or data tag', send: 'Send', remove: 'Remove',
    all: 'All', run: 'Run',
    ranQueries: 'Ran {n} {q}', query: 'query', queries: 'queries', blocked: '{n} blocked/failed',
    rows: '{n} rows', truncated: '(truncated)',
    proposal: 'Proposal #{id}', asked: 'asked',
    pending: 'Picking a model, exploring tables, writing SQL… {s}s',
    agentsSub: 'Roles with their own instructions and tools, called with @handle',
    newAgent: '+ New agent', name: 'Name', descPicker: 'Description (shown in the @ picker)',
    model: 'Model', modelAuto: 'Auto (router picks)', cancel: 'Cancel', save: 'Save', edit: 'Edit',
    confirmDelAgent: 'Delete @{h}?',
    routinesSub: 'Scheduled questions (Asia/Bangkok time) that post results to a Teams / LINE webhook',
    newRoutine: '+ New routine', routineName: 'Morning sales brief',
    routineQ: 'Question (@agent allowed)', time: 'Time', days: 'Days',
    webhook: 'Webhook URL (optional, https)', enabled: 'Enabled',
    question: 'Question', schedule: 'Schedule', nextRun: 'Next run', lastRun: 'Last run',
    running: 'Running…', runNow: 'Run now', viewResult: 'Result', noRoutines: 'No routines yet',
    confirmDelRoutine: 'Delete routine "{n}"?',
    routineDefault: '@analyst Summarize yesterday’s GMV by platform vs the same day last week',
    dayNames: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
    usageSub: 'Every model call is logged in ai_usage with tokens and cost',
    lastDays: 'Last {n} days', cost: 'Cost', dailyCost: 'Daily cost (USD)',
    byModel: 'By model', purpose: 'Purpose', byUser: 'By person', person: 'Person', chats: 'Chats',
    routerTitle: 'Where the router sends questions', noData: 'No data yet',
    routerNote: 'Includes Auto (router-picked) and agent-locked models · fallback = router failed or took over 3s → Sonnet',
  },
  th: {
    loading: 'กำลังโหลด…',
    tagline: 'ถามข้อมูลธุรกิจด้วยภาษาคน ชี้เป้าด้วย @',
    username: 'ชื่อผู้ใช้', password: 'รหัสผ่าน', signIn: 'เข้าสู่ระบบ', signOut: 'ออก',
    navChat: 'แชท', navAgents: 'Agents', navRoutines: 'Routines', navUsage: 'AI usage',
    newChat: '+ แชทใหม่', newChatTitle: 'แชทใหม่', history: 'ประวัติแชท', noChats: 'ยังไม่มีแชท',
    del: 'ลบ', delChat: 'ลบแชท', menu: 'เมนู', closeMenu: 'ปิดเมนู',
    noAccess: 'role "{role}" ใช้ AI ในโดเมนนี้ไม่ได้ (roles.canUse ใน domain.config)',
    homeTitle: 'ถามอะไรเกี่ยวกับ {name} ก็ได้',
    homeHintA: 'พิมพ์', homeHintB: 'เพื่อเลือก agent ที่จะตอบ หรือชี้ข้อมูลที่ต้องการ',
    placeholder: 'พิมพ์คำถาม… ใช้ @ เพื่อเลือก agent หรือชี้ข้อมูล เช่น @platform',
    pickerHead: 'Agents ตอบคำถาม · Data tags ชี้ข้อมูล',
    pickTag: 'เลือก {label} →', searchTag: 'ค้นหา {label}…', noMatch: 'ไม่พบ',
    openPicker: 'เลือก agent หรือ data tag', send: 'ส่ง', remove: 'เอาออก',
    all: 'ทั้งหมด', run: 'รัน',
    ranQueries: 'รัน {n} {q}', query: 'query', queries: 'query', blocked: 'ถูกบล็อก/ล้มเหลว {n}',
    rows: '{n} แถว', truncated: '(ตัดทอน)',
    proposal: 'ข้อเสนอ #{id}', asked: 'ถาม',
    pending: 'กำลังเลือกโมเดล ค้นตาราง และเขียน SQL… {s}s',
    agentsSub: 'บทบาทที่มีคำสั่งและชุดเครื่องมือของตัวเอง เรียกด้วย @handle',
    newAgent: '+ สร้าง agent', name: 'ชื่อ', descPicker: 'คำอธิบาย (แสดงใน @ picker)',
    model: 'โมเดล', modelAuto: 'Auto (router เลือก)', cancel: 'ยกเลิก', save: 'บันทึก', edit: 'แก้ไข',
    confirmDelAgent: 'ลบ @{h}?',
    routinesSub: 'คำถามที่ตั้งเวลาให้รันเอง (เวลา Asia/Bangkok) แล้วส่งผลเข้า webhook ของ Teams / LINE',
    newRoutine: '+ สร้าง routine', routineName: 'สรุปยอดเช้า',
    routineQ: 'คำถาม (ใช้ @agent ได้)', time: 'เวลา', days: 'วัน',
    webhook: 'Webhook URL (ไม่บังคับ, https)', enabled: 'เปิดใช้งาน',
    question: 'คำถาม', schedule: 'เวลา', nextRun: 'รันครั้งถัดไป', lastRun: 'ครั้งล่าสุด',
    running: 'กำลังรัน…', runNow: 'รันเลย', viewResult: 'ดูผล', noRoutines: 'ยังไม่มี routine',
    confirmDelRoutine: 'ลบ routine "{n}"?',
    routineDefault: '@analyst สรุปยอดเมื่อวานทุกแพลตฟอร์ม เทียบวันเดียวกันสัปดาห์ก่อน',
    dayNames: 'จ,อ,พ,พฤ,ศ,ส,อา',
    usageSub: 'ทุกครั้งที่เรียกโมเดลถูกบันทึกใน ai_usage พร้อม token และค่าใช้จ่าย',
    lastDays: '{n} วันล่าสุด', cost: 'ค่าใช้จ่าย', dailyCost: 'ค่าใช้จ่ายรายวัน (USD)',
    byModel: 'แยกตามโมเดล', purpose: 'ใช้ทำ', byUser: 'แยกตามคน', person: 'คน', chats: 'แชท',
    routerTitle: 'Router ส่งคำถามไปโมเดลไหน', noData: 'ยังไม่มีข้อมูล',
    routerNote: 'รวมทั้งที่ router เลือกเอง (Auto) และที่ agent ล็อกโมเดลไว้ · fallback = router ล่มหรือช้าเกิน 3 วินาที → Sonnet',
  },
};
export const LANGS = ['th', 'en'];

const stored = (() => { try { return localStorage.getItem('lang'); } catch { return null; } })();
let lang = LANGS.includes(stored) ? stored : (navigator.language || '').startsWith('th') ? 'th' : 'en';
document.documentElement.lang = lang;
const subs = new Set();

export const getLang = () => lang;
export function setLang(l) {
  lang = l;
  try { localStorage.setItem('lang', l); } catch { /* private mode */ }
  document.documentElement.lang = l;
  subs.forEach(f => f());
}
export const useLang = () => useSyncExternalStore(f => (subs.add(f), () => subs.delete(f)), getLang);
export const t = (k, v = {}) => (DICT[lang][k] ?? DICT.en[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => v[n] ?? '');
export const locale = () => (lang === 'th' ? 'th-TH' : 'en-GB');
// Config text may carry an `en` override: { title, text, en: { title, text } }.
export const loc = o => (lang === 'en' && o?.en ? { ...o, ...o.en } : o);
