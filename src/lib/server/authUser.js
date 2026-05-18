import { AUTH_COOKIE_NAME, verifySessionValue } from "@/lib/authSession";
import { getLocalDevUser, isLocalDevAuthBypassEnabled } from "@/lib/authBypass";
import { isAuthSessionActive } from "@/lib/server/authSessionStore";

export async function getRequestUser(request) {
  if (isLocalDevAuthBypassEnabled()) {
    return getLocalDevUser();
  }

  const session = request.cookies.get(AUTH_COOKIE_NAME)?.value || "";
  const user = await verifySessionValue(session);
  if (!user?.email) return null;
  try {
    const active = await isAuthSessionActive(user.email, user.sid);
    return active.active ? user : null;
  } catch (error) {
    console.error("[Auth] Active session check failed; accepting signed session:", error);
    return user;
  }
}
