import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { LanguageProvider } from './context/LanguageContext';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { installButtonErrorInterceptor } from './utils/buttonErrorInterceptor';
import { installApiBaseFetchRewrite } from './lib/apiClient';
import './index.css';

installApiBaseFetchRewrite();
installButtonErrorInterceptor();

createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <ThemeProvider>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </ThemeProvider>
  </AuthProvider>
);
