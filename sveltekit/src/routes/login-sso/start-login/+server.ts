import type { RequestHandler } from './$types';
import { getOIDC, makePKCE, randomState } from '$lib/sso/oidc';
import { KEYCLOAK_CLIENT_ID } from '$env/static/private';
import { PUBLIC_REDIRECT_URI, PUBLIC_BASE_PATH } from '$env/static/public';
import { resolve } from '$app/paths';

export const GET: RequestHandler = async ({ cookies, url }) => {
    // Generate PKCE values (verifier + challenge)
    const { verifier, challenge } = await makePKCE();
    const state = randomState();

    // Store temporary cookies for PKCE + state
    cookies.set('pkce_verifier', verifier, {
        httpOnly: true, sameSite: 'lax', secure: true,
        path: resolve('/'), maxAge: 600
    });
    cookies.set('oauth_state', state, {
        httpOnly: true, sameSite: 'lax', secure: true,
        path: resolve('/'), maxAge: 600
    });

    // Build authorization request URL
    const OIDC = await getOIDC();
    const u = new URL(OIDC.authorization_endpoint);
    u.searchParams.set('client_id', KEYCLOAK_CLIENT_ID);
    u.searchParams.set('redirect_uri', PUBLIC_REDIRECT_URI);
    // u.searchParams.set('redirect_uri', `${url.origin}${resolve('/callback')}`);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'openid profile email');
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('state', state);

    console.log('AUTH URL →', u.toString());

    // Redirect user to Keycloak login page
    return new Response(null, { status: 302, headers: { Location: u.toString() } });
};
