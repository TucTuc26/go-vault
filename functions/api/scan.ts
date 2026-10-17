import { handleScan, type Env } from '../lib/scan-core';

// Cloudflare Pages Function: POST /api/scan  (opcional; apagada si faltan ANTHROPIC_API_KEY o APP_PASSCODE)
export const onRequest = async (context: { request: Request; env: Env }): Promise<Response> =>
  handleScan(context.request, context.env);
