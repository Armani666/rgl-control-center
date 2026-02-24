import { Injectable } from '@angular/core';
import { Observable, Subject, from, merge, switchMap, timer } from 'rxjs';

import { UserProfile, UserRole } from '../../shared/models/auth-profile.model';
import { assertSupabaseConfigured, supabase } from '../supabase/supabase';

@Injectable({ providedIn: 'root' })
export class UserAdminService {
  private readonly refresh$ = new Subject<void>();

  getProfiles$(): Observable<UserProfile[]> {
    return this.poll(() => this.fetchProfiles());
  }

  async updateUserRole(userId: string, role: UserRole): Promise<void> {
    assertSupabaseConfigured();

    const { error } = await supabase
      .from('profiles')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) {
      throw new Error(error.message);
    }

    this.refresh$.next();
  }

  async setUserActive(userId: string, active: boolean): Promise<void> {
    assertSupabaseConfigured();

    const { error } = await supabase
      .from('profiles')
      .update({ active, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) {
      throw new Error(error.message);
    }

    this.refresh$.next();
  }

  private async fetchProfiles(): Promise<UserProfile[]> {
    assertSupabaseConfigured();

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => mapProfile(row as Record<string, unknown>));
  }

  private poll<T>(loader: () => Promise<T>): Observable<T> {
    return merge(timer(0, 7000), this.refresh$).pipe(switchMap(() => from(loader())));
  }
}

function mapProfile(row: Record<string, unknown>): UserProfile {
  return {
    id: String(row['id'] ?? ''),
    email: String(row['email'] ?? ''),
    fullName: String(row['full_name'] ?? ''),
    role: toRole(row['role']),
    commissionRate: row['commission_rate'] == null ? undefined : Number(row['commission_rate'] ?? 0),
    active: Boolean(row['active'] ?? true),
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at'])
  };
}

function toRole(value: unknown): UserRole {
  if (value === 'super_admin' || value === 'admin' || value === 'almacen' || value === 'ventas') {
    return value;
  }

  return 'admin';
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
