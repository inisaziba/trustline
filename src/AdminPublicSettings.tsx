import { useState } from 'react';
import { api } from '@appdeploy/client';
import { ImagePlus, Save, UploadCloud } from 'lucide-react';

type Plan = { name: string; monthlyRate: number; description: string; benefits: string };
export type PublicConfig = {
  brandName: string; tagline: string; heroHeadline: string; heroDescription: string; heroSubtext: string;
  supportEmail: string; supportPhone: string; whatsapp: string; instagram: string; facebook: string; linkedin: string;
  paymentInstructions: string; plans: Plan[]; logoImage?: string; faviconImage?: string; heroImage?: string;
};
const defaults: PublicConfig = {
  brandName: 'TrustlineCover', tagline: 'HEALTHCARE, MADE CLEAR',
  heroHeadline: 'Healthcare should feel easier.',
  heroDescription: 'Finding the right healthcare cover is one thing. Knowing who to speak to, what happens next and where to turn for support matters just as much.',
  heroSubtext: 'TrustlineCover helps individuals and families choose a suitable plan while we manage the healthcare arrangements, approvals and ongoing support behind the scenes.',
  supportEmail: 'trustlinesolutions@outlook.com', supportPhone: '', whatsapp: '', instagram: '', facebook: '', linkedin: '', paymentInstructions: '',
  plans: [
    { name: 'Essential', monthlyRate: 7000, description: 'A simple starting option for everyday healthcare support.', benefits: 'Digital care access card; Plan benefit guidance; Care request coordination' },
    { name: 'Plus', monthlyRate: 10000, description: 'More support for individuals and families seeking added reassurance.', benefits: 'Everything in Essential; Priority request follow up; Expanded plan benefit guidance' },
    { name: 'Premium', monthlyRate: 20000, description: 'An enhanced option for members who want a higher level of coordinated support.', benefits: 'Everything in Plus; Enhanced care coordination; Dedicated follow up support' }
  ]
};
function ImageUpload({ label, slot, current, onUploaded }: { label: string; slot: 'logo' | 'favicon' | 'hero'; current?: string; onUploaded: (slot: string, data: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function upload(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setMessage('Please choose an image file.'); return; }
    setBusy(true); setMessage('');
    try {
      const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const image = new Image();
      image.src = dataUri;
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
      const canvas = document.createElement('canvas');
      const max = slot === 'hero' ? 1000 : 420;
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Image could not be processed.');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      let quality = 0.78;
      let compressed = canvas.toDataURL('image/jpeg', quality);
      while (compressed.length > 170000 && quality > 0.35) {
        quality -= 0.08;
        compressed = canvas.toDataURL('image/jpeg', quality);
      }
      if (compressed.length > 180000) throw new Error('This image is too large. Please choose a smaller image.');
      await api.post('/api/admin/brand-image', { slot, dataUri: compressed });
      onUploaded(slot, compressed);
      setMessage('Image updated successfully.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Image upload failed. Please try again.');
    } finally { setBusy(false); }
  }
  return <div className="brand-upload-card">
    <div className="brand-upload-preview">{current ? <img src={current} alt={label} /> : <ImagePlus size={26} />}</div>
    <div className="brand-upload-copy"><strong>{label}</strong><small>Choose a new image from your device. It will replace the current one.</small>
      <label className="secondary upload-label"><UploadCloud size={15} /> {busy ? 'Uploading…' : 'Choose image'}<input type="file" accept="image/*" disabled={busy} onChange={e => upload(e.target.files?.[0])} /></label>
      {message && <small>{message}</small>}
    </div>
  </div>;
}
export default function AdminPublicSettings({ config, onSaved }: { config: PublicConfig; onSaved: (c: PublicConfig) => void }) {
  const [form, setForm] = useState<PublicConfig>({ ...defaults, ...config, plans: config.plans || defaults.plans });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  function set(key: keyof PublicConfig, value: any) { setForm(old => ({ ...old, [key]: value })); }
  function updatePlan(index: number, key: keyof Plan, value: string) {
    setForm(old => ({ ...old, plans: old.plans.map((p, i) => i === index ? { ...p, [key]: key === 'monthlyRate' ? Number(value) : value } : p) }));
  }
  function imageUpdated(slot: string, data: string) {
    setForm(old => ({ ...old, [slot === 'logo' ? 'logoImage' : slot === 'favicon' ? 'faviconImage' : 'heroImage']: data }));
    setNotice('Image updated. Remember to save your text and plan settings when finished.');
  }
  async function save() {
    setSaving(true); setNotice('');
    try {
      const response = await api.put('/api/admin/public-config', form);
      onSaved(response.data.config);
      setNotice('Your public website settings have been saved.');
    } catch { setNotice('We could not save the settings. Please try again.'); }
    finally { setSaving(false); }
  }
  return <div className="settings-stack">
    <div className="panel">
      <div className="panel-head"><div><h3>Website identity</h3><p>Change the name, logo, browser icon and main family image shown on your public website.</p></div></div>
      <div className="settings-fields">
        <label className="field"><span>Brand name</span><input value={form.brandName} onChange={e => set('brandName', e.target.value)} /></label>
        <label className="field"><span>Website tagline</span><input value={form.tagline} onChange={e => set('tagline', e.target.value)} /></label>
      </div>
      <div className="brand-upload-grid">
        <ImageUpload label="Website logo" slot="logo" current={form.logoImage} onUploaded={imageUpdated} />
        <ImageUpload label="Browser tab icon" slot="favicon" current={form.faviconImage} onUploaded={imageUpdated} />
        <ImageUpload label="Header family photograph" slot="hero" current={form.heroImage} onUploaded={imageUpdated} />
      </div>
    </div>
    <div className="panel">
      <div className="panel-head"><div><h3>Public website wording</h3><p>Edit the headline and the text visitors see before they sign up.</p></div></div>
      <div className="settings-fields">
        <label className="field"><span>Hero headline</span><input value={form.heroHeadline} onChange={e => set('heroHeadline', e.target.value)} /></label>
        <label className="field"><span>Healthcare made clear text</span><input value={form.tagline} onChange={e => set('tagline', e.target.value)} /></label>
        <label className="field full-field"><span>Main introduction</span><textarea rows={3} value={form.heroDescription} onChange={e => set('heroDescription', e.target.value)} /></label>
        <label className="field full-field"><span>Supporting introduction</span><textarea rows={3} value={form.heroSubtext} onChange={e => set('heroSubtext', e.target.value)} /></label>
      </div>
    </div>
    <div className="panel">
      <div className="panel-head"><div><h3>Plans and prices</h3><p>These details appear on the public website and are used when a new member enrols.</p></div></div>
      <div className="settings-plan-grid">{form.plans.map((plan, i) => <div className="settings-plan" key={i}><h4>Plan {i + 1}</h4>
        <label className="field"><span>Plan name</span><input value={plan.name} onChange={e => updatePlan(i, 'name', e.target.value)} /></label>
        <label className="field"><span>Monthly price in naira</span><input type="number" min="0" value={plan.monthlyRate} onChange={e => updatePlan(i, 'monthlyRate', e.target.value)} /></label>
        <label className="field"><span>Short description</span><textarea rows={2} value={plan.description} onChange={e => updatePlan(i, 'description', e.target.value)} /></label>
        <label className="field"><span>Plan benefits</span><textarea rows={3} value={plan.benefits} onChange={e => updatePlan(i, 'benefits', e.target.value)} /></label>
      </div>)}</div>
    </div>
    <div className="panel">
      <div className="panel-head"><div><h3>Contact and social media</h3><p>These details will appear on the public website.</p></div></div>
      <div className="settings-fields">
        {(['supportEmail','supportPhone','whatsapp','instagram','facebook','linkedin'] as const).map(key => <label className="field" key={key}><span>{{supportEmail:'Contact email',supportPhone:'Contact phone',whatsapp:'WhatsApp link or number',instagram:'Instagram link',facebook:'Facebook link',linkedin:'LinkedIn link'}[key]}</span><input value={form[key]} onChange={e => set(key, e.target.value)} /></label>)}
        <label className="field full-field"><span>Payment instructions for new members</span><textarea rows={4} value={form.paymentInstructions} onChange={e => set('paymentInstructions', e.target.value)} placeholder="Add your approved bank transfer or payment instructions here." /></label>
      </div>
    </div>
    {notice && <div className="notice">{notice}</div>}
    <div className="settings-save"><button className="primary" disabled={saving} onClick={save}><Save size={16} /> {saving ? 'Saving…' : 'Save website settings'}</button></div>
  </div>;
}
