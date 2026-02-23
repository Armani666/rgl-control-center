import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AuthService } from '../../../core/services/auth.service';

type AuthMode = 'login' | 'signup';

@Component({
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  mode: AuthMode = 'login';
  loading = false;
  errorMessage = '';
  infoMessage = '';
  private redirectTo = '/products';

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.redirectTo = params.get('redirectTo') || '/products';
    });
  }

  setMode(mode: AuthMode): void {
    this.mode = mode;
    this.errorMessage = '';
    this.infoMessage = '';
  }

  async submit(): Promise<void> {
    this.errorMessage = '';
    this.infoMessage = '';
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      return;
    }

    this.loading = true;
    const { email, password } = this.form.getRawValue();

    try {
      if (this.mode === 'login') {
        await this.authService.signIn(email, password);
        await this.router.navigateByUrl(this.redirectTo);
      } else {
        await this.authService.signUp(email, password);
        this.infoMessage =
          'Cuenta creada. Si Supabase exige confirmación por email, revisa tu bandeja antes de iniciar sesión.';
        if (this.authService.currentSession) {
          await this.router.navigateByUrl(this.redirectTo);
        } else {
          this.setMode('login');
        }
      }
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo continuar.';
    } finally {
      this.loading = false;
    }
  }
}
