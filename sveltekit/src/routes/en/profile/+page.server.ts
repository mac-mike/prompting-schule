import type { PageServerLoad } from './$types';
import { requireLogin } from '$lib/server/jwt';
import { hasOIDCConfig } from '$lib/sso/oidc';

export const load: PageServerLoad = async ({ cookies }) => {
  const user = requireLogin(cookies);

  return {
    user,
    hasKeycloakIssuer: hasOIDCConfig()
  };
}
