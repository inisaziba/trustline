import {
  router,
  json,
  error,
  requireAuth,
  withScopes,
  requireAdminEmailAllowlist,
  db,
  ai,
  secrets,
} from '@appdeploy/sdk';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';

const OWNER_EMAIL = 'trustlinesolutions@outlook.com';
const ADMIN_EMAILS = ['trustlinesolutions@outlook.com'];
const KINDS = ['clients', 'providers', 'cases', 'payments', 'pricing'] as const;
type Kind = (typeof KINDS)[number];
type StaffRole = 'owner' | 'admin' | 'staff' | 'customer_service';

const TABLES: Record<Kind, string> = {
  clients: 'tc_org_clients',
  providers: 'tc_org_providers',
  cases: 'tc_org_cases',
  payments: 'tc_org_payments',
  pricing: 'tc_org_pricing',
};
const STAFF_TABLE = 'tc_org_staff';
const PUBLIC_CONFIG_TABLE = 'tc_org_public_config';
const BRAND_ASSETS_TABLE = 'tc_org_brand_assets';
const WALLETS_TABLE = 'tc_org_member_wallets';
const WALLET_TX_TABLE = 'tc_org_wallet_transactions';
const PAYMENT_GATEWAY_TABLE = 'tc_org_payment_gateway';
const DEFAULT_PUBLIC_CONFIG = {
  brandName: 'TrustlineCover',
  tagline: 'HEALTHCARE, MADE CLEAR',
  heroHeadline: 'Healthcare should feel easier.',
  heroDescription: 'Finding the right healthcare cover is one thing. Knowing who to speak to, what happens next and where to turn for support matters just as much.',
  heroSubtext: 'TrustlineCover helps individuals and families choose a suitable plan while we manage the healthcare arrangements, approvals and ongoing support behind the scenes.',
  supportEmail: 'trustlinesolutions@outlook.com',
  supportPhone: '',
  whatsapp: '',
  instagram: '',
  facebook: '',
  linkedin: '',
  paymentInstructions: '',
  plans: [
    { name: 'Essential', monthlyRate: 7000, description: 'A simple starting option for everyday healthcare support.', benefits: 'Digital care access card; Plan benefit guidance; Care request coordination' },
    { name: 'Plus', monthlyRate: 10000, description: 'More support for individuals and families seeking added reassurance.', benefits: 'Everything in Essential; Priority request follow up; Expanded plan benefit guidance' },
    { name: 'Premium', monthlyRate: 20000, description: 'An enhanced option for members who want a higher level of coordinated support.', benefits: 'Everything in Plus; Enhanced care coordination; Dedicated follow up support' }
  ]
};

async function readPublicConfig() {
  const [saved] = await db.get<Record<string, any>>(PUBLIC_CONFIG_TABLE, ['public'], { consistent: true });
  const config = { ...DEFAULT_PUBLIC_CONFIG, ...(saved || {}) };
  const slots = await db.get<Record<string, any>>(BRAND_ASSETS_TABLE, ['logo', 'favicon', 'hero'], { consistent: true });
  return {
    ...config,
    logoImage: slots[0]?.dataUri || '',
    faviconImage: slots[1]?.dataUri || '',
    heroImage: slots[2]?.dataUri || '',
  };
}

async function savePublicConfig(changes: Record<string, unknown>) {
  const [saved] = await db.get<Record<string, any>>(PUBLIC_CONFIG_TABLE, ['public'], { consistent: true });
  if (saved) {
    const [ok] = await db.tx.update(PUBLIC_CONFIG_TABLE, [{ id: 'public', record: changes }], { patch: true });
    if (!ok) throw new Error('Could not update public settings');
  } else {
    const [id] = await db.tx.add(PUBLIC_CONFIG_TABLE, [{ id: 'public', ...DEFAULT_PUBLIC_CONFIG, ...changes }]);
    if (!id) throw new Error('Could not create public settings');
  }
}

function addMonths(value: Date, months: number) {
  const result = new Date(value);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function normaliseEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

async function roleFor(emailValue: unknown): Promise<StaffRole | null> {
  const email = normaliseEmail(emailValue);
  if (!email) return null;
  if (email === OWNER_EMAIL) return 'owner';
  const result = await db.list(STAFF_TABLE, {
    filter: { email },
    limit: 5,
  });
  const person = result.items.find(item => item.status !== 'Inactive');
  if (!person) return null;
  if (person.role === 'admin' || person.role === 'staff' || person.role === 'customer_service') return person.role;
  return null;
}

async function memberForEmail(emailValue: unknown): Promise<Record<string, any> | null> {
  const email = normaliseEmail(emailValue);
  if (!email) return null;
  const result = await db.list<Record<string, any>>(TABLES.clients, { filter: { email }, limit: 5 });
  if (result.items[0]) return result.items[0];
  const byLogin = await db.list<Record<string, any>>(TABLES.clients, { filter: { authEmail: email }, limit: 5 });
  return byLogin.items[0] || null;
}

function publicMember(member: Record<string, any>) {
  return {
    id: member.id,
    fullName: member.fullName,
    email: member.email,
    phone: member.phone,
    cardNumber: member.cardNumber,
    membership: member.membership,
    planName: member.planName,
    benefits: member.benefits,
    billingFrequency: member.billingFrequency,
    status: member.status,
    accessStatus: member.accessStatus,
    waitingPeriodEndsAt: member.waitingPeriodEndsAt || '',
    coverageStartsAt: member.coverageStartsAt || '',
    coverageExpiresAt: member.coverageExpiresAt || '',
    createdAt: member.createdAt,
    referralCode: member.referralCode || '',
    walletBalance: Number(member.walletBalance) || 0,
    rewardPoints: Number(member.rewardPoints) || 0,
  };
}

async function createReferralCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = 'TC' + Math.random().toString(36).slice(2, 9).toUpperCase();
    const matches = await db.list<Record<string, any>>(TABLES.clients, { filter: { referralCode: code }, limit: 1 });
    if (!matches.items.length) return code;
  }
  throw new Error('Could not create a unique referral code');
}

async function ensureWallet(memberId: string) {
  const [wallet] = await db.get<Record<string, any>>(WALLETS_TABLE, [memberId], { consistent: true });
  if (wallet) return wallet;
  const initial = { id: memberId, memberId, balance: 0, points: 0, updatedAt: new Date().toISOString() };
  const [id] = await db.add(WALLETS_TABLE, [initial]);
  if (!id) throw new Error('Could not create member wallet');
  return initial;
}

async function addWalletTransaction(memberId: string, type: string, amount: number, points: number, reference: string, description: string) {
  await db.add(WALLET_TX_TABLE, [{ memberId, type, amount, points, reference, description, createdAt: new Date().toISOString() }]);
}

async function processPaymentRewards(paymentId: string, payment: Record<string, any>) {
  const [storedPayment] = await db.get<Record<string, any>>(TABLES.payments, [paymentId], { consistent: true });
  const currentPayment = storedPayment || payment;
  if (currentPayment.rewardsProcessedAt || currentPayment.status !== 'Paid') return;
  const amount = Number(currentPayment.amount) || 0;
  if (amount <= 0 || !currentPayment.clientId) return;
  const memberId = String(currentPayment.clientId);
  const [member] = await db.get<Record<string, any>>(TABLES.clients, [memberId], { consistent: true });
  if (!member) return;
  const wallet = await ensureWallet(memberId);
  const pointsEarned = currentPayment.type === 'wallet_funding' ? Math.round(amount * 0.01 * 100) / 100 : 0;
  const [walletUpdated] = await db.tx.update(WALLETS_TABLE, [{ id: memberId, record: { points: Number(wallet.points || 0) + pointsEarned, updatedAt: new Date().toISOString() } }], { patch: true });
  if (walletUpdated && pointsEarned > 0) await addWalletTransaction(memberId, 'funding_points', 0, pointsEarned, paymentId, '1% wallet funding reward');
  const referrerId = String(member.referredByMemberId || '');
  let referralEarned = 0;
  if (referrerId && referrerId !== memberId) {
    referralEarned = Math.round(amount * 0.025 * 100) / 100;
    const referrerWallet = await ensureWallet(referrerId);
    const [referrerUpdated] = await db.tx.update(WALLETS_TABLE, [{ id: referrerId, record: { balance: Number(referrerWallet.balance || 0) + referralEarned, updatedAt: new Date().toISOString() } }], { patch: true });
    if (referrerUpdated && referralEarned > 0) await addWalletTransaction(referrerId, 'referral_earning', referralEarned, 0, paymentId, '2.5% referral reward from a confirmed payment');
  }
  await db.tx.update(TABLES.payments, [{ id: paymentId, record: { rewardsProcessedAt: new Date().toISOString(), referralRewardAmount: referralEarned, fundingRewardPoints: pointsEarned } }], { patch: true });
}

async function walletSummary(memberId: string) {
  const wallet = await ensureWallet(memberId);
  const transactions = await db.list<Record<string, any>>(WALLET_TX_TABLE, { filter: { memberId }, limit: 100 });
  return { balance: Number(wallet.balance || 0), points: Number(wallet.points || 0), transactions: transactions.items };
}

async function requireStaff(ctx: any) {
  const role = await roleFor(ctx.user?.email);
  if (!role) return error('An authorised TrustlineCover team account is required', 403);
  return undefined;
}

async function getMemberForAi(ctx: any, clientId?: string) {
  const role = await roleFor(ctx.user?.email);
  if (role) {
    if (!clientId) return null;
    const [member] = await db.get<Record<string, any>>(TABLES.clients, [clientId], { consistent: true });
    return member ? { ...member, id: clientId } : null;
  }
  return memberForEmail(ctx.user?.email);
}


const EMAIL_SETTINGS_TABLE = 'tc_org_smtp_settings';
const EMAIL_LOG_TABLE = 'tc_org_email_logs';
const EMAIL_BACKFILL_TABLE = 'tc_org_email_backfill';

function encryptEmailConfig(config: Record<string, any>, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

function decryptEmailConfig(value: string, key: Buffer) {
  const [iv, tag, data] = value.split('.');
  if (!iv || !tag || !data) throw new Error('Invalid SMTP settings');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')) as Record<string, any>;
}

async function emailEncryptionKey() {
  const names = await secrets.listSecretNames();
  if (!names.includes('SMTP_ENCRYPTION_KEY')) throw new Error('SMTP encryption key is missing');
  const value = await secrets.readSecret('SMTP_ENCRYPTION_KEY');
  if (value.length < 32) throw new Error('SMTP encryption key must be at least 32 characters');
  return createHash('sha256').update(value).digest();
}

async function getEmailConfig() {
  const [saved] = await db.get<Record<string, any>>(EMAIL_SETTINGS_TABLE, ['settings'], { consistent: true });
  if (!saved?.encryptedConfig) return null;
  return decryptEmailConfig(String(saved.encryptedConfig), await emailEncryptionKey());
}

async function sendEmail(config: Record<string, any>, to: string, subject: string, text: string, messageId?: string) {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: Number(config.port),
    secure: config.secure === true,
    auth: { user: config.username, pass: config.password },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 25000,
  });
  return transport.sendMail({
    from: '"' + String(config.fromName || 'TrustlineCover').replace(/["\r\n]/g, '') + '" <' + config.fromEmail + '>',
    to,
    subject,
    text,
    ...(messageId ? { messageId } : {}),
  });
}

async function logEmail(record: Record<string, unknown>) {
  await db.add(EMAIL_LOG_TABLE, [{ ...record, createdAt: new Date().toISOString() }]);
}

function emailLagosDate(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return part('year') + '-' + part('month') + '-' + part('day');
}

function emailShiftDate(date: string, days: number) {
  const value = new Date(date + 'T00:00:00.000Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function emailDueTable(date: string) {
  return 'tc_email_due_' + date.replace(/-/g, '');
}

function emailReminderId(memberId: string, expiry: string, days: number) {
  return 'r_' + createHash('sha256').update(memberId + '|' + expiry + '|' + days).digest('hex').slice(0, 40);
}

async function queueMemberReminders(members: Array<Record<string, any>>) {
  const grouped = new Map<string, Array<Record<string, any>>>();
  for (const member of members) {
    if (!member.id || !member.coverageExpiresAt) continue;
    const expiry = new Date(String(member.coverageExpiresAt));
    if (Number.isNaN(expiry.getTime())) continue;
    const expiryDate = emailLagosDate(expiry);
    for (const days of [7, 3, 1, 0]) {
      const table = emailDueTable(emailShiftDate(expiryDate, -days));
      const records = grouped.get(table) || [];
      records.push({
        id: emailReminderId(String(member.id), expiryDate, days),
        memberId: String(member.id),
        expiryDate,
        reminderDays: days,
        status: 'Pending',
        attempts: 0,
        createdAt: new Date().toISOString(),
      });
      grouped.set(table, records);
    }
  }
  for (const [table, records] of grouped) {
    for (let i = 0; i < records.length; i += 100) {
      await db.tx.add(table, records.slice(i, i + 100));
    }
  }
}

async function canUseEmailCentre(email: unknown) {
  const role = await roleFor(email);
  return role === 'owner' || role === 'admin' || role === 'staff';
}

export const renewalEmailCron = async (event: {
  type: 'cron'; name: string; invocationId: string; scheduledTime: string; invokedTime: string;
}) => {
  const today = emailLagosDate(new Date());

  // Migrate existing member expiry dates in one bounded page per run.
  try {
    let [cursor] = await db.get<Record<string, any>>(EMAIL_BACKFILL_TABLE, ['members'], { consistent: true });
    if (!cursor) {
      await db.tx.add(EMAIL_BACKFILL_TABLE, [{ id: 'members', complete: false, nextToken: '' }]);
      [cursor] = await db.get<Record<string, any>>(EMAIL_BACKFILL_TABLE, ['members'], { consistent: true });
    }
    if (cursor && !cursor.complete) {
      const page = await db.list<Record<string, any>>(TABLES.clients, {
        limit: 100,
        ...(cursor.nextToken ? { nextToken: cursor.nextToken } : {}),
      });
      await queueMemberReminders(page.items);
      await db.tx.update(EMAIL_BACKFILL_TABLE, [{
        id: 'members',
        record: { complete: !page.nextToken, nextToken: page.nextToken || '', updatedAt: new Date().toISOString() },
      }], { patch: true });
    }
  } catch {
    // The next scheduled run resumes the backfill cursor.
  }

  let config: Record<string, any> | null = null;
  try { config = await getEmailConfig(); } catch { return { statusCode: 200 }; }
  if (!config) return { statusCode: 200 };

  // Read only the date partitions due within the last seven days, never the full member table.
  for (let age = 0; age <= 7; age += 1) {
    const table = emailDueTable(emailShiftDate(today, -age));
    let nextToken: string | undefined;
    do {
      const page = await db.list<Record<string, any>>(table, { limit: 500, ...(nextToken ? { nextToken } : {}) });
      for (const reminder of page.items) {
        if (!['Pending', 'Failed'].includes(String(reminder.status || 'Pending')) || Number(reminder.attempts || 0) >= 3) continue;
        const [member] = await db.get<Record<string, any>>(TABLES.clients, [String(reminder.memberId)], { consistent: true });
        if (!member?.email) {
          await db.tx.update(table, [{ id: reminder.id, record: { status: 'Skipped', processedAt: new Date().toISOString() } }], { patch: true });
          continue;
        }
        const expiry = new Date(String(member.coverageExpiresAt || ''));
        if (Number.isNaN(expiry.getTime()) || emailLagosDate(expiry) !== reminder.expiryDate) {
          await db.tx.update(table, [{ id: reminder.id, record: { status: 'Cancelled', processedAt: new Date().toISOString() } }], { patch: true });
          continue;
        }
        const daysLeft = Math.round((new Date(String(reminder.expiryDate) + 'T00:00:00.000Z').getTime() - new Date(today + 'T00:00:00.000Z').getTime()) / 86400000);
        const name = String(member.fullName || 'Member').trim().split(/\s+/)[0];
        const subject = daysLeft < 0
          ? 'Your TrustlineCover cover has expired'
          : daysLeft === 0
            ? 'Your TrustlineCover cover expires today'
            : 'Your TrustlineCover cover expires in ' + daysLeft + (daysLeft === 1 ? ' day' : ' days');
        const body = daysLeft < 0
          ? 'Hello ' + name + ',\n\nOur records show that your TrustlineCover cover expired on ' + reminder.expiryDate + '. Please sign in or contact our team to review your renewal options and confirm your current membership status.\n\nThank you for choosing TrustlineCover.'
          : 'Hello ' + name + ',\n\nThis is a reminder that your TrustlineCover cover is scheduled to expire on ' + reminder.expiryDate + '. There are ' + daysLeft + (daysLeft === 1 ? ' day' : ' days') + ' remaining. Please sign in or contact our team to review your renewal options and avoid an interruption.\n\nThank you for choosing TrustlineCover.';
        await db.tx.update(table, [{
          id: reminder.id,
          record: { status: 'Processing', attempts: Number(reminder.attempts || 0) + 1, processingAt: new Date().toISOString() },
        }], { patch: true });
        try {
          await sendEmail(config, String(member.email), subject, body, '<' + String(reminder.id) + '@trustlinecover.ng>');
          await db.tx.update(table, [{ id: reminder.id, record: { status: 'Sent', subject, sentAt: new Date().toISOString() } }], { patch: true });
          await logEmail({ recipientEmail: member.email, recipientName: member.fullName || '', subject, status: 'Accepted by SMTP', source: 'Automatic renewal reminder', reminderId: reminder.id, sentAt: new Date().toISOString() });
        } catch (sendError) {
          await db.tx.update(table, [{ id: reminder.id, record: { status: 'Failed', error: String(sendError).slice(0, 250) } }], { patch: true });
          await logEmail({ recipientEmail: member.email, recipientName: member.fullName || '', subject, status: 'Failed', source: 'Automatic renewal reminder', reminderId: reminder.id, error: String(sendError).slice(0, 250) });
        }
      }
      nextToken = page.nextToken;
    } while (nextToken);
  }
  return { statusCode: 200 };
};

export const handler = router({
  'GET /api/session': [
    requireAuth(),
    withScopes('email'),
    async ctx => {
      const email = normaliseEmail(ctx.user?.email);
      if (!email) return error('Your sign in did not provide a verified email address', 403);
      const role = await roleFor(email);
      if (role) return json({ role, email, userId: ctx.user!.userId });
      const member = await memberForEmail(email);
      if (member) {
        let current = member;
        if (!current.referralCode) {
          const referralCode = await createReferralCode();
          await db.tx.update(TABLES.clients, [{ id: String(current.id), record: { referralCode } }], { patch: true });
          current = { ...current, referralCode };
        }
        const wallet = await ensureWallet(String(current.id));
        current = { ...current, walletBalance: wallet.balance, rewardPoints: wallet.points };
        return json({ role: 'client', email, member: publicMember(current) });
      }
      return json({ role: 'unassigned', email });
    },
  ],

  'GET /api/public-config': [
    async () => {
      try {
        return json(await readPublicConfig());
      } catch {
        return json(DEFAULT_PUBLIC_CONFIG);
      }
    },
  ],

  'GET /api/admin/public-config': [
    requireAuth(),
    withScopes('email'),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    async () => json(await readPublicConfig()),
  ],

  'PUT /api/admin/public-config': [
    requireAuth(),
    withScopes('email'),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    async ctx => {
      const body = (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body))
        ? ctx.body as Record<string, unknown>
        : {};
      const allowed = ['brandName', 'tagline', 'heroHeadline', 'heroDescription', 'heroSubtext', 'supportEmail', 'supportPhone', 'whatsapp', 'instagram', 'facebook', 'linkedin', 'paymentInstructions', 'plans'];
      const changes: Record<string, unknown> = {};
      for (const key of allowed) {
        if (body[key] !== undefined) changes[key] = body[key];
      }
      if (typeof changes.brandName === 'string') changes.brandName = changes.brandName.slice(0, 80);
      if (typeof changes.tagline === 'string') changes.tagline = changes.tagline.slice(0, 120);
      if (typeof changes.heroHeadline === 'string') changes.heroHeadline = changes.heroHeadline.slice(0, 180);
      if (typeof changes.heroDescription === 'string') changes.heroDescription = changes.heroDescription.slice(0, 700);
      if (typeof changes.heroSubtext === 'string') changes.heroSubtext = changes.heroSubtext.slice(0, 700);
      if (typeof changes.paymentInstructions === 'string') changes.paymentInstructions = changes.paymentInstructions.slice(0, 2000);
      if (changes.plans !== undefined) {
        if (!Array.isArray(changes.plans) || changes.plans.length !== 3) return error('Please provide all three plan options', 400);
        const validPlans = changes.plans.every((p: any) => p && typeof p.name === 'string' && p.name.trim() && Number(p.monthlyRate) >= 0 && Number.isFinite(Number(p.monthlyRate)));
        if (!validPlans) return error('Each plan needs a name and a valid monthly price', 400);
        changes.plans = changes.plans.map((p: any) => ({
          name: String(p.name).slice(0, 50),
          monthlyRate: Number(p.monthlyRate),
          description: String(p.description || '').slice(0, 300),
          benefits: String(p.benefits || '').slice(0, 1200),
        }));
      }
      try {
        await savePublicConfig(changes);
        return json({ saved: true, config: await readPublicConfig() });
      } catch {
        return error('Public settings could not be saved', 500);
      }
    },
  ],

  'GET /api/admin/payment-gateway': [
    requireAuth(),
    withScopes('email'),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    async () => {
      const [saved] = await db.get<Record<string, any>>(PAYMENT_GATEWAY_TABLE, ['settings'], { consistent: true });
      return json(saved || { activeGateway: 'none', mode: 'test', publicKey: '', merchantId: '', currency: 'NGN', enabled: false, updatedAt: '' });
    },
  ],

  'PUT /api/admin/payment-gateway': [
    requireAuth(),
    withScopes('email'),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    async ctx => {
      const body = (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body)) ? ctx.body as Record<string, unknown> : {};
      const activeGateway = String(body.activeGateway || 'none');
      const mode = String(body.mode || 'test');
      const publicKey = String(body.publicKey || '').trim().slice(0, 500);
      const merchantId = String(body.merchantId || '').trim().slice(0, 200);
      const enabled = body.enabled === true;
      if (!['none', 'flutterwave', 'paystack', 'quickteller'].includes(activeGateway)) return error('Choose a supported payment gateway', 400);
      if (!['test', 'live'].includes(mode)) return error('Choose test or live mode', 400);
      if (enabled && activeGateway === 'none') return error('Select a payment gateway before enabling payments', 400);
      const settings = { id: 'settings', activeGateway, mode, publicKey, merchantId, currency: 'NGN', enabled, updatedAt: new Date().toISOString() };
      try {
        const [existing] = await db.get<Record<string, any>>(PAYMENT_GATEWAY_TABLE, ['settings'], { consistent: true });
        if (existing) {
          const [ok] = await db.tx.update(PAYMENT_GATEWAY_TABLE, [{ id: 'settings', record: settings }], { patch: true });
          if (!ok) return error('Payment gateway settings could not be saved', 500);
        } else {
          const [id] = await db.tx.add(PAYMENT_GATEWAY_TABLE, [settings]);
          if (!id) return error('Payment gateway settings could not be saved', 500);
        }
        return json({ ...settings, saved: true });
      } catch { return error('Payment gateway settings could not be saved', 500); }
    },
  ],

  'POST /api/admin/brand-image': [
    requireAuth(),
    withScopes('email'),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    async ctx => {
      const body = (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body))
        ? ctx.body as Record<string, unknown>
        : {};
      const slot = String(body.slot || '');
      const dataUri = String(body.dataUri || '');
      if (!['logo', 'favicon', 'hero'].includes(slot)) return error('Choose a valid image type', 400);
      if (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(dataUri) || dataUri.length > 180000)
        return error('Please use a supported image under 130 KB after compression', 400);
      try {
        const [existing] = await db.get<Record<string, any>>(BRAND_ASSETS_TABLE, [slot], { consistent: true });
        if (existing) {
          const [ok] = await db.tx.update(BRAND_ASSETS_TABLE, [{ id: slot, record: { dataUri, updatedAt: new Date().toISOString() } }], { patch: true });
          if (!ok) return error('Image could not be updated', 500);
        } else {
          const [id] = await db.tx.add(BRAND_ASSETS_TABLE, [{ id: slot, dataUri, updatedAt: new Date().toISOString() }]);
          if (!id) return error('Image could not be saved', 500);
        }
        return json({ saved: true, slot });
      } catch {
        return error('Image could not be saved. Please try a smaller image.', 500);
      }
    },
  ],

  'POST /api/member/enrolment': [
    requireAuth(),
    withScopes('email'),
    async ctx => {
      const email = normaliseEmail(ctx.user?.email);
      if (!email) return error('Please confirm your email address before continuing', 403);
      const body = (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body))
        ? ctx.body as Record<string, unknown>
        : {};
      const fullName = String(body.fullName || '').trim();
      const dateOfBirth = String(body.dateOfBirth || '').trim();
      const nin = String(body.nin || '').replace(/\D/g, '');
      const phone = String(body.phone || '').trim();
      const planName = String(body.planName || '').trim();
      const billingFrequency = String(body.billingFrequency || 'Monthly');
      const suppliedReferralCode = String(body.referralCode || '').trim().toUpperCase();
      if (!fullName || !phone || !planName || !dateOfBirth || !/^\d{11}$/.test(nin)) return error('Your full name, date of birth, valid 11 digit NIN, phone number and plan are required', 400);
      if (body.privacyConsent !== true) return error('Please read and accept the privacy notice before continuing', 400);
      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(dateOfBirth) || Number.isNaN(Date.parse(dateOfBirth)) || new Date(dateOfBirth) >= new Date()) return error('Please enter a valid date of birth', 400);
      const existing = await memberForEmail(email);
      if (existing) return error('An enrolment already exists for this email address', 409);
      const config = await readPublicConfig();
      const plan = config.plans.find((p: any) => p.name === planName);
      if (!plan) return error('Please choose one of the available TrustlineCover plans', 400);
      const multiplier = billingFrequency === 'Annually' ? 12 : billingFrequency === 'Quarterly' ? 3 : 1;
      const amount = Number(plan.monthlyRate) * multiplier;
      if (!Number.isFinite(amount) || amount <= 0) return error('This plan is not currently available for purchase', 400);
      const suffix = ctx.user!.userId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 48);
      const memberId = 'member_' + suffix;
      const paymentId = 'signup_' + suffix;
      let referredByMemberId = '';
      if (suppliedReferralCode) {
        const referrers = await db.list<Record<string, any>>(TABLES.clients, { filter: { referralCode: suppliedReferralCode }, limit: 2 });
        if (!referrers.items.length) return error('That referral code could not be found. Please check it and try again.', 400);
        referredByMemberId = String(referrers.items[0].id);
      }
      const referralCode = await createReferralCode();
      const member = {
        fullName, email, authEmail: email, phone, dateOfBirth, nin, privacyConsent: true, privacyConsentVersion: '2026-11-14', privacyConsentAt: new Date().toISOString(), identityVerificationStatus: 'Pending manual review', cardNumber: 'TC-' + suffix.slice(0, 10).toUpperCase(), referralCode, referredByMemberId, membership: 'Individual', benefits: plan.benefits,
        billingFrequency, planName, planPrice: amount, accessStatus: 'Pending approval',
        assignmentApproved: false, providerId: '', status: 'Pending',
        createdAt: new Date().toISOString(),
      };
      const payment = {
        clientId: memberId, amount, period: billingFrequency,
        dueDate: '', paidDate: '', status: 'Pending', reference: paymentId,
        description: 'New member plan enrolment', createdAt: new Date().toISOString(),
      };
      try {
        const [memberIds, paymentIds] = await db.transact([
          db.tx.add(TABLES.clients, [{ id: memberId, ...member }]),
          db.tx.add(TABLES.payments, [{ id: paymentId, ...payment }]),
          db.tx.add(WALLETS_TABLE, [{ id: memberId, memberId, balance: 0, points: 0, updatedAt: new Date().toISOString() }]),
        ]);
        if (!memberIds[0] || !paymentIds[0]) return error('Your enrolment could not be completed', 500);
        return json({
          enrolled: true,
          member: { id: memberId, fullName, email, phone, dateOfBirth, cardNumber: member.cardNumber, referralCode, membership: member.membership, benefits: member.benefits, billingFrequency, planName, planPrice: amount, accessStatus: member.accessStatus, status: member.status, identityVerificationStatus: member.identityVerificationStatus, createdAt: member.createdAt },
          payment: { ...payment, id: paymentId },
          paymentInstructions: config.paymentInstructions || '',
          message: 'Your plan request has been received. Your membership and care access will remain pending until payment and enrolment are reviewed by TrustlineCover.',
        }, 201);
      } catch {
        return error('Your enrolment could not be completed. Please try again or contact TrustlineCover.', 500);
      }
    },
  ],

  'GET /api/records/:kind': [
    requireAuth(),
    withScopes('email'),
    requireStaff,
    async ctx => {
      const kind = ctx.params.kind;
      if (!isKind(kind)) return error('Unknown record type', 404);
      const role = await roleFor(ctx.user?.email);
      if (!role) return error('An authorised TrustlineCover team account is required', 403);
      if (role === 'customer_service' && !['clients', 'cases'].includes(kind)) return error('This workspace role cannot view that record type', 403);
      if (role === 'staff' && !['clients', 'cases', 'payments'].includes(kind)) return error('This workspace role cannot view that record type', 403);
      try {
        const result = await db.list<Record<string, any>>(TABLES[kind], { limit: 100 });
        const items = role === 'owner' ? result.items : result.items.map(({ nin, dateOfBirth, authEmail, ...safe }) => safe);
        return json({ items, nextToken: result.nextToken });
      } catch {
        return error('Could not load records', 500);
      }
    },
  ],

  'POST /api/records/:kind': [
    requireAuth(),
    withScopes('email'),
    requireStaff,
    async ctx => {
      const kind = ctx.params.kind;
      if (!isKind(kind)) return error('Unknown record type', 404);
      if (!ctx.body || typeof ctx.body !== 'object' || Array.isArray(ctx.body))
        return error('Invalid record', 400);
      const role = await roleFor(ctx.user?.email);
      if (!role) return error('An authorised TrustlineCover team account is required', 403);
      if ((role === 'staff' || role === 'customer_service') && !['clients', 'cases'].includes(kind)) return error('This workspace role cannot create that record type', 403);
      const record: Record<string, unknown> = { ...(ctx.body as Record<string, unknown>), createdBy: normaliseEmail(ctx.user?.email), createdAt: new Date().toISOString() };
      if (kind === 'clients') {
        const email = normaliseEmail(record.email);
        if (!email || !String(record.fullName || '').trim() || !String(record.phone || '').trim())
          return error('Customer name, phone and email are required', 400);
        const existing = await memberForEmail(email);
        if (existing) return error('A customer with this email already exists', 409);
        record.email = email;
        record.cardNumber = 'TC-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
        record.accessStatus = 'Pending approval';
        record.assignmentApproved = false;
        record.providerId = '';
      }
      if (kind === 'providers') {
        const existing = await db.list(TABLES.providers, { limit: 100 });
        record.isPrimary = !existing.items.some(item => item.isPrimary === true);
      }
      try {
        const [id] = await db.add(TABLES[kind], [record]);
        if (!id) return error('Record could not be created', 500);
        return json({ item: { ...record, id } }, 201);
      } catch {
        return error('Could not save record', 500);
      }
    },
  ],

  'PUT /api/records/:kind/:id': [
    requireAuth(),
    withScopes('email'),
    requireStaff,
    async ctx => {
      const kind = ctx.params.kind;
      if (!isKind(kind)) return error('Unknown record type', 404);
      if (!ctx.body || typeof ctx.body !== 'object' || Array.isArray(ctx.body))
        return error('Invalid update', 400);
      const changes = ctx.body as Record<string, unknown>;
      const role = await roleFor(ctx.user?.email);
      if (!role) return error('An authorised TrustlineCover team account is required', 403);
      const allowedByKind: Record<Kind, string[]> = {
        clients: role === 'owner'
          ? ['status', 'providerId', 'accessStatus', 'assignmentApproved', 'notes', 'email', 'phone', 'nin', 'dateOfBirth']
          : role === 'admin'
            ? ['status', 'providerId', 'accessStatus', 'assignmentApproved', 'notes']
            : ['notes'],
        providers: ['status', 'isPrimary', 'notes'],
        cases: ['status', 'assignedProviderId', 'priority', 'nextFollowUp', 'notes'],
        payments: ['status', 'paidDate', 'reference', 'notes'],
        pricing: ['notes'],
      };
      if ((kind === 'providers' || kind === 'pricing' || kind === 'payments') && role !== 'owner' && role !== 'admin') return error('This workspace role cannot update that record type', 403);
      const safeChanges: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(changes)) {
        if (!allowedByKind[kind].includes(key)) return error('Only the Super Admin can change sensitive customer information. Other updates are restricted by your role.', 403);
        safeChanges[key] = value;
      }
      if (kind === 'clients' && safeChanges.email !== undefined) {
        const nextEmail = normaliseEmail(safeChanges.email);
        if (!nextEmail || !nextEmail.includes('@')) return error('Enter a valid customer email address', 400);
        const duplicate = await memberForEmail(nextEmail);
        if (duplicate && duplicate.id !== ctx.params.id) return error('Another customer already uses this email address', 409);
        const [current] = await db.get<Record<string, any>>(TABLES.clients, [ctx.params.id], { consistent: true });
        safeChanges.email = nextEmail;
        safeChanges.authEmail = current?.authEmail || current?.email || nextEmail;
      }
      if (kind === 'clients' && safeChanges.phone !== undefined && String(safeChanges.phone).replace(/\D/g, '').length < 7) return error('A valid phone number is required', 400);
      if (kind === 'clients' && safeChanges.nin !== undefined) {
        const nin = String(safeChanges.nin).replace(/\D/g, '');
        if (nin && !/^\d{11}$/.test(nin)) return error('NIN must contain exactly 11 digits', 400);
        safeChanges.nin = nin;
      }
      if (kind === 'clients' && safeChanges.dateOfBirth !== undefined) {
        const dateOfBirth = String(safeChanges.dateOfBirth);
        if (Number.isNaN(Date.parse(dateOfBirth)) || new Date(dateOfBirth) >= new Date()) return error('Enter a valid date of birth in the past', 400);
      }
      if (Object.keys(safeChanges).length === 0) return error('No changes supplied', 400);
      try {
        let paymentForRenewal: Record<string, any> | null = null;
        let memberForRenewal: Record<string, any> | null = null;
        if (kind === 'payments' && safeChanges.status === 'Paid') {
          const [paymentRecord] = await db.get<Record<string, any>>(TABLES.payments, [ctx.params.id], { consistent: true });
          paymentForRenewal = paymentRecord || null;
          if (paymentForRenewal?.clientId) {
            const [memberRecord] = await db.get<Record<string, any>>(TABLES.clients, [String(paymentForRenewal.clientId)], { consistent: true });
            memberForRenewal = memberRecord || null;
          }
        }
        if (kind === 'providers' && safeChanges.isPrimary === true) {
          const providers = await db.list(TABLES.providers, { limit: 100 });
          for (const provider of providers.items) {
            if (provider.id !== ctx.params.id && provider.isPrimary === true) {
              await db.update(TABLES.providers, [{
                id: provider.id,
                record: { ...provider, isPrimary: false },
              }]);
            }
          }
        }
        const [updated] = await db.tx.update(
          TABLES[kind],
          [{ id: ctx.params.id, record: safeChanges }],
          { patch: true }
        );
        if (!updated) return error('Record was not found', 404);
        if (kind === 'payments' && safeChanges.status === 'Paid' && paymentForRenewal?.type !== 'wallet_funding' && paymentForRenewal && memberForRenewal) {
          const now = safeChanges.paidDate ? new Date(String(safeChanges.paidDate)) : new Date();
          if (Number.isNaN(now.getTime())) return error('Please enter a valid payment date', 400);
          const period = String(paymentForRenewal.period || memberForRenewal.billingFrequency || 'Monthly');
          const months = period === 'Annually' ? 12 : period === 'Quarterly' ? 3 : 1;
          const firstPayment = !memberForRenewal.coverageExpiresAt;
          const previousExpiry = memberForRenewal.coverageExpiresAt ? new Date(memberForRenewal.coverageExpiresAt) : null;
          const lateRenewal = !!previousExpiry && now.getTime() > addDays(previousExpiry, 3).getTime();
          let coverageStartsAt: Date;
          let waitingPeriodEndsAt: Date;
          if (firstPayment) {
            const waitHours = period === 'Monthly' ? 7 * 24 : 48;
            waitingPeriodEndsAt = new Date(now.getTime() + waitHours * 60 * 60 * 1000);
            coverageStartsAt = waitingPeriodEndsAt;
          } else if (lateRenewal) {
            waitingPeriodEndsAt = addDays(now, 6);
            coverageStartsAt = waitingPeriodEndsAt;
          } else {
            coverageStartsAt = previousExpiry && previousExpiry > now ? previousExpiry : now;
            waitingPeriodEndsAt = coverageStartsAt;
          }
          const coverageExpiresAt = addMonths(coverageStartsAt, months);
          const accessChanges = {
            billingFrequency: period,
            lastPaymentAt: now.toISOString(),
            waitingPeriodEndsAt: waitingPeriodEndsAt.toISOString(),
            coverageStartsAt: coverageStartsAt.toISOString(),
            coverageExpiresAt: coverageExpiresAt.toISOString(),
            accessStatus: memberForRenewal.accessStatus === 'Approved' ? 'Approved' : (memberForRenewal.accessStatus || 'Pending approval'),
          };
          const [memberUpdated] = await db.tx.update(TABLES.clients, [{ id: String(paymentForRenewal.clientId), record: accessChanges }], { patch: true });
          if (!memberUpdated) return error('Payment was recorded but the membership dates could not be updated. Please review this member manually.', 500);
          try {
            await queueMemberReminders([{ id: String(paymentForRenewal.clientId), coverageExpiresAt: coverageExpiresAt.toISOString() }]);
          } catch {
            // The scheduled backfill will create any missing reminder records.
          }
        }
        if (kind === 'payments' && safeChanges.status === 'Paid' && paymentForRenewal) {
          await processPaymentRewards(ctx.params.id, { ...paymentForRenewal, ...safeChanges, status: 'Paid' });
        }
        const [item] = await db.get<Record<string, unknown>>(
          TABLES[kind],
          [ctx.params.id],
          { consistent: true }
        );
        return json({ item: item ? { ...item, id: ctx.params.id } : null });
      } catch {
        return error('Could not update record', 500);
      }
    },
  ],

  'DELETE /api/records/clients/:id': [
    requireAuth(),
    withScopes('email'),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    async ctx => {
      try {
        const [removed] = await db.delete(TABLES.clients, [ctx.params.id]);
        if (!removed) return error('Customer was not found', 404);
        await db.delete(WALLETS_TABLE, [ctx.params.id]);
        return json({ deleted: true, message: 'Customer record deleted. Related payment and care history remains available for audit purposes.' });
      } catch { return error('Customer could not be deleted', 500); }
    },
  ],

  'GET /api/admin/profile-change-requests': [
    requireAuth(), withScopes('email'), requireAdminEmailAllowlist(ADMIN_EMAILS),
    async () => {
      const result = await db.list<Record<string, any>>('tc_org_profile_change_requests', { limit: 100 });
      return json({ items: result.items });
    },
  ],

  'PUT /api/admin/profile-change-requests/:id': [
    requireAuth(), withScopes('email'), requireAdminEmailAllowlist(ADMIN_EMAILS),
    async ctx => {
      const body = (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body)) ? ctx.body as Record<string, unknown> : {};
      const decision = String(body.decision || '');
      if (!['Approved', 'Rejected'].includes(decision)) return error('Choose approve or reject', 400);
      const [request] = await db.get<Record<string, any>>('tc_org_profile_change_requests', [ctx.params.id], { consistent: true });
      if (!request || request.status !== 'Pending') return error('This request is no longer pending', 404);
      if (decision === 'Approved') {
        const [member] = await db.get<Record<string, any>>(TABLES.clients, [String(request.memberId)], { consistent: true });
        if (!member) return error('Customer record was not found', 404);
        const changes: Record<string, unknown> = {};
        if (request.requestedEmail) {
          const nextEmail = normaliseEmail(request.requestedEmail);
          const duplicate = await memberForEmail(nextEmail);
          if (!nextEmail.includes('@') || (duplicate && duplicate.id !== member.id)) return error('The requested email is invalid or already belongs to another customer', 409);
          changes.email = nextEmail;
          changes.authEmail = member.authEmail || member.email;
        }
        if (request.requestedPhone) changes.phone = String(request.requestedPhone).trim();
        if (Object.keys(changes).length) {
          const [updated] = await db.tx.update(TABLES.clients, [{ id: String(request.memberId), record: changes }], { patch: true });
          if (!updated) return error('Customer details could not be updated', 500);
        }
      }
      const [saved] = await db.tx.update('tc_org_profile_change_requests', [{ id: ctx.params.id, record: { status: decision, reviewedBy: normaliseEmail(ctx.user?.email), reviewedAt: new Date().toISOString() } }], { patch: true });
      if (!saved) return error('The request status could not be updated', 500);
      return json({ updated: true, status: decision });
    },
  ],

  'POST /api/member/profile-change-requests': [
    requireAuth(), withScopes('email'),
    async ctx => {
      const member = await memberForEmail(ctx.user?.email);
      if (!member) return error('Member account not found', 404);
      const body = (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body)) ? ctx.body as Record<string, unknown> : {};
      const requestedEmail = String(body.email || '').trim().toLowerCase();
      const requestedPhone = String(body.phone || '').trim();
      const reason = String(body.reason || '').trim().slice(0, 500);
      if (!requestedEmail && !requestedPhone) return error('Enter the new email address or phone number you want reviewed', 400);
      if (requestedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedEmail)) return error('Enter a valid email address', 400);
      if (requestedPhone && requestedPhone.replace(/\D/g, '').length < 7) return error('Enter a valid phone number', 400);
      const pending = await db.list<Record<string, any>>('tc_org_profile_change_requests', { filter: { memberId: String(member.id), status: 'Pending' }, limit: 10 });
      if (pending.items.length) return error('You already have a pending contact detail request', 409);
      const [id] = await db.add('tc_org_profile_change_requests', [{ memberId: String(member.id), memberName: member.fullName, currentEmail: member.email, currentPhone: member.phone, requestedEmail, requestedPhone, reason, status: 'Pending', requestedAt: new Date().toISOString() }]);
      if (!id) return error('Your request could not be submitted', 500);
      return json({ submitted: true, id, status: 'Pending', message: 'Your request has been sent to TrustlineCover for review.' }, 201);
    },
  ],

  'GET /api/member/profile-change-requests': [
    requireAuth(), withScopes('email'),
    async ctx => {
      const member = await memberForEmail(ctx.user?.email);
      if (!member) return error('Member account not found', 404);
      const result = await db.list<Record<string, any>>('tc_org_profile_change_requests', { filter: { memberId: String(member.id) }, limit: 20 });
      return json({ items: result.items });
    },
  ],

  'GET /api/staff': [
    requireAuth(),
    withScopes('email'),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    async () => {
      const result = await db.list(STAFF_TABLE, { limit: 100 });
      return json({ items: result.items });
    },
  ],

  'POST /api/staff': [
    requireAuth(),
    withScopes('email'),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    async ctx => {
      if (!ctx.body || typeof ctx.body !== 'object' || Array.isArray(ctx.body))
        return error('Invalid team member details', 400);
      const body = ctx.body as Record<string, unknown>;
      const email = normaliseEmail(body.email);
      const role = ['admin', 'staff', 'customer_service'].includes(String(body.role)) ? String(body.role) : 'staff';
      if (!email || !email.includes('@')) return error('A valid email address is required', 400);
      if (email === OWNER_EMAIL) return error('The Super Admin account is already configured', 409);
      const existing = await db.list(STAFF_TABLE, { filter: { email }, limit: 5 });
      if (existing.items.length) return error('This email already has team access', 409);
      const [id] = await db.add(STAFF_TABLE, [{
        email,
        role,
        status: 'Active',
        createdAt: new Date().toISOString(),
      }]);
      if (!id) return error('Team access could not be added', 500);
      return json({ item: { id, email, role, status: 'Active' } }, 201);
    },
  ],

  'PUT /api/staff/:id': [
    requireAuth(),
    withScopes('email'),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    async ctx => {
      if (!ctx.body || typeof ctx.body !== 'object' || Array.isArray(ctx.body))
        return error('Invalid team update', 400);
      const body = ctx.body as Record<string, unknown>;
      const changes: Record<string, unknown> = {};
      if (body.status === 'Active' || body.status === 'Inactive') changes.status = body.status;
      if (body.role === 'admin' || body.role === 'staff' || body.role === 'customer_service') changes.role = body.role;
      if (!Object.keys(changes).length) return error('No valid team changes supplied', 400);
      const [updated] = await db.tx.update(STAFF_TABLE, [{
        id: ctx.params.id,
        record: changes,
      }], { patch: true });
      if (!updated) return error('Team member was not found', 404);
      return json({ updated: true });
    },
  ],

  'GET /api/member/wallet': [
    requireAuth(),
    withScopes('email'),
    async ctx => {
      const member = await memberForEmail(ctx.user?.email);
      if (!member) return error('Member account not found', 404);
      const wallet = await walletSummary(String(member.id));
      return json({ referralCode: member.referralCode || '', pointValueNaira: 1, ...wallet });
    },
  ],

  'POST /api/member/wallet/fund': [
    requireAuth(),
    withScopes('email'),
    async ctx => {
      const member = await memberForEmail(ctx.user?.email);
      if (!member) return error('Member account not found', 404);
      const amount = Number((ctx.body as Record<string, unknown> | undefined)?.amount);
      if (!Number.isFinite(amount) || amount < 1000 || amount > 10000000) return error('Enter a wallet funding amount between ₦1,000 and ₦10,000,000', 400);
      const reference = 'WALLET-' + String(member.id).slice(-8).toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
      const [id] = await db.add(TABLES.payments, [{ clientId: member.id, amount, period: 'Wallet funding', type: 'wallet_funding', description: 'Member wallet funding request', dueDate: '', paidDate: '', status: 'Pending', reference, createdAt: new Date().toISOString() }]);
      if (!id) return error('Your wallet funding request could not be recorded', 500);
      return json({ requested: true, reference, message: 'Your wallet funding request has been recorded. Your points will be added after TrustlineCover confirms the payment.' }, 201);
    },
  ],

  'POST /api/member/wallet/convert': [
    requireAuth(),
    withScopes('email'),
    async ctx => {
      const member = await memberForEmail(ctx.user?.email);
      if (!member) return error('Member account not found', 404);
      const pointsToConvert = Number((ctx.body as Record<string, unknown> | undefined)?.points);
      if (!Number.isFinite(pointsToConvert) || pointsToConvert <= 0) return error('Enter a valid number of points to convert', 400);
      const wallet = await ensureWallet(String(member.id));
      const currentPoints = Number(wallet.points || 0);
      if (pointsToConvert > currentPoints) return error('You do not have enough points for this conversion', 400);
      const newPoints = Math.round((currentPoints - pointsToConvert) * 100) / 100;
      const newBalance = Number(wallet.balance || 0) + pointsToConvert;
      const [updated] = await db.tx.update(WALLETS_TABLE, [{ id: String(member.id), record: { points: newPoints, balance: newBalance, updatedAt: new Date().toISOString() } }], { patch: true });
      if (!updated) return error('Your points could not be converted. Please try again.', 500);
      await addWalletTransaction(String(member.id), 'points_conversion', pointsToConvert, -pointsToConvert, 'CONVERT-' + Date.now().toString(36), 'Converted reward points to wallet balance at 1 point = ₦1');
      return json({ converted: true, balance: newBalance, points: newPoints, message: 'Your points have been converted to your wallet balance.' });
    },
  ],

  'GET /api/member/cases': [
    requireAuth(),
    withScopes('email'),
    async ctx => {
      const member = await memberForEmail(ctx.user?.email);
      if (!member) return error('Member account not found', 404);
      const result = await db.list<Record<string, any>>(TABLES.cases, {
        filter: { clientId: member.id },
        limit: 100,
      });
      const items = result.items.map(item => ({
        id: item.id,
        subject: item.subject,
        category: item.category,
        status: item.status,
        createdAt: item.createdAt,
        nextFollowUp: item.nextFollowUp,
      }));
      return json({ items });
    },
  ],

  'POST /api/member/cases': [
    requireAuth(),
    withScopes('email'),
    async ctx => {
      const member = await memberForEmail(ctx.user?.email);
      if (!member) return error('Member account not found', 404);
      if (!ctx.body || typeof ctx.body !== 'object' || Array.isArray(ctx.body))
        return error('Invalid care request', 400);
      const body = ctx.body as Record<string, unknown>;
      const subject = String(body.subject || '').trim();
      const category = String(body.category || 'General enquiry').trim();
      if (!subject) return error('A request subject is required', 400);
      const record = {
        clientId: member.id,
        subject,
        category,
        details: String(body.details || '').slice(0, 4000),
        priority: 'Normal',
        status: 'Open',
        createdAt: new Date().toISOString(),
      };
      const [id] = await db.add(TABLES.cases, [record]);
      if (!id) return error('Your request could not be submitted', 500);
      return json({ item: { ...record, id } }, 201);
    },
  ],


  'GET /api/admin/email-settings': [
    requireAuth(), withScopes('email'), requireAdminEmailAllowlist(ADMIN_EMAILS),
    async () => {
      const names = await secrets.listSecretNames();
      const encryptionReady = names.includes('SMTP_ENCRYPTION_KEY');
      let config: Record<string, any> | null = null;
      if (encryptionReady) {
        try { config = await getEmailConfig(); } catch { config = null; }
      }
      return json({
        encryptionReady, configured: !!config,
        host: config?.host || '', port: String(config?.port || 587),
        username: config?.username || '', fromEmail: config?.fromEmail || '',
        fromName: config?.fromName || 'TrustlineCover', secure: config?.secure === true,
        updatedAt: config?.updatedAt || '',
      });
    },
  ],

  'PUT /api/admin/email-settings': [
    requireAuth(), withScopes('email'), requireAdminEmailAllowlist(ADMIN_EMAILS),
    async ctx => {
      const body = ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body as Record<string, any> : {};
      const host = String(body.host || '').trim().slice(0, 200);
      const port = Number(body.port);
      const username = String(body.username || '').trim().slice(0, 200);
      const fromEmail = normaliseEmail(body.fromEmail);
      const fromName = String(body.fromName || 'TrustlineCover').trim().slice(0, 100);
      if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !username || !fromEmail.includes('@')) {
        return error('Enter a valid SMTP host, port, username and sender email.', 400);
      }
      try {
        const previous = await getEmailConfig();
        const password = String(body.password || '') || String(previous?.password || '');
        if (!password) return error('Enter your SMTP password before saving.', 400);
        const config = { host, port, username, password, fromEmail, fromName, secure: body.secure === true, updatedAt: new Date().toISOString() };
        const encryptedConfig = encryptEmailConfig(config, await emailEncryptionKey());
        const [saved] = await db.get<Record<string, any>>(EMAIL_SETTINGS_TABLE, ['settings'], { consistent: true });
        if (saved) {
          const [ok] = await db.tx.update(EMAIL_SETTINGS_TABLE, [{ id: 'settings', record: { encryptedConfig, updatedAt: config.updatedAt } }], { patch: true });
          if (!ok) return error('SMTP settings could not be saved.', 500);
        } else {
          const [id] = await db.tx.add(EMAIL_SETTINGS_TABLE, [{ id: 'settings', encryptedConfig, updatedAt: config.updatedAt }]);
          if (!id) return error('SMTP settings could not be saved.', 500);
        }
        return json({
          saved: true, encryptionReady: true, configured: true,
          host, port: String(port), username, fromEmail, fromName,
          secure: config.secure, updatedAt: config.updatedAt,
        });
      } catch {
        return error('SMTP settings could not be saved. Complete the secure key setup first.', 503);
      }
    },
  ],

  'POST /api/admin/email-settings/test': [
    requireAuth(), withScopes('email'), requireAdminEmailAllowlist(ADMIN_EMAILS),
    async ctx => {
      try {
        const config = await getEmailConfig();
        if (!config) return error('Save SMTP settings first.', 400);
        const to = normaliseEmail(ctx.user?.email);
        if (!to) return error('Your sign in email is unavailable.', 400);
        await sendEmail(config, to, 'TrustlineCover SMTP connection test', 'Your TrustlineCover SMTP connection accepted this test email.');
        await logEmail({ recipientEmail: to, subject: 'TrustlineCover SMTP connection test', status: 'Accepted by SMTP', source: 'SMTP test', sentAt: new Date().toISOString() });
        return json({ sent: true, message: 'Test email accepted by SMTP for ' + to + '.' });
      } catch {
        return error('SMTP test failed. Check the host, port, username, password and SSL/TLS setting.', 502);
      }
    },
  ],

  'GET /api/emails/recipients': [
    requireAuth(), withScopes('email'),
    async ctx => {
      if (!await canUseEmailCentre(ctx.user?.email)) return error('Admin or Staff access is required.', 403);
      const result = await db.list<Record<string, any>>(TABLES.clients, { limit: 500 });
      return json({ items: result.items.filter(item => typeof item.email === 'string' && item.email.includes('@')).map(item => ({
        id: item.id, fullName: item.fullName || 'Member', email: item.email,
        planName: item.planName || '', status: item.status || '', coverageExpiresAt: item.coverageExpiresAt || '',
      })) });
    },
  ],

  'GET /api/emails/history': [
    requireAuth(), withScopes('email'),
    async ctx => {
      if (!await canUseEmailCentre(ctx.user?.email)) return error('Admin or Staff access is required.', 403);
      const result = await db.list<Record<string, any>>(EMAIL_LOG_TABLE, { limit: 100 });
      return json({ items: result.items });
    },
  ],

  'POST /api/emails/send': [
    requireAuth(), withScopes('email'),
    async ctx => {
      if (!await canUseEmailCentre(ctx.user?.email)) return error('Admin or Staff access is required.', 403);
      const body = ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body as Record<string, any> : {};
      const ids = Array.isArray(body.recipientIds) ? [...new Set(body.recipientIds.map((id: unknown) => String(id)))].slice(0, 101) : [];
      const subject = String(body.subject || '').trim().slice(0, 180);
      const message = String(body.text || '').trim().slice(0, 5000);
      if (!ids.length || ids.length > 100 || !subject || !message) return error('Select 1 to 100 members and enter a subject and message.', 400);
      let config: Record<string, any> | null = null;
      try { config = await getEmailConfig(); } catch { return error('The Super Admin must complete the secure SMTP setup first.', 503); }
      if (!config) return error('The Super Admin has not configured SMTP yet.', 503);
      let accepted = 0;
      let failed = 0;
      for (const id of ids) {
        const [member] = await db.get<Record<string, any>>(TABLES.clients, [id], { consistent: true });
        if (!member?.email || !normaliseEmail(member.email).includes('@')) { failed += 1; continue; }
        try {
          await sendEmail(config, String(member.email), subject, message);
          accepted += 1;
          await logEmail({ recipientEmail: member.email, recipientName: member.fullName || '', subject, status: 'Accepted by SMTP', source: 'Manual email', sentBy: normaliseEmail(ctx.user?.email), sentAt: new Date().toISOString() });
        } catch (sendError) {
          failed += 1;
          await logEmail({ recipientEmail: member.email, recipientName: member.fullName || '', subject, status: 'Failed', source: 'Manual email', sentBy: normaliseEmail(ctx.user?.email), error: String(sendError).slice(0, 250) });
        }
      }
      return json({ accepted, failed, message: accepted + ' email(s) accepted by SMTP' + (failed ? ', ' + failed + ' failed.' : '.') });
    },
  ],

  'POST /api/ai/customer-help': [
    async ctx => {
      const body = (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body)) ? ctx.body as Record<string, unknown> : {};
      const question = String(body.question || '').trim();
      if (!question || question.length > 1200) return error('Please enter a question of up to 1200 characters', 400);
      const config = await readPublicConfig();
      const plans = (config.plans || []).map((p: any) => ({
        name: p.name, monthlyPrice: p.monthlyRate, description: p.description, benefits: p.benefits,
      }));
      const history = Array.isArray(body.history) ? body.history.slice(-8).map((item: any) => ({
        role: item?.role === 'assistant' ? 'assistant' : 'user',
        content: String(item?.content || '').slice(0, 1200),
      })) : [];
      const hasActivePlan = body.hasActivePlan === true;
      const location = String(body.location || '').trim().slice(0, 180);
      const emergencyPattern = /\b(chest pain|cannot breathe|can't breathe|difficulty breathing|shortness of breath|unconscious|not waking|stroke|face drooping|slurred speech|seizure|convulsion|heavy bleeding|bleeding heavily|severe allergic reaction|anaphylaxis|overdose|poisoning|suicidal|trying to kill myself|labour with heavy bleeding)\b/i;
      if (emergencyPattern.test(question)) {
        return json({
          answer: 'This may be an emergency. Please do not wait for a chat reply or try to buy a plan first. Call 112 in Nigeria now, or go straight to the nearest hospital emergency department. Ask someone nearby to stay with you and help arrange transport. Do not drive yourself if you feel faint, confused or seriously unwell. Once you are safe, TrustlineCover can help with general care coordination. If you do not have a plan, you can view available plans here: #plans. Buying a plan does not guarantee payment for this emergency or replace urgent treatment.',
          emergency: true,
          purchaseUrl: '#plans',
        });
      }
      const generated = await ai.generate({
        system: 'You are TrustlineCover Speak to a Doctor, a careful health information and care navigation assistant for people in Nigeria. Speak warmly and naturally, like a helpful Nigerian health guide. Use clear everyday Nigerian English and familiar words such as “please”, “abeg” only sparingly, “nearest hospital”, “chemist” when contextually appropriate, and explain medical terms simply. Be detailed enough to explain common health topics, symptoms, prevention and when to seek care, but never claim to be a doctor, diagnose a person, prescribe medicines, recommend dosages, or replace an in-person clinician. Ask one useful follow-up question at a time when details are needed. For symptoms, ask about age range, when it started, severity and associated symptoms only when relevant. Do not ask for full name, NIN, passwords, OTPs, bank details or medical records. Always screen for red flags such as chest pain, breathing difficulty, fainting, unconsciousness, stroke signs, seizures, severe bleeding, severe allergic reaction, poisoning, overdose, severe dehydration, pregnancy complications or thoughts of self-harm. If any red flag is mentioned or reasonably suspected, clearly tell the person to seek emergency care immediately and not wait for this chat or plan purchase. In Nigeria advise calling 112 or going to the nearest hospital emergency department. Never make emergency treatment conditional on membership. If the person says they do not have an active TrustlineCover plan, gently explain that they can view and buy a plan at #plans for future eligible care coordination, but buying a plan does not cover an existing emergency automatically, does not guarantee a clinic visit and must never delay treatment. If they say they have an active plan, ask for their town, area or neighbourhood and tell them to use the nearby clinic search link supplied by the app; do not invent or claim a facility is in network. Explain that TrustlineCover confirms benefits and provider arrangements separately. If waiting periods, exclusions or eligibility are not supplied, say they need confirmation from TrustlineCover. Use calm, non-judgmental language and answer the actual question with practical next steps.',
        prompt: 'TrustlineCover company: ' + config.brandName + '\nAvailable plans: ' + JSON.stringify(plans) + '\nContact email: ' + config.supportEmail + '\nContact phone: ' + config.supportPhone + '\nWhatsApp: ' + config.whatsapp + '\nUser says they have an active plan: ' + (hasActivePlan ? 'Yes, self-reported and not independently verified in this public chat' : 'No or not confirmed') + '\nUser location if provided: ' + (location || 'Not provided') + '\nConversation so far: ' + JSON.stringify(history) + '\nLatest message: ' + question + '\nIf no active plan is confirmed, include the plan page link #plans naturally. If active plan is reported and location is missing, ask for their area or town. Do not invent a clinic name.',
        maxTokens: 850, temperature: 0.35,
      });
      return json({ answer: generated.text, emergency: false, purchaseUrl: hasActivePlan ? '' : '#plans' });
    },
  ],

  'POST /api/ai/admin-briefing': [
    requireAuth(),
    withScopes('email'),
    async ctx => {
      const role = await roleFor(ctx.user?.email);
      if (role !== 'owner' && role !== 'admin') return error('Administrator access is required for this briefing', 403);
      const [clients, payments, cases, providers] = await Promise.all([
        db.list<Record<string, any>>(TABLES.clients, { limit: 100 }),
        db.list<Record<string, any>>(TABLES.payments, { limit: 100 }),
        db.list<Record<string, any>>(TABLES.cases, { limit: 100 }),
        db.list<Record<string, any>>(TABLES.providers, { limit: 100 }),
      ]);
      const summary = {
        totalMembers: clients.items.length,
        activeMembers: clients.items.filter(x => x.status === 'Active').length,
        pendingMembers: clients.items.filter(x => x.status === 'Pending' || x.accessStatus === 'Pending approval').length,
        pendingPayments: payments.items.filter(x => x.status !== 'Paid').length,
        paidPayments: payments.items.filter(x => x.status === 'Paid').length,
        paidAmount: payments.items.filter(x => x.status === 'Paid').reduce((n, x) => n + (Number(x.amount) || 0), 0),
        openCareRequests: cases.items.filter(x => !['Resolved', 'Closed'].includes(x.status)).length,
        urgentCareRequests: cases.items.filter(x => x.priority === 'Urgent' && !['Resolved', 'Closed'].includes(x.status)).length,
        providers: providers.items.length,
        providerSetup: providers.items.some(x => x.isPrimary) ? 'Primary provider configured' : 'Primary provider not yet configured',
        recentOperationalItems: [
          ...payments.items.slice(0, 12).map(x => ({ type: 'payment', status: x.status, amount: Number(x.amount) || 0, date: x.createdAt || x.dueDate || '' })),
          ...cases.items.slice(0, 12).map(x => ({ type: 'care request', status: x.status, priority: x.priority, category: x.category, date: x.createdAt || '' })),
          ...clients.items.slice(0, 12).map(x => ({ type: 'membership', status: x.status, accessStatus: x.accessStatus, plan: x.planName, date: x.createdAt || '' })),
        ].slice(0, 30),
      };
      const generated = await ai.generate({
        system: 'You are the private operations briefing assistant for the TrustlineCover Super Admin. Analyse only the aggregate and de-identified operational data supplied. Provide a short executive briefing with what is going well, what needs attention, priority actions for today and any data gaps. Never include or infer member identities, contact details, NIN, diagnoses or clinical advice. Do not approve claims, payments, care, provider assignment or membership. Clearly say all actions require human review. If there is a possible urgent care request, advise the administrator to follow the established human escalation process.',
        prompt: 'Prepare a practical management briefing from these TrustlineCover operational figures:\n' + JSON.stringify(summary),
        maxTokens: 750, temperature: 0.2,
      });
      return json({ briefing: generated.text, metrics: {
        totalMembers: summary.totalMembers, activeMembers: summary.activeMembers,
        pendingMembers: summary.pendingMembers, pendingPayments: summary.pendingPayments,
        paidPayments: summary.paidPayments, paidAmount: summary.paidAmount,
        openCareRequests: summary.openCareRequests, urgentCareRequests: summary.urgentCareRequests,
        providers: summary.providers, providerSetup: summary.providerSetup,
      }, humanReviewRequired: true });
    },
  ],

  'POST /api/ai/eligibility': [
    requireAuth(),
    withScopes('email'),
    async ctx => {
      const body = (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body))
        ? ctx.body as Record<string, unknown>
        : {};
      const member = await getMemberForAi(ctx, typeof body.clientId === 'string' ? body.clientId : undefined);
      if (!member) return error('An active member record is required for this check', 404);
      const now = new Date();
      if (member.coverageStartsAt && new Date(member.coverageStartsAt) > now) {
        return json({
          status: 'waiting_period',
          result: 'Your payment has been confirmed. Your waiting period ends on ' + new Date(member.coverageStartsAt).toLocaleString('en-NG') + '. Care access will begin after that date, subject to TrustlineCover approval.',
        });
      }
      if (member.coverageExpiresAt && new Date(member.coverageExpiresAt) <= now) {
        return json({
          status: 'coverage_expired',
          result: 'Your membership cover has expired. Please renew your plan and contact TrustlineCover for confirmation of your access date.',
        });
      }
      if (member.status !== 'Active' || member.accessStatus !== 'Approved') {
        return json({
          status: 'not_approved',
          result: 'Your membership or care access is not yet active. Please contact TrustlineCover for a manual review before proceeding.',
        });
      }
      const request = String(body.request || '').trim();
      if (!request) return error('Describe the requested healthcare service', 400);
      const pricing = await db.list<Record<string, any>>(TABLES.pricing, {
        filter: { name: member.planName },
        limit: 10,
      });
      const plan = pricing.items[0];
      const benefits = String(member.benefits || plan?.benefits || '').trim();
      if (!benefits) {
        return json({
          status: 'benefits_not_configured',
          result: 'The benefits for this plan have not yet been entered. TrustlineCover will need to review the request manually.',
        });
      }
      const generated = await ai.generate({
        system: 'You are a healthcare plan administration assistant for TrustlineCover. Compare the request only with the exact plan benefits supplied. Do not diagnose, recommend treatment, interpret symptoms, promise payment, or approve access. If limits, exclusions, waiting periods, provider rules, or details are missing, say that human review is required. Use plain, careful language. Make clear this is an initial administrative guide, not a final coverage decision.',
        prompt: 'Plan name: ' + String(member.planName || 'Not supplied') +
          '\nRecorded plan benefits: ' + benefits +
          '\nCare request: ' + request +
          '\nAssess whether the request appears clearly listed, unclear, or not listed in the supplied benefits. State what information is missing and that TrustlineCover must make the final decision.',
        schema: {
          type: 'object',
          properties: {
            assessment: { type: 'string' },
            benefit_match: { type: 'string', enum: ['appears_listed', 'unclear', 'not_listed'] },
            missing_information: { type: 'array', items: { type: 'string' } },
            human_review_required: { type: 'boolean' },
            disclaimer: { type: 'string' },
          },
          required: ['assessment', 'benefit_match', 'missing_information', 'human_review_required', 'disclaimer'],
        },
        temperature: 0.2,
        maxTokens: 600,
      });
      return json({
        status: 'initial_assessment',
        result: generated.text,
        finalApprovalRequired: true,
      });
    },
  ],

  'POST /api/ai/case-review': [
    requireAuth(),
    withScopes('email'),
    requireStaff,
    async ctx => {
      const body = (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body))
        ? ctx.body as Record<string, unknown>
        : {};
      if (body.confirmedAnonymised !== true)
        return error('Confirm that identifying and sensitive details have been removed', 400);
      const caseId = String(body.caseId || '');
      if (!caseId) return error('Select a care case', 400);
      const [item] = await db.get<Record<string, any>>(TABLES.cases, [caseId], { consistent: true });
      if (!item) return error('Care case was not found', 404);
      const operationalText = [
        'Request subject: ' + String(item.subject || ''),
        'Request category: ' + String(item.category || ''),
        'Request notes: ' + String(item.details || ''),
        'Priority currently recorded: ' + String(item.priority || 'Normal'),
        'Current status: ' + String(item.status || 'Open'),
        'Next follow up date: ' + String(item.nextFollowUp || 'Not set'),
      ].join('\n');
      if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(operationalText) ||
          /(?:\+?\d[\d\s().-]{8,}\d)/.test(operationalText)) {
        return error('Remove email addresses and phone numbers from the case notes before using the assistant', 400);
      }
      const generated = await ai.generate({
        system: 'You are an operational care coordination assistant. Do not diagnose, recommend treatment, assess clinical severity, or make coverage decisions. Summarise only the supplied anonymised operational information. Identify missing administrative details, suggest a practical follow up and flag whether a human should review promptly. If there is any possible emergency, instruct the team to follow its established emergency escalation process rather than relying on this assistant.',
        prompt: 'Review this anonymised care coordination case:\n' + operationalText,
        schema: {
          type: 'object',
          properties: {
            case_summary: { type: 'string' },
            operational_attention: { type: 'string', enum: ['routine', 'prompt_human_review', 'urgent_human_escalation'] },
            missing_information: { type: 'array', items: { type: 'string' } },
            suggested_next_steps: { type: 'array', items: { type: 'string' } },
            human_review_note: { type: 'string' },
          },
          required: ['case_summary', 'operational_attention', 'missing_information', 'suggested_next_steps', 'human_review_note'],
        },
        temperature: 0.2,
        maxTokens: 700,
      });
      return json({ result: generated.text, humanReviewRequired: true });
    },
  ],
});
