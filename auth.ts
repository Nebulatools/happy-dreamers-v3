import NextAuth from 'next-auth/next';
import { authConfig } from './lib/auth/config';

export const { auth, handlers, signIn, signOut } = NextAuth(authConfig);
export const { GET, POST } = handlers;
