import { useState } from 'react';
import { getToken, clearToken } from './lib/api';
import Auth from './components/Auth';
import Layout from './components/Layout';
import MockApp from './components/MockApp';
import Toaster from './components/Toaster';

// `?mock=1` short-circuits Auth and renders MockApp with a pre-baked set of
// sessions in grid mode. Used by the marketing site to capture device-frame
// screenshots without exposing a real panel session — no JWT, no API calls.
const IS_MOCK = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('mock') === '1';

export default function App() {
  const [token, setToken] = useState<string | null>(getToken());

  const handleAuthed = (newToken: string) => setToken(newToken);
  const handleLogout = () => {
    clearToken();
    setToken(null);
  };

  if (IS_MOCK) {
    return (
      <>
        <MockApp />
        <Toaster />
      </>
    );
  }

  return (
    <>
      {token ? <Layout onLogout={handleLogout} /> : <Auth onAuthed={handleAuthed} />}
      <Toaster />
    </>
  );
}
