import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import Login from "@/pages/Login";
import DashboardLayout from "@/components/DashboardLayout";
import Inbox from "@/pages/Inbox";
import Conversation from "@/pages/Conversation";
import EnquiryEditor from "@/pages/EnquiryEditor";
import QuotationPreview from "@/pages/QuotationPreview";
import CRM from "@/pages/CRM";
import CustomerProfile from "@/pages/CustomerProfile";
import Inventory from "@/pages/Inventory";
import Automation from "@/pages/Automation";
import Settings from "@/pages/Settings";

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="flex h-screen items-center justify-center text-ink-muted">Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;
  return children;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <DashboardLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/inbox" replace />} />
            <Route path="inbox" element={<Inbox />} />
            <Route path="inbox/:conversationId" element={<Conversation />} />
            <Route path="enquiries/:enquiryId" element={<EnquiryEditor />} />
            <Route path="quotations/:quotationId" element={<QuotationPreview />} />
            <Route path="crm" element={<CRM />} />
            <Route path="crm/:customerId" element={<CustomerProfile />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="automation" element={<Automation />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/inbox" replace />} />
        </Routes>
        <Toaster position="top-right" richColors />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
