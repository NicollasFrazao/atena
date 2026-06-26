/** Origem da API e do WebSocket (build-time via Vite; default = host local). */
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
export const WS_URL = import.meta.env.VITE_WS_URL ?? 'http://localhost:3000';
