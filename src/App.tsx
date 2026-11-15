import { useEffect, useMemo, useState } from 'react';
import { auth, api } from '@appdeploy/client';
import './access-card.css';
import './portal-features.css';
import './public-plans.css';
import './branding-admin.css';
import AdminPublicSettings from './AdminPublicSettings';
import MemberEnrollment from './MemberEnrollment';
import { EmailCentre, EmailSettings } from './EmailCentre';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  FileText,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Stethoscope,
  Users,
  Wallet,
  X,
  RefreshCw,
  Clock3,
  Sparkles,
  UserPlus,
  LockKeyhole,
  Mail,
} from 'lucide-react';

type Kind = 'clients' | 'providers' | 'cases' | 'payments' | 'pricing';
type RecordItem = { id: string; [key: string]: any };
type User = { userId: string; email?: string; name?: string };
type Session = { role: 'owner' | 'admin' | 'staff' | 'customer_service' | 'client' | 'unassigned'; email?: string; member?: RecordItem };

const sections = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'clients', label: 'Customers', icon: Users },
  { id: 'providers', label: 'Healthcare providers', icon: Stethoscope },
  { id: 'pricing', label: 'Pricing & benefits', icon: CircleDollarSign },
  { id: 'payments', label: 'Payments & renewals', icon: Wallet },
  { id: 'cases', label: 'Care coordination', icon: HeartPulse },
  { id: 'ai', label: 'AI assistants', icon: Sparkles },
  { id: 'team', label: 'Team access', icon: UserPlus },
  { id: 'emails', label: 'Email centre', icon: Mail },
  { id: 'settings', label: 'Website settings', icon: Settings },
  { id: 'gateways', label: 'Payment gateways', icon: Wallet },
] as const;

const kindLabels: Record<Kind, string> = {
  clients: 'Customer',
  providers: 'Healthcare provider',
  cases: 'Care coordination case',
  payments: 'Payment record',
  pricing: 'Pricing package',
};

const emptyForms: Record<Kind, Record<string, string>> = {
  clients: {
    fullName: '',
    email: '',
    phone: '',
    age: '',
    membership: 'Individual',
    benefits: 'To be confirmed',
    billingFrequency: 'Monthly',
    planName: '',
    accessStatus: 'Pending approval',
    providerId: '',
    status: 'Pending',
  },
  providers: {
    name: '',
    facilityType: 'Hospital',
    location: '',
    contactPerson: '',
    phone: '',
    email: '',
    services: '',
    status: 'Active',
  },
  cases: {
    clientId: '',
    category: 'Treatment authorisation',
    subject: '',
    details: '',
    assignedProviderId: '',
    priority: 'Normal',
    status: 'Open',
    nextFollowUp: '',
  },
  payments: {
    clientId: '',
    amount: '',
    period: 'Monthly',
    dueDate: '',
    paidDate: '',
    status: 'Pending',
    reference: '',
  },
  pricing: {
    name: '',
    ageBand: '',
    membership: 'Individual',
    benefits: '',
    monthlyRate: '',
    quarterlyRate: '',
    annualRate: '',
    notes: '',
  },
};

function money(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0
    ? '₦' + n.toLocaleString('en-NG')
    : 'Not set';
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [section, setSection] = useState('overview');
  const [records, setRecords] = useState<Record<Kind, RecordItem[]>>({
    clients: [],
    providers: [],
    cases: [],
    payments: [],
    pricing: [],
  });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<Kind | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [selectedCard, setSelectedCard] = useState<RecordItem | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [team, setTeam] = useState<RecordItem[]>([]);
  const [profileChangeRequests, setProfileChangeRequests] = useState<RecordItem[]>([]);
  const [staffEmail, setStaffEmail] = useState('');
  const [staffRole, setStaffRole] = useState('staff');
  const [sensitiveForm, setSensitiveForm] = useState<Record<string, string>>({});
  const [eligibilityClientId, setEligibilityClientId] = useState('');
  const [eligibilityRequest, setEligibilityRequest] = useState('');
  const [eligibilityResult, setEligibilityResult] = useState('');
  const [caseReviewId, setCaseReviewId] = useState('');
  const [caseReviewConfirmed, setCaseReviewConfirmed] = useState(false);
  const [caseReviewResult, setCaseReviewResult] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [adminBriefing, setAdminBriefing] = useState('');
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [customerQuestion, setCustomerQuestion] = useState('');
  const [customerAnswer, setCustomerAnswer] = useState('');
  const [customerHelpLoading, setCustomerHelpLoading] = useState(false);
  const [gatewaySettings, setGatewaySettings] = useState<any>({ activeGateway: 'none', mode: 'test', publicKey: '', merchantId: '', currency: 'NGN', enabled: false, updatedAt: '' });
  const [gatewayLoading, setGatewayLoading] = useState(false);
  const [gatewaySaving, setGatewaySaving] = useState(false);
  const [publicConfig, setPublicConfig] = useState<any>({ brandName: 'TrustlineCover', tagline: 'HEALTHCARE, MADE CLEAR', heroHeadline: 'Healthcare should feel easier.', heroDescription: 'Finding the right healthcare cover is one thing. Knowing who to speak to, what happens next and where to turn for support matters just as much.', heroSubtext: 'TrustlineCover helps individuals and families choose a suitable plan while we manage the healthcare arrangements, approvals and ongoing support behind the scenes.', supportEmail: 'trustlinesolutions@outlook.com', supportPhone: '', whatsapp: '', instagram: '', facebook: '', linkedin: '', paymentInstructions: '', plans: [{ name: 'Essential', monthlyRate: 7000, description: 'A simple starting option for everyday healthcare support.', benefits: 'Digital care access card; Plan benefit guidance; Care request coordination' }, { name: 'Plus', monthlyRate: 10000, description: 'More support for individuals and families seeking added reassurance.', benefits: 'Everything in Essential; Priority request follow up; Expanded plan benefit guidance' }, { name: 'Premium', monthlyRate: 20000, description: 'An enhanced option for members who want a higher level of coordinated support.', benefits: 'Everything in Plus; Enhanced care coordination; Dedicated follow up support' }] });

  useEffect(() => {
    api.get('/api/public-config').then(response => setPublicConfig(response.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const iconUrl = publicConfig.faviconImage;
    if (iconUrl) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = iconUrl;
    }
  }, [publicConfig.faviconImage]);

  useEffect(() => {
    auth
      .getUser()
      .then(u => setUser(u))
      .catch(() =>
        setAuthError('We could not restore your sign in. Please try again.')
      )
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!user) {
      setSession(null);
      return;
    }
    setSessionLoading(true);
    api.get('/api/session')
      .then(response => setSession(response.data))
      .catch(() => setSession({ role: 'unassigned', email: user.email }))
      .finally(() => setSessionLoading(false));
  }, [user]);

  async function loadAll() {
    setLoading(true);
    try {
      const kinds: Kind[] = session?.role === 'owner' || session?.role === 'admin'
        ? ['clients', 'providers', 'cases', 'payments', 'pricing']
        : session?.role === 'staff'
          ? ['clients', 'cases', 'payments']
          : ['clients', 'cases'];
      const responses = await Promise.all(
        kinds.map(k => api.get('/api/records/' + k))
      );
      const next: Record<Kind, RecordItem[]> = { clients: [], providers: [], cases: [], payments: [], pricing: [] };
      kinds.forEach((k, i) => {
        next[k] = responses[i].data.items || [];
      });
      setRecords(next);
    } catch {
      setNotice(
        'We could not load your workspace. Please refresh and try again.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user && session && ['owner', 'admin', 'staff', 'customer_service'].includes(session.role)) loadAll();
  }, [user, session?.role]);

  useEffect(() => {
    if (section === 'team' && session?.role === 'owner') { loadTeam(); loadProfileChangeRequests(); }
    if (section === 'gateways' && session?.role === 'owner') loadGatewaySettings();
  }, [section, session?.role]);

  async function loadGatewaySettings() {
    setGatewayLoading(true);
    try { const response = await api.get('/api/admin/payment-gateway'); setGatewaySettings(response.data); }
    catch { setNotice('Payment gateway settings could not be loaded.'); }
    finally { setGatewayLoading(false); }
  }

  async function saveGatewaySettings() {
    setGatewaySaving(true);
    try {
      const response = await api.put('/api/admin/payment-gateway', gatewaySettings);
      setGatewaySettings(response.data);
      setNotice('Payment gateway settings saved. API secret keys must also be submitted through the secure secrets form before live payments can be activated.');
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Payment gateway settings could not be saved.'); }
    finally { setGatewaySaving(false); }
  }

  const counts = useMemo(
    () => ({
      clients: records.clients.length,
      providers: records.providers.length,
      active: records.clients.filter(r => r.status === 'Active').length,
      openCases: records.cases.filter(
        r => !['Resolved', 'Closed'].includes(r.status)
      ).length,
      pending: records.payments.filter(r => r.status !== 'Paid').length,
      revenue: records.payments
        .filter(r => r.status === 'Paid')
        .reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
    }),
    [records]
  );

  const currentItems =
    section === 'clients' ||
    section === 'providers' ||
    section === 'pricing' ||
    section === 'payments' ||
    section === 'cases'
      ? records[section as Kind]
      : [];
  const filteredItems = currentItems.filter(r =>
    JSON.stringify(r).toLowerCase().includes(search.toLowerCase())
  );

  function openNew(kind: Kind) {
    setForm({ ...emptyForms[kind] });
    setModal(kind);
  }

  async function saveRecord() {
    if (!modal) return;
    const required: Record<Kind, string[]> = {
      clients: ['fullName', 'phone', 'email'],
      providers: ['name', 'location'],
      cases: ['subject', 'category'],
      payments: ['clientId', 'amount'],
      pricing: ['name', 'membership'],
    };
    if (required[modal].some(key => !String(form[key] || '').trim())) {
      setNotice('Please complete the required fields before saving.');
      return;
    }
    if (
      modal === 'payments' &&
      (!Number(form.amount) || Number(form.amount) <= 0)
    ) {
      setNotice('Enter a valid payment amount.');
      return;
    }
    setSaving(true);
    try {
      const response = await api.post('/api/records/' + modal, {
        ...form,
        ...(modal === 'clients' ? {
          accessStatus: 'Pending approval',
          providerId: '',
          assignmentApproved: false,
        } : {}),
        createdAt: new Date().toISOString(),
      });
      setRecords(old => ({
        ...old,
        [modal]: [response.data.item, ...old[modal]],
      }));
      setModal(null);
      setNotice(kindLabels[modal] + ' saved successfully.');
    } catch {
      setNotice('We could not save this record. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function updateRecord(
    kind: Kind,
    item: RecordItem,
    changes: Record<string, unknown>
  ) {
    try {
      const response = await api.put(
        '/api/records/' + kind + '/' + item.id,
        changes
      );
      setRecords(old => ({
        ...old,
        [kind]: old[kind].map(r => (r.id === item.id ? response.data.item : r)),
      }));
      setNotice('Record updated.');
    } catch {
      setNotice('The update could not be saved.');
    }
  }

  async function signOut() {
    await auth.signOut();
    setUser(null);
    setSession(null);
    setRecords({
      clients: [],
      providers: [],
      cases: [],
      payments: [],
      pricing: [],
    });
  }

  async function loadTeam() {
    try {
      const response = await api.get('/api/staff');
      setTeam(response.data.items || []);
    } catch {
      setNotice('We could not load team access details.');
    }
  }

  async function loadProfileChangeRequests() {
    try {
      const response = await api.get('/api/admin/profile-change-requests');
      setProfileChangeRequests(response.data.items || []);
    } catch { setNotice('Contact detail requests could not be loaded.'); }
  }

  async function reviewProfileChangeRequest(item: RecordItem, decision: 'Approved' | 'Rejected') {
    try {
      await api.put('/api/admin/profile-change-requests/' + item.id, { decision });
      setNotice(decision === 'Approved' ? 'Customer contact details updated.' : 'Contact detail request declined.');
      await loadProfileChangeRequests();
      await loadAll();
    } catch { setNotice('The contact detail request could not be processed.'); }
  }

  async function deleteCustomer(item: RecordItem) {
    if (!window.confirm('Delete this customer record? Payment and care history will remain for audit purposes.')) return;
    try {
      await api.delete('/api/records/clients/' + item.id);
      setRecords(old => ({ ...old, clients: old.clients.filter(customer => customer.id !== item.id) }));
      setNotice('Customer record deleted.');
    } catch { setNotice('Customer record could not be deleted.'); }
  }

  function openSensitiveProfile(item: RecordItem) {
    setSelectedCard(item);
    setSensitiveForm({ email: item.email || '', phone: item.phone || '', nin: item.nin || '', dateOfBirth: item.dateOfBirth || '' });
  }

  async function saveSensitiveProfile() {
    if (!selectedCard) return;
    try {
      const response = await api.put('/api/records/clients/' + selectedCard.id, sensitiveForm);
      setRecords(old => ({ ...old, clients: old.clients.map(item => item.id === selectedCard.id ? response.data.item : item) }));
      setSelectedCard(response.data.item);
      setNotice('Sensitive customer details updated by Super Admin.');
    } catch { setNotice('Sensitive customer details could not be updated.'); }
  }

  async function addStaff() {
    const email = staffEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      setNotice('Enter a valid team member email address.');
      return;
    }
    try {
      await api.post('/api/staff', { email, role: staffRole });
      setStaffEmail('');
      await loadTeam();
      setNotice('Team access has been added. The team member can now sign in with this email.');
    } catch (e) {
      setNotice('We could not add this team member. Check whether the email is already registered.');
    }
  }

  async function runAdminBriefing() {
    setBriefingLoading(true); setAdminBriefing('');
    try {
      const response = await api.post('/api/ai/admin-briefing', {});
      setAdminBriefing(response.data.briefing || 'No briefing was returned.');
    } catch { setAdminBriefing('The management briefing could not be prepared. Please try again.'); }
    finally { setBriefingLoading(false); }
  }

  async function runCustomerHelp() {
    if (!customerQuestion.trim()) return;
    setCustomerHelpLoading(true); setCustomerAnswer('');
    try {
      const response = await api.post('/api/ai/customer-help', { question: customerQuestion.trim() });
      setCustomerAnswer(response.data.answer || 'I could not find an answer. Please contact TrustlineCover.');
    } catch { setCustomerAnswer('I could not answer that just now. Please contact TrustlineCover using the details on this website.'); }
    finally { setCustomerHelpLoading(false); }
  }

  async function runEligibility() {
    if (!eligibilityClientId || !eligibilityRequest.trim()) {
      setNotice('Select a customer and describe the care request first.');
      return;
    }
    setAiLoading(true);
    setEligibilityResult('');
    try {
      const response = await api.post('/api/ai/eligibility', {
        clientId: eligibilityClientId,
        request: eligibilityRequest.trim(),
      });
      setEligibilityResult(response.data.result || response.data.message || 'No assessment was returned.');
    } catch {
      setEligibilityResult('The eligibility assistant could not complete this check. Please review the plan manually.');
    } finally {
      setAiLoading(false);
    }
  }

  async function runCaseReview() {
    if (!caseReviewId || !caseReviewConfirmed) {
      setNotice('Select a case and confirm that identifying details have been removed.');
      return;
    }
    setAiLoading(true);
    setCaseReviewResult('');
    try {
      const response = await api.post('/api/ai/case-review', {
        caseId: caseReviewId,
        confirmedAnonymised: true,
      });
      setCaseReviewResult(response.data.result || 'No review was returned.');
    } catch {
      setCaseReviewResult('The case assistant could not complete this review. Please review the case manually.');
    } finally {
      setAiLoading(false);
    }
  }

  if (authLoading)
    return (
      <div className="auth-screen">
        <div className="loader" />
        <p>Preparing your TrustlineCover workspace…</p>
      </div>
    );
  if (user && sessionLoading) return <div className="auth-screen"><div className="loader" /><p>Checking your TrustlineCover access…</p></div>;
  if (user && session?.role === 'client' && session.member) return <ClientDashboard user={user} member={session.member} onSignOut={signOut} />;
  if (user && (!session || session.role === 'unassigned')) return <MemberEnrollment email={user.email || ''} config={publicConfig} onComplete={() => window.location.reload()} onSignOut={signOut} />;
  if (user && !['owner', 'admin', 'staff', 'customer_service', 'client'].includes(session.role)) return <div className="auth-screen"><div className="login-card"><div className="brand-mark"><ShieldCheck size={28} /></div><h2>Access not available</h2><p className="muted">Please contact TrustlineCover for assistance.</p><button className="primary wide" onClick={signOut}>Sign out</button></div></div>;
  if (!user && !showLogin) return <LandingPage config={publicConfig} onLogin={() => setShowLogin(true)} />;
  if (!user)
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="brand-mark">
            <ShieldCheck size={30} />
          </div>
          <div className="eyebrow">HEALTHCARE, WITH YOU AT EVERY STEP</div>
          <h1>
            Trustline<span>Cover</span>
          </h1>
          <p className="muted">
            A central workspace for customer subscriptions, healthcare partners
            and care coordination.
          </p>
          {authError && <div className="notice error">{authError}</div>}
          <button
            className="primary wide"
            onClick={() =>
              auth
                .signInWithRedirect()
                .catch(e =>
                  setAuthError(e.message || 'Sign in failed. Please try again.')
                )
            }
          >
            Continue with email
          </button>
          <p className="tiny">
            New members can create an account with their email address. We will send a secure confirmation link. After confirming your email, you can complete your details and choose a plan. Existing members and authorised team members can use the same email sign in.
          </p>
        </div>
      </div>
    );

  const pageTitle = sections.find(s => s.id === section)?.label || 'Overview';
  const roleLabel = session?.role === 'owner' ? 'Super Admin' : session?.role === 'customer_service' ? 'Customer Service' : session?.role === 'admin' ? 'Administrator' : 'Staff';
  const visibleSections = sections.filter(item => {
    if (session?.role === 'owner') return true;
    if (['team', 'settings', 'gateways'].includes(item.id)) return false;
    if (session?.role === 'admin') return true;
    if (session?.role === 'staff') return ['overview', 'clients', 'cases', 'payments', 'emails'].includes(item.id);
    return ['overview', 'clients', 'cases'].includes(item.id);
  });
  const pageIntro: Record<string, string> = {
    overview: 'A clear view of your customer base and daily operations.',
    clients:
      'Manage subscriptions, internal care approval and each customer’s digital access card.',
    providers:
      'Manage the core healthcare provider and any additional arrangements approved by TrustlineCover.',
    pricing:
      'Set your own rates and benefit structures. Prices are intentionally left blank until you provide your schedule.',
    payments:
      'Track customer payments, outstanding balances and renewal dates.',
    cases:
      'Coordinate customer requests and follow up with assigned healthcare providers.',
    ai: 'Use AI support to review plan eligibility and organise care coordination. Human approval remains essential.',
    team: 'Manage who can access the TrustlineCover operations workspace.',
    settings: 'Update the public website, brand images, plan prices, contact details and social media links.',
    gateways: 'Configure Flutterwave, Paystack or Quickteller for member and wallet payments.',
    emails: 'Send member communications and review recent email activity.',
  };

  return (
    <div className="app-shell">
      <aside className={'sidebar ' + (mobileMenu ? 'show' : '')}>
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={23} />
          </div>
          <div>
            <strong>
              Trustline<span>Cover</span>
            </strong>
            <small>MANAGEMENT PORTAL</small>
          </div>
          <button
            className="icon-button close-menu"
            onClick={() => setMobileMenu(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          {visibleSections.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={'nav-link ' + (section === item.id ? 'active' : '')}
                onClick={() => {
                  setSection(item.id);
                  setSearch('');
                  setMobileMenu(false);
                }}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {item.id === 'cases' && counts.openCases > 0 && (
                  <b className="nav-count">{counts.openCases}</b>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">
              <Activity size={17} />
            </div>
            <strong>Care, coordinated.</strong>
            <p>Keep every customer request visible and moving.</p>
          </div>
          {session?.role === 'owner' && (
            <button
              className="nav-link"
              onClick={() => setSection('settings')}
            >
              <Settings size={18} />
              <span>Website settings</span>
            </button>
          )}
          <div className="profile">
            <div className="avatar">
              {(user.name || user.email || 'T').slice(0, 1).toUpperCase()}
            </div>
            <div className="profile-text">
              <strong>{user.name || 'Workspace administrator'}</strong>
              <small>{user.email || 'Signed in account'}</small>
            </div>
            <button className="icon-button" title="Sign out" onClick={signOut}>
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            onClick={() => setMobileMenu(true)}
          >
            <Menu />
          </button>
          <div className="crumb">
            TrustlineCover <span>/</span> {pageTitle}
          </div>
          <div className="top-actions">
            <span className="secure">
              <span /> Secure workspace
            </span>
            <button className="icon-button" onClick={loadAll} title="Refresh">
              <RefreshCw size={17} />
            </button>
            <div className="avatar small">
              {(user.name || user.email || 'T').slice(0, 1).toUpperCase()}
            </div>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">TRUSTLINECOVER OPERATIONS</div>
              <h1>{pageTitle}</h1>
              <p>{pageIntro[section]}</p>
            </div>
            {(['clients', 'cases'].includes(section) || (['providers', 'pricing'].includes(section) && ['owner', 'admin'].includes(session?.role || '')) || (section === 'payments' && ['owner', 'admin', 'staff'].includes(session?.role || ''))) && (
              <button
                className="primary"
                onClick={() => openNew(section as Kind)}
              >
                <Plus size={17} /> Add {kindLabels[section as Kind]}
              </button>
            )}
          </div>
          {notice && (
            <div className="notice">
              <span>{notice}</span>
              <button onClick={() => setNotice('')}>
                <X size={15} />
              </button>
            </div>
          )}
          {loading && <div className="loading-line">Refreshing workspace…</div>}

          {section === 'overview' && (
            <>
              <div className="welcome-panel">
                <div>
                  <div className="eyebrow light">
                    YOUR HEALTHCARE OPERATIONS, IN ONE PLACE
                  </div>
                  <h2>Welcome to your {roleLabel} workspace.</h2>
                  <p>{session?.role === 'customer_service' ? 'Register customers, respond to enquiries and keep care requests moving.' : session?.role === 'staff' ? 'Register customers and keep assigned operations and care requests up to date.' : session?.role === 'admin' ? 'Oversee customer records, payments, providers and daily operations.' : 'Manage TrustlineCover, team access, customer information and all operations.'}</p>
                </div>
                <div className="welcome-icon">
                  <HeartPulse size={62} />
                </div>
              </div>
              <div className="stat-grid">
                <Stat
                  icon={<Users />}
                  label="Total customers"
                  value={counts.clients}
                  note="All registered customers"
                />
                <Stat
                  icon={<ShieldCheck />}
                  label="Active memberships"
                  value={counts.active}
                  note="Marked as active"
                />
                <Stat
                  icon={<Stethoscope />}
                  label="Plans configured"
                  value={records.pricing.length}
                  note="Available subscription plans"
                />
                <Stat
                  icon={<ClipboardList />}
                  label="Open care requests"
                  value={counts.openCases}
                  note="Awaiting follow up"
                />
              </div>
              <div className="overview-grid">
                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <h3>Recent customers</h3>
                      <p>Latest customer records</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setSection('clients')}
                    >
                      View all
                    </button>
                  </div>
                  <RecordsPreview
                    items={records.clients.slice(0, 5)}
                    empty="Customer records will appear here when you add your first customer."
                  />
                </div>
                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <h3>Operations snapshot</h3>
                      <p>Current workspace activity</p>
                    </div>
                    <Activity size={19} className="muted-icon" />
                  </div>
                  <div className="snapshot-row">
                    <span>Payments awaiting confirmation</span>
                    <strong>{counts.pending}</strong>
                  </div>
                  <div className="snapshot-row">
                    <span>Payments recorded</span>
                    <strong>
                      {records.payments.filter(p => p.status === 'Paid').length}
                    </strong>
                  </div>
                  <div className="snapshot-row">
                    <span>Recorded collections</span>
                    <strong>{money(counts.revenue)}</strong>
                  </div>
                  <div className="snapshot-row">
                    <span>Pricing packages configured</span>
                    <strong>{records.pricing.length}</strong>
                  </div>
                  <div className="hint-box">
                    Add your actual pricing and benefit schedule when it is
                    ready. No sample premiums have been assumed.
                  </div>
                </div>
              </div>
              <div className="quick-actions">
                <button onClick={() => openNew('clients')}>
                  <Plus size={17} /> Add a customer
                </button>
                <button onClick={() => openNew('providers')}>
                  <Plus size={17} /> Add a provider
                </button>
                <button onClick={() => openNew('cases')}>
                  <Plus size={17} /> Log a care request
                </button>
              </div>
            </>
          )}

          {['clients', 'providers', 'pricing', 'payments', 'cases'].includes(section) && (
            <div className="panel data-panel">
              <div className="panel-head">
                <div>
                  <h3>
                    {section === 'clients'
                      ? 'Customer directory'
                      : section === 'providers'
                        ? 'Provider directory'
                        : section === 'pricing'
                          ? 'Pricing packages'
                          : section === 'payments'
                            ? 'Payment records'
                            : 'Care coordination log'}
                  </h3>
                  <p>
                    {currentItems.length} record
                    {currentItems.length === 1 ? '' : 's'} in this workspace
                  </p>
                </div>
                <div className="search-box">
                  <Search size={16} />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search records"
                  />
                </div>
              </div>
              {filteredItems.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    <FileText size={25} />
                  </div>
                  <h3>{search ? 'No matching records' : 'Nothing here yet'}</h3>
                  <p>
                    {search
                      ? 'Try another search term.'
                      : 'Add your first record to start building your TrustlineCover workspace.'}
                  </p>
                  {!search && (
                    <button
                      className="primary"
                      onClick={() => openNew(section as Kind)}
                    >
                      <Plus size={16} /> Add {kindLabels[section as Kind]}
                    </button>
                  )}
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {(section === 'clients'
                          ? [
                              'Customer',
                              'Membership',
                              'Age',
                              'Benefits',
                              'Care access card',
                              'Status',
                            ]
                          : section === 'providers'
                            ? [
                                'Provider',
                                'Type',
                                'Location',
                                'Contact',
                                'Status',
                              ]
                            : section === 'pricing'
                              ? [
                                  'Package',
                                  'Membership',
                                  'Age band',
                                  'Monthly',
                                  'Quarterly',
                                  'Annual',
                                ]
                              : section === 'payments'
                                ? [
                                    'Customer',
                                    'Amount',
                                    'Period',
                                    'Due date',
                                    'Status',
                                  ]
                                : [
                                    'Request',
                                    'Category',
                                    'Customer',
                                    'Provider',
                                    'Priority',
                                    'Status',
                                  ]
                        ).map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map(r => (
                        <tr key={r.id}>
                          {section === 'clients' ? (
                            <>
                              <td>
                                <strong>{r.fullName}</strong>
                                <small>{r.phone || 'Contact number not supplied'}</small>
                                {session?.role === 'owner' && <><button className="text-button" onClick={() => openSensitiveProfile(r)}>Sensitive profile</button><button className="text-button" onClick={() => deleteCustomer(r)}>Delete customer</button></>}
                              </td>
                              <td>{r.membership}</td>
                              <td>{r.age || 'Not supplied'}</td>
                              <td>{r.benefits}</td>
                              <td>
                                <strong>{r.cardNumber || 'Card pending'}</strong>
                                <small>{r.planName || r.membership} · {r.accessStatus || 'Pending approval'}</small>
                                <button className="text-button" onClick={() => setSelectedCard(r)}>View access card</button>
                                {r.accessStatus !== 'Approved' && (
                                  <button className="text-button" onClick={() => updateRecord('clients', r, { accessStatus: 'Approved', status: 'Active', assignmentApproved: true })}>Approve access</button>
                                )}
                              </td>
                              <td>
                                <Status value={r.status} />
                              </td>
                            </>
                          ) : section === 'providers' ? (
                            <>
                              <td>
                                <strong>{r.name}</strong>
                                <small>{r.email || r.phone}</small>
                              </td>
                              <td>{r.facilityType}</td>
                              <td>{r.location}</td>
                              <td>{r.contactPerson || 'Not supplied'}</td>
                              <td>
                                <Status value={r.status} />
                              </td>
                            </>
                          ) : section === 'pricing' ? (
                            <>
                              <td>
                                <strong>{r.name}</strong>
                                <small>{r.benefits}</small>
                              </td>
                              <td>{r.membership}</td>
                              <td>{r.ageBand || 'All ages'}</td>
                              <td>{money(r.monthlyRate)}</td>
                              <td>{money(r.quarterlyRate)}</td>
                              <td>{money(r.annualRate)}</td>
                            </>
                          ) : section === 'payments' ? (
                            <>
                              <td>
                                {records.clients.find(c => c.id === r.clientId)
                                  ?.fullName || 'Customer record'}
                              </td>
                              <td>
                                <strong>{money(r.amount)}</strong>
                              </td>
                              <td>{r.period}</td>
                              <td>{r.dueDate || 'Not set'}</td>
                              <td>
                                <select
                                  className="inline-select"
                                  value={r.status}
                                  disabled={!['owner', 'admin'].includes(session?.role || '')}
                                  onChange={e => updateRecord('payments', r, { status: e.target.value })}
                                >
                                  <option>Pending</option>
                                  <option>Paid</option>
                                  <option>Overdue</option>
                                  <option>Cancelled</option>
                                </select>
                              </td>
                            </>
                          ) : (
                            <>
                              <td>
                                <strong>{r.subject}</strong>
                                <small>{r.details}</small>
                              </td>
                              <td>{r.category}</td>
                              <td>
                                {records.clients.find(c => c.id === r.clientId)
                                  ?.fullName || 'Not linked'}
                              </td>
                              <td>
                                {records.providers.find(
                                  p => p.id === r.assignedProviderId
                                )?.name || 'Not assigned'}
                              </td>
                              <td>{r.priority}</td>
                              <td>
                                <select
                                  className="inline-select"
                                  value={r.status}
                                  onChange={e =>
                                    updateRecord('cases', r, {
                                      status: e.target.value,
                                    })
                                  }
                                >
                                  <option>Open</option>
                                  <option>In progress</option>
                                  <option>Awaiting provider</option>
                                  <option>Resolved</option>
                                  <option>Closed</option>
                                </select>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {section === 'emails' && ['owner', 'admin', 'staff'].includes(session?.role || '') && (
            <EmailCentre role={session?.role || 'staff'} />
          )}

          {section === 'settings' && session?.role === 'owner' && (
            <>
              <AdminPublicSettings config={publicConfig} onSaved={setPublicConfig} />
              <EmailSettings />
            </>
          )}

          {section === 'gateways' && session?.role === 'owner' && (
            <div className="panel gateway-panel">
              <div className="panel-head"><div><h3>Payment gateway configuration</h3><p>Choose one provider to receive plan subscription, renewal and wallet funding payments.</p></div><span className="role-pill">SUPER ADMIN ONLY</span></div>
              {gatewayLoading ? <div className="loading-line">Loading payment settings…</div> : <>
                <div className="gateway-provider-grid">
                  {[
                    {id:'flutterwave',name:'Flutterwave',desc:'Card, bank transfer and supported local payment methods.'},
                    {id:'paystack',name:'Paystack',desc:'Card, bank transfer and supported local payment methods.'},
                    {id:'quickteller',name:'Quickteller',desc:'Interswitch payment services, subject to merchant onboarding.'}
                  ].map(provider => <button type="button" key={provider.id} className={'gateway-choice '+(gatewaySettings.activeGateway===provider.id?'selected':'')} onClick={()=>setGatewaySettings((old:any)=>({...old,activeGateway:provider.id}))}><strong>{provider.name}</strong><small>{provider.desc}</small><span>{gatewaySettings.activeGateway===provider.id?'Selected':'Select provider'}</span></button>)}
                </div>
                <div className="gateway-form-grid">
                  <SelectField label="Environment" value={gatewaySettings.mode} options={['test','live']} labels={['Test mode','Live mode']} onChange={v=>setGatewaySettings((old:any)=>({...old,mode:v}))}/>
                  <Field label="Public key or client identifier" value={gatewaySettings.publicKey} onChange={v=>setGatewaySettings((old:any)=>({...old,publicKey:v}))}/>
                  <Field label="Merchant ID or terminal ID, if supplied" value={gatewaySettings.merchantId} onChange={v=>setGatewaySettings((old:any)=>({...old,merchantId:v}))}/>
                  <div className="field"><label>Settlement currency</label><input value="NGN" readOnly /></div>
                </div>
                <label className="confirm-line gateway-enable"><input type="checkbox" checked={!!gatewaySettings.enabled} onChange={e=>setGatewaySettings((old:any)=>({...old,enabled:e.target.checked}))}/> Enable this gateway after credentials and payment verification are fully tested.</label>
                <div className="gateway-security-note"><ShieldCheck size={18}/><div><strong>API secret security</strong><p>Secret keys are not saved in these settings. They must be entered through the encrypted AppDeploy secret form and remain on the backend. Never paste secret keys into ordinary website fields or share them in chat.</p></div></div>
                <div className="gateway-actions"><button className="secondary" onClick={loadGatewaySettings}>Reload settings</button><button className="primary" disabled={gatewaySaving} onClick={saveGatewaySettings}>{gatewaySaving?'Saving…':'Save gateway settings'}</button></div>
                <p className="client-disclaimer">Saving this page records your preferred gateway and environment. It does not by itself activate checkout. Live payments require the correct provider credentials, merchant approval, checkout integration, signed webhook verification and successful end to end tests.</p>
              </>}
            </div>
          )}

          {section === 'team' && session?.role === 'owner' && (
            <div className="panel team-panel">
              <div className="panel-head">
                <div><h3>Team access</h3><p>Only the Super Admin can add or manage authorised team accounts.</p></div>
                <span className="role-pill">SUPER ADMIN</span>
              </div>
              <div className="team-add-row">
                <Field label="Team member email address" value={staffEmail} onChange={setStaffEmail} />
                <SelectField label="Access level" value={staffRole} options={['admin', 'staff', 'customer_service']} labels={['Administrator', 'Staff', 'Customer Service']} onChange={setStaffRole} />
                <button className="primary" onClick={addStaff}><UserPlus size={16} /> Add access</button>
              </div>
              <div className="team-list">
                {team.length === 0 ? <div className="preview-empty">No team members have been added yet.</div> : team.map(person => <div className="team-row" key={person.id}><div className="team-avatar"><Users size={17} /></div><div><strong>{person.email}</strong><small>{person.role === 'admin' ? 'Administrator' : person.role === 'customer_service' ? 'Customer Service' : 'Staff'} · {person.status || 'Active'}</small></div><Status value={person.status || 'Active'} /></div>)}
              </div>
              <div className="team-list">
                <div className="panel-head"><div><h3>Customer contact change requests</h3><p>Only the Super Admin can approve changes to registered email addresses or phone numbers.</p></div><button className="secondary" onClick={loadProfileChangeRequests}>Refresh</button></div>
                {profileChangeRequests.filter(item => item.status === 'Pending').length === 0 ? <div className="preview-empty">There are no pending contact detail requests.</div> : profileChangeRequests.filter(item => item.status === 'Pending').map(item => <div className="team-row" key={item.id}><div className="team-avatar"><Users size={17}/></div><div><strong>{item.memberName || 'Customer'}</strong><small>Current: {item.currentEmail || 'No email'} · {item.currentPhone || 'No phone'}</small><small>Requested: {item.requestedEmail || item.currentEmail} · {item.requestedPhone || item.currentPhone}</small><small>{item.reason || 'No reason supplied'}</small></div><div className="team-actions"><button className="primary" onClick={() => reviewProfileChangeRequest(item, 'Approved')}>Approve</button><button className="secondary" onClick={() => reviewProfileChangeRequest(item, 'Rejected')}>Decline</button></div></div>)}
              </div>
              <p className="muted small-note">The Super Admin account is trustlinesolutions@outlook.com. Team members must sign in using the same email address added here.</p>
            </div>
          )}

          {section === 'ai' && (
            <div className="ai-grid">
              <div className="panel ai-panel admin-briefing-panel">
                <div className="ai-panel-icon"><Activity size={20} /></div>
                <h3>Super Admin management assistant</h3>
                <p>Prepare an operational briefing from member, payment, care request and provider records. Personal identifiers are excluded from the briefing data.</p>
                <button className="primary" disabled={briefingLoading} onClick={runAdminBriefing}><Sparkles size={16} /> {briefingLoading ? 'Preparing briefing…' : 'Prepare management briefing'}</button>
                {adminBriefing && <div className="ai-result"><strong>Management briefing</strong><p>{adminBriefing}</p><small>For administrative guidance only. Review all records and make decisions yourself.</small></div>}
              </div>
              <div className="panel ai-panel">
                <div className="ai-panel-icon"><ShieldCheck size={20} /></div>
                <h3>Plan eligibility assistant</h3>
                <p>Compare a care request with the customer’s saved plan benefits and highlight what needs human review.</p>
                <SelectField label="Customer" value={eligibilityClientId} options={['', ...records.clients.map(c => c.id)]} labels={['Select customer', ...records.clients.map(c => c.fullName)]} onChange={setEligibilityClientId} />
                <div className="field"><label>Care request</label><textarea rows={4} value={eligibilityRequest} onChange={e => setEligibilityRequest(e.target.value)} placeholder="Briefly describe the service being requested." /></div>
                <button className="primary" disabled={aiLoading} onClick={runEligibility}><Sparkles size={16} /> {aiLoading ? 'Reviewing…' : 'Check plan eligibility'}</button>
                {eligibilityResult && <div className="ai-result"><strong>Assistant assessment</strong><p>{eligibilityResult}</p></div>}
              </div>
              <div className="panel ai-panel">
                <div className="ai-panel-icon"><ClipboardList size={20} /></div>
                <h3>Care coordination assistant</h3>
                <p>Summarise a case, identify missing information and suggest the next operational follow up.</p>
                <SelectField label="Care case" value={caseReviewId} options={['', ...records.cases.map(c => c.id)]} labels={['Select care case', ...records.cases.map(c => c.subject)]} onChange={setCaseReviewId} />
                <label className="confirm-line"><input type="checkbox" checked={caseReviewConfirmed} onChange={e => setCaseReviewConfirmed(e.target.checked)} /> I have removed names, contact details and identifying clinical information from the case notes.</label>
                <button className="primary" disabled={aiLoading || !caseReviewConfirmed} onClick={runCaseReview}><Sparkles size={16} /> {aiLoading ? 'Reviewing…' : 'Review care case'}</button>
                {caseReviewResult && <div className="ai-result"><strong>Coordination suggestions</strong><p>{caseReviewResult}</p></div>}
              </div>
              <div className="ai-disclaimer"><LockKeyhole size={17} /> AI outputs are operational suggestions only. They do not diagnose, approve treatment, guarantee benefits or replace human review by TrustlineCover.</div>
            </div>
          )}

          <footer>
            TrustlineCover <span>•</span> Healthcare intermediation and care
            coordination workspace
          </footer>
        </div>
      </main>

      {selectedCard && (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSelectedCard(null); }}>
          <div className="modal access-card-modal">
            <div className="modal-head">
              <div><div className="eyebrow">CLIENT DASHBOARD PREVIEW</div><h2>Digital care access card</h2></div>
              <button className="icon-button" onClick={() => setSelectedCard(null)}><X /></button>
            </div>
            <div className="digital-access-card">
              <div className="access-card-brand"><ShieldCheck size={22} /><span><strong>TrustlineCover</strong><small>HEALTHCARE ACCESS</small></span></div>
              <div className="access-card-label">MEMBER</div>
              <h2>{selectedCard.fullName}</h2>
              <div className="access-card-number">{selectedCard.cardNumber || 'CARD PENDING'}</div>
              <div className="access-card-details"><span>PLAN<strong>{selectedCard.planName || selectedCard.membership}</strong></span><span>PAYMENT<strong>{selectedCard.billingFrequency || 'To be confirmed'}</strong></span></div>
              <div className="access-card-footer"><span>{selectedCard.accessStatus || 'Pending approval'}</span><span>Present this card to request approved care</span></div>
            </div>
            <p className="muted">TrustlineCover manages provider assignment and care arrangements internally. This card confirms the member’s access status and plan. It is not a guarantee of treatment or payment for services outside the approved benefits.</p>
            {session?.role === 'owner' && <div className="panel sensitive-profile-editor"><div className="eyebrow">SUPER ADMIN ONLY</div><h3>Sensitive customer information</h3><p>Only the Super Admin can change these details. Customers must submit a request for email or phone changes.</p><Field label="Email address" value={sensitiveForm.email || ''} onChange={v => setSensitiveForm(old => ({ ...old, email: v }))}/><Field label="Phone number" value={sensitiveForm.phone || ''} onChange={v => setSensitiveForm(old => ({ ...old, phone: v }))}/><Field label="NIN" value={sensitiveForm.nin || ''} onChange={v => setSensitiveForm(old => ({ ...old, nin: v }))}/><Field label="Date of birth" type="date" value={sensitiveForm.dateOfBirth || ''} onChange={v => setSensitiveForm(old => ({ ...old, dateOfBirth: v }))}/><button className="primary" onClick={saveSensitiveProfile}>Save sensitive information</button></div>}
            <div className="modal-actions"><button className="secondary" onClick={() => setSelectedCard(null)}>Close card</button></div>
          </div>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={e => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <div className="modal">
            <div className="modal-head">
              <div>
                <div className="eyebrow">NEW RECORD</div>
                <h2>Add {kindLabels[modal].toLowerCase()}</h2>
              </div>
              <button className="icon-button" onClick={() => setModal(null)}>
                <X />
              </button>
            </div>
            <div className="form-grid">
              {modal === 'clients' && (
                <>
                  <Field
                    label="Full name *"
                    value={form.fullName}
                    onChange={v => setForm({ ...form, fullName: v })}
                  />
                  <Field
                    label="Phone number *"
                    value={form.phone}
                    onChange={v => setForm({ ...form, phone: v })}
                  />
                  <Field
                    label="Email address"
                    value={form.email}
                    onChange={v => setForm({ ...form, email: v })}
                  />
                  <Field
                    label="Age"
                    type="number"
                    value={form.age}
                    onChange={v => setForm({ ...form, age: v })}
                  />
                  <SelectField
                    label="Membership category"
                    value={form.membership}
                    options={['Individual', 'Couple', 'Family']}
                    onChange={v => setForm({ ...form, membership: v })}
                  />
                  <SelectField
                    label="Payment frequency"
                    value={form.billingFrequency}
                    options={['Monthly', 'Quarterly', 'Annually']}
                    onChange={v => setForm({ ...form, billingFrequency: v })}
                  />
                  <Field
                    label="Healthcare benefits"
                    value={form.benefits}
                    onChange={v => setForm({ ...form, benefits: v })}
                  />
                  <Field
                    label="Selected plan or price tier"
                    value={form.planName}
                    onChange={v => setForm({ ...form, planName: v })}
                  />
                  <div className="field">
                    <label>Care assignment</label>
                    <div className="muted">Assigned internally by TrustlineCover after plan review and approval.</div>
                  </div>
                  <SelectField
                    label="Membership status"
                    value={form.status}
                    options={['Pending', 'Active', 'Suspended', 'Expired']}
                    onChange={v => setForm({ ...form, status: v })}
                  />
                </>
              )}
              {modal === 'providers' && (
                <>
                  <Field
                    label="Provider or facility name *"
                    value={form.name}
                    onChange={v => setForm({ ...form, name: v })}
                  />
                  <SelectField
                    label="Facility type"
                    value={form.facilityType}
                    options={[
                      'Hospital',
                      'Clinic',
                      'Diagnostic centre',
                      'Pharmacy',
                      'Specialist centre',
                      'Other',
                    ]}
                    onChange={v => setForm({ ...form, facilityType: v })}
                  />
                  <Field
                    label="Location *"
                    value={form.location}
                    onChange={v => setForm({ ...form, location: v })}
                  />
                  <Field
                    label="Contact person"
                    value={form.contactPerson}
                    onChange={v => setForm({ ...form, contactPerson: v })}
                  />
                  <Field
                    label="Phone"
                    value={form.phone}
                    onChange={v => setForm({ ...form, phone: v })}
                  />
                  <Field
                    label="Email"
                    value={form.email}
                    onChange={v => setForm({ ...form, email: v })}
                  />
                  <Field
                    label="Services"
                    value={form.services}
                    onChange={v => setForm({ ...form, services: v })}
                  />
                </>
              )}
              {modal === 'pricing' && (
                <>
                  <Field
                    label="Package name *"
                    value={form.name}
                    onChange={v => setForm({ ...form, name: v })}
                  />
                  <SelectField
                    label="Membership category"
                    value={form.membership}
                    options={['Individual', 'Couple', 'Family']}
                    onChange={v => setForm({ ...form, membership: v })}
                  />
                  <Field
                    label="Age band"
                    value={form.ageBand}
                    onChange={v => setForm({ ...form, ageBand: v })}
                  />
                  <Field
                    label="Benefits summary"
                    value={form.benefits}
                    onChange={v => setForm({ ...form, benefits: v })}
                  />
                  <Field
                    label="Monthly rate (₦)"
                    type="number"
                    value={form.monthlyRate}
                    onChange={v => setForm({ ...form, monthlyRate: v })}
                  />
                  <Field
                    label="Quarterly rate (₦)"
                    type="number"
                    value={form.quarterlyRate}
                    onChange={v => setForm({ ...form, quarterlyRate: v })}
                  />
                  <Field
                    label="Annual rate (₦)"
                    type="number"
                    value={form.annualRate}
                    onChange={v => setForm({ ...form, annualRate: v })}
                  />
                  <Field
                    label="Notes"
                    value={form.notes}
                    onChange={v => setForm({ ...form, notes: v })}
                  />
                </>
              )}
              {modal === 'payments' && (
                <>
                  <SelectField
                    label="Customer *"
                    value={form.clientId}
                    options={['', ...records.clients.map(c => c.id)]}
                    labels={[
                      'Select customer',
                      ...records.clients.map(c => c.fullName),
                    ]}
                    onChange={v => setForm({ ...form, clientId: v })}
                  />
                  <Field
                    label="Amount (₦) *"
                    type="number"
                    value={form.amount}
                    onChange={v => setForm({ ...form, amount: v })}
                  />
                  <SelectField
                    label="Payment period"
                    value={form.period}
                    options={['Monthly', 'Quarterly', 'Annually']}
                    onChange={v => setForm({ ...form, period: v })}
                  />
                  <Field
                    label="Due date"
                    type="date"
                    value={form.dueDate}
                    onChange={v => setForm({ ...form, dueDate: v })}
                  />
                  <Field
                    label="Payment date"
                    type="date"
                    value={form.paidDate}
                    onChange={v => setForm({ ...form, paidDate: v })}
                  />
                  <Field
                    label="Payment reference"
                    value={form.reference}
                    onChange={v => setForm({ ...form, reference: v })}
                  />
                  <SelectField
                    label="Status"
                    value={form.status}
                    options={['Pending', 'Paid', 'Overdue']}
                    onChange={v => setForm({ ...form, status: v })}
                  />
                </>
              )}
              {modal === 'cases' && (
                <>
                  <Field
                    label="Request subject *"
                    value={form.subject}
                    onChange={v => setForm({ ...form, subject: v })}
                  />
                  <SelectField
                    label="Request category"
                    value={form.category}
                    options={[
                      'Treatment authorisation',
                      'Claims follow up',
                      'Appointment support',
                      'Complaint',
                      'Provider issue',
                      'General enquiry',
                      'Other',
                    ]}
                    onChange={v => setForm({ ...form, category: v })}
                  />
                  <SelectField
                    label="Customer"
                    value={form.clientId}
                    options={['', ...records.clients.map(c => c.id)]}
                    labels={[
                      'Not linked',
                      ...records.clients.map(c => c.fullName),
                    ]}
                    onChange={v => setForm({ ...form, clientId: v })}
                  />
                  <SelectField
                    label="Healthcare provider"
                    value={form.assignedProviderId}
                    options={['', ...records.providers.map(p => p.id)]}
                    labels={[
                      'Not assigned',
                      ...records.providers.map(p => p.name),
                    ]}
                    onChange={v => setForm({ ...form, assignedProviderId: v })}
                  />
                  <SelectField
                    label="Priority"
                    value={form.priority}
                    options={['Low', 'Normal', 'High', 'Urgent']}
                    onChange={v => setForm({ ...form, priority: v })}
                  />
                  <Field
                    label="Next follow up"
                    type="date"
                    value={form.nextFollowUp}
                    onChange={v => setForm({ ...form, nextFollowUp: v })}
                  />
                  <div className="full-field">
                    <label>Details</label>
                    <textarea
                      value={form.details}
                      onChange={e =>
                        setForm({ ...form, details: e.target.value })
                      }
                      rows={3}
                    />
                  </div>
                </>
              )}
            </div>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={saving}
                onClick={saveRecord}
              >
                {saving ? 'Saving…' : 'Save record'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ClientDashboard({ user, member, onSignOut }: { user: User; member: RecordItem; onSignOut: () => void }) {
  const [cases, setCases] = useState<RecordItem[]>([]);
  const [requestSubject, setRequestSubject] = useState('');
  const [requestCategory, setRequestCategory] = useState('Appointment support');
  const [requestDetails, setRequestDetails] = useState('');
  const [eligibilityRequest, setEligibilityRequest] = useState('');
  const [eligibilityResult, setEligibilityResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [wallet, setWallet] = useState<any>({ balance: 0, points: 0, transactions: [], referralCode: '' });
  const [walletAmount, setWalletAmount] = useState('');
  const [pointsToConvert, setPointsToConvert] = useState('');
  const [walletBusy, setWalletBusy] = useState(false);
  const [requestedEmail, setRequestedEmail] = useState('');
  const [requestedPhone, setRequestedPhone] = useState('');
  const [profileReason, setProfileReason] = useState('');
  const [profileRequests, setProfileRequests] = useState<RecordItem[]>([]);

  async function loadProfileRequests() {
    try { const response = await api.get('/api/member/profile-change-requests'); setProfileRequests(response.data.items || []); }
    catch { setNotice('Your contact detail requests could not be loaded.'); }
  }

  async function submitProfileChangeRequest() {
    if (!requestedEmail.trim() && !requestedPhone.trim()) { setNotice('Enter the new email address or phone number you want us to review.'); return; }
    setBusy(true);
    try {
      const response = await api.post('/api/member/profile-change-requests', { email: requestedEmail.trim(), phone: requestedPhone.trim(), reason: profileReason.trim() });
      setNotice(response.data.message || 'Your request has been submitted.');
      setRequestedEmail(''); setRequestedPhone(''); setProfileReason('');
      await loadProfileRequests();
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Your request could not be submitted.'); }
    finally { setBusy(false); }
  }

  async function loadWallet() {
    try {
      const response = await api.get('/api/member/wallet');
      setWallet(response.data);
    } catch {
      setNotice('We could not load your wallet just now. Please refresh later.');
    }
  }

  async function requestWalletFunding() {
    const amount = Number(walletAmount);
    if (!Number.isFinite(amount) || amount < 1000) { setNotice('Enter at least ₦1,000 to fund your wallet.'); return; }
    setWalletBusy(true);
    try {
      const response = await api.post('/api/member/wallet/fund', { amount });
      setNotice(response.data.message || 'Wallet funding request recorded.');
      setWalletAmount('');
      await loadWallet();
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Wallet funding request could not be recorded.'); }
    finally { setWalletBusy(false); }
  }

  async function convertPoints() {
    const points = Number(pointsToConvert);
    if (!Number.isFinite(points) || points <= 0) { setNotice('Enter the points you want to convert.'); return; }
    setWalletBusy(true);
    try {
      const response = await api.post('/api/member/wallet/convert', { points });
      setNotice(response.data.message || 'Points converted successfully.');
      setPointsToConvert('');
      await loadWallet();
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Points could not be converted.'); }
    finally { setWalletBusy(false); }
  }

  async function loadCases() {
    try {
      const response = await api.get('/api/member/cases');
      setCases(response.data.items || []);
    } catch {
      setNotice('We could not load your care requests. Please refresh later.');
    }
  }

  useEffect(() => { loadCases(); loadWallet(); loadProfileRequests(); }, []);

  async function submitRequest() {
    if (!requestSubject.trim()) { setNotice('Please enter the subject of your request.'); return; }
    setBusy(true);
    try {
      await api.post('/api/member/cases', { subject: requestSubject.trim(), category: requestCategory, details: requestDetails.trim() });
      setRequestSubject('');
      setRequestDetails('');
      setNotice('Your request has been sent to the TrustlineCover team.');
      await loadCases();
    } catch {
      setNotice('Your request could not be submitted. Please try again.');
    } finally { setBusy(false); }
  }

  async function checkEligibility() {
    if (!eligibilityRequest.trim()) { setNotice('Describe the care service you want to check.'); return; }
    setBusy(true);
    setEligibilityResult('');
    try {
      const response = await api.post('/api/ai/eligibility', { request: eligibilityRequest.trim() });
      setEligibilityResult(response.data.result || response.data.message || 'No assessment was returned.');
    } catch {
      setEligibilityResult('We could not complete this check. Please contact TrustlineCover for a manual review.');
    } finally { setBusy(false); }
  }

  return (
    <div className="client-portal">
      <header className="client-topbar"><div className="brand"><div className="brand-mark"><ShieldCheck size={23} /></div><div><strong>Trustline<span>Cover</span></strong><small>MEMBER DASHBOARD</small></div></div><div className="client-user"><span>{user.email}</span><button className="secondary" onClick={onSignOut}><LogOut size={15} /> Sign out</button></div></header>
      <main className="client-content">
        <div className="client-welcome"><div><div className="eyebrow">YOUR HEALTHCARE COVER</div><h1>Welcome, {member.fullName || user.name || 'Member'}.</h1><p>Your care access details and support requests are available here.</p></div><div className="client-welcome-icon"><HeartPulse size={42} /></div></div>
        <PublicCustomerHelp memberMode />
        {notice && <div className="notice"><span>{notice}</span><button onClick={() => setNotice('')}><X size={15} /></button></div>}
        <section className="panel client-panel profile-request-panel">
          <div className="panel-head"><div><div className="eyebrow">ACCOUNT DETAILS</div><h3>Request a contact detail change</h3><p>Your registered email address and phone number cannot be changed directly from your dashboard. Send a request and TrustlineCover will review it.</p></div><div className="ai-panel-icon"><LockKeyhole size={20}/></div></div>
          <div className="profile-current-details"><span>Registered email<strong>{member.email || user.email}</strong></span><span>Registered phone<strong>{member.phone || 'Not supplied'}</strong></span></div>
          <div className="form-grid"><Field label="New email address" value={requestedEmail} onChange={setRequestedEmail}/><Field label="New phone number" value={requestedPhone} onChange={setRequestedPhone}/><div className="field full-field"><label>Reason for the change</label><textarea rows={2} value={profileReason} onChange={e => setProfileReason(e.target.value)} placeholder="Tell us why you need this change."/></div></div>
          <button className="primary" disabled={busy} onClick={submitProfileChangeRequest}>Submit change request</button>
          <div className="team-list"><h4>Your previous requests</h4>{profileRequests.length === 0 ? <div className="preview-empty">No contact detail requests yet.</div> : profileRequests.map(item => <div className="client-case-row" key={item.id}><div><strong>{item.requestedEmail || item.currentEmail} · {item.requestedPhone || item.currentPhone}</strong><small>{new Date(item.requestedAt).toLocaleString('en-NG')}</small></div><Status value={item.status || 'Pending'}/></div>)}</div>
        </section>
        <section className="client-card-section">
          <div className="digital-access-card client-live-card">
            <div className="access-card-brand"><ShieldCheck size={22} /><span><strong>TrustlineCover</strong><small>HEALTHCARE ACCESS</small></span></div>
            <div className="access-card-label">MEMBER</div>
            <h2>{member.fullName}</h2>
            <div className="access-card-number">{member.cardNumber || 'CARD PENDING'}</div>
            <div className="access-card-details"><span>PLAN<strong>{member.planName || member.membership || 'To be confirmed'}</strong></span><span>PAYMENT<strong>{member.billingFrequency || 'To be confirmed'}</strong></span></div>
            <div className="access-card-footer"><span>{member.coverageStartsAt && new Date(member.coverageStartsAt) > new Date() ? 'Waiting period' : member.coverageExpiresAt && new Date(member.coverageExpiresAt) <= new Date() ? 'Cover expired' : member.accessStatus || 'Pending approval'}</span><span>Present this card when requesting approved care</span></div>
          </div>
          <div className="client-plan-info"><span className="eyebrow">YOUR MEMBERSHIP</span><h3>{member.planName || member.membership || 'Plan details pending'}</h3><p>{member.benefits || 'Your plan benefits will appear here once confirmed by TrustlineCover.'}</p><div className="membership-status"><span>Membership status</span><Status value={member.status || 'Pending'} /></div><div className="membership-status"><span>Care access</span><Status value={member.coverageStartsAt && new Date(member.coverageStartsAt) > new Date() ? 'Waiting period' : member.coverageExpiresAt && new Date(member.coverageExpiresAt) <= new Date() ? 'Cover expired' : member.accessStatus || 'Pending approval'} /></div>{member.coverageStartsAt && new Date(member.coverageStartsAt) > new Date() && <small>Your waiting period ends on {new Date(member.coverageStartsAt).toLocaleString('en-NG')}.</small>}{member.coverageExpiresAt && <small>Current cover expires on {new Date(member.coverageExpiresAt).toLocaleDateString('en-NG')}.</small>}<small>Provider arrangements are managed internally by TrustlineCover and are not displayed on your card.</small></div>
        </section>
        <section className="panel client-panel wallet-panel">
          <div className="panel-head"><div><div className="eyebrow">YOUR REWARDS</div><h3>Wallet and referrals</h3><p>Share your code, earn 2.5% on confirmed payments made by members you refer, and earn points when your wallet funding is confirmed.</p></div><div className="ai-panel-icon"><Wallet size={21}/></div></div>
          <div className="wallet-summary-grid"><div><small>Wallet balance</small><strong>{money(wallet.balance)}</strong></div><div><small>Reward points</small><strong>{Number(wallet.points || 0).toLocaleString('en-NG')} points</strong><small>1 point = ₦1</small></div></div>
          <div className="wallet-referral"><label>Your referral code</label><div><strong>{wallet.referralCode || member.referralCode || 'Loading…'}</strong><button className="secondary" onClick={() => { if (wallet.referralCode || member.referralCode) navigator.clipboard?.writeText(wallet.referralCode || member.referralCode); }}>Copy code</button></div></div>
          <div className="wallet-actions"><div className="field"><label>Fund wallet (₦)</label><input type="number" min="1000" value={walletAmount} onChange={e => setWalletAmount(e.target.value)} placeholder="Minimum ₦1,000"/><button className="primary" disabled={walletBusy} onClick={requestWalletFunding}>Request funding</button></div><div className="field"><label>Convert points to wallet</label><input type="number" min="0.01" max={wallet.points || 0} step="0.01" value={pointsToConvert} onChange={e => setPointsToConvert(e.target.value)} placeholder="Enter points"/><button className="secondary" disabled={walletBusy || Number(wallet.points || 0) <= 0} onClick={convertPoints}>Convert points</button></div></div>
          <p className="client-disclaimer">Wallet funding is credited only after TrustlineCover confirms receipt. Confirmed wallet funding earns 1% of the funded amount in points. Points can be converted at 1 point for ₦1.</p>
          <h4>Recent wallet activity</h4>{(wallet.transactions || []).length === 0 ? <div className="preview-empty">No wallet activity yet.</div> : wallet.transactions.slice(0, 8).map((item: any, index: number) => <div className="client-case-row" key={item.id || item.reference || index}><div><strong>{item.description || item.type}</strong><small>{new Date(item.createdAt).toLocaleDateString('en-NG')}</small></div><span>{item.amount ? money(item.amount) : item.points ? item.points + ' points' : 'Recorded'}</span></div>)}
        </section>
        <div className="client-grid">
          <section className="panel client-panel"><div className="ai-panel-icon"><Sparkles size={20} /></div><h3>Check a plan benefit</h3><p>Describe the healthcare service you want to ask about. The assistant will compare it with your recorded benefits.</p><textarea rows={4} value={eligibilityRequest} onChange={e => setEligibilityRequest(e.target.value)} placeholder="What service would you like to check?" /><button className="primary" disabled={busy} onClick={checkEligibility}>Check benefit eligibility</button>{eligibilityResult && <div className="ai-result"><strong>Initial guidance</strong><p>{eligibilityResult}</p></div>}</section>
          <section className="panel client-panel"><div className="ai-panel-icon"><HeartPulse size={20} /></div><h3>Request care support</h3><p>Send a request to the TrustlineCover team. We will contact you about the next step.</p><Field label="Request subject" value={requestSubject} onChange={setRequestSubject} /><SelectField label="Request type" value={requestCategory} options={['Appointment support', 'Treatment authorisation', 'Claims follow up', 'General enquiry', 'Complaint', 'Other']} onChange={setRequestCategory} /><div className="field"><label>Additional information</label><textarea rows={3} value={requestDetails} onChange={e => setRequestDetails(e.target.value)} placeholder="Add details needed to understand your request." /></div><button className="primary" disabled={busy} onClick={submitRequest}>Submit request</button></section>
        </div>
        <section className="panel client-panel client-cases"><div className="panel-head"><div><h3>Your care requests</h3><p>Updates from the TrustlineCover coordination team.</p></div><button className="secondary" onClick={loadCases}><RefreshCw size={15} /> Refresh</button></div>{cases.length === 0 ? <div className="preview-empty">You have not submitted a care request yet.</div> : cases.map(item => <div className="client-case-row" key={item.id}><div><strong>{item.subject}</strong><small>{item.category} · {new Date(item.createdAt).toLocaleDateString('en-NG')}</small></div><Status value={item.status || 'Open'} /></div>)}</section>
        <p className="client-disclaimer">Your digital card shows your recorded membership status. It does not guarantee treatment or payment for services outside your approved benefits. TrustlineCover remains your point of contact for care approval and coordination.</p>
      </main>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  note: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <div className="stat-icon">{icon}</div>
      </div>
      <strong>{value.toLocaleString('en-NG')}</strong>
      <small>{note}</small>
    </div>
  );
}
function Status({ value }: { value: string }) {
  const cls =
    value === 'Active' || value === 'Paid' || value === 'Resolved'
      ? 'good'
      : value === 'Overdue' || value === 'Urgent'
        ? 'bad'
        : 'pending';
  return <span className={'status ' + cls}>{value || 'Pending'}</span>;
}
function RecordsPreview({
  items,
  empty,
}: {
  items: RecordItem[];
  empty: string;
}) {
  if (!items.length) return <div className="preview-empty">{empty}</div>;
  return (
    <div className="preview-list">
      {items.map(item => (
        <div className="preview-row" key={item.id}>
          <div className="preview-avatar">
            {(item.fullName || 'C').slice(0, 1).toUpperCase()}
          </div>
          <div>
            <strong>{item.fullName}</strong>
            <small>{item.membership} membership</small>
          </div>
          <Status value={item.status} />
        </div>
      ))}
    </div>
  );
}
function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type={type}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}
function SelectField({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  labels?: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value || ''} onChange={e => onChange(e.target.value)}>
        {options.map((v, i) => (
          <option value={v} key={v || 'empty'}>
            {labels?.[i] ?? v}
          </option>
        ))}
      </select>
    </div>
  );
}


function PublicCustomerHelp({ memberMode = false }: { memberMode?: boolean }) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [hasActivePlan, setHasActivePlan] = useState(memberMode);
  const [location, setLocation] = useState('');
  const [emergency, setEmergency] = useState(false);
  async function ask() {
    const prompt = question.trim();
    if (!prompt || busy) return;
    const history = [...messages, { role: 'user' as const, content: prompt }];
    setMessages(history);
    setQuestion('');
    setBusy(true);
    setEmergency(false);
    try {
      const response = await api.post('/api/ai/customer-help', {
        question: prompt,
        history: messages,
        hasActivePlan,
        location: hasActivePlan ? location : '',
      });
      const answer = response.data.answer || 'I could not find an answer. Please contact TrustlineCover.';
      setMessages(old => [...old, { role: 'assistant', content: answer }]);
      setEmergency(!!response.data.emergency);
    } catch {
      setMessages(old => [...old, { role: 'assistant', content: 'I could not answer that just now. If you are seriously unwell, please do not wait for this chat. Go to the nearest hospital emergency department or call 112 in Nigeria.' }]);
    } finally { setBusy(false); }
  }
  const mapsUrl = location.trim() ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('clinics near ' + location.trim()) : '';
  return <section className="public-customer-help">
    <div className="public-eyebrow">HEALTH GUIDANCE AND CARE SUPPORT</div>
    <h2>Emergency? Speak to a Doctor</h2>
    <p>Ask health questions in simple language, understand common symptoms and know when to seek medical attention. This assistant gives general guidance, not a diagnosis.</p>
    <div style={{ background: '#fff1f0', border: '1px solid #f2b8b5', borderRadius: 12, padding: 14, margin: '14px 0' }}>
      <strong style={{ color: '#9b1c1c' }}>If it may be an emergency</strong>
      <p style={{ margin: '6px 0' }}>Do not wait for this chat or buy a plan first. Call 112 in Nigeria or go to the nearest hospital emergency department now.</p>
    </div>
    <div style={{ display: 'grid', gap: 10, margin: '14px 0' }}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={hasActivePlan} onChange={e => setHasActivePlan(e.target.checked)} /> I have an active TrustlineCover plan</label>
      {hasActivePlan ? <div className="field"><label>Your town, area or neighbourhood</label><input value={location} onChange={e => setLocation(e.target.value)} placeholder="For example, Ikeja, Lagos" /></div> : <p style={{ margin: 0 }}>No active plan? You can view available plans below. Please remember that buying a plan does not replace urgent treatment or guarantee cover for an existing condition.</p>}
    </div>
    <div style={{ display: 'grid', gap: 10, maxHeight: 260, overflowY: 'auto', margin: '14px 0' }}>
      {messages.map((message, index) => <div key={index} className="public-help-answer"><strong>{message.role === 'assistant' ? 'TrustlineCover assistant' : 'You'}</strong><p style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{message.content}</p></div>)}
    </div>
    {hasActivePlan && location.trim() && <p><a href={mapsUrl} target="_blank" rel="noreferrer">Find clinics near {location.trim()} on Google Maps</a></p>}
    {!hasActivePlan && <p><a href="#plans">View and purchase a TrustlineCover plan</a></p>}
    <div className="public-help-row">
      <input value={question} onChange={e => setQuestion(e.target.value)} placeholder="Tell us what is happening or ask a health question" maxLength={1200} onKeyDown={e => { if (e.key === 'Enter') ask(); }} />
      <button className="public-login" disabled={busy || !question.trim()} onClick={ask}>{busy ? 'Please wait…' : 'Send'}</button>
    </div>
    <small>Do not share your NIN, passwords, OTPs, bank details or identifying medical records. For active members, nearby clinic search is a location search only. Please confirm network status and benefits with TrustlineCover before non emergency treatment. AI guidance is not a diagnosis or prescription.</small>
  </section>;
}

function LandingPage({ onLogin, config }: { onLogin: () => void; config: any }) {
  const highlights = [
    { icon: ShieldCheck, title: 'Guidance you can count on', text: 'We help you understand your healthcare options and navigate the process with clarity.' },
    { icon: Stethoscope, title: 'Care arranged by us', text: 'Your selected plan guides the care arrangement TrustlineCover reviews and approves on your behalf.' },
    { icon: HeartPulse, title: 'Support beyond enrolment', text: 'Our team helps follow up on requests, service concerns and communication with providers.' },
  ];
  return (
    <div className="public-site">
      <header className="public-nav">
        <a className="public-brand" href="#home" aria-label="TrustlineCover home">
          <span className="public-logo">{config.logoImage ? <img src={config.logoImage} alt="" /> : <ShieldCheck size={25}/>}</span>
          <span><strong>{config.brandName || 'TrustlineCover'}</strong><small>{config.tagline || 'HEALTHCARE, MADE CLEAR'}</small></span>
        </a>
        <nav className="public-nav-links"><a href="#how-it-works">How it works</a><a href="#our-approach">Our approach</a><a href="#support">Support</a></nav>
        <div className="public-auth-actions"><button className="public-outline" onClick={onLogin}>Login</button><button className="public-login" onClick={onLogin}>Sign up <ArrowUpRight size={16}/></button></div>
      </header>
      <main id="home">
        <section className="public-hero">
          <div className="public-hero-copy">
            <div className="public-eyebrow"><span/> HEALTHCARE COVER, WITH A HUMAN TOUCH</div>
            <h1>{config.heroHeadline || 'Healthcare should feel easier.'}</h1>
            <p className="public-lead">{config.heroDescription}</p>
            <p className="public-lead second">{config.heroSubtext}</p>
            <div className="public-hero-actions"><a className="public-primary" href="#how-it-works">Discover how we help <ArrowUpRight size={17}/></a><span><ShieldCheck size={16}/> Clear guidance. Ongoing coordination.</span></div>
            <div className="public-note">We coordinate your healthcare journey with partner providers. Medical cover and treatment services are provided by the relevant licensed partners.</div>
          </div>
          <div className="public-hero-art">
            {config.heroImage ? <img className="public-family-image" src={config.heroImage} alt="A Nigerian family together at home" /> : <>
            <div className="art-glow"/>
            <div className="art-circle circle-one"/>
            <div className="art-circle circle-two"/>
            <div className="care-card">
              <div className="care-card-top"><span className="care-icon"><HeartPulse size={20}/></span><span className="care-tag">HERE TO HELP</span></div>
              <div className="care-card-title">Your care journey, connected.</div>
              <div className="care-step"><span className="step-check"><CheckCircle2 size={15}/></span><span><b>Understand your options</b><small>Clear information to help you decide</small></span></div>
              <div className="care-line"/>
              <div className="care-step"><span className="step-check"><CheckCircle2 size={15}/></span><span><b>We approve your care access</b><small>Arranged internally to match your plan</small></span></div>
              <div className="care-line"/>
              <div className="care-step"><span className="step-current"><Activity size={15}/></span><span><b>Stay supported</b><small>Follow up and coordination when needed</small></span></div>
              <div className="care-card-footer"><span className="mini-avatars"><i>T</i><i>C</i><i>+</i></span><span>People first. Every step.</span></div>
            </div>
            <div className="floating-note"><span><CheckCircle2 size={16}/></span><div><b>One point of contact</b><small>We help keep things moving.</small></div></div>
            <div className="art-caption">CARE, CONNECTED WITH CLARITY</div>
            </>}
          </div>
        </section>
        <section className="public-trust-strip"><div><strong>Clear plan options</strong><span>Know what your selected plan includes</span></div><div><strong>Managed care access</strong><span>TrustlineCover approves the care arrangement</span></div><div><strong>Ongoing support</strong><span>A team to help coordinate and follow up</span></div></section>
        <section className="public-plans" id="plans">
          <div className="plans-heading"><div className="public-eyebrow">SIMPLE OPTIONS FOR DIFFERENT NEEDS</div><h2>Choose a plan that feels right.</h2><p>Start with the level of cover that suits you. TrustlineCover will review your enrolment and manage the care arrangements.</p></div>
          <div className="plan-card-grid">
            {(config.plans || []).map((plan: any, index: number) => <article className={'public-plan-card ' + (index === 1 ? 'featured-plan' : '')} key={plan.name}><span className="plan-label">{index === 1 ? 'POPULAR OPTION' : index === 2 ? 'EXTENDED SUPPORT' : 'ESSENTIAL'}</span><h3>{plan.name}</h3><div className="plan-price">₦{Number(plan.monthlyRate || 0).toLocaleString('en-NG')} <small>/ month</small></div><p>{plan.description}</p><ul>{String(plan.benefits || '').split(';').map((benefit: string) => <li key={benefit}>{benefit.trim()}</li>)}</ul><button className="plan-select" onClick={onLogin}>Get started <ArrowUpRight size={15}/></button></article>)}
          </div>
          <p className="plans-footnote">Prices shown are introductory examples and may be updated. Final benefits and care access are subject to TrustlineCover review and approval.</p>
        </section>
        <section className="public-section" id="our-approach">
          <div className="section-intro"><div className="public-eyebrow">A MORE HUMAN WAY TO NAVIGATE COVER</div><h2>More than choosing a plan.<br/><em>Knowing you have support.</em></h2><p>Healthcare arrangements can feel complicated. We bring the conversations, information and follow up together, so you are not left wondering what to do next.</p></div>
          <div className="public-feature-grid">{highlights.map((item, index) => { const Icon = item.icon; return <article className="public-feature" key={item.title}><div className="feature-number">0{index + 1}</div><div className="feature-icon"><Icon size={23}/></div><h3>{item.title}</h3><p>{item.text}</p></article>; })}</div>
        </section>
        <section className="public-how" id="how-it-works">
          <div className="how-copy"><div className="public-eyebrow light">SIMPLE STEPS, STEADY SUPPORT</div><h2>A clearer path to healthcare cover.</h2><p>From understanding your options to getting help with provider follow up, we make the process easier to navigate.</p></div>
          <div className="how-steps"><div><span>01</span><section><b>Choose your plan</b><p>Select the price and payment option that suits your needs.</p></section></div><div><span>02</span><section><b>TrustlineCover reviews your enrolment</b><p>We check the selected plan and approve the appropriate level of care access.</p></section></div><div><span>03</span><section><b>Use your digital access card</b><p>Your dashboard card helps you request care under the approved benefits. We manage the provider arrangements.</p></section></div></div>
        </section>
        <section className="public-support" id="support"><div className="support-icon"><HeartPulse size={27}/></div><div><div className="public-eyebrow">HERE WHEN YOU NEED A HAND</div><h2>Questions along the way?</h2><p>TrustlineCover remains your point of contact for care approval, coordination and follow up.</p><div className="public-contact-links">{config.supportEmail && <a href={'mailto:' + config.supportEmail}>{config.supportEmail}</a>}{config.supportPhone && <a href={'tel:' + config.supportPhone}>{config.supportPhone}</a>}{config.whatsapp && <a href={config.whatsapp.startsWith('http') ? config.whatsapp : 'https://wa.me/' + config.whatsapp.replace(/[^0-9]/g, '')}>WhatsApp</a>}</div></div><button className="public-outline" onClick={onLogin}>Sign up <ArrowUpRight size={16}/></button></section>
      </main>
      <PublicCustomerHelp />
      <footer className="public-footer"><a className="public-brand" href="#home"><span className="public-logo">{config.logoImage ? <img src={config.logoImage} alt="" /> : <ShieldCheck size={22}/>}</span><span><strong>{config.brandName || 'TrustlineCover'}</strong><small>{config.tagline || 'HEALTHCARE, MADE CLEAR'}</small></span></a><p>Helping you navigate healthcare cover with clarity and care.</p><div className="public-social-links">{config.instagram && <a href={config.instagram} target="_blank" rel="noreferrer">Instagram</a>}{config.facebook && <a href={config.facebook} target="_blank" rel="noreferrer">Facebook</a>}{config.linkedin && <a href={config.linkedin} target="_blank" rel="noreferrer">LinkedIn</a>}</div><span>© {new Date().getFullYear()} {config.brandName || 'TrustlineCover'}. All rights reserved.</span></footer>
    </div>
  );
}

export default App;
