export function isLocalDevAuthBypassEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.DISABLE_LOCAL_AUTH !== "0";
}

export function getLocalDevUser() {
  return {
    email: "local-dev@easyai.local",
    username: "本地开发",
    sid: "local-dev-session",
  };
}
