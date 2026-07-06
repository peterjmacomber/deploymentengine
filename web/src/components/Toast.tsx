import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type ToastKind = 'info' | 'success' | 'error';
interface Toast { id: number; kind: ToastKind; message: string; }

interface ToastCtx { push: (message: string, kind?: ToastKind) => void; }
const Ctx = createContext<ToastCtx>({ push: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
