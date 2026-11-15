import { useState } from 'react';
import { api } from '@appdeploy/client';
import { ShieldCheck, CheckCircle2 } from 'lucide-react';
import type { PublicConfig } from './AdminPublicSettings';

export default function MemberEnrollment({ email, config, onComplete, onSignOut }: { email: string; config: PublicConfig; onComplete: () => void; onSignOut: () => void }) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [nin, setNin] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [planName, setPlanName] = useState(config.plans?.[0]?.name || 'Essential');
  const [billingFrequency, setBillingFrequency] = useState('Monthly');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [receipt, setReceipt] = useState<any>(null);
  const plan = config.plans?.find(p => p.name === planName) || config.plans?.[0];
  const amount = Number(plan?.monthlyRate || 0) * (billingFrequency === 'Annually' ? 12 : billingFrequency === 'Quarterly' ? 3 : 1);
  const format = (n: number) => '₦' + n.toLocaleString('en-NG');
  async function submit() {
    if (!fullName.trim() || !phone.trim() || !dateOfBirth || !/^\d{11}$/.test(nin) || !planName || !privacyConsent) { setNotice('Please complete all required details and accept the privacy notice to continue.'); return; }
    setBusy(true); setNotice('');
    try {
      const response = await api.post('/api/member/enrolment', { fullName: fullName.trim(), dateOfBirth, nin, phone: phone.trim(), privacyConsent, planName, billingFrequency, referralCode: referralCode.trim().toUpperCase() });
      setReceipt(response.data);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'We could not complete your enrolment. Please try again.');
    } finally { setBusy(false); }
  }
  if (receipt) return <div className="enrolment-screen"><div className="enrolment-card"><div className="enrolment-mark"><CheckCircle2 size={30} /></div><div className="eyebrow">ENROLMENT RECEIVED</div><h1>Thank you, {fullName.split(' ')[0]}.</h1><p>{receipt.message}</p><div className="enrolment-summary"><span>Selected plan<strong>{planName}</strong></span><span>Payment frequency<strong>{billingFrequency}</strong></span><span>Amount due<strong>{format(amount)}</strong></span><span>Reference<strong>{receipt.payment?.reference}</strong></span></div>
    <div className="notice">{receipt.paymentInstructions || 'Your enrolment is recorded as pending. TrustlineCover will contact you with approved payment instructions. Online card payment is not yet connected.'}</div>
    <button className="primary wide" onClick={onComplete}>Continue to my account</button></div></div>;
  return <div className="enrolment-screen"><div className="enrolment-card"><div className="enrolment-brand"><ShieldCheck size={27}/><strong>{config.brandName || 'TrustlineCover'}</strong></div><div className="eyebrow">EMAIL CONFIRMED</div><h1>Complete your sign up.</h1><p>Your email address <strong>{email}</strong> has been confirmed. Add your details and choose a plan to continue.</p>
    <label className="field"><span>Full name</span><input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Enter your full name" /></label>
    <label className="field"><span>Date of birth</span><input type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} max={new Date().toISOString().slice(0, 10)} /></label>
    <label className="field"><span>National Identification Number (NIN)</span><input inputMode="numeric" autoComplete="off" maxLength={11} value={nin} onChange={e => setNin(e.target.value.replace(/\D/g, '').slice(0, 11))} placeholder="Enter your 11 digit NIN" /></label>
    <label className="field"><span>Phone number</span><input type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Enter your phone number" /></label>
    <label className="field"><span>Referral code (optional)</span><input value={referralCode} onChange={e => setReferralCode(e.target.value.toUpperCase())} placeholder="Enter a member referral code" maxLength={12} /></label>
    <div className="notice"><strong>Privacy notice</strong><p>TrustlineCover collects your name, date of birth, NIN and phone number to register your membership, confirm your identity and manage access to healthcare services. Your details will be available only to authorised personnel who need them for these purposes. Your NIN will be reviewed internally and will not be sent to an external NIN verification provider through this registration form. Please provide accurate information. Contact TrustlineCover through the support details on this website if you have a question about your personal information.</p></div>
    <label className="field consent-check"><span><input type="checkbox" checked={privacyConsent} onChange={e => setPrivacyConsent(e.target.checked)} /> I have read the privacy notice and consent to TrustlineCover collecting and using these details for membership registration, identity review and healthcare administration.</span></label>
    <label className="field"><span>Choose your plan</span><select value={planName} onChange={e => setPlanName(e.target.value)}>{(config.plans || []).map(p => <option key={p.name} value={p.name}>{p.name} · {format(Number(p.monthlyRate))} monthly</option>)}</select></label>
    <label className="field"><span>Payment frequency</span><select value={billingFrequency} onChange={e => setBillingFrequency(e.target.value)}><option>Monthly</option><option>Quarterly</option><option>Annually</option></select></label>
    {plan && <div className="enrolment-summary"><span>Selected plan<strong>{plan.name}</strong></span><span>Amount due<strong>{format(amount)}</strong></span><p>{plan.description}</p><small>{plan.benefits}</small></div>}
    {notice && <div className="notice error">{notice}</div>}
    <button className="primary wide" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Continue to payment'}</button>
    <button className="text-button" onClick={onSignOut}>Sign out</button>
  </div></div>;
}
