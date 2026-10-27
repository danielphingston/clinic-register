// Imported first by main.tsx. Coming back from Google's redirect sign-in the
// token sits in the URL fragment; this strips it before the router is created
// (the result is remembered for AuthProvider).
import { finishRedirectSignIn } from './google'

finishRedirectSignIn()
