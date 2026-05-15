import { AUTH_COOKIE_NAME, verifySessionValue } from "@/lib/authSession";
import { isAuthSessionActive } from "@/lib/server/authSessionStore";

export async function getRequestUser(request) {
  const session = request.cookies.get(AUTH_COOKIE_NAME)?.value || "";
  const user = await verifySessionValue(session);
  if (!user?.email) return null;
  const active = await isAuthSessionActive(user.email, user.sid);
  return active.active ? user : null;
}
