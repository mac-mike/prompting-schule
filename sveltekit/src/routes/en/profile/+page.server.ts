import type { PageServerLoad } from './$types';
import { requireLogin } from '$lib/server/jwt';
import { KEYCLOAK_ISSUER } from '$env/static/private';

export const load: PageServerLoad = async ({ cookies }) => {
  const user = requireLogin(cookies);

  return {
    user,
    hasKeycloakIssuer: Boolean(KEYCLOAK_ISSUER)
  };
}
