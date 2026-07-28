import { Permission } from './types';

// Checagem central pras telas do nível gerencial (roadmap "Time x
// Gerencial") — sem lógica de role aqui de propósito: o bypass do
// Administrador já acontece antes de chegar nestas funções (no front,
// getUserPermissions/hasPermission em lib/nav-items.ts expandem tudo pro
// role ADMIN; no back, a migration dashboard_management_permissions.sql já
// grava as permissões no array do perfil Administrador). Reusar aqui
// duplicaria essa regra e arriscaria os dois lados divergirem.

export function canViewManagementDashboard(permissions: Permission[]): boolean {
  return permissions.includes(Permission.DASHBOARD_MANAGEMENT);
}

export function canViewIndividualData(permissions: Permission[]): boolean {
  return permissions.includes(Permission.REPORTS_INDIVIDUAL);
}
