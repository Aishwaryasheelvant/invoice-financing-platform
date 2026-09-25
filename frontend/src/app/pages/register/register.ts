import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';
import { UserRole } from '../../core/models/user.model';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.html',
  styleUrl: './register.css',
})
export class Register {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);

  readonly roles: Array<{ value: Exclude<UserRole, 'admin'>; label: string }> = [
    { value: 'sme', label: 'SME (invoice seller)' },
    { value: 'buyer', label: 'Buyer' },
    { value: 'financier', label: 'Financier' },
  ];

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(10)]],
    role: ['sme' as Exclude<UserRole, 'admin'>, [Validators.required]],
    companyName: ['', [Validators.required]],
  });

  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly registeredEmail = signal<string | null>(null);

  submit(): void {
    if (this.form.invalid || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);

    const payload = this.form.getRawValue();
    this.authService.register(payload).subscribe({
      next: (user) => {
        this.submitting.set(false);
        this.registeredEmail.set(user.email);
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        const message = err.error?.message;
        this.errorMessage.set(Array.isArray(message) ? message.join(', ') : (message ?? 'Registration failed'));
      },
    });
  }
}
