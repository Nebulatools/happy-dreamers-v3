export const USER_ROLES = ['user', 'pro', 'admin'] as const;

export type UserRole = (typeof USER_ROLES)[number];

const ROLE_PRIORITY: Record<UserRole, number> = {
  user: 0,
  pro: 1,
  admin: 2,
};

export const compareRoles = (granted: UserRole, required: UserRole) =>
  ROLE_PRIORITY[granted] - ROLE_PRIORITY[required];

export const hasSufficientRole = (granted: UserRole, required: UserRole) =>
  compareRoles(granted, required) >= 0;
