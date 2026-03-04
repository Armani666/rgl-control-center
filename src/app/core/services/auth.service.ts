import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AuthChangeEvent, Session, User } from '@supabase/supabase-js';

import { UserProfile, UserRole } from '../../shared/models/auth-profile.model';
import { assertSupabaseConfigured, supabase } from '../supabase/supabase';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly sessionSubject = new BehaviorSubject<Session | null>(null);
  private readonly userSubject = new BehaviorSubject<User | null>(null);
  private readonly profileSubject = new BehaviorSubject<UserProfile | null>(null);
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  readonly session$ = this.sessionSubject.asObservable();
  readonly user$ = this.userSubject.asObservable();
  readonly profile$ = this.profileSubject.asObservable();

  constructor() {
    this.bootstrapAuthListener();
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!this.initPromise) {
      this.initPromise = this.loadInitialSession();
    }

    await this.initPromise;
  }

  get currentSession(): Session | null {
    return this.sessionSubject.value;
  }

  get currentUser(): User | null {
    return this.userSubject.value;
  }

  get currentProfile(): UserProfile | null {
    return this.profileSubject.value;
  }

  hasAnyRole(...roles: UserRole[]): boolean {
    const profile = this.profileSubject.value;
    return !!profile && roles.includes(profile.role);
  }

  hasRole(role: UserRole): boolean {
    return this.profileSubject.value?.role === role;
  }

  canManageUsers(): boolean {
    return this.hasAnyRole('super_admin', 'admin');
  }

  canEditUsers(): boolean {
    return this.hasRole('super_admin');
  }

  canManageProducts(): boolean {
    return this.hasAnyRole('super_admin', 'admin', 'almacen');
  }

  canManageInventory(): boolean {
    return this.hasAnyRole('super_admin', 'admin', 'almacen');
  }

  canRegisterSales(): boolean {
    return this.hasAnyRole('super_admin', 'ventas');
  }

  canManageProcurement(): boolean {
    return this.hasAnyRole('super_admin', 'admin', 'almacen');
  }

  async signIn(email: string, password: string): Promise<void> {
    assertSupabaseConfigured();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });

    if (error) {
      throw new Error(error.message);
    }

    await this.setSession(data.session);
  }

  async signUp(email: string, password: string): Promise<void> {
    assertSupabaseConfigured();

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password
    });

    if (error) {
      throw new Error(error.message);
    }

    await this.setSession(data.session ?? null);
  }

  async signOut(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw new Error(error.message);
    }
  }

  private bootstrapAuthListener(): void {
    supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      void this.setSession(session);
    });
  }

  private async loadInitialSession(): Promise<void> {
    assertSupabaseConfigured();

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      throw new Error(error.message);
    }

    await this.setSession(data.session);
    this.initialized = true;
  }

  private async setSession(session: Session | null): Promise<void> {
    this.sessionSubject.next(session);
    const user = session?.user ?? null;
    this.userSubject.next(user);
    if (!user) {
      this.profileSubject.next(null);
      return;
    }

    try {
      const profile = await this.fetchOrCreateProfile(user);
      this.profileSubject.next(profile);
    } catch (error) {
      console.warn('No se pudo cargar el perfil de usuario.', error);
      this.profileSubject.next(null);
    }
  }

  private async fetchOrCreateProfile(user: User): Promise<UserProfile> {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) {
      throw new Error(error.message);
    }

    if (data) {
      return mapProfile(data as Record<string, unknown>, user.email ?? '');
    }

    const payload = {
      id: user.id,
      email: user.email?.trim() || '',
      full_name: (user.user_metadata?.['full_name'] as string | undefined)?.trim() || '',
      role: 'admin',
      active: true
    };

    const { data: created, error: createError } = await supabase
      .from('profiles')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();

    if (createError) {
      throw new Error(createError.message);
    }

    return mapProfile(created as Record<string, unknown>, user.email ?? '');
  }
}

function mapProfile(row: Record<string, unknown>, fallbackEmail: string): UserProfile {
  return {
    id: String(row['id'] ?? ''),
    email: String(row['email'] ?? fallbackEmail ?? ''),
    fullName: String(row['full_name'] ?? ''),
    role: toRole(row['role']),
    commissionRate: row['commission_rate'] == null ? undefined : Number(row['commission_rate'] ?? 0),
    active: Boolean(row['active'] ?? true),
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at'])
  };
}

function toRole(value: unknown): UserRole {
  const normalized = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z_]/g, '');

  if (normalized === 'super_admin' || normalized === 'admin' || normalized === 'almacen' || normalized === 'ventas') {
    return normalized;
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
