import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Gallery } from './components/features/Gallery';
import { BottomPanel } from './components/features/BottomPanel';
import { ThoughtNotification } from './components/features/ThoughtNotification';
import { MainNav } from './components/layout/MainNav';
import { TopNav } from './components/layout/TopNav';
import { OpsLayout } from './pages/ops/OpsLayout';
import { JobsPage } from './pages/ops/JobsPage';
import { AccountsPage } from './pages/ops/AccountsPage';
import { AnalyticsPage } from './pages/ops/AnalyticsPage';
import { useStore } from './store';

function GalleryPage() {
  return (
    <>
      <TopNav />
      <Gallery />
      <BottomPanel />
      <ThoughtNotification />
    </>
  );
}

function AppRoutes() {
  const loadGalleryFromServer = useStore((state) => state.loadGalleryFromServer);
  const loadBackendCapabilities = useStore((state) => state.loadBackendCapabilities);

  useEffect(() => {
    loadBackendCapabilities();
    loadGalleryFromServer();
  }, [loadBackendCapabilities, loadGalleryFromServer]);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-primary)]">
      <MainNav />
      <div className="min-h-screen md:pl-20">
        <Routes>
          <Route path="/" element={<Navigate to="/gallery" replace />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/ops" element={<OpsLayout />}>
            <Route index element={<Navigate to="/ops/jobs" replace />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="accounts" element={<AccountsPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/gallery" replace />} />
        </Routes>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
