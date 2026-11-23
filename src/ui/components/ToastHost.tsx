import { useAppStore } from '../../state/appStore';

export function ToastHost() {
  const toast = useAppStore((state) => state.toast);
  const dismiss = useAppStore((state) => state.dismissToast);
  if (!toast) return null;
  return (
    <div className="toast-host" role="status" aria-live="polite">
      <button
        type="button"
        className={`toast toast--${toast.tone}`}
        onClick={dismiss}
        title="dismiss"
      >
        <span className="toast__dot" />
        <span className="toast__text">{toast.message}</span>
      </button>
    </div>
  );
}
