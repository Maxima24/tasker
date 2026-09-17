/**
 * Shared ticket vocabulary. Lives outside the page files because a Next page
 * may only export its component, and both the list and the detail view need to
 * name a category the same way.
 */
export const TICKET_CATEGORIES: { value: string; label: string; hint: string }[] = [
  {
    value: "ACCOUNT_BLOCKED",
    label: "The account is blocked",
    hint: "Locked out, suspended, or asking for a verification you cannot pass.",
  },
  {
    value: "CREDENTIALS_WRONG",
    label: "The credentials do not work",
    hint: "Password rejected, or the login goes somewhere unexpected.",
  },
  {
    value: "TASK_UNCLEAR",
    label: "I do not understand the task",
    hint: "A step does not match what you are seeing on the platform.",
  },
  {
    value: "PLATFORM_ISSUE",
    label: "The platform is broken",
    hint: "Pages not loading, changes not saving, errors on their side.",
  },
  {
    value: "OTHER",
    label: "Something else",
    hint: "Anything the list above does not cover.",
  },
];

export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  TICKET_CATEGORIES.map((c) => [c.value, c.label]),
);

export const TICKET_STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-tint-red text-danger",
  CLAIMED: "bg-tint-amber text-warn",
  RESOLVED: "bg-tint-green text-ok",
};

export const TICKET_STATUS_LABEL: Record<string, string> = {
  OPEN: "Waiting",
  CLAIMED: "Being handled",
  RESOLVED: "Resolved",
};
