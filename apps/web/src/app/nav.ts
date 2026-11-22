import type { Role } from '@hr/shared';
import {
  Building2,
  Coins,
  CalendarDays,
  CalendarOff,
  ClipboardCheck,
  Clock,
  FileDown,
  FileText,
  House,
  type LucideIcon,
  MapPin,
  Receipt,
  Settings,
  ShieldAlert,
  Users,
} from 'lucide-react';

export interface NavItem {
  to: string;
  key: 'home' | 'clock' | 'schedule' | 'absences' | 'expenses' | 'documents' | 'reports' | 'team' | 'timesheets' | 'alerts' | 'sites' | 'locations' | 'company' | 'settings';
  icon: LucideIcon;
  /** Roles que lo ven dentro de una empresa; sin definir = todos y también en modo personal. */
  roles?: Role[];
}

export const NAV: Record<NavItem['key'], NavItem> = {
  home: { to: '/', key: 'home', icon: House },
  clock: { to: '/clock', key: 'clock', icon: Clock },
  schedule: { to: '/schedule', key: 'schedule', icon: CalendarDays },
  absences: { to: '/absences', key: 'absences', icon: CalendarOff, roles: ['ADMIN', 'MANAGER', 'EMPLOYEE', 'INSPECTOR'] },
  expenses: { to: '/expenses', key: 'expenses', icon: Receipt },
  documents: { to: '/documents', key: 'documents', icon: FileText },
  reports: { to: '/reports', key: 'reports', icon: FileDown },
  timesheets: { to: '/timesheets', key: 'timesheets', icon: ClipboardCheck, roles: ['ADMIN', 'MANAGER', 'INSPECTOR'] },
  team: { to: '/team', key: 'team', icon: Users, roles: ['ADMIN', 'MANAGER', 'INSPECTOR'] },
  alerts: { to: '/alerts', key: 'alerts', icon: ShieldAlert, roles: ['ADMIN', 'MANAGER', 'INSPECTOR'] },
  sites: { to: '/sites', key: 'sites', icon: Coins, roles: ['ADMIN'] },
  locations: { to: '/locations', key: 'locations', icon: MapPin },
  company: { to: '/company', key: 'company', icon: Building2, roles: ['ADMIN'] },
  settings: { to: '/settings', key: 'settings', icon: Settings },
};

export const GENERAL: NavItem[] = [NAV.home, NAV.clock, NAV.schedule, NAV.absences, NAV.expenses, NAV.documents, NAV.reports];
export const MANAGEMENT: NavItem[] = [NAV.timesheets, NAV.alerts, NAV.team, NAV.sites, NAV.locations, NAV.company];

export const visible = (item: NavItem, role: Role | null): boolean =>
  !item.roles || (role !== null && item.roles.includes(role));
