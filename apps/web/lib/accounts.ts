/** The login fields an account can carry, in the order a person reads them. */
export const LOGIN_FIELDS = [
  "host",
  "username",
  "email",
  "password",
  "phone",
  "twoFactor",
  "recoveryEmail",
  "extra",
] as const;

export type LoginField = (typeof LOGIN_FIELDS)[number];
export type LoginDetails = Partial<Record<LoginField, string>>;

/** For use inside a sentence, where "Email" becomes "email" but "2FA" stays "2FA". */
const FIELD_IN_SENTENCE: Record<LoginField, string> = {
  host: "IP address",
  username: "username",
  email: "email",
  password: "password",
  phone: "phone number",
  twoFactor: "2FA or backup codes",
  recoveryEmail: "recovery email",
  extra: "other details",
};

export const FIELD_LABEL: Record<LoginField, string> = {
  host: "IP address",
  username: "Username",
  email: "Email",
  password: "Password",
  phone: "Phone",
  twoFactor: "2FA or backup codes",
  recoveryEmail: "Recovery email",
  extra: "Other details",
};

/** Values that are often several lines long, like a sheet of backup codes. */
export const MULTILINE_FIELDS: LoginField[] = ["twoFactor", "extra"];

/** How a tasker gets into the account, in the manager's words. */
export type AccessType = "MORELOGIN" | "RDP" | "OTHER";

export const ACCESS_LABEL: Record<AccessType, string> = {
  MORELOGIN: "Morelogin profile",
  RDP: "Remote desktop (RDP)",
  OTHER: "Other",
};

export interface Assignee {
  assignmentId: string;
  taskerId: string;
  name: string;
  role: string;
  since: string;
}

export interface AccountDetails {
  id: string;
  ref: string;
  label: string | null;
  platform: string | null;
  loginUrl: string | null;
  notes: string | null;
  owner?: string | null;
  accessType?: AccessType;
  assignedTo?: Assignee[];
  state: string;
  cooldownUntil?: string | null;
  fields: LoginField[];
  addedBy: { id: string; name: string } | null;
  addedVia: "WEB" | "TELEGRAM" | "SYSTEM";
  createdAt?: string;
  updatedAt?: string;
  detailsUpdatedAt?: string | null;
}

export function addedViaLabel(via: AccountDetails["addedVia"]): string {
  return via === "TELEGRAM" ? "from Telegram" : via === "SYSTEM" ? "automatically" : "from the console";
}

/** "username, password and 2FA codes" - what is on file, said the way a person would. */
export function describeFields(fields: LoginField[]): string {
  const names = fields.map((f) => FIELD_IN_SENTENCE[f]);
  if (names.length === 0) return "no login details";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
