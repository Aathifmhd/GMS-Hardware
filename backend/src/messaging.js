// Messaging: SMS, WhatsApp and Email with templates, logging and automatic reminders.
const nodemailer = require('nodemailer');
const { db, getSettings, setSetting } = require('./db');
const L = require('./ledger');

const CHANNELS = ['sms', 'whatsapp', 'email'];

function money(n, s) {
  const v = Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${s.currency || 'Rs.'} ${v}`;
}

// Normalise local numbers (0771234567) to international digits (94771234567).
function normalizePhone(phone, countryCode) {
  let p = String(phone || '').replace(/[^\d+]/g, '');
  if (!p) return '';
  if (p.startsWith('+')) return p.slice(1);
  if (p.startsWith('00')) return p.slice(2);
  if (p.startsWith('0')) return (countryCode || '') + p.slice(1);
  if (countryCode && p.length <= 9) return countryCode + p;
  return p;
}

function render(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

async function customerVars(customer, extra = {}, s) {
  s = s || (await getSettings());
  const b = await L.customerBalance(customer.id);
  const out = {
    name: customer.name,
    code: customer.code,
    business: s.business_name,
    phone: s.business_phone,
    balance: money(b.balance, s),
    overdue: money(b.overdue, s),
    limit: money(customer.credit_limit, s),
    period: customer.credit_period_days,
    rate: s.interest_rate,
    cycle: s.interest_cycle_days,
    date: L.today(),
  };
  for (const [k, v] of Object.entries(extra)) {
    out[k] = (k === 'amount' && typeof v === 'number') ? money(v, s) : v;
  }
  return out;
}

// ---------- providers ----------
async function sendSms(to, body, s) {
  const num = normalizePhone(to, s.country_code);
  if (!num) throw new Error('No phone number');
  switch (s.sms_provider) {
    case 'notifylk': {
      const u = new URL('https://app.notify.lk/api/v1/send');
      u.search = new URLSearchParams({
        user_id: s.sms_notifylk_user_id, api_key: s.sms_notifylk_api_key,
        sender_id: s.sms_sender_id || 'NotifyDEMO', to: num, message: body,
      });
      const r = await fetch(u);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || (j.status && j.status !== 'success')) throw new Error(j.errors ? JSON.stringify(j.errors) : `Notify.lk HTTP ${r.status}`);
      return;
    }
    case 'textlk': {
      const r = await fetch('https://app.text.lk/api/v3/sms/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${s.sms_textlk_token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ recipient: num, sender_id: s.sms_sender_id, type: 'plain', message: body }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.status === 'error') throw new Error(j.message || `Text.lk HTTP ${r.status}`);
      return;
    }
    case 'generic': {
      if (!s.sms_generic_url) throw new Error('Generic SMS URL not configured');
      const url = render(s.sms_generic_url, { to: encodeURIComponent(num), message: encodeURIComponent(body) });
      const opts = { method: s.sms_generic_method || 'GET' };
      if (opts.method === 'POST') {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = render(s.sms_generic_body || '{"to":"{to}","message":"{message}"}',
          { to: num, message: JSON.stringify(body).slice(1, -1) });
      }
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`SMS gateway HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return;
    }
    default:
      throw new Error('SMS gateway not configured (Settings → SMS)');
  }
}

async function sendWhatsapp(to, body, s) {
  const num = normalizePhone(to, s.country_code);
  if (!num) throw new Error('No WhatsApp number');
  if (s.whatsapp_mode === 'cloudapi') {
    if (!s.whatsapp_token || !s.whatsapp_phone_id) throw new Error('WhatsApp Cloud API not configured');
    const r = await fetch(`https://graph.facebook.com/v21.0/${s.whatsapp_phone_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.whatsapp_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: num, type: 'text', text: { body } }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `WhatsApp HTTP ${r.status}`);
    return { status: 'sent' };
  }
  // click-to-chat: staff opens the link to send from the shop's WhatsApp
  return { status: 'link', link: `https://wa.me/${num}?text=${encodeURIComponent(body)}` };
}

async function sendEmail(to, subject, body, s) {
  if (!to) throw new Error('No email address');
  if (s.email_enabled !== '1' || !s.smtp_host) throw new Error('Email (SMTP) not configured');
  const transport = nodemailer.createTransport({
    host: s.smtp_host,
    port: Number(s.smtp_port) || 587,
    secure: s.smtp_secure === '1',
    auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_pass } : undefined,
  });
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
    <div style="background:#0f172a;color:#fbbf24;padding:18px 22px;font-size:20px;font-weight:700">${escapeHtml(s.business_name)}</div>
    <div style="padding:22px;color:#111827;font-size:15px;line-height:1.6">${escapeHtml(body).replace(/\n/g, '<br>')}</div>
    <div style="padding:12px 22px;background:#f9fafb;color:#6b7280;font-size:12px">${escapeHtml([s.business_address, s.business_phone].filter(Boolean).join(' · '))}</div></div>`;
  await transport.sendMail({ from: s.smtp_from || s.smtp_user, to, subject: subject || s.business_name, text: body, html });
}

function escapeHtml(t) {
  return String(t || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function recipientFor(customer, channel) {
  if (channel === 'email') return customer.email;
  if (channel === 'whatsapp') return customer.whatsapp || customer.phone;
  return customer.phone;
}

// Send one message and log it. Never throws: failures are logged with status 'failed'.
async function send({ customer, channel, subject, body, kind = 'manual', userId, recipient, settings }) {
  const s = settings || (await getSettings());
  const to = recipient || (customer ? recipientFor(customer, channel) : '');
  let status = 'sent', error = null, link = null;
  try {
    if (channel === 'sms') await sendSms(to, body, s);
    else if (channel === 'whatsapp') { const r = await sendWhatsapp(to, body, s); status = r.status; link = r.link || null; }
    else if (channel === 'email') await sendEmail(to, subject, body, s);
    else throw new Error('Unknown channel');
  } catch (e) {
    status = 'failed';
    error = e.message;
  }
  const r = await db.get(`INSERT INTO messages (customer_id, channel, recipient, subject, body, kind, status, error, link, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    customer ? customer.id : null, channel, to || null, subject || null, body, kind, status, error, link, userId || null);
  return { id: r.id, channel, recipient: to, status, error, link };
}

function template(key) {
  return db.get('SELECT * FROM templates WHERE key = ?', key);
}

// Can this channel deliver right now? Background jobs need a real gateway; a user at the
// screen can also use a WhatsApp click-to-chat link.
function channelReady(channel, s, interactive) {
  if (channel === 'sms') return s.sms_provider && s.sms_provider !== 'none';
  if (channel === 'email') return s.email_enabled === '1' && !!s.smtp_host;
  if (channel === 'whatsapp') return s.whatsapp_mode === 'cloudapi' ? !!(s.whatsapp_token && s.whatsapp_phone_id) : interactive;
  return false;
}

// Send a templated message on the customer's preferred channel, falling back to the default
// channel (and to a WhatsApp link when a user is present). Skips silently if nothing can deliver.
async function notify(customerId, templateKey, extra = {}, kind = templateKey, userId = null) {
  const [customer, t, s] = await Promise.all([db.get('SELECT * FROM customers WHERE id = ?', customerId), template(templateKey), getSettings()]);
  if (!customer || !t) return null;
  const interactive = userId != null;
  const candidates = [customer.preferred_channel, s.default_channel, 'sms', 'whatsapp', 'email'];
  const channel = candidates.find((ch) => CHANNELS.includes(ch) && channelReady(ch, s, interactive) && recipientFor(customer, ch));
  if (!channel) return null;
  const vars = await customerVars(customer, extra, s);
  return send({ customer, channel, subject: render(t.subject, vars), body: render(t.body, vars), kind, userId, settings: s });
}

// ---------- daily automation ----------
// Runs interest, due-date reminders and overdue notices. Safe to call repeatedly.
async function runDailyAutomation({ force = false } = {}) {
  const s = await getSettings();
  const day = L.today();
  const result = { interest: [], reminders: 0, overdue: 0, skipped: false };
  result.interest = await L.runInterest(day);

  if (s.auto_notify_interest === '1') {
    for (const c of result.interest) {
      await notify(c.customer_id, 'interest_applied', { amount: c.amount, ref_no: c.parent_ref, rate: c.rate }, 'interest');
    }
  }

  if (!force && s.last_auto_run === day) { result.skipped = true; return result; }
  await setSetting('last_auto_run', day);

  if (s.auto_due_reminder === '1') {
    const target = L.addDays(day, Number(s.due_reminder_days) || 3);
    const bills = await db.all(`SELECT t.* FROM transactions t JOIN customers c ON c.id = t.customer_id
      WHERE t.voided = 0 AND t.type IN ('credit','opening') AND t.due_date = ? AND t.amount - t.settled > 0.004
        AND c.status = 'active'`, target);
    for (const b of bills) {
      const r = await notify(b.customer_id, 'due_reminder',
        { amount: L.round2(b.amount - b.settled), ref_no: b.ref_no, due_date: b.due_date }, 'reminder');
      if (r) result.reminders++;
    }
  }

  if (s.auto_overdue_notice === '1') {
    const every = Math.max(1, Number(s.overdue_notice_every_days) || 7);
    const customers = (await db.all(`SELECT c.id, ${L.balanceColumns(day)},
        (SELECT MAX(substr(m.created_at, 1, 10)) FROM messages m WHERE m.customer_id = c.id AND m.kind = 'overdue') AS last_notice
      FROM customers c WHERE c.status != 'inactive'`)).filter((c) => c.overdue > 0.004);
    for (const c of customers) {
      if (c.last_notice && L.diffDays(day, c.last_notice) < every) continue;
      const r = await notify(c.id, 'overdue_notice', {}, 'overdue');
      if (r) result.overdue++;
    }
  }
  return result;
}

module.exports = { CHANNELS, send, notify, render, customerVars, template, runDailyAutomation, normalizePhone, money };
