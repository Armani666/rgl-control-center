import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AuthChangeEvent, Session, User } from '@supabase/supabase-js';

import { assertSupabaseConfigured, supabase } from '../supabase/supabase';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly sessionSubject = new BehaviorSubject<Session | null>(null);
  private readonly userSubject = new BehaviorSubject<User | null>(null);
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  readonly session$ = this.sessionSubject.asObservable();
  readonly user$ = this.userSubject.asObservable();

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

  async signIn(email: string, password: string): Promise<void> {
    assertSupabaseConfigured();

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  async signUp(email: string, password: string): Promise<void> {
    assertSupabaseConfigured();

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  async signOut(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw new Error(error.message);
    }
  }

  private bootstrapAuthListener(): void {
    supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      this.setSession(session);
    });
  }

  private async loadInitialSession(): Promise<void> {
    assertSupabaseConfigured();

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      throw new Error(error.message);
    }

    this.setSession(data.session);
    this.initialized = true;
  }

  private setSession(session: Session | null): void {
    this.sessionSubject.next(session);
    this.userSubject.next(session?.user ?? null);
  }
}
