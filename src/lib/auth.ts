import { Auth, type AuthConfig } from '@auth/core';
import Google from '@auth/core/providers/google';
import type { Session } from '@auth/core/types';

// Only this Google account may sign in. Set ALLOWED_EMAIL in Vercel.
const allowedEmail = () => (process.env.ALLOWED_EMAIL ?? '').trim().toLowerCase();

const isAllowed = (email: string | null | undefined) =>
  !!email && !!allowedEmail() && email.toLowerCase() === allowedEmail();

export const authConfig: AuthConfig = {
  basePath: '/api/auth',
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  callbacks: {
    signIn({ profile }) {
      return profile?.email_verified === true && isAllowed(profile.email);
    },
  },
};

export function handleAuth(request: Request) {
  return Auth(request, authConfig);
}

// Returns the session only when it belongs to the allowed account.
export async function getSession(request: Request): Promise<Session | null> {
  const url = new URL(`${authConfig.basePath}/session`, request.url);
  const res = await Auth(
    new Request(url, { headers: { cookie: request.headers.get('cookie') ?? '' } }),
    authConfig,
  );
  const session = (await res.json()) as Session | null;
  return session && isAllowed(session.user?.email) ? session : null;
}
