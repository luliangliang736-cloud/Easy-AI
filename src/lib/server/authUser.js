import { AUTH_COOKIE_NAME, verifySessionValue } from "@/lib/authSession";

export async function getRequestUser(request) {
  const session = request.cookies.get(AUTH_COOKIE_NAME)?.value || "";
  return verifySessionValue(session);
}
