import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from './stores/authStore';
import { Loading } from './components/ui';

import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Merchants } from './pages/Merchants';
import { MerchantDetail } from './pages/MerchantDetail';
import { Orders } from './pages/Orders';
import { OrderDetail } from './pages/OrderDetail';
import { NewOrder } from './pages/NewOrder';
import { Shipping } from './pages/Shipping';
import { Returns } from './pages/Returns';
import { ReturnDetail } from './pages/ReturnDetail';
import { DeployedEquipment } from './pages/DeployedEquipment';
import { Inventory } from './pages/Inventory';
import { Forecasting } from './pages/Forecasting';
import { Bundles } from './pages/Bundles';
import { Pricing } from './pages/Pricing';
import { Policies } from './pages/Policies';
import { Approvals } from './pages/Approvals';
import { Users } from './pages/Users';
import { ApiKeys } from './pages/ApiKeys';
import { FortisGateway } from './pages/FortisGateway';
import { Audit } from './pages/Audit';
import { Apply } from './pages/public/Apply';
import { OrderForm } from './pages/public/OrderForm';
import { TrackPublic } from './pages/public/TrackPublic';
import { TrackToken } from './pages/public/TrackToken';
import { LinkPage } from './pages/public/LinkPage';
import { Links } from './pages/Links';
import { PortalHome, PortalOrders, PortalCases, PortalAnalytics } from './portal/PortalPages';
import { ReportIssue } from './portal/ReportIssue';

function LinkRoute() {
  const { token } = useParams();
  return <LinkPage token={token!} />;
}
function ApplyRoute() {
  const [sp] = useSearchParams();
  const v = sp.get('v');
  return v ? <LinkPage token={v} /> : <Apply />;
}

/** Internal-tool routes. Merchant logins are bounced to their portal. */
function Protected({ children }: { children: JSX.Element }) {
  const status = useAuth((s) => s.status);
  const isMerchant = useAuth((s) => s.isMerchant());
  if (status === 'idle' || status === 'loading') return <Loading label="Authenticating…" />;
  if (status === 'anon') return <Navigate to="/login" replace />;
  if (isMerchant) return <Navigate to="/portal" replace />;
  return children;
}

/** Merchant portal routes. Internal users only reach these via impersonation (role becomes merchant). */
function PortalProtected({ children }: { children: JSX.Element }) {
  const status = useAuth((s) => s.status);
  const isMerchant = useAuth((s) => s.isMerchant());
  if (status === 'idle' || status === 'loading') return <Loading label="Loading…" />;
  if (status === 'anon') return <Navigate to="/login" replace />;
  if (!isMerchant) return <Navigate to="/" replace />;
  return children;
}

export function App() {
  const hydrate = useAuth((s) => s.hydrate);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();

  useEffect(() => {
    void hydrate();
    const onUnauth = () => {
      logout();
      navigate('/login');
    };
    window.addEventListener('de:unauthorized', onUnauth);
    return () => window.removeEventListener('de:unauthorized', onUnauth);
  }, [hydrate, logout, navigate]);

  return (
    <Routes>
      {/* Public / embeddable partner flow */}
      <Route path="/login" element={<Login />} />
      <Route path="/apply" element={<ApplyRoute />} />
      <Route path="/l/:token" element={<LinkRoute />} />
      <Route path="/order" element={<OrderForm />} />
      <Route path="/track/:id" element={<TrackPublic />} />
      <Route path="/t/:token" element={<TrackToken />} />

      {/* Internal tool */}
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/merchants" element={<Protected><Merchants /></Protected>} />
      <Route path="/merchants/:id" element={<Protected><MerchantDetail /></Protected>} />
      <Route path="/orders" element={<Protected><Orders /></Protected>} />
      <Route path="/orders/new" element={<Protected><NewOrder /></Protected>} />
      <Route path="/orders/:id" element={<Protected><OrderDetail /></Protected>} />
      <Route path="/tools" element={<Protected><Shipping /></Protected>} />
      <Route path="/shipping" element={<Navigate to="/tools" replace />} />
      <Route path="/returns" element={<Protected><Returns kind="return" /></Protected>} />
      <Route path="/swaps" element={<Protected><Returns kind="swap" /></Protected>} />
      <Route path="/returns/:id" element={<Protected><ReturnDetail /></Protected>} />
      <Route path="/deployed" element={<Protected><DeployedEquipment /></Protected>} />
      <Route path="/inventory" element={<Protected><Inventory /></Protected>} />
      <Route path="/forecasting" element={<Protected><Forecasting /></Protected>} />
      <Route path="/bundles" element={<Protected><Bundles /></Protected>} />
      <Route path="/links" element={<Protected><Links /></Protected>} />
      <Route path="/pricing" element={<Protected><Pricing /></Protected>} />
      <Route path="/policies" element={<Protected><Policies /></Protected>} />
      <Route path="/approvals" element={<Protected><Approvals /></Protected>} />
      <Route path="/users" element={<Protected><Users /></Protected>} />
      <Route path="/api-keys" element={<Protected><ApiKeys /></Protected>} />
      <Route path="/fortis" element={<Protected><FortisGateway /></Protected>} />
      <Route path="/audit" element={<Protected><Audit /></Protected>} />

      {/* Merchant self-service portal */}
      <Route path="/portal" element={<PortalProtected><PortalHome /></PortalProtected>} />
      <Route path="/portal/orders" element={<PortalProtected><PortalOrders /></PortalProtected>} />
      <Route path="/portal/swaps" element={<PortalProtected><PortalCases kind="swap" /></PortalProtected>} />
      <Route path="/portal/returns" element={<PortalProtected><PortalCases kind="return" /></PortalProtected>} />
      <Route path="/portal/analytics" element={<PortalProtected><PortalAnalytics /></PortalProtected>} />
      <Route path="/portal/report" element={<PortalProtected><ReportIssue /></PortalProtected>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
