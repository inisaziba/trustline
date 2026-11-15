import { useEffect, useMemo, useState } from 'react';
import { api } from '@appdeploy/client';
import { Mail, RefreshCw, Send, ShieldCheck } from 'lucide-react';

type Recipient = { id: string; fullName: string; email: string; planName?: string; status?: string; coverageExpiresAt?: string };
type EmailLog = { id: string; recipientEmail: string; recipientName?: string; subject: string; status: string; source?: string; sentAt?: string; createdAt?: string };

export function EmailCentre({ role }: { role: string }) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [history, setHistory] = useState<EmailLog[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [people, logs] = await Promise.all([api.get('/api/emails/recipients'), api.get('/api/emails/history')]);
      setRecipients(people.data.items || []);
      setHistory(logs.data.items || []);
    } catch {
      setNotice('Email workspace could not be loaded. Please refresh.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const visible = useMemo(() => recipients.filter(person => (
    (person.fullName + ' ' + person.email + ' ' + (person.planName || '')).toLowerCase().includes(search.toLowerCase())
  )), [recipients, search]);

  async function sendEmails() {
    if (!selected.length || !subject.trim() || !message.trim()) {
      setNotice('Select members and enter an email subject and message.');
      return;
    }
    if (selected.length > 100) {
      setNotice('You can send to a maximum of 100 members at a time.');
      return;
    }
    setSending(true);
    setNotice('');
    try {
      const result = await api.post('/api/emails/send', { recipientIds: selected, subject: subject.trim(), text: message.trim() });
      setNotice(result.data.message || 'Email request processed.');
      setSelected([]);
      setSubject('');
      setMessage('');
      await load();
    } catch {
      setNotice('The emails could not be sent. Ask the Super Admin to check SMTP settings.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="email-workspace">
      <section className="panel email-compose">
        <div className="panel-head">
          <div><h3><Mail size={18} /> Send member email</h3><p>Each selected member receives a separate email.</p></div>
          <span className="role-pill">{role === 'owner' ? 'SUPER ADMIN' : role.toUpperCase()}</span>
        </div>
        {notice && <div className="email-notice">{notice}</div>}
        <div className="email-recipient-tools">
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name, email or plan" />
          <button type="button" className="secondary" onClick={() => setSelected(visible.map(person => person.id))}>Select visible</button>
          <button type="button" className="secondary" onClick={() => setSelected([])}>Clear</button>
        </div>
        <div className="email-recipient-list">
          {loading ? <p>Loading members…</p> : visible.length === 0 ? <p>No matching members found.</p> : visible.map(person => (
            <label className="email-recipient" key={person.id}>
              <input type="checkbox" checked={selected.includes(person.id)} onChange={() => setSelected(current => current.includes(person.id) ? current.filter(id => id !== person.id) : [...current, person.id])} />
              <span><strong>{person.fullName}</strong><small>{person.email} · {person.planName || 'Plan not set'} · {person.status || 'Status not set'}</small></span>
            </label>
          ))}
        </div>
        <div className="email-compose-fields">
          <label>Subject<input value={subject} maxLength={180} onChange={event => setSubject(event.target.value)} placeholder="Enter email subject" /></label>
          <label>Message<textarea rows={7} maxLength={5000} value={message} onChange={event => setMessage(event.target.value)} placeholder="Write your message here" /></label>
        </div>
        <div className="email-compose-footer">
          <small>{selected.length} selected. Maximum 100 per send.</small>
          <button type="button" className="primary" disabled={sending || !selected.length || selected.length > 100} onClick={sendEmails}><Send size={16} /> {sending ? 'Sending…' : 'Send email'}</button>
        </div>
      </section>
      <section className="panel email-history">
        <div className="panel-head">
          <div><h3>Email history</h3><p>Recent manual emails and automatic renewal reminders.</p></div>
          <button type="button" className="secondary" onClick={load}><RefreshCw size={15} /> Refresh</button>
        </div>
        {history.length === 0 ? <div className="preview-empty">No email activity has been recorded yet.</div> : (
          <div className="table-wrap">
            <table><thead><tr><th>Recipient</th><th>Subject</th><th>Source</th><th>Status</th><th>Date</th></tr></thead>
              <tbody>{history.map(item => <tr key={item.id}>
                <td>{item.recipientName || item.recipientEmail}<small className="email-subline">{item.recipientEmail}</small></td>
                <td>{item.subject}</td><td>{item.source || 'Manual email'}</td>
                <td><span className={'email-status ' + (item.status === 'Failed' ? 'failed' : 'sent')}>{item.status}</span></td>
                <td>{item.sentAt || item.createdAt ? new Date(item.sentAt || item.createdAt || '').toLocaleString('en-NG') : 'Not available'}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
        <p className="client-disclaimer">Accepted by SMTP means the mail server accepted the message. It does not confirm inbox delivery.</p>
      </section>
    </div>
  );
}

export function EmailSettings() {
  const [settings, setSettings] = useState({
    host: '', port: '587', username: '', password: '', fromEmail: '',
    fromName: 'TrustlineCover', secure: false, configured: false,
    encryptionReady: false, updatedAt: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState('');

  async function loadSettings() {
    setLoading(true);
    try {
      const result = await api.get('/api/admin/email-settings');
      setSettings(current => ({ ...current, ...result.data, password: '' }));
    } catch {
      setNotice('Email settings could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadSettings(); }, []);

  async function saveSettings() {
    setSaving(true);
    setNotice('');
    try {
      const result = await api.put('/api/admin/email-settings', settings);
      setSettings(current => ({ ...current, ...result.data, password: '' }));
      setNotice('SMTP settings saved securely. You can now test the connection.');
    } catch {
      setNotice('SMTP settings could not be saved. Check the secure key and required fields.');
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setNotice('');
    try {
      const result = await api.post('/api/admin/email-settings/test', {});
      setNotice(result.data.message || 'The SMTP server accepted the test email.');
    } catch {
      setNotice('SMTP test failed. Check the SMTP details and credentials.');
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="panel email-settings">
      <div className="panel-head">
        <div><h3><ShieldCheck size={18} /> Email server configuration</h3><p>Only the Super Admin can configure the SMTP connection used by the whole team.</p></div>
        <span className="role-pill">SUPER ADMIN ONLY</span>
      </div>
      {notice && <div className="email-notice">{notice}</div>}
      {loading ? <p>Loading email settings…</p> : <>
        {!settings.encryptionReady && <div className="email-notice">The secure email storage key has not been connected. Complete the one time secure setup before saving SMTP details.</div>}
        <div className="email-settings-grid">
          <label>SMTP Host<input value={settings.host} onChange={event => setSettings(current => ({ ...current, host: event.target.value }))} placeholder="smtp.yourprovider.com" /></label>
          <label>SMTP Port<input type="number" min="1" max="65535" value={settings.port} onChange={event => setSettings(current => ({ ...current, port: event.target.value }))} /></label>
          <label>SMTP Username<input value={settings.username} onChange={event => setSettings(current => ({ ...current, username: event.target.value }))} /></label>
          <label>SMTP Password<input type="password" autoComplete="new-password" value={settings.password} onChange={event => setSettings(current => ({ ...current, password: event.target.value }))} placeholder={settings.configured ? 'Leave blank to keep saved password' : 'Enter SMTP password'} /></label>
          <label>Sender Email<input type="email" value={settings.fromEmail} onChange={event => setSettings(current => ({ ...current, fromEmail: event.target.value }))} placeholder="notifications@trustlinecover.ng" /></label>
          <label>Sender Name<input value={settings.fromName} onChange={event => setSettings(current => ({ ...current, fromName: event.target.value }))} /></label>
        </div>
        <label className="email-secure-toggle"><input type="checkbox" checked={settings.secure} onChange={event => setSettings(current => ({ ...current, secure: event.target.checked }))} /> Use direct SSL/TLS, usually enabled for port 465. Leave off for STARTTLS on port 587.</label>
        <div className="email-compose-footer">
          <small>{settings.configured ? 'SMTP settings are saved. The password is never displayed.' : 'SMTP is not configured yet.'}</small>
          <div>
            <button type="button" className="secondary" disabled={!settings.configured || testing} onClick={testConnection}>{testing ? 'Testing…' : 'Send test email'}</button>
            <button type="button" className="primary" disabled={saving || !settings.encryptionReady} onClick={saveSettings}>{saving ? 'Saving…' : 'Save SMTP settings'}</button>
          </div>
        </div>
        {settings.updatedAt && <p className="client-disclaimer">Last updated {new Date(settings.updatedAt).toLocaleString('en-NG')}.</p>}
      </>}
      <p className="client-disclaimer">SMTP credentials are encrypted before storage. Admins and Staff can send emails, but cannot view or change these settings.</p>
    </section>
  );
}
