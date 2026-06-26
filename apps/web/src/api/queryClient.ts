import { QueryClient } from '@tanstack/react-query';

/** QueryClient único do app (cache/estados das chamadas REST). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});
