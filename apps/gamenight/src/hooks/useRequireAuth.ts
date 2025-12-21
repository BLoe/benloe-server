import { useAuthStore } from '../store/authStore';

export const useRequireAuth = () => {
  const { user, redirectToLogin } = useAuthStore();

  const withAuth = (
    action: () => void,
    options?: {
      message?: string;
      returnUrl?: string;
    }
  ) => {
    if (user) {
      action();
    } else {
      const message =
        options?.message || 'This action requires you to sign in. Would you like to sign in now?';
      if (confirm(message)) {
        redirectToLogin(options?.returnUrl || window.location.href);
      }
    }
  };

  const isAuthenticated = !!user;

  return {
    withAuth,
    isAuthenticated,
    user,
  };
};
